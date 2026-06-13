"use client";

import React from "react";
import type { EDL, Overlay, ImageOverlay, TextOverlay, OverlayPatch } from "@/lib/types";
import { assetToUrl } from "@/lib/asset-url";

// ============================================================================
// プレビューに重ねる「直感操作レイヤ」。
// 画像オーバーレイ／フリー記号(絵文字)を、ドラッグで移動・角ハンドルでサイズ変更する。
// 座標は EDL の x,y(中心・0-1)・width(出力幅比)・fontSize(出力px) を直接書き換える。
// 動画の表示矩形(レターボックス考慮)を実測して、相対座標↔画面pxを対応づける。
// ============================================================================

type EditableKind = "image" | "freetext";
function editableKind(o: Overlay): EditableKind | null {
  if (o.type === "image") return "image";
  if (o.type === "text" && (o as TextOverlay).free) return "freetext";
  return null;
}

/** コンテナ内で composition(アスペクト固定)が contain 表示される矩形 */
function fitRect(cw: number, ch: number, aspect: number) {
  let w = cw;
  let h = cw / aspect;
  if (h > ch) {
    h = ch;
    w = ch * aspect;
  }
  return { w, h, x: (cw - w) / 2, y: (ch - h) / 2 };
}

export default function OverlayCanvas({
  edl,
  playheadSec,
  selectedId,
  onSelect,
  onLiveChange,
  onCommit,
  onDelete,
}: {
  edl: EDL;
  playheadSec: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグ中のライブ更新（サーバー未保存） */
  onLiveChange: (id: string, patch: OverlayPatch) => void;
  /** 操作確定時にコミット */
  onCommit: (label: string) => void;
  /** 素材を削除 */
  onDelete: (id: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const aspect = edl.output.width / edl.output.height;
  const rect = fitRect(box.w, box.h, aspect);
  const t = playheadSec;

  const items = edl.overlays.filter((o) => {
    const k = editableKind(o);
    if (!k) return false;
    return t >= o.startSec && t < o.endSec;
  });

  // ---- ドラッグ（移動/リサイズ）共通処理 ----
  function startMove(e: React.PointerEvent, o: Overlay) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(o.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = (o as ImageOverlay).x ?? 0.5;
    const oy = (o as ImageOverlay).y ?? 0.5;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.w;
      const dy = (ev.clientY - startY) / rect.h;
      onLiveChange(o.id, {
        x: Math.max(0, Math.min(1, ox + dx)),
        y: Math.max(0, Math.min(1, oy + dy)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onCommit("素材を移動");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(e: React.PointerEvent, o: Overlay, kind: EditableKind) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(o.id);
    const startX = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const img = o as ImageOverlay;
    const txt = o as TextOverlay;
    const baseW = img.width ?? 0.25; // 画像: 出力幅比
    const baseFont = txt.fontSize ?? 80; // 記号: 出力px
    const move = (ev: PointerEvent) => {
      const dxRel = (ev.clientX - startX) / rect.w; // 出力幅比の変化
      if (kind === "image") {
        onLiveChange(o.id, { width: Math.max(0.03, Math.min(1.5, baseW + dxRel * 2)) });
      } else {
        // 記号: 幅比の変化を出力pxに換算（出力幅 = edl.output.width）
        const deltaPx = dxRel * 2 * edl.output.width;
        onLiveChange(o.id, { fontSize: Math.max(16, Math.min(600, baseFont + deltaPx)) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onCommit("素材のサイズ変更");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10"
      style={{ pointerEvents: "none" }}
      onPointerDown={() => onSelect(null)}
    >
      {rect.w > 0 &&
        items.map((o) => {
          const k = editableKind(o)!;
          const ox = (o as ImageOverlay).x ?? 0.5;
          const oy = (o as ImageOverlay).y ?? 0.5;
          const cx = rect.x + ox * rect.w;
          const cy = rect.y + oy * rect.h;
          const selected = selectedId === o.id;

          // 表示寸法（プレビュー枠内px）
          let elW: number | undefined;
          let elH: number | undefined;
          let replica: React.ReactNode;
          if (k === "image") {
            const img = o as ImageOverlay;
            elW = (img.width ?? 0.25) * rect.w;
            replica = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetToUrl(img.src) ?? img.src}
                alt=""
                draggable={false}
                style={{ width: elW, height: "auto", display: "block", opacity: 0 }}
              />
            );
          } else {
            const txt = o as TextOverlay;
            const fs = (txt.fontSize ?? 80) * (rect.h / edl.output.height);
            replica = (
              <div style={{ fontSize: fs, lineHeight: 1, whiteSpace: "nowrap", opacity: 0, fontWeight: 900 }}>
                {txt.text}
              </div>
            );
          }

          return (
            <div
              key={o.id}
              style={{
                position: "absolute",
                left: cx,
                top: cy,
                transform: "translate(-50%,-50%)",
                pointerEvents: "auto",
                cursor: "move",
                outline: selected ? "2px solid #00e0a0" : "1.5px dashed rgba(255,255,255,.6)",
                outlineOffset: 2,
              }}
              onPointerDown={(e) => startMove(e, o)}
            >
              {replica}

              {selected && (
                <>
                  {/* リサイズハンドル（右下） */}
                  <div
                    onPointerDown={(e) => startResize(e, o, k)}
                    style={{
                      position: "absolute",
                      right: -8,
                      bottom: -8,
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: "#00e0a0",
                      border: "2px solid #053",
                      cursor: "nwse-resize",
                    }}
                  />
                  {/* 削除 */}
                  <div
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(o.id);
                    }}
                    title="削除"
                    style={{
                      position: "absolute",
                      right: -10,
                      top: -10,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      background: "#ff4d5e",
                      color: "#fff",
                      fontSize: 13,
                      lineHeight: "18px",
                      textAlign: "center",
                      cursor: "pointer",
                      border: "2px solid #511",
                    }}
                  >
                    ×
                  </div>
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}
