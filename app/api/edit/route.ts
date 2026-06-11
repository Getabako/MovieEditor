import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getCodex } from "@/lib/codex/client";
import { getMeta, getEDL, commitEDL, getHistoryLog } from "@/lib/project-store";
import { paths, ensureDir } from "@/lib/paths";
import { buildEditPrompt, EditContext } from "@/lib/prompt";
import { validateEDL } from "@/lib/edl";
import { sseResponse } from "@/lib/sse";
import type { EDL } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id: string; instruction: string; ctx: EditContext };

/**
 * 自然言語の編集指示を Codex(app-server) に渡し、新しい EDL を受け取ってコミットする。
 * Codex は projectDir で動き、_codex/edl.next.json を書き出す。進捗は SSE で流す。
 */
export async function POST(req: NextRequest) {
  const { id, instruction, ctx } = (await req.json()) as Body;
  const meta = getMeta(id);
  const edl = getEDL(id);
  if (!meta || !edl) return new Response("project not found", { status: 404 });
  if (!instruction?.trim()) return new Response("instruction required", { status: 400 });

  const projectDir = paths.projectDir(id);
  const codexDir = paths.codexDir(id);
  ensureDir(codexDir);
  const nextPath = path.join(codexDir, "edl.next.json");
  // 前回の出力を消しておく
  if (fs.existsSync(nextPath)) fs.unlinkSync(nextPath);

  const prompt = buildEditPrompt({ projectDir, edl, instruction, ctx });

  return sseResponse(async (send, signal) => {
    send("init", { id });
    const srv = await getCodex();

    let threadId: string | null = null;
    let turnId: string | null = null;
    let turnDone = false;
    let agentSummary = "";

    const onNotif = (notif: any) => {
      const { method, params } = notif;
      if (!params) return;
      switch (method) {
        case "thread/started":
          threadId = params.thread?.id;
          return;
        case "turn/plan/updated": {
          const plan = (params.plan ?? []) as Array<{ step: string; status: string }>;
          const s = plan
            .map((p) => `${p.status === "completed" ? "✓" : p.status === "inProgress" ? "▸" : "·"} ${p.step}`)
            .join(" / ");
          if (s) send("step", { kind: "plan", text: `📋 ${s}` });
          return;
        }
        case "item/started": {
          const item = params.item;
          if (!item || item.type === "agentMessage") return;
          if (item.type === "reasoning") send("step", { kind: "reasoning", text: "🧠 思考中…" });
          else if (item.type === "commandExecution") {
            const cmd = Array.isArray(item.command) ? item.command.join(" ") : String(item.command ?? "");
            send("step", { kind: "command", text: `$ ${cmd.slice(0, 200)}` });
          } else if (item.type === "fileChange") {
            const files = (item.changes || []).map((c: any) => c.path).join(", ");
            send("step", { kind: "file", text: `📄 ${files}` });
          }
          return;
        }
        case "item/agentMessage/delta":
          send("delta", { text: params.delta ?? "" });
          return;
        case "item/completed": {
          const item = params.item;
          if (item?.type === "agentMessage" && item.text) {
            agentSummary = item.text;
            send("agent", { text: item.text });
          }
          return;
        }
        case "turn/completed":
          turnDone = true;
          return;
        case "thread/status/changed":
          if (params.status?.type === "systemError") {
            send("step", { kind: "error", text: "systemError" });
            turnDone = true;
          }
          return;
      }
    };
    srv.on("notification", onNotif);

    const cleanup = () => srv.off("notification", onNotif);
    signal.addEventListener("abort", () => {
      if (threadId && turnId) srv.send("turn/interrupt", { threadId, turnId }).catch(() => {});
      cleanup();
    });

    try {
      const model = process.env.MOVIEEDITOR_MODEL || "gpt-5.5";
      const effort = process.env.MOVIEEDITOR_EFFORT || "medium";
      send("step", { kind: "info", text: `Codex 起動 (model=${model})` });

      const started: any = await srv.send("thread/start", {
        cwd: projectDir,
        model,
        effort,
        sandbox: "workspace-write",
        approvalPolicy: "never",
        serviceName: "movieeditor",
      });
      threadId = started.thread.id;

      const turn: any = await srv.send("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        cwd: projectDir,
        model,
        effort,
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [projectDir], networkAccess: true },
        approvalPolicy: "never",
      });
      turnId = turn.turn.id;

      await new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          if (turnDone) {
            clearInterval(tick);
            resolve();
          }
        }, 200);
        signal.addEventListener("abort", () => {
          clearInterval(tick);
          resolve();
        });
      });
      cleanup();

      if (!fs.existsSync(nextPath)) {
        send("error", { message: "Codex が edl.next.json を出力しませんでした。指示を変えて再試行してください。" });
        return;
      }
      let nextEdl: EDL;
      try {
        nextEdl = validateEDL(JSON.parse(fs.readFileSync(nextPath, "utf-8")));
      } catch (e) {
        send("error", { message: `EDL の検証に失敗: ${(e as Error).message}` });
        return;
      }
      // 元動画パスは差し替え不可（安全のため固定）
      nextEdl.source = edl.source;
      const label = (agentSummary || instruction).slice(0, 80);
      const updated = commitEDL(id, nextEdl, label);
      send("done", {
        meta: updated,
        edl: nextEdl,
        history: getHistoryLog(id),
        summary: agentSummary,
      });
    } finally {
      cleanup();
    }
  }, req.signal);
}
