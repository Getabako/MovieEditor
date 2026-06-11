import fs from "node:fs";
import { NextRequest } from "next/server";
import { getMeta } from "@/lib/project-store";
import { paths } from "@/lib/paths";
import { extractFrames } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 指定した元動画時刻のフレームを PNG 抽出し、data URL の配列で返す。
 * タイムラインのサムネイルや「今のシーン」確認に使う。
 */
export async function POST(req: NextRequest) {
  const { id, times, scaleW } = (await req.json()) as {
    id: string;
    times: number[];
    scaleW?: number;
  };
  const meta = getMeta(id);
  if (!meta) return new Response("project not found", { status: 404 });
  if (!Array.isArray(times) || !times.length)
    return new Response("times required", { status: 400 });

  const frames = await extractFrames(
    meta.source.path,
    times.slice(0, 60),
    paths.framesDir(id),
    scaleW ?? 320,
  );
  const result = frames.map((f) => ({
    atSec: f.atSec,
    dataUrl: `data:image/png;base64,${fs.readFileSync(f.path).toString("base64")}`,
  }));
  return Response.json({ frames: result });
}
