import { NextRequest } from "next/server";
import { getMeta, getEDL, commitEDL, getHistoryLog } from "@/lib/project-store";
import { paths, readJson } from "@/lib/paths";
import { applyPresets } from "@/lib/presets";
import { sseResponse } from "@/lib/sse";
import type { PresetId, PresetOptions, Transcript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id: string; presets: PresetId[]; options?: PresetOptions };

/** チェックしたプリセットをまとめて適用し、新 EDL をコミットする。 */
export async function POST(req: NextRequest) {
  const { id, presets, options } = (await req.json()) as Body;
  const meta = getMeta(id);
  const edl = getEDL(id);
  if (!meta || !edl) return new Response("project not found", { status: 404 });
  if (!presets?.length) return new Response("presets required", { status: 400 });

  const transcript = readJson<Transcript>(paths.transcriptFile(id));

  return sseResponse(async (send) => {
    send("init", { id, presets });
    const result = await applyPresets(presets, {
      edl,
      transcript,
      options,
      onProgress: (msg) => send("step", { kind: "status", text: msg }),
    });

    for (const s of result.skipped) {
      send("step", { kind: "warn", text: `スキップ: ${s.preset}（${s.reason}）` });
    }
    if (!result.labels.length) {
      send("error", { message: "適用できる処理がありませんでした（文字起こしが必要かもしれません）" });
      return;
    }

    const label = `プリセット: ${result.labels.join(" / ")}`.slice(0, 120);
    const updated = commitEDL(id, result.edl, label);
    send("done", {
      meta: updated,
      edl: result.edl,
      history: getHistoryLog(id),
      labels: result.labels,
    });
  }, req.signal);
}
