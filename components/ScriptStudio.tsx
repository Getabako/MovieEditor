"use client";

import React, { useRef, useState } from "react";

// ============================================================================
// 台本ツール（汎用UI）。テイストはサーバ側 lib/script-prompt.ts + studio/script-style.md で決まる。
// このコンポーネント自体にはチャンネル固有の文言を持たせない。
// ============================================================================

type Format = { value: string; label: string };
const FORMATS: Format[] = [
  { value: "explainer", label: "解説" },
  { value: "review", label: "レビュー" },
  { value: "free", label: "自由（指定なし）" },
];

export default function ScriptStudio() {
  const [theme, setTheme] = useState("");
  const [format, setFormat] = useState("explainer");
  const [minutes, setMinutes] = useState(10);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [script, setScript] = useState("");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function generate() {
    if (!theme.trim() || busy) return;
    setBusy(true);
    setErr("");
    setScript("");
    setSteps([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, format, minutes, notes }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const ev = /event: (.+)/.exec(chunk)?.[1];
          const dataLine = /data: (.+)/.exec(chunk)?.[1];
          if (!ev || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (ev === "delta") setScript((s) => s + (data.text ?? ""));
          else if (ev === "step") setSteps((s) => [...s.slice(-6), data.text]);
          else if (ev === "done") setScript(data.script ?? "");
          else if (ev === "error") setErr(data.message ?? "生成に失敗しました");
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="min-h-full p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">台本</h1>
      <p className="text-sm opacity-70 mb-5">
        テーマを入れると台本を生成します。テイストは studio/script-style.md に書くほど寄ります（未設定なら一般的な構成）。
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* 入力 */}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="opacity-70">テーマ / お題</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
              placeholder="例: 初心者向けに〇〇を5分で解説"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </label>
          <div className="flex gap-3">
            <label className="block text-sm flex-1">
              <span className="opacity-70">フォーマット</span>
              <select
                className="mt-1 w-full px-2 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm w-28">
              <span className="opacity-70">尺(分)</span>
              <input
                type="number"
                min={1}
                max={40}
                className="mt-1 w-full px-2 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="opacity-70">盛り込みたい点・要望（任意）</span>
            <textarea
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)] h-24 resize-y"
              placeholder="例: 具体例を多めに。最後に視聴者への問いかけを入れて。"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            {!busy ? (
              <button className="btn btn-accent" onClick={generate} disabled={!theme.trim()}>
                台本を生成
              </button>
            ) : (
              <button className="btn" onClick={stop}>
                中止
              </button>
            )}
            {script && !busy && (
              <button className="btn" onClick={() => navigator.clipboard.writeText(script)}>
                コピー
              </button>
            )}
          </div>
          {steps.length > 0 && (
            <div className="text-xs opacity-60 space-y-0.5">
              {steps.map((s, i) => (
                <div key={i} className="truncate">
                  {s}
                </div>
              ))}
            </div>
          )}
          {err && <div className="text-sm text-red-400">{err}</div>}
        </div>

        {/* 出力 */}
        <div>
          <div className="text-sm opacity-70 mb-1">生成結果（編集可）</div>
          <textarea
            className="w-full h-[70vh] px-4 py-3 rounded bg-[var(--panel)] border border-[var(--border)] font-mono text-sm leading-relaxed resize-none"
            placeholder="ここに台本が表示されます。"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
