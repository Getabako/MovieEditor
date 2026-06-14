"use client";

import React, { useRef, useState } from "react";

// ============================================================================
// サムネツール（汎用UI）。テイストはサーバ側 lib/thumbnail-prompt.ts + studio/thumbnail-style.md で決まる。
// Codex の画像生成でサムネPNGを作り、プレビュー＆ダウンロードする。
// ============================================================================

export default function ThumbnailStudio() {
  const [mainCopy, setMainCopy] = useState("");
  const [subCopy, setSubCopy] = useState("");
  const [scene, setScene] = useState("");
  const [badge, setBadge] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [imgUrl, setImgUrl] = useState("");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function generate() {
    if (!mainCopy.trim() || !scene.trim() || busy) return;
    setBusy(true);
    setErr("");
    setImgUrl("");
    setSteps([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainCopy, subCopy, scene, badge }),
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
          if (ev === "step") setSteps((s) => [...s.slice(-6), data.text]);
          else if (ev === "done") setImgUrl(data.url ?? "");
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
      <h1 className="text-2xl font-bold mb-1">サムネ</h1>
      <p className="text-sm opacity-70 mb-5">
        コピーと背景を指定するとサムネ画像を生成します（AI画像生成）。テイストは studio/thumbnail-style.md で寄せられます。
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* 入力 */}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="opacity-70">メインコピー（上半分の大きい文字）</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
              placeholder="例: 知らないと損する〇〇"
              value={mainCopy}
              onChange={(e) => setMainCopy(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="opacity-70">サブコピー（右下・任意）</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
              placeholder="例: 完全保存版"
              value={subCopy}
              onChange={(e) => setSubCopy(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="opacity-70">背景 / 被写体の説明</span>
            <textarea
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)] h-28 resize-y"
              placeholder="例: デスクの上にノートPCとコーヒー、明るい朝の光。人物なし。"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="opacity-70">左上バッジ（任意）</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded bg-[var(--panel-2)] border border-[var(--border)]"
              placeholder="例: 保存版"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            {!busy ? (
              <button className="btn btn-accent" onClick={generate} disabled={!mainCopy.trim() || !scene.trim()}>
                サムネを生成
              </button>
            ) : (
              <button className="btn" onClick={stop}>
                中止
              </button>
            )}
            {imgUrl && !busy && (
              <a className="btn" href={imgUrl} download="thumbnail.png">
                ダウンロード
              </a>
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
          {busy && <div className="text-xs opacity-60">画像生成中…（数十秒かかることがあります）</div>}
          {err && <div className="text-sm text-red-400">{err}</div>}
        </div>

        {/* プレビュー */}
        <div>
          <div className="text-sm opacity-70 mb-1">プレビュー（16:9）</div>
          <div className="aspect-video w-full rounded border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center overflow-hidden">
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl} alt="thumbnail" className="w-full h-full object-contain" />
            ) : (
              <span className="opacity-40 text-sm">ここにサムネが表示されます</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
