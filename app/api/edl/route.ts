import { NextRequest } from "next/server";
import { getMeta, getEDL, commitEDL, getHistoryLog } from "@/lib/project-store";
import type { EDL } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * UI からの手動編集（クリップのトリム、オーバーレイの移動/追加など）をコミットする。
 * これも履歴に積まれ、autosave となる。元動画パスは差し替え不可。
 */
export async function POST(req: NextRequest) {
  const { id, edl, label } = (await req.json()) as {
    id: string;
    edl: EDL;
    label?: string;
  };
  const meta = getMeta(id);
  const current = getEDL(id);
  if (!meta || !current) return new Response("project not found", { status: 404 });

  try {
    // source は常に既存を強制（安全）
    const next: EDL = { ...edl, source: current.source };
    const updated = commitEDL(id, next, (label || "手動編集").slice(0, 80));
    return Response.json({
      meta: updated,
      edl: next,
      history: getHistoryLog(id),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
