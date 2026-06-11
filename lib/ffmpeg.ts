import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SourceInfo } from "./types";
import { ensureDir } from "./paths";

/** child_process を Promise でまとめて実行（stdout/stderr を結合して返す） */
function run(
  cmd: string,
  args: string[],
  onStderr?: (line: string) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) s.split(/\r?\n/).forEach((l: string) => l && onStderr(l));
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

/** ffprobe で動画メタを取得 */
export async function probeVideo(filePath: string): Promise<SourceInfo> {
  const { stdout, code, stderr } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-show_entries", "format=duration",
    "-of", "json",
    filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe 失敗: ${stderr.slice(0, 300)}`);
  const json = JSON.parse(stdout);
  const stream = json.streams?.[0] ?? {};
  const [num, den] = String(stream.r_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;
  return {
    path: filePath,
    width: Number(stream.width) || 1280,
    height: Number(stream.height) || 720,
    fps: Math.round(fps * 1000) / 1000,
    durationSec: Number(json.format?.duration) || 0,
  };
}

/** 16kHz mono WAV を抽出（whisper.cpp 入力用） */
export async function extractAudioWav(
  videoPath: string,
  outWav: string,
  onProgress?: (sec: number) => void,
): Promise<void> {
  ensureDir(path.dirname(outWav));
  const { code, stderr } = await run(
    "ffmpeg",
    ["-y", "-i", videoPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outWav],
    (line) => {
      const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) {
        onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
    },
  );
  if (code !== 0) throw new Error(`音声抽出失敗: ${stderr.slice(-300)}`);
}

/**
 * プレビュー用の軽量プロキシ動画を作る。
 * 低解像度（高さ360）＋キーフレーム多め（毎秒1）で、ブラウザでの高速シーク/早送りを軽くする。
 * 元動画は触らない。書き出しは常に元動画を使う。
 */
export async function buildPreviewProxy(
  videoPath: string,
  outPath: string,
  onProgress?: (sec: number) => void,
): Promise<void> {
  ensureDir(path.dirname(outPath));
  const tmp = outPath + ".tmp.mp4";
  const { code, stderr } = await run(
    "ffmpeg",
    [
      "-y",
      "-i", videoPath,
      "-vf", "scale=-2:360",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "30",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      tmp,
    ],
    (line) => {
      const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) {
        onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
    },
  );
  if (code !== 0) {
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`プロキシ生成失敗: ${stderr.slice(-300)}`);
  }
  fs.renameSync(tmp, outPath);
}

/**
 * 無音区間を検出する（ffmpeg silencedetect）。
 * 返り値は [開始秒, 終了秒][]（元動画時刻）。
 */
export async function detectSilences(
  videoPath: string,
  thresholdDb = -30,
  minSilenceSec = 0.6,
  onProgress?: (sec: number) => void,
): Promise<Array<[number, number]>> {
  const { stderr } = await run(
    "ffmpeg",
    [
      "-i", videoPath,
      "-af", `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
      "-f", "null", "-",
    ],
    (line) => {
      const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) {
        onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
    },
  );
  const silences: Array<[number, number]> = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const sm = line.match(/silence_start:\s*(-?[\d.]+)/);
    const em = line.match(/silence_end:\s*([\d.]+)/);
    if (sm) start = Math.max(0, Number(sm[1]));
    else if (em && start !== null) {
      silences.push([start, Number(em[1])]);
      start = null;
    }
  }
  return silences;
}

/** 指定した元動画時刻のフレームを PNG で書き出し、絶対パスを返す */
export async function extractFrame(
  videoPath: string,
  atSec: number,
  outPng: string,
  scaleW = 640,
): Promise<string> {
  ensureDir(path.dirname(outPng));
  const { code, stderr } = await run("ffmpeg", [
    "-y",
    "-ss", atSec.toFixed(3),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", `scale=${scaleW}:-1`,
    outPng,
  ]);
  if (code !== 0 || !fs.existsSync(outPng))
    throw new Error(`フレーム抽出失敗(${atSec}s): ${stderr.slice(-200)}`);
  return outPng;
}

/** 複数時刻のフレームをまとめて抽出 */
export async function extractFrames(
  videoPath: string,
  times: number[],
  dir: string,
  scaleW = 640,
): Promise<Array<{ atSec: number; path: string }>> {
  ensureDir(dir);
  const out: Array<{ atSec: number; path: string }> = [];
  for (const t of times) {
    const p = path.join(dir, `frame_${t.toFixed(2)}.png`);
    try {
      await extractFrame(videoPath, t, p, scaleW);
      out.push({ atSec: t, path: p });
    } catch {
      /* skip */
    }
  }
  return out;
}
