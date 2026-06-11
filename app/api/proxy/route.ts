import fs from "node:fs";
import { NextRequest } from "next/server";
import { getMeta } from "@/lib/project-store";
import { paths } from "@/lib/paths";
import { buildPreviewProxy } from "@/lib/ffmpeg";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** プレビュー用の軽量プロキシ動画を生成する（SSEで進捗）。 */
export async function POST(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  const meta = getMeta(id);
  if (!meta) return new Response("project not found", { status: 404 });
  if (!fs.existsSync(meta.source.path)) {
    return new Response("source missing", { status: 404 });
  }

  return sseResponse(async (send) => {
    const out = paths.proxyFile(id);
    const total = meta.source.durationSec || 1;
    send("step", { kind: "status", text: "プレビュー用の軽量動画を生成中…（一度だけ）" });
    await buildPreviewProxy(meta.source.path, out, (sec) => {
      send("progress", { pct: Math.min(100, Math.round((sec / total) * 100)) });
    });
    send("done", { ok: true });
  }, req.signal);
}
