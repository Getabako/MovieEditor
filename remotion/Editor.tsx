import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  Series,
  Video,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/MPLUSRounded1c";
import type { EditorProps } from "./types";
import type { ImageOverlay, TextOverlay } from "@/lib/types";
import {
  ROUNDED_FONT_STACK,
  DEFAULT_SUBTITLE_COLOR,
  STROKE_MAIN_DEFAULT,
  STROKE_EDGE_DEFAULT,
  TITLE_BG_GRADIENT,
  TITLE_TEXT_COLOR,
} from "@/lib/subtitle-style";

// M PLUS Rounded 1c を読み込む（Player/Renderer 共通。delayRender は内部処理）
loadFont();

/**
 * EDL を描画する Remotion コンポジション。
 * Player（ブラウザのリアルタイムプレビュー）と Renderer（MP4書き出し）の両方で使う。
 * clips を Series で連結し、overlays を出力タイムライン時刻で重ねる。
 */
export const Editor: React.FC<EditorProps> = ({
  edl,
  srcUrl,
  mode = "render",
  realtimeSpeed = false,
}) => {
  const { fps } = edl.output;
  const muteOriginal = edl.audio?.muteOriginal ?? false;
  const isPreview = mode === "preview";

  // 軽量化: clips/overlays の要素配列は EDL が変わった時だけ作り直す。
  // Player は毎フレーム Editor を再レンダリングするため、毎回 140+530 個の
  // 要素を作り直すとフレームごとに重い。useMemo で参照を固定する
  // （実際に描画されるのは現在フレームに掛かる Sequence だけ）。
  const clipSeqs = React.useMemo(
    () =>
      edl.clips.map((c) => {
        const speed = c.speed && c.speed > 0 ? c.speed : 1;
        const rawDur = Math.max(0, c.srcEndSec - c.srcStartSec);
        const outFrames = Math.max(1, Math.round((rawDur / speed) * fps));
        // プレビューは <Video>(HTML5)、書き出しは <OffthreadVideo>（フレーム単位に正確）。
        const Comp = isPreview ? Video : OffthreadVideo;
        // プレビューは通常 1倍で再生（巨大な元動画を高速シークすると黒画面＆重くなるため）。
        // 軽量プロキシ使用時(realtimeSpeed)は実際の速度で再生してよい。書き出しは常に実速度。
        const playbackRate = isPreview && !realtimeSpeed ? 1 : speed;
        return (
          <Series.Sequence key={c.id} durationInFrames={outFrames}>
            <AbsoluteFill>
              <Comp
                src={srcUrl}
                startFrom={Math.round(c.srcStartSec * fps)}
                endAt={Math.round(c.srcEndSec * fps)}
                playbackRate={playbackRate}
                volume={muteOriginal ? 0 : c.volume ?? 1}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </AbsoluteFill>
          </Series.Sequence>
        );
      }),
    [edl.clips, fps, isPreview, muteOriginal, srcUrl],
  );

  const overlaySeqs = React.useMemo(
    () =>
      edl.overlays.map((ov) => {
        const from = Math.round(ov.startSec * fps);
        const dur = Math.max(1, Math.round((ov.endSec - ov.startSec) * fps));
        return (
          <Sequence key={ov.id} from={from} durationInFrames={dur} layout="none">
            {ov.type === "text" ? (
              <TextOverlayView ov={ov} edl={edl} />
            ) : (
              <ImageOverlayView ov={ov} edl={edl} />
            )}
          </Sequence>
        );
      }),
    [edl, fps],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Series>{clipSeqs}</Series>
      {overlaySeqs}

      {edl.audio?.bgmPath && (
        <Audio src={edl.audio.bgmPath} volume={edl.audio.bgmVolume ?? 0.2} loop />
      )}
    </AbsoluteFill>
  );
};

/**
 * 二重縁取り(YouTube風)テキスト。
 * 後ろに「太い外側縁取り(濃色)」、その上に「細い内側縁取り(明色)」、最前面に塗りを重ねる。
 * -webkit-text-stroke + paintOrder で塗りつぶしを壊さずに縁取りだけ重ねる。
 */
const StrokeText: React.FC<{
  text: string;
  fill: string;
  inner: string;
  outer: string;
  outerWidth: number;
  innerWidth: number;
  fontSize: number;
  fontWeight: number;
  align?: "left" | "center" | "right";
  /** true で CSS の自動折り返しを禁止（改行は \n のみ）。字幕で使う */
  noWrap?: boolean;
}> = ({ text, fill, inner, outer, outerWidth, innerWidth, fontSize, fontWeight, align, noWrap }) => {
  const base: React.CSSProperties = {
    margin: 0,
    fontFamily: ROUNDED_FONT_STACK,
    fontSize,
    fontWeight,
    lineHeight: 1.5, // 行間をゆったり
    // 字幕は改行(\n)だけで折る。CSS の勝手な再折返し(単語の途中で割れる)を禁止。
    whiteSpace: noWrap ? "pre" : "pre-wrap",
    textAlign: align ?? "center",
    letterSpacing: "0.06em", // 字間も少し広げる
    // 縁取りを文字の外側だけに出す
    paintOrder: "stroke fill" as React.CSSProperties["paintOrder"],
  };
  const layer = (color: string, strokeColor: string, strokeW: number, z: number): React.CSSProperties => ({
    ...base,
    position: z === 0 ? "relative" : "absolute",
    inset: z === 0 ? undefined : 0,
    color,
    WebkitTextStrokeWidth: strokeW,
    WebkitTextStrokeColor: strokeColor,
  });
  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        // 明るい背景でも沈まないよう暗いハロー(影)を全体に付ける
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.9)) drop-shadow(0 0 2px rgba(0,0,0,0.8))",
      }}
    >
      {/* 外側の太い縁取り（濃色） */}
      <div style={layer("transparent", outer, outerWidth, 1)} aria-hidden>
        {text}
      </div>
      {/* 内側の細い縁取り（明色） */}
      <div style={layer("transparent", inner, innerWidth, 2)} aria-hidden>
        {text}
      </div>
      {/* 最前面の塗り */}
      <div style={layer(fill, "transparent", 0, 0)}>{text}</div>
    </div>
  );
};

/** 白系の色かどうか（タイトルの「白文字」を強制的に色付きへ置き換える判定） */
function isWhitish(c?: string): boolean {
  if (!c) return true;
  const s = c.toLowerCase().replace(/\s/g, "");
  return s === "#fff" || s === "#ffffff" || s === "white" || s === "rgb(255,255,255)";
}

const TextOverlayView: React.FC<{ ov: TextOverlay; edl: EditorProps["edl"] }> = ({
  ov,
  edl,
}) => {
  // variant 未指定でも「字幕でないテキスト」はタイトル扱いにして装飾する
  const isTitle = ov.variant === "title" || ov.isSceneTitle === true || !ov.isSubtitle;
  const h = edl.output.height;
  const mainStroke = ov.strokeInner ?? STROKE_MAIN_DEFAULT; // 太い白
  const edgeStroke = ov.strokeOuter ?? STROKE_EDGE_DEFAULT; // 細い黒の外周

  // タイトル登場の「ポヨン」スプリング（Sequence相対フレーム）。字幕では未使用。
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 9, mass: 0.7, stiffness: 130 }, // オーバーシュートして弾む
    durationInFrames: Math.round(fps * 0.7),
  });

  if (isTitle) {
    // シーンタイトル: 凝った背景＋白枠＋縁取り＋白以外の文字色
    const x = ov.x ?? 0.5;
    const y = ov.y ?? 0.08;
    const fontSize = ov.fontSize ?? Math.round(h * 0.058);
    const mainW = Math.max(5, Math.round(fontSize * 0.13));
    // Codex が白指定でも、白以外の見やすい色に置き換える
    const titleFill = isWhitish(ov.color) ? TITLE_TEXT_COLOR : (ov.color as string);
    const titleBg = TITLE_BG_GRADIENT;
    return (
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            // ポヨンと弾みながら登場（scaleをスプリングで）
            transform: `translateX(-50%) scale(${pop})`,
            transformOrigin: "center center",
            maxWidth: "80%",
            background: titleBg,
            padding: "0.16em 0.8em",
            borderRadius: 14,
            boxShadow: "0 5px 0 rgba(0,0,0,0.3), 0 12px 26px rgba(0,0,0,0.5)",
            border: "3px solid #ffd34d", // ゴールドの枠
            outline: "2px solid rgba(0,0,0,0.55)",
          }}
        >
          <StrokeText
            text={ov.text}
            fill={titleFill}
            inner={mainStroke}
            outer={edgeStroke}
            innerWidth={mainW}
            outerWidth={mainW + Math.max(3, Math.round(fontSize * 0.08))}
            fontSize={fontSize}
            fontWeight={ov.fontWeight ?? 900}
            align="center"
          />
        </div>
      </AbsoluteFill>
    );
  }

  // 字幕: カラフルな塗り＋太い白縁＋細い黒外周。CSS の自動折返しはさせない。
  const fill = ov.color ?? DEFAULT_SUBTITLE_COLOR;
  const x = ov.x ?? 0.5;
  const y = ov.y ?? 0.86;
  const fontSize = ov.fontSize ?? Math.round(h * 0.05);
  const mainW = Math.max(6, Math.round(fontSize * 0.14));
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: "translate(-50%, -50%)",
          maxWidth: "94%",
        }}
      >
        <StrokeText
          text={ov.text}
          fill={fill}
          inner={mainStroke}
          outer={edgeStroke}
          innerWidth={mainW}
          outerWidth={mainW + Math.max(3, Math.round(fontSize * 0.08))}
          fontSize={fontSize}
          fontWeight={ov.fontWeight ?? 800}
          align={ov.align ?? "center"}
          noWrap
        />
      </div>
    </AbsoluteFill>
  );
};

const ImageOverlayView: React.FC<{ ov: ImageOverlay; edl: EditorProps["edl"] }> = ({
  ov,
  edl,
}) => {
  const x = ov.x ?? 0.5;
  const y = ov.y ?? 0.5;
  const w = ov.width ? ov.width * edl.output.width : undefined;
  return (
    <AbsoluteFill>
      <Img
        src={ov.src}
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: "translate(-50%, -50%)",
          width: w,
          opacity: ov.opacity ?? 1,
        }}
      />
    </AbsoluteFill>
  );
};
