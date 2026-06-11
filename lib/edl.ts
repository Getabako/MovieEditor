import type { Clip, EDL, Overlay, SourceInfo, OutputInfo } from "./types";

/** これ未満の長さのクリップは「カットのかけら(スライバー)」とみなして掃除する */
export const MIN_CLIP_SEC = 0.3;
/** この秒数以下の隙間で隣り合うクリップは連続とみなして結合する */
export const MERGE_TOL_SEC = 0.05;

/** クリップの出力上の長さ（速度を考慮） */
export function clipOutputDuration(clip: Clip): number {
  const raw = Math.max(0, clip.srcEndSec - clip.srcStartSec);
  return raw / (clip.speed && clip.speed > 0 ? clip.speed : 1);
}

/** 出力タイムライン全体の尺（秒） */
export function totalDuration(edl: EDL): number {
  return edl.clips.reduce((a, c) => a + clipOutputDuration(c), 0);
}

/** 出力フレーム総数 */
export function totalFrames(edl: EDL): number {
  return Math.max(1, Math.round(totalDuration(edl) * edl.output.fps));
}

/** 各クリップの「出力開始秒」を前から積算したテーブル */
export function clipTimelineOffsets(edl: EDL): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const c of edl.clips) {
    offsets.push(acc);
    acc += clipOutputDuration(c);
  }
  return offsets;
}

/**
 * 出力タイムライン上の秒 -> 元動画上の秒 へのマッピング。
 * フレーム抽出やシーン特定で「今プレビューしている位置の元動画時刻」を出すのに使う。
 */
export function outputToSource(edl: EDL, outSec: number): number | null {
  return outputToSourceByClips(edl.clips, outSec);
}

/** outputToSource の clips 版（EDL を作る前の中間 clips に使える） */
export function outputToSourceByClips(clips: Clip[], outSec: number): number | null {
  let acc = 0;
  for (const c of clips) {
    const dur = clipOutputDuration(c);
    if (outSec < acc + dur || c === clips[clips.length - 1]) {
      const into = (outSec - acc) * (c.speed && c.speed > 0 ? c.speed : 1);
      return Math.min(c.srcEndSec, c.srcStartSec + Math.max(0, into));
    }
    acc += dur;
  }
  return null;
}

/**
 * 元動画上の秒 -> 出力タイムライン上の秒。
 * その元時刻がどのクリップにも含まれない（カット済み）なら null。
 * 字幕をカット後のタイムラインに正しく載せるのに使う。
 */
export function sourceToOutput(clips: Clip[], srcSec: number): number | null {
  let acc = 0;
  for (const c of clips) {
    if (srcSec >= c.srcStartSec && srcSec <= c.srcEndSec) {
      const into = (srcSec - c.srcStartSec) / (c.speed && c.speed > 0 ? c.speed : 1);
      return acc + into;
    }
    acc += clipOutputDuration(c);
  }
  return null;
}

/** 新規プロジェクトの初期 EDL：元動画まるごと1クリップ */
export function initialEDL(source: SourceInfo, output?: Partial<OutputInfo>): EDL {
  return {
    schema: 1,
    source,
    output: {
      width: output?.width ?? source.width,
      height: output?.height ?? source.height,
      fps: output?.fps ?? source.fps,
    },
    clips: [
      {
        id: "clip-0",
        srcStartSec: 0,
        srcEndSec: source.durationSec,
      },
    ],
    overlays: [],
    audio: {},
  };
}

let idCounter = 0;
export function newClipId(): string {
  idCounter += 1;
  return `clip-${Date.now().toString(36)}-${idCounter}`;
}
export function newOverlayId(): string {
  idCounter += 1;
  return `ov-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * EDL の最低限のバリデーション。Codex 出力などを受け入れる前に通す。
 * 不正なら理由を投げる。
 */
export function validateEDL(edl: unknown): EDL {
  if (!edl || typeof edl !== "object") throw new Error("EDL がオブジェクトではありません");
  const e = edl as EDL;
  if (e.schema !== 1) throw new Error(`未知のスキーマ: ${(e as any).schema}`);
  if (!e.source || typeof e.source.path !== "string") throw new Error("source.path が不正");
  if (!e.output || !e.output.fps) throw new Error("output が不正");
  if (!Array.isArray(e.clips)) throw new Error("clips が配列ではありません");
  for (const c of e.clips) {
    if (typeof c.srcStartSec !== "number" || typeof c.srcEndSec !== "number")
      throw new Error("clip の in/out が不正");
    if (c.srcEndSec < c.srcStartSec) throw new Error("clip の out < in");
  }
  if (!Array.isArray(e.overlays)) e.overlays = [];
  // クリップ ID 欠落を補完
  e.clips = e.clips.map((c, i) => ({ ...c, id: c.id || `clip-${i}` }));
  return e;
}

/**
 * 元動画上の [cutStart, cutEnd] 区間を全クリップから削除する（非破壊カット）。
 * クリップをまたぐ場合は分割して該当部分だけ除去する。
 */
export function cutSourceRange(clips: Clip[], cutStart: number, cutEnd: number): Clip[] {
  if (cutEnd <= cutStart) return clips;
  const out: Clip[] = [];
  for (const c of clips) {
    // 重なりなし
    if (c.srcEndSec <= cutStart || c.srcStartSec >= cutEnd) {
      out.push(c);
      continue;
    }
    // 前半が残る
    if (c.srcStartSec < cutStart) {
      out.push({ ...c, id: newClipId(), srcEndSec: cutStart });
    }
    // 後半が残る
    if (c.srcEndSec > cutEnd) {
      out.push({ ...c, id: newClipId(), srcStartSec: cutEnd });
    }
  }
  return out.filter((c) => c.srcEndSec - c.srcStartSec > 0.001);
}

/**
 * 複数のカット区間（元動画時刻）をまとめて適用。
 * ranges は重複していてもよい（内部でソート&マージする）。
 */
export function applyCuts(clips: Clip[], ranges: Array<[number, number]>): Clip[] {
  const merged = mergeRanges(ranges);
  let result = clips;
  // 後ろから適用するとインデックスずれを気にしなくてよい
  for (let i = merged.length - 1; i >= 0; i--) {
    result = cutSourceRange(result, merged[i][0], merged[i][1]);
  }
  return result;
}

export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      out.push([r[0], r[1]]);
    }
  }
  return out;
}

// ============================================================================
// クリップ正規化（繰り返し再生・ぶつ切りの防止）
// 編集の結果、同じ元動画区間が複数回再生されたり（重複再生＝「繰り返し」）、
// カットのかけら(0.1〜0.3秒の極小クリップ)が残ると、視聴時に短い区間が
// 繰り返されているように見える。これを取り除く。
// ============================================================================

/** [s,e] から [cs,ce] を引いた残り（0〜2片） */
function subtractInterval(
  s: number,
  e: number,
  cs: number,
  ce: number,
): Array<[number, number]> {
  if (ce <= s || cs >= e) return [[s, e]]; // 重なりなし
  const out: Array<[number, number]> = [];
  if (cs > s) out.push([s, Math.min(cs, e)]);
  if (ce < e) out.push([Math.max(ce, s), e]);
  return out.filter(([a, b]) => b - a > 1e-6);
}

/**
 * 同じ元動画の瞬間が二度以上再生されないようにする（重複再生＝繰り返しの除去）。
 * 出力順を保ったまま、既に再生済みの元区間を後続クリップから削る。最初の出現を優先。
 */
export function removeRepeatedSource(clips: Clip[]): Clip[] {
  const covered: Array<[number, number]> = [];
  const out: Clip[] = [];
  for (const c of clips) {
    let pieces: Array<[number, number]> = [[c.srcStartSec, c.srcEndSec]];
    for (const cov of covered) {
      pieces = pieces.flatMap(([s, e]) => subtractInterval(s, e, cov[0], cov[1]));
    }
    for (const [s, e] of pieces) {
      if (e - s > 1e-6) out.push({ ...c, id: newClipId(), srcStartSec: s, srcEndSec: e });
    }
    covered.push([c.srcStartSec, c.srcEndSec]);
  }
  return out;
}

/** 隣り合うクリップが元動画上で連続(または僅差)なら1本に結合する。出力は不変。 */
export function mergeContiguousClips(clips: Clip[], tol = MERGE_TOL_SEC): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const prev = out[out.length - 1];
    const sameSpeed = (prev?.speed ?? 1) === (c.speed ?? 1);
    const sameVol = (prev?.volume ?? 1) === (c.volume ?? 1);
    if (
      prev &&
      sameSpeed &&
      sameVol &&
      c.srcStartSec >= prev.srcStartSec &&
      c.srcStartSec <= prev.srcEndSec + tol
    ) {
      prev.srcEndSec = Math.max(prev.srcEndSec, c.srcEndSec);
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/**
 * クリップ列を正規化する: 重複再生の除去 → 連続クリップの結合 → 極小かけらの除去。
 * これにより「繰り返し再生」「ぶつ切り」が出なくなる。
 */
export function sanitizeClips(
  clips: Clip[],
  minClipSec = MIN_CLIP_SEC,
): Clip[] {
  let out = removeRepeatedSource(clips);
  out = mergeContiguousClips(out);
  out = out.filter((c) => c.srcEndSec - c.srcStartSec >= minClipSec);
  // 全部消えてしまう異常時は最低1クリップ残す
  if (!out.length && clips.length) {
    const longest = [...clips].sort(
      (a, b) => b.srcEndSec - b.srcStartSec - (a.srcEndSec - a.srcStartSec),
    )[0];
    out = [{ ...longest, id: newClipId() }];
  }
  return out;
}

/**
 * クリップ構成が変わったとき、オーバーレイ(字幕など)を新タイムラインへ載せ直す。
 * 旧出力時刻→元動画時刻→新出力時刻 と変換し、削除された区間に乗っていたものは落とす。
 */
export function remapOverlays(
  oldClips: Clip[],
  newClips: Clip[],
  overlays: Overlay[],
): Overlay[] {
  const out: Overlay[] = [];
  for (const o of overlays) {
    const srcStart = outputToSourceByClips(oldClips, o.startSec);
    if (srcStart == null) continue;
    const ns = sourceToOutput(newClips, srcStart);
    if (ns == null) continue; // この字幕が乗っていた箇所はカットされた
    const srcEnd = outputToSourceByClips(oldClips, o.endSec);
    let ne = srcEnd != null ? sourceToOutput(newClips, srcEnd) : null;
    if (ne == null || ne <= ns) ne = ns + Math.max(0.4, o.endSec - o.startSec);
    out.push({ ...o, startSec: ns, endSec: ne });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/**
 * プレビュー用に「速度を1倍に戻した」EDL を返す（オーバーレイも追従）。
 * プレビューは映像を等速で再生するため、speed が乗ったままだと映像と字幕/音声が
 * ズレて見える（境界で繰り返しにも見える）。速度を抜いて同期した1倍版を見せる。
 * 書き出しは元の（速度付き）EDL を使う。
 */
export function stripSpeedForPreview(edl: EDL): EDL {
  if (!edl.clips.some((c) => c.speed && c.speed !== 1)) return edl;
  const clips = edl.clips.map((c) => ({ ...c, speed: 1 }));
  const overlays = edl.overlays?.length
    ? remapOverlays(edl.clips, clips, edl.overlays)
    : edl.overlays ?? [];
  return { ...edl, clips, overlays };
}

/** clips を正規化し、overlays も追従させた EDL を返す（出力の繰り返しを除去）。 */
export function normalizeEDL(edl: EDL, minClipSec = MIN_CLIP_SEC): EDL {
  const newClips = sanitizeClips(edl.clips, minClipSec);
  const changed =
    newClips.length !== edl.clips.length ||
    newClips.some(
      (c, i) =>
        Math.abs(c.srcStartSec - edl.clips[i].srcStartSec) > 1e-6 ||
        Math.abs(c.srcEndSec - edl.clips[i].srcEndSec) > 1e-6,
    );
  if (!changed) return edl;
  const overlays = edl.overlays?.length
    ? remapOverlays(edl.clips, newClips, edl.overlays)
    : edl.overlays;
  return { ...edl, clips: newClips, overlays: overlays ?? [] };
}
