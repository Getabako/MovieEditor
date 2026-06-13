"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PlayerRef } from "@remotion/player";
import type { EDL, HistoryEntry, ProjectMeta, PresetId, Overlay, ImageOverlay, TextOverlay, SeEvent, OverlayPatch } from "@/lib/types";
import {
  totalFrames,
  totalDuration,
  clipTimelineOffsets,
  outputToSource,
  stripSpeedForPreview,
} from "@/lib/edl";
import { prepareEdl, toAsset } from "@/lib/asset-url";
import { consumeSSE } from "@/lib/sse-client";
import { Timeline } from "./Timeline";
import { fmtTime } from "./util";

const OverlayCanvasDyn = dynamic(() => import("./OverlayCanvas"), { ssr: false });

let _oid = 0;
function newId(prefix: string): string {
  _oid += 1;
  return `${prefix}-${Date.now().toString(36)}-${_oid}`;
}

/** 記号パレット（フリー配置のスタンプ） */
const SYMBOLS = ["😀", "🔥", "💡", "❤️", "✨", "👍", "👀", "🎉", "❗️", "❓", "①", "②", "③", "💯", "⤴︎"];

// Player は SSR 不可。ref を prop で渡すラッパー経由でロードする。
const RemotionPlayer = dynamic(() => import("./RemotionPlayer"), { ssr: false });

type LocalVideo = { name: string; path: string; sizeMB: number };
type LogLine = { kind: string; text: string };

const PRESET_UI: { id: PresetId; label: string; needsTranscript: boolean; hint: string }[] = [
  { id: "trimSilence", label: "長い無音/間を自動カット", needsTranscript: false, hint: "0.8秒以上の無音を詰める" },
  { id: "removeFillers", label: "「えー」「あー」をカット", needsTranscript: true, hint: "フィラー語を自動除去" },
  { id: "autoSubtitle", label: "喋りに自動字幕", needsTranscript: true, hint: "発話に字幕を付与" },
  { id: "tightenGaps", label: "間を詰める(ジャンプカット)", needsTranscript: true, hint: "発話間の空白を圧縮" },
  { id: "trimEnds", label: "冒頭・末尾の無音トリム", needsTranscript: false, hint: "前後の無音を除去" },
  { id: "normalizeAudio", label: "音量ノーマライズ", needsTranscript: false, hint: "書き出し時に音量を均一化" },
];

export default function EditorApp() {
  const [view, setView] = useState<"home" | "editor">("home");
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [locals, setLocals] = useState<LocalVideo[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [edl, setEdl] = useState<EDL | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [transcriptExists, setTranscriptExists] = useState(false);
  const [proxyExists, setProxyExists] = useState(false);

  const [playheadSec, setPlayheadSec] = useState(0);
  const [selection, setSelection] = useState<{ startSec: number; endSec: number } | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  const [instruction, setInstruction] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<null | string>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checked, setChecked] = useState<Set<PresetId>>(new Set());
  const [speed, setSpeed] = useState(1); // 全体の再生速度倍率
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  const playerRef = useRef<PlayerRef>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const edlRef = useRef<EDL | null>(null);
  const metaRef = useRef<ProjectMeta | null>(null);
  useEffect(() => {
    edlRef.current = edl;
  }, [edl]);
  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  // ============ 素材(画像/記号/BGM/SE)の編集ヘルパ ============
  /** 手動編集の EDL をサーバーへコミット（履歴に積む＝autosave） */
  const applyEdl = useCallback(async (next: EDL, label: string) => {
    if (!metaRef.current) return;
    try {
      const r = await fetch("/api/edl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: metaRef.current.id, edl: next, label }),
      }).then((x) => x.json());
      if (r.error) {
        alert(r.error);
        return;
      }
      setMeta(r.meta);
      setEdl(r.edl);
      setHistory(r.history ?? []);
    } catch (e) {
      alert((e as Error).message);
    }
  }, []);

  /** ドラッグ中のライブ更新（サーバー未保存。Player に即反映） */
  const updateOverlayLive = useCallback((id: string, patch: OverlayPatch) => {
    setEdl((e) =>
      e ? { ...e, overlays: e.overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)) } : e,
    );
  }, []);

  /** 操作確定時にコミット（最新の edl を edlRef から読む） */
  const commitOverlay = useCallback(
    (label: string) => {
      if (edlRef.current) void applyEdl(edlRef.current, label);
    },
    [applyEdl],
  );

  const addOverlay = useCallback(
    (ov: Overlay) => {
      const cur = edlRef.current;
      if (!cur) return;
      void applyEdl({ ...cur, overlays: [...cur.overlays, ov] }, "素材を追加");
      setSelectedOverlayId(ov.id);
    },
    [applyEdl],
  );

  const removeOverlay = useCallback(
    (id: string) => {
      const cur = edlRef.current;
      if (!cur) return;
      void applyEdl({ ...cur, overlays: cur.overlays.filter((o) => o.id !== id) }, "素材を削除");
      setSelectedOverlayId((s) => (s === id ? null : s));
    },
    [applyEdl],
  );

  const setAudioPatch = useCallback(
    (patch: Partial<NonNullable<EDL["audio"]>>, label: string) => {
      const cur = edlRef.current;
      if (!cur) return;
      void applyEdl({ ...cur, audio: { ...(cur.audio ?? {}), ...patch } }, label);
    },
    [applyEdl],
  );

  async function addImage() {
    const r = await fetch("/api/pick-file?kind=image").then((x) => x.json());
    if (r.canceled || !r.path) return;
    addOverlay({
      id: newId("img"),
      type: "image",
      src: toAsset(r.path),
      startSec: playheadSec,
      endSec: Math.min(durationSec, playheadSec + 5),
      x: 0.5,
      y: 0.5,
      width: 0.25,
    } as ImageOverlay);
  }
  function addSymbol(sym: string) {
    addOverlay({
      id: newId("sym"),
      type: "text",
      free: true,
      text: sym,
      startSec: playheadSec,
      endSec: Math.min(durationSec, playheadSec + 5),
      x: 0.5,
      y: 0.5,
      fontSize: 140,
    } as TextOverlay);
  }
  async function pickBgm() {
    const r = await fetch("/api/pick-file?kind=audio").then((x) => x.json());
    if (r.canceled || !r.path) return;
    setAudioPatch({ bgmPath: toAsset(r.path) }, "BGM設定");
  }
  async function addSe() {
    const r = await fetch("/api/pick-file?kind=audio").then((x) => x.json());
    if (r.canceled || !r.path) return;
    const cur = edlRef.current;
    if (!cur) return;
    const se: SeEvent = { id: newId("se"), src: toAsset(r.path), atSec: playheadSec, volume: 1 };
    setAudioPatch({ se: [...(cur.audio?.se ?? []), se] }, `効果音を追加 (${fmtTime(playheadSec)})`);
  }

  // ---- 初期ロード ----
  useEffect(() => {
    void refreshProjects();
    void refreshLocals();
  }, []);

  // ---- 経過秒カウンタ（作業中かフリーズかを区別するため）----
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    setElapsed(0);
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(iv);
  }, [busy]);

  // ---- ログ自動スクロール ----
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  async function refreshProjects() {
    const r = await fetch("/api/projects").then((x) => x.json());
    setProjects(r.projects ?? []);
  }
  async function refreshLocals() {
    const r = await fetch("/api/local-video").then((x) => x.json());
    setLocals(r.files ?? []);
    if (!pathInput && r.files?.[0]) setPathInput(r.files[0].path);
  }

  // ---- プロジェクト作成/オープン ----
  async function createProject(sourcePath: string) {
    setCreating(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath }),
      }).then((x) => x.json());
      if (r.error) {
        alert(r.error);
        return;
      }
      await refreshProjects();
      await openProject(r.project.id);
    } finally {
      setCreating(false);
    }
  }

  // ---- ネイティブのファイル選択ダイアログ（絶対パスを取得）----
  async function pickFile() {
    setPicking(true);
    try {
      const r = await fetch("/api/pick-file").then((x) => x.json());
      if (r.canceled) return;
      if (r.error) {
        alert(r.error);
        return;
      }
      if (r.path) await createProject(r.path);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPicking(false);
    }
  }

  // ---- ドラッグ&ドロップ ----
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    // Electron 等ではパスが取れる。素のブラウザでは取れないのでネイティブ選択にフォールバック。
    const p = (f as unknown as { path?: string })?.path;
    if (p) {
      void createProject(p);
      return;
    }
    alert("ブラウザではドラッグしたファイルの保存場所を取得できません。『ファイルを選択』ダイアログを開きます。");
    void pickFile();
  }

  // ---- 過去データの削除 ----
  async function deleteProjectById(id: string, title: string) {
    if (!confirm(`「${title}」の編集データ（履歴・字幕）を削除します。\n元動画ファイルは消えません。よろしいですか？`)) return;
    const r = await fetch(`/api/project/${id}`, { method: "DELETE" });
    if (!r.ok) {
      alert("削除に失敗しました");
      return;
    }
    await refreshProjects();
  }

  async function openProject(id: string) {
    const r = await fetch(`/api/project/${id}`).then((x) => x.json());
    if (!r.meta) return;
    applyState(r.meta, r.edl, r.history);
    setTranscriptExists(!!r.transcriptExists);
    setProxyExists(!!r.proxyExists);
    setExportUrl(null);
    setLog([]);
    setView("editor");
  }

  function applyState(m: ProjectMeta, e: EDL, h: HistoryEntry[]) {
    setMeta(m);
    setEdl(e);
    setHistory(h ?? []);
  }

  // プレビュー/タイムライン表示用に、速度を1倍へ戻した同期版EDL。
  // （映像・音声・字幕がズレない。書き出しは元の edl を使う）
  const viewEdl = React.useMemo(() => (edl ? stripSpeedForPreview(edl) : null), [edl]);
  const durationSec = viewEdl ? totalDuration(viewEdl) : 0;
  const frames = viewEdl ? totalFrames(viewEdl) : 1;

  // ---- Player の再生位置を購読 ----
  // 軽量化: frameupdate は毎フレーム(30-60回/秒)発火する。毎回 state 更新すると
  // エディタUI全体が再レンダリングされて重いので、約150msに間引く。
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !edl) return;
    let last = 0;
    const onFrame = (e: { detail: { frame: number } }) => {
      const now = performance.now();
      if (now - last < 150) return;
      last = now;
      setPlayheadSec(e.detail.frame / edl.output.fps);
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [edl, view]);

  const seekToSec = useCallback(
    (sec: number) => {
      if (!edl) return;
      const f = Math.max(0, Math.min(frames - 1, Math.round(sec * edl.output.fps)));
      playerRef.current?.seekTo(f);
      setPlayheadSec(f / edl.output.fps);
    },
    [edl, frames],
  );

  // ストリーミング出力（delta/agent）は1トークン=1行になりやすいので、
  // 連続する同種の出力は同じ行にまとめて「縦書き化」を防ぐ。
  function pushLog(kind: string, text: string) {
    setLog((l) => {
      const last = l[l.length - 1];
      if ((kind === "delta" || kind === "agent") && last && last.kind === kind) {
        const merged = l.slice();
        merged[merged.length - 1] = { kind, text: last.text + text };
        return merged.slice(-200);
      }
      return [...l.slice(-200), { kind, text }];
    });
  }

  // ============================================================
  // 統合実行: 字幕(必要なら自動)→ ワンクリック処理 → 自然言語の指示
  // を1ボタンで上から順に一気に実行する。
  // ============================================================
  async function runAll() {
    if (!meta || !edl) return;
    const hasInstr = !!instruction.trim();
    const presetList = [...checked];
    if (speed > 1 && !presetList.includes("speedUp")) presetList.push("speedUp");
    if (!hasInstr && !presetList.length) return;

    setBusy("run");
    setLog([]);
    setExportUrl(null);
    const playheadSourceSec = outputToSource(viewEdl ?? edl, playheadSec);
    let txReady = transcriptExists;

    try {
      // 1) 字幕が必要なプリセットがあって未生成なら、自動で文字起こし
      const needsTx = presetList.some(
        (p) => PRESET_UI.find((u) => u.id === p)?.needsTranscript,
      );
      if ((needsTx || /字幕|テロップ|セリフ|文字/.test(instruction)) && !txReady) {
        pushLog("status", "▶ 字幕が必要なので、先に文字起こしします…");
        await consumeSSE("/api/transcribe", { id: meta.id }, (event, data) => {
          if (event === "step") pushLog(data.kind ?? "info", data.text ?? "");
          else if (event === "progress")
            pushLog("progress", `${data.phase === "extract" ? "音声抽出" : "文字起こし"} ${data.pct}%`);
          else if (event === "error") throw new Error(data.message ?? "文字起こしエラー");
          else if (event === "done") {
            txReady = true;
            setTranscriptExists(true);
            pushLog("ok", `✓ 文字起こし完了（${data.segments} セグメント）`);
          }
        });
      }

      // 2) チェックしたワンクリック処理をまとめて適用
      if (presetList.length) {
        pushLog("status", "▶ ワンクリック処理を適用中…");
        await consumeSSE(
          "/api/preset",
          {
            id: meta.id,
            presets: presetList,
            options: { speedFactor: speed },
          },
          (event, data) => {
            if (event === "step") pushLog(data.kind ?? "info", data.text ?? "");
            else if (event === "error") throw new Error(data.message ?? "プリセットエラー");
            else if (event === "done") {
              applyState(data.meta, data.edl, data.history);
              pushLog("ok", `✓ ${(data.labels ?? []).join(" / ")}`);
              setChecked(new Set());
              setSpeed(1);
            }
          },
        );
      }

      // 3) 自然言語の編集指示
      if (hasInstr) {
        pushLog("status", "▶ 指示を解釈して編集中…");
        await consumeSSE(
          "/api/edit",
          {
            id: meta.id,
            instruction,
            ctx: { playheadSec, playheadSourceSec, selection, hasTranscript: txReady },
          },
          (event, data) => {
            if (event === "step" || event === "info") pushLog(data.kind ?? "info", data.text ?? "");
            else if (event === "delta") pushLog("delta", data.text ?? "");
            else if (event === "agent") pushLog("agent", data.text ?? "");
            else if (event === "error") throw new Error(data.message ?? "編集エラー");
            else if (event === "done") {
              applyState(data.meta, data.edl, data.history);
              pushLog("ok", `✓ ${data.summary || "編集を適用しました"}`);
              setInstruction("");
            }
          },
        );
      }

      pushLog("ok", "✦ すべての処理が完了しました");
    } catch (e) {
      pushLog("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- 文字起こし（単体）----
  async function runTranscribe() {
    if (!meta) return;
    setBusy("transcribe");
    setLog([]);
    try {
      await consumeSSE("/api/transcribe", { id: meta.id }, (event, data) => {
        if (event === "step") pushLog(data.kind ?? "info", data.text ?? "");
        else if (event === "progress")
          pushLog("progress", `${data.phase === "extract" ? "音声抽出" : "文字起こし"} ${data.pct}%`);
        else if (event === "error") pushLog("error", data.message ?? "エラー");
        else if (event === "done") {
          setTranscriptExists(true);
          pushLog("ok", `✓ 文字起こし完了（${data.segments} セグメント）`);
        }
      });
    } catch (e) {
      pushLog("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- プレビュー用プロキシ生成 ----
  async function runProxy() {
    if (!meta) return;
    setBusy("proxy");
    setLog([]);
    try {
      await consumeSSE("/api/proxy", { id: meta.id }, (event, data) => {
        if (event === "step") pushLog(data.kind ?? "info", data.text ?? "");
        else if (event === "progress") pushLog("progress", `軽量化 ${data.pct}%`);
        else if (event === "error") pushLog("error", data.message ?? "エラー");
        else if (event === "done") {
          setProxyExists(true);
          pushLog("ok", "✓ プレビュー軽量化が完了（プレビューが軽くなりました）");
        }
      });
    } catch (e) {
      pushLog("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- 書き出し ----
  async function runExport() {
    if (!meta) return;
    setBusy("export");
    setLog([]);
    setExportUrl(null);
    try {
      await consumeSSE("/api/export", { id: meta.id }, (event, data) => {
        if (event === "step") pushLog(data.kind ?? "info", data.text ?? "");
        else if (event === "progress") pushLog("progress", `レンダリング ${data.pct}%`);
        else if (event === "error") pushLog("error", data.message ?? "エラー");
        else if (event === "done") {
          setExportUrl(data.url);
          pushLog("ok", `✓ 書き出し完了: ${data.file}`);
        }
      });
    } catch (e) {
      pushLog("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- 履歴 (undo/redo/goto) ----
  async function doHistory(action: "undo" | "redo" | "goto", index?: number) {
    if (!meta) return;
    const r = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: meta.id, action, index }),
    }).then((x) => x.json());
    if (r.error) return pushLog("error", r.error);
    applyState(r.meta, r.edl, r.history);
  }

  // ---- 音声入力（口頭指示）----
  function toggleVoice() {
    const SR =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      alert("このブラウザは音声入力に未対応です（Chrome 推奨）");
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.continuous = false;
    let final = instruction;
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += t;
        else interim += t;
      }
      setInstruction((final + interim).trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  }

  // ============================ ホーム ============================
  if (view === "home" || !meta || !edl) {
    const loading = creating || picking;
    return (
      <main className="min-h-screen p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">🎬 MovieEditor</h1>
        <p className="text-sm opacity-70 mb-6">
          口頭/自然言語の指示で既存動画を非破壊編集（Codex + Remotion）
        </p>

        <Card title="動画を読み込む">
          {/* ドラッグ&ドロップ枠 */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !loading && pickFile()}
            className={`mb-3 rounded-lg border-2 border-dashed px-4 py-7 text-center cursor-pointer transition ${
              dragOver
                ? "border-[var(--accent)] bg-[var(--panel-2)]"
                : "border-[var(--border)] hover:bg-[var(--panel-2)]"
            }`}
          >
            <div className="text-sm font-medium">
              {loading ? "読み込み中…" : "ここに動画をドラッグ&ドロップ"}
            </div>
            <div className="text-xs opacity-60 mt-1">
              またはクリックしてファイルを選択
            </div>
          </div>

          {/* 絶対パス入力（従来どおり） */}
          <div className="flex gap-2 mb-1">
            <input
              className="flex-1 bg-[var(--panel-2)] border border-[var(--border)] rounded px-3 py-2 text-sm"
              placeholder="または動画ファイルの絶対パスを貼り付け"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
            <button className="btn" disabled={loading} onClick={() => pickFile()}>
              📁 ファイルを選択
            </button>
            <button
              className="btn-accent"
              disabled={loading || !pathInput}
              onClick={() => createProject(pathInput)}
            >
              {creating ? "作成中…" : "読み込む"}
            </button>
          </div>

          {locals.length > 0 && (
            <div className="text-sm mt-3">
              <div className="opacity-60 mb-1">このフォルダの動画:</div>
              <div className="flex flex-col gap-1">
                {locals.map((f) => (
                  <button
                    key={f.path}
                    className="text-left px-3 py-2 rounded bg-[var(--panel-2)] hover:bg-[var(--border)] flex justify-between"
                    onClick={() => createProject(f.path)}
                    disabled={loading}
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="opacity-50 ml-2">{f.sizeMB}MB</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {projects.length > 0 && (
          <Card title="続きから編集">
            <div className="flex flex-col gap-1">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center gap-1">
                  <button
                    className="flex-1 text-left px-3 py-2 rounded bg-[var(--panel-2)] hover:bg-[var(--border)] flex justify-between text-sm min-w-0"
                    onClick={() => openProject(p.id)}
                  >
                    <span className="truncate">{p.title}</span>
                    <span className="opacity-50 ml-2 shrink-0">
                      {new Date(p.updatedAt).toLocaleString("ja-JP")}
                    </span>
                  </button>
                  <button
                    className="btn px-2 text-red-400 shrink-0"
                    title="この編集データを削除"
                    onClick={() => deleteProjectById(p.id, p.title)}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Style />
      </main>
    );
  }

  // ============================ エディタ ============================
  const vEdl = viewEdl ?? edl; // 表示用（速度を1倍に戻した同期版）
  // 素材(画像/BGM/SE)の asset:// をプレビュー用の相対URLへ解決してから Player に渡す
  const playerEdl = React.useMemo(() => prepareEdl(vEdl), [vEdl]);
  const offsets = clipTimelineOffsets(vEdl);
  const canRun =
    !busy && (!!instruction.trim() || checked.size > 0 || speed > 1);

  return (
    <main className="h-screen flex flex-col">
      {/* トップバー */}
      <header className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--panel)]">
        <button className="btn" onClick={() => setView("home")}>
          ← 一覧
        </button>
        <div className="font-semibold truncate max-w-[30%]">{meta.title}</div>
        <div className="flex gap-1 ml-2">
          <button className="btn" disabled={meta.historyIndex <= 0} onClick={() => doHistory("undo")}>
            ↶ 元に戻す
          </button>
          <button
            className="btn"
            disabled={meta.historyIndex >= meta.historyMax}
            onClick={() => doHistory("redo")}
          >
            ↷ やり直す
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="opacity-60">
            {fmtTime(durationSec)} / {edl.clips.length}クリップ
          </span>
          {transcriptExists ? (
            <span className="text-[var(--accent-2)]">✓ 字幕あり</span>
          ) : (
            <button className="btn" disabled={!!busy} onClick={runTranscribe}>
              {busy === "transcribe" ? "文字起こし中…" : "📝 文字起こし"}
            </button>
          )}
          <button className="btn-accent" disabled={!!busy} onClick={runExport}>
            {busy === "export" ? "書き出し中…" : "⬇ 書き出し"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 中央: プレビュー + タイムライン */}
        <section className="flex-1 flex flex-col min-w-0 p-3 gap-3">
          <div className="flex-1 min-h-0 relative flex items-center justify-center bg-black rounded-lg overflow-hidden">
            <RemotionPlayer
              playerRef={playerRef}
              edl={playerEdl}
              srcUrl={proxyExists ? `/api/source/${meta.id}?proxy=1` : `/api/source/${meta.id}`}
              durationInFrames={frames}
              realtimeSpeed={false}
            />
            <OverlayCanvasDyn
              edl={vEdl}
              playheadSec={playheadSec}
              selectedId={selectedOverlayId}
              onSelect={setSelectedOverlayId}
              onLiveChange={updateOverlayLive}
              onCommit={commitOverlay}
              onDelete={removeOverlay}
            />
          </div>

          <Timeline
            edl={vEdl}
            offsets={offsets}
            durationSec={durationSec}
            playheadSec={playheadSec}
            selection={selection}
            onSeek={seekToSec}
            onSelect={setSelection}
          />

          <div className="flex items-center gap-2 text-sm">
            <span className="opacity-60">再生位置 {fmtTime(playheadSec)}</span>
            <button
              className="btn"
              onClick={() => setSelection({ startSec: playheadSec, endSec: Math.min(durationSec, playheadSec + 3) })}
            >
              ここから選択
            </button>
            {selection && (
              <>
                <span className="text-[var(--accent)]">
                  選択 {fmtTime(selection.startSec)}〜{fmtTime(selection.endSec)}
                </span>
                <button className="btn" onClick={() => setSelection(null)}>
                  選択解除
                </button>
              </>
            )}
          </div>
        </section>

        {/* 右パネル: 指示 + ワンクリックを統合し、1ボタンで一気に実行 */}
        <aside className="w-[460px] border-l border-[var(--border)] bg-[var(--panel)] flex flex-col min-h-0">
          <div className="p-3 border-b border-[var(--border)] overflow-auto">
            <div className="text-sm font-semibold mb-2">🗣 やりたい編集を入力</div>
            <textarea
              className="w-full h-24 bg-[var(--panel-2)] border border-[var(--border)] rounded p-2 text-sm resize-none"
              placeholder={
                "例: 環境構築の解説動画にわかりやすく仕上げて。喋っているセリフを字幕にして。"
              }
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) runAll();
              }}
            />
            <div className="flex gap-2 mt-2">
              <button
                className={`btn ${listening ? "ring-2 ring-red-500" : ""}`}
                onClick={toggleVoice}
                disabled={!!busy}
                title="音声入力"
              >
                {listening ? "● 録音中" : "🎤 音声"}
              </button>
            </div>

            {/* 装飾・音：画像/記号/BGM/効果音。画像と記号はプレビュー上でドラッグ移動・角でサイズ変更 */}
            <div className="text-sm font-semibold mt-4 mb-2">🎨 装飾・音を足す</div>
            <div className="text-xs opacity-60 mb-2">
              追加すると再生位置から5秒表示。プレビュー上で<strong>ドラッグ＝移動／右下の緑■＝サイズ変更／×＝削除</strong>。
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              <button className="btn !text-xs" onClick={addImage}>🖼 画像を追加</button>
              <button className="btn !text-xs" onClick={pickBgm}>🎵 BGMを選ぶ</button>
              {edl?.audio?.bgmPath && (
                <button className="btn !text-xs" onClick={() => setAudioPatch({ bgmPath: undefined }, "BGM解除")}>
                  BGM解除
                </button>
              )}
              <button className="btn !text-xs" onClick={addSe}>🔊 効果音をここに</button>
            </div>
            {edl?.audio?.bgmPath && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="opacity-60">BGM音量</span>
                <input
                  type="range" min={0} max={1} step={0.05}
                  defaultValue={edl.audio.bgmVolume ?? 0.2}
                  onPointerUp={(e) =>
                    setAudioPatch({ bgmVolume: Number((e.target as HTMLInputElement).value) }, "BGM音量")
                  }
                  className="flex-1"
                />
              </div>
            )}
            <div className="text-xs opacity-60 mb-1">記号/スタンプ（クリックで追加）:</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  className="btn !px-2 !py-1 text-lg leading-none"
                  onClick={() => addSymbol(s)}
                  title="記号を追加"
                >
                  {s}
                </button>
              ))}
            </div>
            {edl?.audio?.se && edl.audio.se.length > 0 && (
              <div className="text-xs opacity-60 mt-1">効果音 {edl.audio.se.length}個（履歴から取り消せます）</div>
            )}

            {/* ワンクリック処理（任意でチェック。指示と一緒に一気に実行される） */}
            <div className="text-sm font-semibold mt-4 mb-2">
              ⚡ ワンクリック処理 <span className="opacity-50 font-normal text-xs">（任意・複数選択可）</span>
            </div>
            <div className="flex flex-col gap-1">
              {PRESET_UI.map((p) => {
                const willAutoTx = p.needsTranscript && !transcriptExists;
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-[var(--panel-2)] cursor-pointer"
                    title={p.hint}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(p.id)}
                      disabled={!!busy}
                      onChange={(e) => {
                        const n = new Set(checked);
                        e.target.checked ? n.add(p.id) : n.delete(p.id);
                        setChecked(n);
                      }}
                    />
                    <span>{p.label}</span>
                    {willAutoTx && (
                      <span className="ml-auto text-xs opacity-50">字幕は自動生成</span>
                    )}
                  </label>
                );
              })}
            </div>

            {/* 全体の再生速度 */}
            <div className="flex items-center gap-2 text-sm px-2 py-2 mt-1">
              <span className="opacity-80">⏩ 全体の再生速度</span>
              <select
                className="bg-[var(--panel-2)] border border-[var(--border)] rounded px-2 py-1 text-sm"
                value={speed}
                disabled={!!busy}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={1}>等速</option>
                <option value={1.1}>1.1倍</option>
                <option value={1.25}>1.25倍</option>
                <option value={1.5}>1.5倍</option>
                <option value={1.75}>1.75倍</option>
                <option value={2}>2倍</option>
              </select>
            </div>
            <div className="px-2 -mt-1">
              {proxyExists ? (
                <div className="text-xs text-[var(--accent-2)]">
                  ✓ プレビュー軽量化済み（プレビューが軽くなりました／速度は書き出しで反映）
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-50">
                    ※ プレビューは等速・速度は書き出しで反映。重い場合は→
                  </span>
                  <button className="btn !py-1 !text-xs" disabled={!!busy} onClick={runProxy}>
                    {busy === "proxy" ? "軽量化中…" : "⚡ プレビュー軽量化"}
                  </button>
                </div>
              )}
            </div>

            {/* 統合実行ボタン */}
            <button
              className="btn-accent w-full mt-3 flex items-center justify-center gap-2"
              disabled={!canRun}
              onClick={runAll}
            >
              {busy ? (
                <>
                  <span className="spinner" />
                  処理中… {elapsed}s（中断せずお待ちください）
                </>
              ) : (
                <>
                  ▶ 実行
                  {(() => {
                    const n = checked.size + (speed > 1 ? 1 : 0);
                    return n ? `（${instruction.trim() ? "指示 + " : ""}${n}件）` : "";
                  })()}
                  （⌘↵）
                </>
              )}
            </button>
          </div>

          {/* ログ */}
          <div className="p-3 border-b border-[var(--border)] flex-1 min-h-0 overflow-auto">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              進捗ログ
              {busy && (
                <span className="flex items-center gap-1 text-[var(--accent)] text-xs">
                  <span className="spinner" /> 処理中 {elapsed}s
                </span>
              )}
            </div>
            <div className="font-mono text-[13px] leading-relaxed space-y-0.5">
              {log.map((l, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-words ${
                    l.kind === "error"
                      ? "text-red-400"
                      : l.kind === "ok"
                        ? "text-[var(--accent-2)]"
                        : l.kind === "agent"
                          ? "text-[var(--accent)]"
                          : l.kind === "status"
                            ? "text-[var(--accent)] font-semibold"
                            : "opacity-70"
                  }`}
                >
                  {l.text}
                </div>
              ))}
              {exportUrl && (
                <a className="text-[var(--accent-2)] underline block mt-2" href={exportUrl}>
                  ⬇ 書き出した動画をダウンロード
                </a>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 履歴 */}
          <div className="p-3 max-h-[28%] overflow-auto">
            <div className="text-sm font-semibold mb-2">🕘 履歴（クリックで復元）</div>
            <div className="flex flex-col gap-0.5">
              {[...history].reverse().map((h) => (
                <button
                  key={h.index}
                  onClick={() => doHistory("goto", h.index)}
                  className={`text-left text-xs px-2 py-1 rounded flex justify-between ${
                    h.index === meta.historyIndex
                      ? "bg-[var(--accent)] text-white"
                      : "hover:bg-[var(--panel-2)]"
                  }`}
                >
                  <span className="truncate">
                    v{h.index} {h.label}
                  </span>
                  <span className="opacity-60 ml-2 shrink-0">{fmtTime(h.durationSec)}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
      <Style />
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-lg p-4 mb-4">
      <div className="text-sm font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function Style() {
  return (
    <style jsx global>{`
      .btn {
        background: var(--panel-2);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 14px;
        font-size: 15px;
        cursor: pointer;
      }
      .btn:hover:not(:disabled) {
        background: var(--border);
      }
      .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .btn-accent {
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 9px 16px;
        font-size: 15px;
        cursor: pointer;
        font-weight: 600;
      }
      .btn-accent:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .spinner {
        display: inline-block;
        width: 13px;
        height: 13px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: me-spin 0.7s linear infinite;
      }
      @keyframes me-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `}</style>
  );
}
