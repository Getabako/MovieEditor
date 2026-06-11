import { NextRequest } from "next/server";
import { undo, redo, gotoHistory, getHistoryLog } from "@/lib/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** undo / redo / 任意の履歴 index へ復元 */
export async function POST(req: NextRequest) {
  const { id, action, index } = (await req.json()) as {
    id: string;
    action: "undo" | "redo" | "goto";
    index?: number;
  };
  try {
    let result;
    if (action === "undo") result = undo(id);
    else if (action === "redo") result = redo(id);
    else if (action === "goto" && typeof index === "number")
      result = gotoHistory(id, index);
    else return Response.json({ error: "不正な action" }, { status: 400 });

    return Response.json({
      meta: result.meta,
      edl: result.edl,
      history: getHistoryLog(id),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
