import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

/**
 * 作業ディレクトリ（このツールを起動したフォルダ = MovieEditor）直下の動画を列挙。
 * ドラッグ&ドロップでパスが取れないブラウザのため、ワンクリック選択肢を提供する。
 */
export async function GET() {
  const dir = process.cwd();
  let files: { name: string; path: string; sizeMB: number }[] = [];
  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && VIDEO_EXT.has(path.extname(d.name).toLowerCase()))
      .map((d) => {
        const p = path.join(dir, d.name);
        const sizeMB = Math.round(fs.statSync(p).size / 1024 / 1024);
        return { name: d.name, path: p, sizeMB };
      });
  } catch {
    /* ignore */
  }
  return Response.json({ dir, files });
}
