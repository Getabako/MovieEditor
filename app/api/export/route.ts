import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextRequest } from "next/server";
import { getMeta, getEDL } from "@/lib/project-store";
import { paths, ensureDir } from "@/lib/paths";
import { renderEDL } from "@/lib/remotion-render";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 現在の EDL を MP4 に書き出す。進捗は SSE、完了で download URL を返す。 */
export async function POST(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  const meta = getMeta(id);
  const edl = getEDL(id);
  if (!meta || !edl) return new Response("project not found", { status: 404 });

  // Renderer の OffthreadVideo が読む元動画URL（同一サーバー経由）
  const origin = req.nextUrl.origin;
  const srcUrl = `${origin}/api/source/${id}`;

  return sseResponse(async (send) => {
    ensureDir(paths.exportsDir(id));
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const rawName = `export-${stamp}.mp4`;
    const rawPath = path.join(paths.exportsDir(id), rawName);

    send("step", { kind: "info", text: "Remotion バンドル/レンダリング開始…" });
    await renderEDL(edl, srcUrl, rawPath, (p) =>
      send("progress", { phase: "render", pct: Math.round(p * 100) }),
    );

    let finalName = rawName;
    let finalPath = rawPath;

    // 音量ノーマライズ（loudnorm）を後処理で適用
    if (edl.audio?.normalize) {
      send("step", { kind: "status", text: "音量ノーマライズ中…" });
      finalName = `export-${stamp}-norm.mp4`;
      finalPath = path.join(paths.exportsDir(id), finalName);
      await loudnorm(rawPath, finalPath);
      fs.unlinkSync(rawPath);
    }

    send("done", {
      file: finalName,
      path: finalPath,
      url: `/api/download/${id}/${encodeURIComponent(finalName)}`,
    });
  }, req.signal);
}

function loudnorm(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", input,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:v", "copy",
      output,
    ]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`loudnorm 失敗: ${err.slice(-200)}`)),
    );
  });
}
