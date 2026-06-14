"use client";

import React, { useState } from "react";
import EditorApp from "./EditorApp";
import ScriptStudio from "./ScriptStudio";
import ThumbnailStudio from "./ThumbnailStudio";

// ============================================================================
// スタジオのシェル。「台本 / 動画編集 / サムネ」の3タブでツールを切り替える。
// 各ツールはこのコンテンツ領域(flex-1)を埋める前提（高さは h-full / min-h-full）。
// ============================================================================

type Tab = "script" | "editor" | "thumbnail";

const TABS: { key: Tab; label: string }[] = [
  { key: "script", label: "台本" },
  { key: "editor", label: "動画編集" },
  { key: "thumbnail", label: "サムネ" },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("editor");

  return (
    <div className="h-screen flex flex-col">
      {/* タブバー */}
      <nav className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel)]">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-4 py-1.5 rounded-t text-sm font-semibold transition-colors " +
                (active
                  ? "bg-[var(--panel-2)] text-[var(--foreground)] border border-b-0 border-[var(--border)]"
                  : "opacity-60 hover:opacity-100")
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* コンテンツ */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "script" && <ScriptStudio />}
        {tab === "editor" && <EditorApp />}
        {tab === "thumbnail" && <ThumbnailStudio />}
      </div>
    </div>
  );
}
