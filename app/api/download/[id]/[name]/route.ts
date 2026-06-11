import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { paths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 書き出した MP4 をダウンロード配信 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  // パストラバーサル防止
  const safe = path.basename(decodeURIComponent(name));
  const file = path.join(paths.exportsDir(id), safe);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });

  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(fs.statSync(file).size),
      "Content-Disposition": `attachment; filename="${safe}"`,
    },
  });
}
