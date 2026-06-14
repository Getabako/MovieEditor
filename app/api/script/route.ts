import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { runCodexTurn } from "@/lib/codex/run-turn";
import { buildScriptPrompt, ScriptInput } from "@/lib/script-prompt";
import { paths, ensureDir, newId } from "@/lib/paths";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * テーマからWEEDMANテイストの台本を生成する。Codex の最終メッセージ＝台本本文。
 * 生成中は delta を SSE で流し、完了時に全文を保存して返す。
 */
export async function POST(req: NextRequest) {
  const input = (await req.json()) as ScriptInput;
  if (!input?.theme?.trim()) return new Response("theme required", { status: 400 });

  const prompt = buildScriptPrompt(input);
  // 台本は cwd にファイル出力しないので、書込み可能な作業ディレクトリだけ用意する
  const workDir = path.join(paths.studioDir, "work");
  ensureDir(workDir);

  return sseResponse(async (send, signal) => {
    send("init", {});
    let full = "";
    const { summary } = await runCodexTurn({
      cwd: workDir,
      prompt,
      signal,
      onEvent: (e) => {
        if (e.kind === "delta") {
          full += e.text;
          send("delta", { text: e.text });
        } else if (e.kind === "step") {
          send("step", { text: e.text });
        }
      },
    });

    const script = (summary || full).trim();
    if (!script) {
      send("error", { message: "台本を生成できませんでした。テーマを変えて再試行してください。" });
      return;
    }

    // 保存（履歴/再利用用）
    ensureDir(paths.scriptsDir);
    const id = newId();
    const file = path.join(paths.scriptsDir, `${id}.md`);
    fs.writeFileSync(file, script);

    send("done", { id, script, file });
  }, req.signal);
}
