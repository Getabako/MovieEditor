import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getMeta, setTranscriptStatus } from "@/lib/project-store";
import { paths, ensureDir, writeJson } from "@/lib/paths";
import { extractAudioWav } from "@/lib/ffmpeg";
import { transcribe, detectWhisper, WHISPER_SETUP_HINT } from "@/lib/transcribe";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 元動画を文字起こしして transcript.json を生成する。
 * 音声抽出(ffmpeg) -> whisper.cpp -> 正規化。進捗は SSE。
 */
export async function POST(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  const meta = getMeta(id);
  if (!meta) return new Response("project not found", { status: 404 });

  return sseResponse(async (send, signal) => {
    const found = detectWhisper();
    if (!found) {
      send("error", { message: WHISPER_SETUP_HINT });
      return;
    }
    send("step", { kind: "info", text: `whisper: ${path.basename(found.model)}` });
    setTranscriptStatus(id, "running");

    try {
      const tmp = paths.tmpDir(id);
      ensureDir(tmp);
      const wav = path.join(tmp, "audio.wav");

      if (!fs.existsSync(wav)) {
        send("step", { kind: "status", text: "音声を抽出中…" });
        await extractAudioWav(meta.source.path, wav, (sec) => {
          send("progress", {
            phase: "extract",
            pct: Math.min(100, Math.round((sec / meta.source.durationSec) * 100)),
          });
        });
      }

      send("step", { kind: "status", text: "文字起こし中…（長尺は時間がかかります）" });
      const outBase = path.join(tmp, "transcript_raw");
      const transcript = await transcribe(wav, outBase, {
        language: "ja",
        signal,
        onProgress: (pct) => send("progress", { phase: "transcribe", pct }),
      });

      writeJson(paths.transcriptFile(id), transcript);
      setTranscriptStatus(id, "done");
      send("done", {
        segments: transcript.segments.length,
        durationSec: meta.source.durationSec,
      });
    } catch (e) {
      setTranscriptStatus(id, "error");
      send("error", { message: (e as Error).message });
    }
  }, req.signal);
}
