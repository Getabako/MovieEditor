import type {
  EDL,
  PresetId,
  PresetOptions,
  TextOverlay,
  Transcript,
} from "./types";
import { applyCuts, sourceToOutput, newOverlayId, sanitizeClips, remapOverlays } from "./edl";
import { SPEAKER_COLORS, DEFAULT_SUBTITLE_COLOR } from "./subtitle-style";
import { detectSilences } from "./ffmpeg";

// ============================================================================
// ワンクリック・プリセット処理。
// チェックを付けた処理をまとめて適用する。
//
// 設計: カット系プリセットは「元動画時刻のカット区間」を出すだけにして、
// 最後にまとめて applyCuts する（座標系が元動画で統一されるので合成が安全）。
// その後に字幕(autoSubtitle)を、カット後の出力タイムラインへマッピングして載せる。
// ============================================================================

const DEFAULT_FILLERS = [
  "えー", "えーと", "えっと", "えと", "あのー", "あの", "そのー",
  "あー", "うーん", "んー", "んーと", "なんか", "まあ", "ええと",
];

export type PresetContext = {
  edl: EDL;
  transcript: Transcript | null;
  options?: PresetOptions;
  onProgress?: (msg: string) => void;
};

export type PresetResult = {
  edl: EDL;
  /** 各プリセットが何をしたかの短い説明（履歴ラベル/UI表示用） */
  labels: string[];
  /** transcript が必要なのに無くてスキップしたプリセット */
  skipped: { preset: PresetId; reason: string }[];
};

export const PRESET_LABELS: Record<PresetId, string> = {
  trimSilence: "長い無音/間を自動カット",
  removeFillers: "フィラー語(えー/あー)をカット",
  autoSubtitle: "喋りに自動字幕",
  tightenGaps: "間を詰める(ジャンプカット圧縮)",
  trimEnds: "冒頭・末尾の無音をトリム",
  cleanupRepeats: "繰り返し再生/ぶつ切りを掃除",
  speedUp: "全体の再生速度を上げる",
  colorSpeakers: "話者ごとに字幕の色を変える",
  normalizeAudio: "音量をノーマライズ",
};

export const PRESET_NEEDS_TRANSCRIPT: Record<PresetId, boolean> = {
  trimSilence: false,
  removeFillers: true,
  autoSubtitle: true,
  tightenGaps: true,
  trimEnds: false,
  cleanupRepeats: false,
  speedUp: false,
  colorSpeakers: false,
  normalizeAudio: false,
};

export async function applyPresets(
  presets: PresetId[],
  ctx: PresetContext,
): Promise<PresetResult> {
  const { edl, transcript, options, onProgress } = ctx;
  const opt: Required<PresetOptions> = {
    silenceMinSec: options?.silenceMinSec ?? 0.8,
    silenceThresholdDb: options?.silenceThresholdDb ?? -30,
    paddingSec: options?.paddingSec ?? 0.12,
    extraFillers: options?.extraFillers ?? [],
    subtitleMaxChars: options?.subtitleMaxChars ?? 18,
    speedFactor: options?.speedFactor ?? 1.5,
    colorBySpeaker: options?.colorBySpeaker ?? false,
  };

  const labels: string[] = [];
  const skipped: { preset: PresetId; reason: string }[] = [];
  const cutRanges: Array<[number, number]> = [];
  let doSubtitle = false;
  let doNormalize = false;
  let doCleanup = false;
  let doColorSpeakers = false;
  let speedFactor = 1;

  // --- 無音/間検出（trimSilence / trimEnds で共有） ---
  // 文字起こしがある時は「発話の境界」でしか切らないので音声無音解析は不要。
  let silences: Array<[number, number]> | null = null;
  const needSilence =
    !transcript &&
    (presets.includes("trimSilence") || presets.includes("trimEnds"));
  if (needSilence) {
    onProgress?.("無音区間を解析中…");
    silences = await detectSilences(
      edl.source.path,
      opt.silenceThresholdDb,
      Math.min(0.4, opt.silenceMinSec),
      (sec) => onProgress?.(`無音解析 ${fmt(sec)} / ${fmt(edl.source.durationSec)}`),
    );
  }

  for (const preset of presets) {
    if (PRESET_NEEDS_TRANSCRIPT[preset] && !transcript) {
      skipped.push({ preset, reason: "文字起こし(transcript)が必要です" });
      continue;
    }
    switch (preset) {
      case "trimSilence": {
        // 文字起こしがあれば「発話セグメント間の無言ギャップ」だけを切る。
        // → カットは必ず喋り終わってから。字幕の途中で切れず、無言の画面だけの間も除去。
        const ranges = transcript
          ? speechSilenceRanges(transcript, opt.silenceMinSec, opt.paddingSec, edl.source.durationSec)
          : (silences ?? [])
              .filter(([s, e]) => e - s >= opt.silenceMinSec)
              .map(([s, e]) => shrink(s, e, opt.paddingSec, edl.source.durationSec));
        cutRanges.push(...ranges);
        labels.push(`${PRESET_LABELS.trimSilence}（${ranges.length}箇所）`);
        break;
      }
      case "trimEnds": {
        const ends = transcript
          ? speechEndsRanges(transcript, opt.paddingSec, edl.source.durationSec)
          : leadingTrailingSilence(silences ?? [], edl.source.durationSec, opt.silenceMinSec);
        cutRanges.push(...ends);
        labels.push(`${PRESET_LABELS.trimEnds}（${ends.length}箇所）`);
        break;
      }
      case "removeFillers": {
        const fillers = new Set([...DEFAULT_FILLERS, ...opt.extraFillers]);
        const ranges = fillerRanges(transcript!, fillers, opt.paddingSec, edl.source.durationSec);
        cutRanges.push(...ranges);
        labels.push(`${PRESET_LABELS.removeFillers}（${ranges.length}語）`);
        break;
      }
      case "tightenGaps": {
        const ranges = speechGapRanges(transcript!, opt.paddingSec, opt.silenceMinSec);
        cutRanges.push(...ranges);
        labels.push(`${PRESET_LABELS.tightenGaps}（${ranges.length}箇所）`);
        break;
      }
      case "autoSubtitle":
        doSubtitle = true;
        break;
      case "cleanupRepeats":
        doCleanup = true;
        break;
      case "speedUp":
        speedFactor = opt.speedFactor > 0 ? opt.speedFactor : 1.5;
        break;
      case "colorSpeakers":
        doColorSpeakers = true;
        break;
      case "normalizeAudio":
        doNormalize = true;
        break;
    }
  }

  // --- クリップ変更（カット → 掃除 → 速度）をまとめて適用し、最後に1回だけ
  //     既存オーバーレイを新タイムラインへ載せ直す（字幕やタイトルのズレ防止） ---
  const originalClips = edl.clips;
  let clips = originalClips;
  let cleanupRemoved = 0;
  if (cutRanges.length) clips = applyCuts(clips, cutRanges);
  if (doCleanup || cutRanges.length) {
    const before = clips.length;
    clips = sanitizeClips(clips);
    cleanupRemoved = before - clips.length;
  }
  if (speedFactor !== 1) {
    clips = clips.map((c) => ({ ...c, speed: speedFactor }));
  }

  const clipsChanged = clips !== originalClips;
  let overlays = edl.overlays ?? [];
  if (clipsChanged && overlays.length) {
    overlays = remapOverlays(originalClips, clips, overlays);
  }
  let nextEdl: EDL = { ...edl, clips, overlays };

  if (doCleanup) {
    labels.push(`${PRESET_LABELS.cleanupRepeats}（${cleanupRemoved}個のかけらを除去）`);
  }
  if (speedFactor !== 1) {
    labels.push(`${PRESET_LABELS.speedUp}（${speedFactor}倍速）`);
  }

  // --- 字幕（カット/速度反映後のタイムラインへマッピング） ---
  if (doSubtitle && transcript) {
    const subs = buildSubtitles(
      nextEdl,
      transcript,
      opt.subtitleMaxChars,
      opt.colorBySpeaker,
      opt.silenceMinSec,
    );
    // 既存の自動字幕は置き換える
    const kept = nextEdl.overlays.filter(
      (o) => !(o.type === "text" && (o as TextOverlay).isSubtitle),
    );
    nextEdl = { ...nextEdl, overlays: [...kept, ...subs] };
    labels.push(
      `${PRESET_LABELS.autoSubtitle}（${subs.length}行${opt.colorBySpeaker ? "・話者色分け" : ""}）`,
    );
  }

  // --- 話者ごとに字幕色を変える（既存の字幕にも適用） ---
  // 自動字幕の有無に関わらず、現在の字幕オーバーレイを出力時刻順に並べ、
  // 字幕間の空きが大きい所を話者交代とみなして色を交互に振る。
  if (doColorSpeakers) {
    const recolored = recolorSubtitlesBySpeaker(nextEdl.overlays);
    nextEdl = { ...nextEdl, overlays: recolored.overlays };
    labels.push(`${PRESET_LABELS.colorSpeakers}（${recolored.count}行）`);
  }

  // --- 音量ノーマライズ（書き出し時に適用するフラグ） ---
  if (doNormalize) {
    nextEdl = { ...nextEdl, audio: { ...(nextEdl.audio ?? {}), normalize: true } };
    labels.push(PRESET_LABELS.normalizeAudio);
  }

  return { edl: nextEdl, labels, skipped };
}

/** 既存の字幕オーバーレイを、間（空き時間）から話者を推定して色分けする。 */
function recolorSubtitlesBySpeaker(
  overlays: EDL["overlays"],
): { overlays: EDL["overlays"]; count: number } {
  const SPEAKER_GAP = 0.6; // 字幕間がこれ以上空いたら話者交代の可能性
  // 字幕だけ抜き出して時刻順に
  const subIdx = overlays
    .map((o, i) => ({ o, i }))
    .filter((x) => x.o.type === "text" && (x.o as TextOverlay).isSubtitle)
    .sort((a, b) => a.o.startSec - b.o.startSec);

  const colorById = new Map<string, { color: string; speaker: string }>();
  let speakerIdx = 0;
  let prevEnd = -Infinity;
  for (const { o } of subIdx) {
    if (o.startSec - prevEnd >= SPEAKER_GAP && prevEnd !== -Infinity) {
      speakerIdx = (speakerIdx + 1) % 2; // 2人想定で交互
    }
    prevEnd = Math.max(prevEnd, o.endSec);
    colorById.set(o.id, {
      color: SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length],
      speaker: String.fromCharCode(65 + speakerIdx),
    });
  }

  const next = overlays.map((o) => {
    const c = colorById.get(o.id);
    if (!c || o.type !== "text") return o;
    return { ...(o as TextOverlay), color: c.color, speaker: c.speaker, variant: "subtitle" as const };
  });
  return { overlays: next, count: subIdx.length };
}

// ---- helpers ----

function shrink(s: number, e: number, pad: number, dur: number): [number, number] {
  // 無音の前後に pad だけ余白を残してカット
  return [clamp(s + pad, 0, dur), clamp(e - pad, 0, dur)];
}

function leadingTrailingSilence(
  silences: Array<[number, number]>,
  dur: number,
  minSec: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of silences) {
    if (s <= 0.05 && e - s >= minSec) out.push([0, e - 0.1]); // 冒頭
    if (e >= dur - 0.05 && e - s >= minSec) out.push([s + 0.1, dur]); // 末尾
  }
  return out;
}

function fillerRanges(
  transcript: Transcript,
  fillers: Set<string>,
  pad: number,
  dur: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const seg of transcript.segments) {
    for (const w of seg.words ?? []) {
      const norm = w.text.replace(/[、。,.「」\s]/g, "");
      if (fillers.has(norm)) {
        out.push([clamp(w.startSec - pad, 0, dur), clamp(w.endSec + pad, 0, dur)]);
      }
    }
  }
  return out;
}

/** 発話の最小単位（句）。startSec/endSec は実際に喋っている区間。 */
type Span = { startSec: number; endSec: number; text: string };

/**
 * 文字起こしを句(word)単位の Span 列に展開する。
 * whisper の word タイムスタンプは実際の発話の開始/終了を表すので、
 * これを使うと「セグメント境界では見えない本当の無言の間」を捉えられる。
 */
function flattenWords(transcript: Transcript): Span[] {
  const out: Span[] = [];
  for (const s of transcript.segments) {
    if (s.words && s.words.length) {
      for (const w of s.words) {
        const t = w.text.trim();
        if (t) out.push({ startSec: w.startSec, endSec: Math.max(w.endSec, w.startSec), text: t });
      }
    } else {
      const t = (s.text || "").trim();
      if (t) out.push({ startSec: s.startSec, endSec: s.endSec, text: t });
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/**
 * 句と句の間の「無言ギャップ」をカット区間として返す（発話境界でのみ切る）。
 * 先頭・末尾の無言も含めて除去する。padでカット前後に小さな“間”を残す。
 * → カットは必ず喋り終わってから。字幕の途中では切れない。
 */
function speechSilenceRanges(
  transcript: Transcript,
  minSec: number,
  pad: number,
  dur: number,
): Array<[number, number]> {
  const words = flattenWords(transcript);
  if (!words.length) return [];
  const out: Array<[number, number]> = [];
  if (words[0].startSec >= minSec) out.push([0, Math.max(0, words[0].startSec - pad)]);
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].startSec - words[i].endSec;
    if (gap >= minSec) out.push([words[i].endSec + pad, words[i + 1].startSec - pad]);
  }
  const last = words[words.length - 1];
  if (dur - last.endSec >= minSec) out.push([last.endSec + pad, dur]);
  return out.filter(([s, e]) => e - s > 0.05);
}

/** 発話ベースの「冒頭・末尾の無言」だけを返す */
function speechEndsRanges(
  transcript: Transcript,
  pad: number,
  dur: number,
): Array<[number, number]> {
  const words = flattenWords(transcript);
  if (!words.length) return [];
  const out: Array<[number, number]> = [];
  if (words[0].startSec > 0.15) out.push([0, Math.max(0, words[0].startSec - pad)]);
  const last = words[words.length - 1];
  if (dur - last.endSec > 0.15) out.push([last.endSec + pad, dur]);
  return out.filter(([s, e]) => e - s > 0.05);
}

function speechGapRanges(
  transcript: Transcript,
  pad: number,
  minGap: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const segs = transcript.segments;
  for (let i = 0; i < segs.length - 1; i++) {
    const gapStart = segs[i].endSec;
    const gapEnd = segs[i + 1].startSec;
    if (gapEnd - gapStart >= minGap) {
      out.push([gapStart + pad, gapEnd - pad]);
    }
  }
  return out;
}

// 字幕テキストから除去するフィラー（長いものから先に消す）。
// あの/その/まあ/なんか等は語の一部を壊しやすいので、明確なフィラーだけに絞る。
const SUBTITLE_FILLERS = [
  "えーっと", "えーと", "ええっと", "ええと", "えっと",
  "あのー", "あのう", "そのー", "そのう",
  "うーんと", "うーん", "んーと", "んー",
  "あーっと", "えー", "あー",
];
const FILLER_RE = new RegExp(`(${SUBTITLE_FILLERS.join("|")})`, "g");

/** 字幕テキストからフィラーを除去して整形 */
function stripFillers(text: string): string {
  return text
    .replace(FILLER_RE, "")
    .replace(/[、，]{2,}/g, "、")
    .replace(/^[、，。\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 句(Span)を、見やすい長さの字幕チャンクにまとめる。
 *  maxGap 以上空く所では結合しない（= カット位置をまたがない）ので、字幕が切られない。 */
type SubChunk = { startSec: number; endSec: number; text: string };
function mergeSegments(
  spans: Span[],
  minChars: number,
  maxChunkChars: number,
  maxGap: number,
): SubChunk[] {
  const SENTENCE_END = /[。！？!?]$/;
  const out: SubChunk[] = [];
  for (const seg of spans) {
    const text = seg.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    const gap = last ? seg.startSec - last.endSec : Infinity;
    const lastLen = last ? Array.from(last.text).length : 0;
    const combinedLen = lastLen + Array.from(text).length;
    // 直前が短すぎる/文の途中で、間も詰まっていて、合計が長すぎないなら結合
    if (
      last &&
      gap < maxGap &&
      combinedLen <= maxChunkChars &&
      (lastLen < minChars || Array.from(text).length < 3 || !SENTENCE_END.test(last.text))
    ) {
      last.text += text;
      last.endSec = seg.endSec;
    } else {
      out.push({ startSec: seg.startSec, endSec: seg.endSec, text });
    }
  }
  return out;
}

/** transcript を、カット後の出力タイムラインに載る字幕オーバーレイへ変換 */
function buildSubtitles(
  edl: EDL,
  transcript: Transcript,
  maxChars: number,
  colorBySpeaker = false,
  cutGapSec = 0.8,
): TextOverlay[] {
  const subs: TextOverlay[] = [];
  const fontSize = Math.round(edl.output.height * 0.05);
  // 解像度とフォントから「1行に確実に収まる文字数」を求め、指定値と小さい方を使う
  const fitChars = Math.max(8, Math.floor((edl.output.width * 0.8) / (fontSize * 1.08)));
  const perLine = Math.max(8, Math.min(maxChars, fitChars));

  // 句(word)単位に展開して、カット位置(=cutGapSec以上の無言)をまたがないように結合する。
  // mergeの結合しきい値はカットしきい値より必ず小さくする → 字幕がカットをまたがない。
  const mergeGap = Math.max(0.3, Math.min(0.6, cutGapSec - 0.1));
  const chunks = mergeSegments(flattenWords(transcript), 6, perLine * 2, mergeGap);

  // 話者推定: チャンク間の無音が長い箇所を「話者交代」とみなして色を交互に振る簡易ヒューリスティック
  const SPEAKER_GAP = 0.7;
  let speakerIdx = 0;
  for (let i = 0; i < chunks.length; i++) {
    const seg = chunks[i];
    const text = seg.text.trim();
    if (colorBySpeaker && i > 0) {
      const gap = seg.startSec - chunks[i - 1].endSec;
      if (gap >= SPEAKER_GAP) speakerIdx = (speakerIdx + 1) % 2;
    }
    // フィラー(えーと等)を字幕テキストから除去
    const cleaned = stripFillers(text);
    if (!cleaned) continue;
    const mid = (seg.startSec + seg.endSec) / 2;
    const outStart = sourceToOutput(edl.clips, seg.startSec);
    const outEnd = sourceToOutput(edl.clips, seg.endSec);
    if (outStart == null && sourceToOutput(edl.clips, mid) == null) continue;
    const startSec = outStart ?? sourceToOutput(edl.clips, mid)!;
    const endSec = outEnd != null && outEnd > startSec ? outEnd : startSec + 2;
    const color = colorBySpeaker
      ? SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length]
      : DEFAULT_SUBTITLE_COLOR;

    // 全行に折り返してから「2行ずつ」の字幕に分け、長文でも各字幕は最大2行に収める。
    // 表示時間は文字数で按分する。
    const allLines = splitLines(cleaned, perLine).map((l) => l.text);
    const totalChars = allLines.reduce((a, l) => a + Array.from(l).length, 0) || 1;
    let acc = 0;
    for (let li = 0; li < allLines.length; li += 2) {
      const pair = allLines.slice(li, li + 2);
      const pairChars = pair.reduce((a, l) => a + Array.from(l).length, 0);
      const segDur = endSec - startSec;
      const s = startSec + (acc / totalChars) * segDur;
      acc += pairChars;
      const e = startSec + (acc / totalChars) * segDur;
      subs.push({
        id: newOverlayId(),
        type: "text",
        text: pair.join("\n"),
        startSec: s,
        endSec: Math.max(s + 0.2, e),
        x: 0.5,
        y: 0.85,
        fontSize,
        color,
        fontWeight: 800,
        align: "center",
        isSubtitle: true,
        variant: "subtitle",
        speaker: colorBySpeaker ? String.fromCharCode(65 + speakerIdx) : undefined,
      });
    }
  }
  // 連続する字幕が時間的に重ならないよう、各字幕の終わりを次の字幕の開始までに収める
  const sorted = subs.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].endSec > sorted[i + 1].startSec) {
      sorted[i].endSec = Math.max(sorted[i].startSec + 0.3, sorted[i + 1].startSec - 0.02);
    }
  }
  return sorted;
}

const BREAK_AFTER_PUNCT = "、。！？”」』）"; // この直後で改行すると綺麗
const BREAK_AFTER_PARTICLE = "はがをにでとものへやかねよわ・,，"; // 助詞等の直後も良い区切り
function isAsciiWordChar(ch: string): boolean {
  return /[A-Za-z0-9.\-_/+#]/.test(ch);
}

/**
 * 日本語字幕を見やすく折り返す。
 * - 行数を決めて均等割りし、各行を「助詞・句読点の直後」で区切る
 * - Node.js / Claude Code のような英単語・記号の途中では割らない
 * - 1〜2文字だけが行に残る不格好な改行を避ける
 */
function splitLines(text: string, maxChars: number): Array<{ text: string }> {
  const t = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  if (chars.length <= maxChars) return [{ text: t }];

  const numLines = Math.ceil(chars.length / maxChars);
  const out: string[] = [];
  let start = 0;
  for (let li = 0; li < numLines - 1; li++) {
    const remaining = chars.length - start;
    const remLines = numLines - li;
    const ideal = start + Math.ceil(remaining / remLines);
    const cut = findBreakPoint(chars, start, ideal, maxChars);
    out.push(chars.slice(start, cut).join(""));
    start = cut;
  }
  out.push(chars.slice(start).join(""));
  return out.filter((s) => s.length > 0).map((text) => ({ text }));
}

/** start以降で、idealに近く綺麗な改行位置(その位置の手前までを1行にする)を返す */
function findBreakPoint(chars: string[], start: number, ideal: number, maxChars: number): number {
  const n = chars.length;
  const minCut = start + 2; // 先頭1文字だけの行を作らない
  const maxCut = Math.min(n - 1, start + maxChars); // 1行がmaxCharsを超えない & 末尾を1文字以上残す
  const target = Math.max(minCut, Math.min(ideal, maxCut));
  const window = Math.max(4, Math.ceil(maxChars * 0.45));

  let best = -1;
  let bestScore = -Infinity;
  for (let c = Math.max(minCut, target - window); c <= Math.min(maxCut, target + window); c++) {
    const prev = chars[c - 1];
    const cur = chars[c];
    // 英単語・記号の途中では割らない
    if (isAsciiWordChar(prev) && isAsciiWordChar(cur)) continue;
    let score: number;
    if (BREAK_AFTER_PUNCT.includes(prev)) score = 100;
    else if (BREAK_AFTER_PARTICLE.includes(prev)) score = 60;
    else if (!isAsciiWordChar(prev) && !isAsciiWordChar(cur)) score = 30;
    else score = 8;
    score -= Math.abs(c - target); // idealに近いほど良い
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best < 0 ? Math.min(maxCut, target) : best;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
