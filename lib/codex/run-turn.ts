import { getCodex } from "./client";

// ============================================================================
// Codex App Server で1ターン実行する共通ヘルパ。
// /api/edit は EDL 専用の独自実装だが、台本生成(/api/script)・サムネ生成(/api/thumbnail)は
// 「cwd で1ターン走らせて、ストリームと最終メッセージを受け取る」だけなのでこれを共用する。
// ============================================================================

export type TurnEvent =
  | { kind: "step"; text: string }
  | { kind: "delta"; text: string }
  | { kind: "agent"; text: string };

export async function runCodexTurn(opts: {
  /** 作業ディレクトリ（workspace-write の書込み許可ルート）。画像出力先などはこの下に作る。 */
  cwd: string;
  /** Codex に渡すプロンプト全文 */
  prompt: string;
  onEvent?: (e: TurnEvent) => void;
  signal?: AbortSignal;
  model?: string;
  effort?: string;
}): Promise<{ summary: string }> {
  const { cwd, prompt, onEvent, signal } = opts;
  const srv = await getCodex();
  const model = opts.model || process.env.MOVIEEDITOR_MODEL || "gpt-5.5";
  const effort = opts.effort || process.env.MOVIEEDITOR_EFFORT || "medium";

  let threadId: string | null = null;
  let turnId: string | null = null;
  let turnDone = false;
  let agentSummary = "";

  const onNotif = (notif: { method: string; params?: Record<string, unknown> }) => {
    const { method, params } = notif as { method: string; params?: any };
    if (!params) return;
    switch (method) {
      case "thread/started":
        threadId = params.thread?.id;
        return;
      case "item/started": {
        const item = params.item;
        if (!item) return;
        if (item.type === "reasoning") onEvent?.({ kind: "step", text: "🧠 思考中…" });
        else if (item.type === "commandExecution") {
          const cmd = Array.isArray(item.command) ? item.command.join(" ") : String(item.command ?? "");
          onEvent?.({ kind: "step", text: `$ ${cmd.slice(0, 200)}` });
        } else if (item.type === "fileChange") {
          const files = (item.changes || []).map((c: any) => c.path).join(", ");
          onEvent?.({ kind: "step", text: `📄 ${files}` });
        }
        return;
      }
      case "item/agentMessage/delta":
        onEvent?.({ kind: "delta", text: params.delta ?? "" });
        return;
      case "item/completed": {
        const item = params.item;
        if (item?.type === "agentMessage" && item.text) {
          agentSummary = item.text;
          onEvent?.({ kind: "agent", text: item.text });
        }
        return;
      }
      case "turn/completed":
        turnDone = true;
        return;
      case "thread/status/changed":
        if (params.status?.type === "systemError") {
          onEvent?.({ kind: "step", text: "systemError" });
          turnDone = true;
        }
        return;
    }
  };
  srv.on("notification", onNotif);
  const cleanup = () => srv.off("notification", onNotif);
  signal?.addEventListener("abort", () => {
    if (threadId && turnId) srv.send("turn/interrupt", { threadId, turnId }).catch(() => {});
    cleanup();
  });

  try {
    const started: any = await srv.send("thread/start", {
      cwd,
      model,
      effort,
      sandbox: "workspace-write",
      approvalPolicy: "never",
      serviceName: "studio",
    });
    threadId = started.thread.id;

    const turn: any = await srv.send("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      cwd,
      model,
      effort,
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: true },
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
      signal?.addEventListener("abort", () => {
        clearInterval(tick);
        resolve();
      });
    });
  } finally {
    cleanup();
  }
  return { summary: agentSummary };
}
