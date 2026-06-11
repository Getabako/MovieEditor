"use client";

import React, { useRef, useState } from "react";
import type { EDL } from "@/lib/types";
import { clipOutputDuration } from "@/lib/edl";
import { fmtTime } from "./util";

/**
 * 出力タイムライン。クリップを比率で並べ、再生ヘッドと選択区間を表示する。
 * クリック=シーク、ドラッグ=区間選択。
 */
export function Timeline({
  edl,
  offsets,
  durationSec,
  playheadSec,
  selection,
  onSeek,
  onSelect,
}: {
  edl: EDL;
  offsets: number[];
  durationSec: number;
  playheadSec: number;
  selection: { startSec: number; endSec: number } | null;
  onSeek: (sec: number) => void;
  onSelect: (sel: { startSec: number; endSec: number } | null) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: number } | null>(null);

  const pct = (sec: number) => (durationSec > 0 ? (sec / durationSec) * 100 : 0);

  function secAt(clientX: number): number {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * durationSec;
  }

  return (
    <div className="select-none">
      <div
        ref={barRef}
        className="relative h-14 rounded bg-[var(--panel-2)] border border-[var(--border)] cursor-pointer overflow-hidden"
        onMouseDown={(e) => {
          const s = secAt(e.clientX);
          setDrag({ start: s });
          onSeek(s);
        }}
        onMouseMove={(e) => {
          if (!drag) return;
          const cur = secAt(e.clientX);
          const a = Math.min(drag.start, cur);
          const b = Math.max(drag.start, cur);
          if (b - a > 0.2) onSelect({ startSec: a, endSec: b });
        }}
        onMouseUp={() => setDrag(null)}
        onMouseLeave={() => setDrag(null)}
      >
        {/* クリップ境界 */}
        {edl.clips.map((c, i) => {
          const left = pct(offsets[i]);
          const w = pct(clipOutputDuration(c));
          return (
            <div
              key={c.id}
              className="absolute top-0 bottom-0 border-r border-[var(--border)]"
              style={{
                left: `${left}%`,
                width: `${w}%`,
                background:
                  i % 2 === 0 ? "rgba(91,140,255,0.12)" : "rgba(56,211,159,0.10)",
              }}
              title={`clip ${i}: ${c.srcStartSec.toFixed(1)}〜${c.srcEndSec.toFixed(1)}s${
                c.speed && c.speed !== 1 ? ` ×${c.speed}` : ""
              }`}
            />
          );
        })}

        {/* オーバーレイ（字幕など）マーカー */}
        {edl.overlays.map((o) => (
          <div
            key={o.id}
            className="absolute bottom-0 h-1.5 bg-amber-400/80"
            style={{ left: `${pct(o.startSec)}%`, width: `${Math.max(0.3, pct(o.endSec - o.startSec))}%` }}
          />
        ))}

        {/* 選択区間 */}
        {selection && (
          <div
            className="absolute top-0 bottom-0 bg-[var(--accent)]/25 border-x border-[var(--accent)]"
            style={{
              left: `${pct(selection.startSec)}%`,
              width: `${Math.max(0.3, pct(selection.endSec - selection.startSec))}%`,
            }}
          />
        )}

        {/* 再生ヘッド */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
          style={{ left: `${pct(playheadSec)}%` }}
        />
      </div>

      {/* 目盛り */}
      <div className="flex justify-between text-xs opacity-50 mt-1 px-0.5">
        <span>0:00</span>
        <span>{fmtTime(durationSec / 2)}</span>
        <span>{fmtTime(durationSec)}</span>
      </div>
    </div>
  );
}
