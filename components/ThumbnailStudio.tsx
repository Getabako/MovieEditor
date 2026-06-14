"use client";

import React, { useEffect, useRef, useState } from "react";

// ============================================================================
// サムネツール（汎用UI）。テイストはサーバ側 lib/thumbnail-prompt.ts + studio/thumbnail-style.md で決まる。
// 「編集中の動画」の内容（タイトル/テロップ/文字起こし）から各欄を自動入力できる。
// ============================================================================

const labelCls = "block text-[15px] font-medium opacity-80 mb-1.5";
const inputCls =
  "w-full px-3.5 py-3 text-[15px] rounded-lg bg-[var(--panel-2)] border border-[var(--border)]";

export default function ThumbnailStudio() {
  const [mainCopy, setMainCopy] = useState("");
  const [subCopy, setSubCopy] = useState("");
  const [scene, setScene] = useState("");
  const [badge, setBadge] = useState("");
  const [refs, setRefs] = useState<{ path: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [imgUrl, setImgUrl] = useState("");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // マウント時：編集中（＝最新）の動画を把握し、空なら自動でサムネ要素を提案して埋める
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/projects").then((x) => x.json());
        const list = (r.projects ?? []) as Array<{ title: string; updatedAt?: string }>;
        const latest = [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
        if (latest && !cancelled) {
          setProjectTitle(latest.title);
          void autofill(true);
        }
      } catch {
        /* プロジェクトが無くても手入力で使える */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function autofill(onlyIfEmpty = false) {
    if (suggesting || busy) return;
    if (onlyIfEmpty && (mainCopy.trim() || scene.trim())) return;
    setSuggesting(true);
    setErr("");
    try {
      const res = await fetch("/api/thumbnail/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "自動入力に失敗しました");
      if (data.title) setProjectTitle(data.title);
      const s = data.suggestion ?? {};
      setMainCopy((v) => (onlyIfEmpty && v ? v : s.mainCopy ?? v));
      setSubCopy((v) => (onlyIfEmpty && v ? v : s.subCopy ?? v));
      setScene((v) => (onlyIfEmpty && v ? v : s.scene ?? v));
      setBadge((v) => (onlyIfEmpty && v ? v : s.badge ?? v));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

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
        body: JSON.stringify({ mainCopy, subCopy, scene, badge, refs }),
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

  // 参照画像（人物/キャラ/ロゴ）をネイティブダイアログで追加
  async function addRef() {
    const r = await fetch("/api/pick-file?kind=image").then((x) => x.json());
    if (r.canceled || !r.path) return;
    setRefs((rs) => [...rs, { path: r.path, role: "person" }]);
  }
  function setRefRole(i: number, role: string) {
    setRefs((rs) => rs.map((r, idx) => (idx === i ? { ...r, role } : r)));
  }
  function removeRef(i: number) {
    setRefs((rs) => rs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="min-h-full p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">サムネ</h1>
      <p className="text-base opacity-70 mb-6 leading-relaxed">
        編集中の動画の内容から各欄を自動入力できます。整えて「サムネを生成」を押すと画像を作ります（テイストは studio/thumbnail-style.md）。
      </p>

      {/* 編集中の動画 + 自動入力 */}
      <div className="flex items-center flex-wrap gap-3 mb-6 p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)]">
        <span className="text-[15px] opacity-70">編集中の動画:</span>
        <span className="text-[15px] font-semibold">{projectTitle || "（未取得）"}</span>
        <button className="btn ml-auto" onClick={() => autofill(false)} disabled={suggesting || busy}>
          {suggesting ? (
            <span className="inline-flex items-center gap-2">
              <span className="spinner" /> 動画から自動入力中…
            </span>
          ) : (
            "この動画から自動入力"
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-8">
        {/* 入力 */}
        <div className="space-y-5">
          <div>
            <span className={labelCls}>メインコピー（上半分の大きい文字）</span>
            <input className={inputCls} placeholder="例: 知らないと損する〇〇" value={mainCopy} onChange={(e) => setMainCopy(e.target.value)} />
          </div>
          <div>
            <span className={labelCls}>サブコピー（右下・任意）</span>
            <input className={inputCls} placeholder="例: 完全保存版" value={subCopy} onChange={(e) => setSubCopy(e.target.value)} />
          </div>
          <div>
            <span className={labelCls}>背景 / 被写体の説明</span>
            <textarea
              className={inputCls + " h-32 resize-y leading-relaxed"}
              placeholder="例: デスクの上にノートPCとコーヒー、明るい朝の光。人物なし。"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
            />
          </div>
          <div>
            <span className={labelCls}>左上バッジ（任意）</span>
            <input className={inputCls} placeholder="例: 保存版" value={badge} onChange={(e) => setBadge(e.target.value)} />
          </div>

          {/* 参照画像（人物・キャラ・ロゴ）→ サムネに合成 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[15px] font-medium opacity-80">参照画像（人物・キャラ・ロゴ）</span>
              <button className="btn !py-1.5 !px-3 !text-sm" onClick={addRef} disabled={busy}>
                ＋ 画像を追加
              </button>
            </div>
            {refs.length === 0 ? (
              <div className="text-[13px] opacity-50 leading-relaxed">
                人物・キャラ・ロゴを追加すると、その画像をサムネに合成して生成します（複数可）。
              </div>
            ) : (
              <div className="space-y-2">
                {refs.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--panel-2)] border border-[var(--border)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/file?path=${encodeURIComponent(r.path)}`}
                      alt=""
                      className="w-12 h-12 object-cover rounded shrink-0 bg-black/30"
                    />
                    <select
                      value={r.role}
                      onChange={(e) => setRefRole(i, e.target.value)}
                      className="px-2 py-1.5 rounded bg-[var(--panel)] border border-[var(--border)] text-sm shrink-0"
                    >
                      <option value="person">人物</option>
                      <option value="character">キャラ</option>
                      <option value="logo">ロゴ</option>
                      <option value="other">参考</option>
                    </select>
                    <span className="text-xs opacity-50 truncate flex-1">{r.path.split("/").pop()}</span>
                    <button className="btn !py-1 !px-2.5 !text-red-400 shrink-0" onClick={() => removeRef(i)} title="削除">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            {!busy ? (
              <button className="btn-accent" onClick={generate} disabled={!mainCopy.trim() || !scene.trim()}>
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
            <div className="text-[13px] opacity-60 space-y-0.5">
              {steps.map((s, i) => (
                <div key={i} className="truncate">
                  {s}
                </div>
              ))}
            </div>
          )}
          {busy && <div className="text-[13px] opacity-60">画像生成中…（数十秒かかることがあります）</div>}
          {err && <div className="text-sm text-red-400">{err}</div>}
        </div>

        {/* プレビュー */}
        <div>
          <div className="text-[15px] opacity-70 mb-2">プレビュー（16:9）</div>
          <div className="aspect-video w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center overflow-hidden">
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl} alt="thumbnail" className="w-full h-full object-contain" />
            ) : (
              <span className="opacity-40 text-base">ここにサムネが表示されます</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
