import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { runCodexTurn } from "@/lib/codex/run-turn";
import { buildThumbnailPrompt, ThumbnailInput } from "@/lib/thumbnail-prompt";
import { paths, ensureDir, newId } from "@/lib/paths";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * テーマ/コピーからWEEDMANテイストのサムネ画像を生成する。
 * Codex に画像生成→指定パスへPNG保存を依頼し、保存されたファイルを /api/file 経由で返す。
 */
export async function POST(req: NextRequest) {
  const input = (await req.json()) as ThumbnailInput;
  if (!input?.mainCopy?.trim() || !input?.scene?.trim()) {
    return new Response("mainCopy and scene required", { status: 400 });
  }

  ensureDir(paths.thumbnailsDir);
  const id = newId();
  const outPath = path.join(paths.thumbnailsDir, `${id}.png`);
  const prompt = buildThumbnailPrompt(input, outPath);

  return sseResponse(async (send, signal) => {
    send("init", {});
    await runCodexTurn({
      cwd: paths.thumbnailsDir,
      prompt,
      signal,
      onEvent: (e) => {
        if (e.kind === "step") send("step", { text: e.text });
        else if (e.kind === "agent") send("step", { text: e.text.slice(0, 200) });
      },
    });

    if (!fs.existsSync(outPath)) {
      send("error", {
        message: "サムネ画像が生成されませんでした。Codex の画像生成が使えるか確認するか、内容を変えて再試行してください。",
      });
      return;
    }
    send("done", { id, path: outPath, url: `/api/file?path=${encodeURIComponent(outPath)}` });
  }, req.signal);
}
