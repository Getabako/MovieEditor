import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function contentType(p: string): string {
  return TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

/**
 * ローカルの画像/音声ファイルを配信する（Player/Renderer 共通）。
 * オーバーレイ画像・BGM・SE の asset:// が指す絶対パスをここで読む。
 * 音声のシークに備えて Range 対応。
 */
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || !path.isAbsolute(filePath)) {
    return new Response("invalid path", { status: 400 });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response("not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const ct = contentType(filePath);
  const range = req.headers.get("range");

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
  const end = m && m[2] ? parseInt(m[2], 10) : total - 1;
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
