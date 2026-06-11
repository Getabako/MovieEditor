// ============================================================================
// 字幕/シーンタイトルの見た目の共通定義。
// presets.ts（色の割り当て）と remotion/Editor.tsx（描画）で共有する。
// ============================================================================

/** 字幕のデフォルト色（白ではなく、はっきり見える濃いめの黄） */
export const DEFAULT_SUBTITLE_COLOR = "#ffd400"; // 濃い黄

/** 話者ごとの字幕色パレット（YouTube風に目立つ色）。順に割り当てる。白は使わない。 */
export const SPEAKER_COLORS = [
  "#ffd400", // 話者A: 濃い黄
  "#37c6ff", // 話者B: 水色
  "#a965ff", // 話者C: 紫
  "#46e06a", // 話者D: 緑
  "#ff6fa5", // 話者E: ピンク
];

/** タイトルの背景グラデーション（ダークネイビー。ゴールド枠に合わせる） */
export const TITLE_BG_GRADIENT = "linear-gradient(135deg,#14365f 0%,#0a1f3c 100%)";
/** タイトルの文字色（字幕の黄とは別の色・シアン） */
export const TITLE_TEXT_COLOR = "#5ce6ff";

export function speakerColor(speaker: string | undefined, index = 0): string {
  if (!speaker) return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
  // "A","B"... や "0","1"... を数値化
  const code = /^[A-Za-z]$/.test(speaker)
    ? speaker.toUpperCase().charCodeAt(0) - 65
    : Number.isFinite(Number(speaker))
      ? Number(speaker)
      : index;
  return SPEAKER_COLORS[((code % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length];
}

/**
 * 縁取りの既定色。
 * - メインの太い縁取りは白（視認性・ご要望）
 * - その外側にごく細い黒を入れて、明るい背景でも白縁が埋もれないようにする
 */
export const STROKE_MAIN_DEFAULT = "#ffffff"; // 太い白縁
export const STROKE_EDGE_DEFAULT = "#000000"; // 細い黒の外周

/** 丸ゴシック（M PLUS Rounded 1c）を最優先にしたフォントスタック */
export const ROUNDED_FONT_STACK =
  '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Noto Sans JP",sans-serif';
