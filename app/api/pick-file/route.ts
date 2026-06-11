import { exec } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

/**
 * macOS ネイティブのファイル選択ダイアログを開き、選ばれた動画の絶対パスを返す。
 * ブラウザは <input type=file> やドラッグ&ドロップで絶対パスを取得できない
 * （しかも 2時間動画はアップロードでコピーすると重い）ため、ローカルツールとして
 * osascript で Finder のダイアログを直接開く方式を採る。
 */
export async function GET() {
  const script = [
    'set chosen to choose file with prompt "編集する動画を選択" of type {"mp4","mov","mkv","webm","m4v"}',
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
