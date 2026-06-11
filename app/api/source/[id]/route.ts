import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getMeta } from "@/lib/project-store";
import { paths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentType(path: string): string {
  if (path.endsWith(".mov")) return "video/quicktime";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  if (path.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

/**
 * プロジェクトの元動画を Range 対応でストリーム配信する。
 * Player のシーク（タイムラインの進む/戻る）と Renderer の OffthreadVideo 両方がこれを読む。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = getMeta(id);
  if (!meta) return new Response("project not found", { status: 404 });
  // ?proxy=1 でプレビュー用の軽量プロキシを配信（あれば）。なければ元動画。
  const wantProxy = req.nextUrl.searchParams.get("proxy") === "1";
  const proxyPath = paths.proxyFile(id);
  const filePath =
    wantProxy && fs.existsSync(proxyPath) ? proxyPath : meta.source.path;
  if (!fs.existsSync(filePath)) return new Response("source missing", { status: 404 });

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.get("range");
  const ct = contentType(filePath);

  if (!range) {
    const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Length": String(total),
        "Content-Type": ct,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? parseInt(m[1], 10) : 0;
  const end = m && m[2] ? parseInt(m[2], 10) : Math.min(start + 4 * 1024 * 1024 - 1, total - 1);
  const safeEnd = Math.min(end, total - 1);
  const chunkSize = safeEnd - start + 1;

  const stream = Readable.toWeb(
    fs.createReadStream(filePath, { start, end: safeEnd }),
  ) as ReadableStream;

  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${start}-${safeEnd}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunkSize),
      "Content-Type": ct,
      "Cache-Control": "no-store",
    },
  });
}
