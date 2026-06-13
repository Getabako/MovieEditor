import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

const KINDS: Record<string, { prompt: string; types: string[] }> = {
  video: { prompt: "編集する動画を選択", types: ["mp4", "mov", "mkv", "webm", "m4v"] },
  image: { prompt: "表示する画像を選択", types: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
  audio: { prompt: "音源（BGM/効果音）を選択", types: ["mp3", "m4a", "aac", "wav", "ogg"] },
};

/**
 * macOS ネイティブのファイル選択ダイアログを開き、選ばれたファイルの絶対パスを返す。
 * ブラウザは <input type=file> やドラッグ&ドロップで絶対パスを取得できない
 * （しかも 2時間動画はアップロードでコピーすると重い）ため、ローカルツールとして
 * osascript で Finder のダイアログを直接開く方式を採る。
 * ?kind=video|image|audio で対象種別を切り替える（既定 video）。
 */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "video";
  const cfg = KINDS[kind] ?? KINDS.video;
  const typeList = cfg.types.map((t) => JSON.stringify(t)).join(", ");
  const script = [
    `set chosen to choose file with prompt "${cfg.prompt}" of type {${typeList}}`,
    "POSIX path of chosen",
  ].join("\n");

  try {
    const { stdout } = await execAsync(
      `osascript ${script
        .split("\n")
        .map((l) => `-e ${JSON.stringify(l)}`)
        .join(" ")}`,
    );
    const path = stdout.trim();
    if (!path) return Response.json({ canceled: true });
    return Response.json({ path });
  } catch (e) {
    // ユーザーがキャンセルすると osascript は非0で終了する（-128）。
    const msg = (e as Error).message || "";
    if (msg.includes("-128") || msg.includes("User canceled")) {
      return Response.json({ canceled: true });
    }
    return Response.json({ error: msg || "ファイル選択に失敗しました" }, { status: 500 });
  }
}
