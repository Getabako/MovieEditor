import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Transcript, TranscriptSegment, TranscriptWord } from "./types";

// ============================================================================
// whisper.cpp ラッパー。元動画の音声(16kHz wav)を文字起こしし、
// 単語/セグメントのタイムスタンプ付き Transcript に正規化する。
// バイナリ・モデルは環境変数で上書き可能。未検出ならセットアップ手順を投げる。
// ============================================================================

const HOME = os.homedir();

const BIN_CANDIDATES = [
  process.env.WHISPER_CLI,
  "whisper-cli",
  "whisper-cpp",
  path.join(HOME, "whisper.cpp/build/bin/whisper-cli"),
  path.join(HOME, "whisper.cpp/main"),
  "/opt/homebrew/bin/whisper-cli",
].filter(Boolean) as string[];

const MODEL_CANDIDATES = [
  process.env.WHISPER_MODEL,
  path.join(HOME, "whisper.cpp/models/ggml-large-v3-turbo.bin"),
  path.join(HOME, "whisper.cpp/models/ggml-large-v3.bin"),
  path.join(HOME, "whisper.cpp/models/ggml-medium.bin"),
  path.join(HOME, ".whisper/ggml-large-v3-turbo.bin"),
].filter(Boolean) as string[];

function which(cmd: string): string | null {
  if (cmd.includes("/")) return fs.existsSync(cmd) ? cmd : null;
  const dirs = (process.env.PATH ?? "").split(":");
  for (const d of dirs) {
    const p = path.join(d, cmd);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function detectWhisper(): { bin: string; model: string } | null {
  let bin: string | null = null;
  for (const c of BIN_CANDIDATES) {
    const found = which(c);
    if (found) { bin = found; break; }
  }
  if (!bin) return null;
  let model: string | null = null;
  for (const m of MODEL_CANDIDATES) {
    if (fs.existsSync(m)) { model = m; break; }
  }
  if (!model) return null;
  return { bin, model };
}

export const WHISPER_SETUP_HINT =
  "whisper.cpp が見つかりません。次でセットアップしてください:\n" +
  "  brew install whisper-cpp\n" +
  "  # 日本語モデルを取得 (例: large-v3-turbo)\n" +
  "  mkdir -p ~/whisper.cpp/models && cd ~/whisper.cpp/models\n" +
  "  curl -L -o ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin\n" +
  "  # もしくは環境変数で明示: WHISPER_CLI=/path/to/whisper-cli WHISPER_MODEL=/path/to/model.bin";

/**
 * whisper.cpp を実行して JSON(full) を出力させ、Transcript に正規化する。
 * onProgress は whisper の進捗行(%)を拾う。
 */
export async function transcribe(
  wavPath: string,
  outJsonBase: string, // 拡張子なしのベースパス（whisper が .json を付ける）
  opts: { language?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<Transcript> {
  const found = detectWhisper();
  if (!found) throw new Error(WHISPER_SETUP_HINT);
  const { bin, model } = found;
  const lang = opts.language ?? "ja";

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-m", model,
      "-f", wavPath,
      "-l", lang,
      "-oj", // JSON 出力
      "-ojf", // フル(トークン単位タイムスタンプ込み)
      "-of", outJsonBase,
      "-pp", // 進捗表示
      "-t", String(Math.max(2, Math.min(8, os.cpus().length - 2))),
    ];
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const onProg = (d: Buffer) => {
      const s = d.toString();
      const m = s.match(/progress\s*=\s*(\d+)%/);
      if (m && opts.onProgress) opts.onProgress(Number(m[1]));
    };
    proc.stdout.on("data", onProg);
    proc.stderr.on("data", onProg);
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"));
    }
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`whisper 終了コード ${code}`)),
    );
  });

  const jsonPath = `${outJsonBase}.json`;
  if (!fs.existsSync(jsonPath)) throw new Error("whisper の JSON 出力が見つかりません");
  return parseWhisperJson(jsonPath, lang);
}

/** whisper.cpp の JSON(full) を Transcript に変換 */
export function parseWhisperJson(jsonPath: string, language: string): Transcript {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const trans = raw.transcription ?? [];
  const segments: TranscriptSegment[] = trans.map((t: any, i: number) => {
    const startSec = msToSec(t.offsets?.from);
    const endSec = msToSec(t.offsets?.to);
    const words: TranscriptWord[] = [];
    // フルJSONなら tokens にトークン単位のタイムスタンプがある
    if (Array.isArray(t.tokens)) {
      for (const tok of t.tokens) {
        const text = String(tok.text ?? "").trim();
        // 特殊トークン([_BEG_]等)を除外
        if (!text || text.startsWith("[_") || text.startsWith("<|")) continue;
        words.push({
          text,
          startSec: msToSec(tok.offsets?.from),
          endSec: msToSec(tok.offsets?.to),
        });
      }
    }
    return {
      id: i,
      startSec,
      endSec,
      text: String(t.text ?? "").trim(),
      words: words.length ? mergeSubwords(words) : undefined,
    };
  });
  return { language, segments };
}

function msToSec(ms: unknown): number {
  return typeof ms === "number" ? ms / 1000 : 0;
}

/**
 * whisper のトークンはサブワードに割れることがある(「学」「校」)。
 * 先頭が空白で始まらないトークンを直前に連結し、語っぽい単位にまとめる。
 */
function mergeSubwords(tokens: TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const tok of tokens) {
    const startsNew = /^[\s「」、。,.!?！？]/.test(tok.text) || out.length === 0;
    if (startsNew) {
      out.push({ ...tok, text: tok.text.trim() });
    } else {
      const last = out[out.length - 1];
      last.text += tok.text;
      last.endSec = tok.endSec;
    }
  }
  return out.filter((w) => w.text.length > 0);
}
