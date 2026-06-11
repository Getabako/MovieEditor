import path from "node:path";
import os from "node:os";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import type { EDL } from "./types";

const ENTRY = path.join(process.cwd(), "remotion", "index.ts");

let bundleCache: string | null = null;

async function getBundle(): Promise<string> {
  if (bundleCache) return bundleCache;
  bundleCache = await bundle({
    entryPoint: ENTRY,
    // Remotion の書き出しバンドルは Next の "@/..." エイリアスを知らないので、
    // tsconfig の "@/*": "./*" に合わせて webpack 側にも別名を追加する。
    webpackOverride: (cfg) => ({
      ...cfg,
      resolve: {
        ...(cfg.resolve ?? {}),
        alias: {
          ...(cfg.resolve?.alias ?? {}),
          "@": process.cwd(),
        },
      },
    }),
  });
  return bundleCache;
}

/**
 * EDL を Remotion で MP4 に書き出す。
 * srcUrl は OffthreadVideo が読む元動画URL（ローカルの /api/source/... を渡す）。
 */
export async function renderEDL(
  edl: EDL,
  srcUrl: string,
  outPath: string,
  onProgress?: (p: number) => void,
): Promise<void> {
  const serveUrl = await getBundle();
  const inputProps = { edl, srcUrl };
  const comp = await selectComposition({
    serveUrl,
    id: "Editor",
    inputProps,
  });
  await renderMedia({
    serveUrl,
    composition: comp,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    audioCodec: "aac",
    audioBitrate: "192k",
    // 元動画を多数の区間で参照するため、同時実行は控えめにして安定させる
    concurrency: Math.max(1, Math.min(4, os.cpus().length - 2)),
    onProgress: ({ progress }) => onProgress?.(progress),
  });
}
