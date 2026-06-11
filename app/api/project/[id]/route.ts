import fs from "node:fs";
import { getMeta, getEDL, deleteProject } from "@/lib/project-store";
import { getHistoryLog } from "@/lib/project-store";
import { paths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** プロジェクトの現在状態（メタ + EDL + 履歴 + 字幕有無）を返す */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = getMeta(id);
  const edl = getEDL(id);
  if (!meta || !edl) return new Response("project not found", { status: 404 });
  return Response.json({
    meta,
    edl,
    history: getHistoryLog(id),
    transcriptExists: fs.existsSync(paths.transcriptFile(id)),
    proxyExists: fs.existsSync(paths.proxyFile(id)),
  });
}

/** プロジェクト（履歴含む作業データ）を削除。元動画は削除しない。 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = deleteProject(id);
  if (!ok) return new Response("project not found", { status: 404 });
  return Response.json({ ok: true });
}
