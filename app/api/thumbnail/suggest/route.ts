import fs from "node:fs";
import { NextRequest } from "next/server";
import { runCodexTurn } from "@/lib/codex/run-turn";
import { buildThumbnailSuggestPrompt, ThumbnailContext } from "@/lib/thumbnail-prompt";
import { listProjects, getMeta, getEDL } from "@/lib/project-store";
import { paths, ensureDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 文字起こしファイルから本文を抜き出す（あれば） */
function readTranscript(id: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.transcriptFile(id), "utf-8"));
    const segs = raw.segments ?? [];
    return segs.map((s: { text?: string }) => s.text ?? "").join(" ").trim();
  } catch {
    return "";
  }
}

/** JSON文字列を緩く取り出す（前後にゴミがあっても最初の{...}を拾う） */
function looseJson(text: string): Record<string, string> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * 編集中の動画（=最新プロジェクト、または指定id）の内容から、
 * サムネ各欄(mainCopy/subCopy/scene/badge)を提案して返す。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };

  // 指定が無ければ「いちばん最近編集したプロジェクト」を編集中とみなす
  let id = body.id;
  if (!id) {
    const list = listProjects();
    const latest = [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    id = latest?.id;
  }
  if (!id) {
    return Response.json({ error: "編集中の動画が見つかりません。先に動画編集タブでプロジェクトを開いてください。" }, { status: 404 });
  }

  const meta = getMeta(id);
  if (!meta) return Response.json({ error: "プロジェクトが見つかりません" }, { status: 404 });

  const edl = getEDL(id);
  const telops = (edl?.overlays ?? [])
    .filter((o): o is Extract<typeof o, { type: "text" }> => o.type === "text")
    .map((o) => o.text?.replace(/\n/g, " ").trim())
    .filter((t): t is string => !!t);

  const ctx: ThumbnailContext = {
    title: meta.title,
    telops,
    transcript: readTranscript(id),
  };

  const prompt = buildThumbnailSuggestPrompt(ctx);
  ensureDir(paths.studioDir);
  const { summary } = await runCodexTurn({ cwd: paths.studioDir, prompt, signal: req.signal });
  const parsed = looseJson(summary);
  if (!parsed) {
    return Response.json({ error: "提案を生成できませんでした。もう一度お試しください。" }, { status: 502 });
  }

  return Response.json({
    title: meta.title,
    suggestion: {
      mainCopy: parsed.mainCopy ?? "",
      subCopy: parsed.subCopy ?? "",
      scene: parsed.scene ?? "",
      badge: parsed.badge ?? "",
    },
  });
}
