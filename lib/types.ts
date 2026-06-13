// ============================================================================
// EDL (Edit Decision List) — 編集の単一の真実(source of truth)
// 元動画は一切書き換えない非破壊編集。EDL を解釈して Player / Renderer が描画する。
// ============================================================================

export type SourceInfo = {
  /** 元動画の絶対パス */
  path: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
};

export type OutputInfo = {
  width: number;
  height: number;
  fps: number;
};

/**
 * クリップ = 元動画から切り出した一区間。timeline 上では clips を順に連結する。
 * 「カット」はこの区間を分割/削除することで表現する（非破壊）。
 */
export type Clip = {
  id: string;
  /** 元動画上の開始秒 (in点) */
  srcStartSec: number;
  /** 元動画上の終了秒 (out点) */
  srcEndSec: number;
  /** 再生速度。1=等速, 2=2倍速。間延び圧縮などで使用 */
  speed?: number;
  /** このクリップの音量 (0-1)。未指定は1 */
  volume?: number;
  /** 任意ラベル（「導入」「本編」など。チャプター用） */
  label?: string;
};

export type OverlayBase = {
  id: string;
  /** 出力タイムライン上の表示開始秒 */
  startSec: number;
  /** 出力タイムライン上の表示終了秒 */
  endSec: number;
};

export type TextOverlay = OverlayBase & {
  type: "text";
  text: string;
  /** 0-1 の相対座標（中心基準）。未指定は字幕デフォルト */
  x?: number;
  y?: number;
  fontSize?: number;
  /** 文字本体の色（塗り） */
  color?: string;
  /** 背景帯の色（字幕の可読性）。null/未指定で無し */
  background?: string | null;
  fontWeight?: number;
  /** 字幕として自動生成されたものか（プリセット再生成で置換対象になる） */
  isSubtitle?: boolean;
  align?: "left" | "center" | "right";
  /**
   * 表示の種類。
   * - "subtitle"(既定): 画面下の字幕。二重縁取り＋丸ゴシック。
   * - "title": 各シーンの見出し。左上に大きく目立つ装飾で出す。
   */
  variant?: "subtitle" | "title";
  /** 話者ID（色分け用。"A"/"B" など）。色は speaker→color で決める */
  speaker?: string;
  /** 二重縁取りの内側の色（既定は話者色に追従）。YouTube風の目立つ縁取り用 */
  strokeInner?: string;
  /** 二重縁取りの外側の色（既定は濃い色） */
  strokeOuter?: string;
  /** 自動シーンタイトルとして生成されたか（再生成で置換対象） */
  isSceneTitle?: boolean;
  /**
   * フリー配置の記号/スタンプ（絵文字や♡!?など）。true のとき定型装飾を使わず、
   * x,y(中心・0-1) に fontSize の大きさでそのまま置く。直感操作（移動/拡縮）の対象。
   */
  free?: boolean;
  /** 回転（度）。free 記号などで使用。既定 0 */
  rotation?: number;
};

export type ImageOverlay = OverlayBase & {
  type: "image";
  /** 画像のURL / 絶対パス / asset://絶対パス */
  src: string;
  /** 中心のX座標（出力幅に対する相対 0-1）。既定 0.5 */
  x?: number;
  /** 中心のY座標（出力高さに対する相対 0-1）。既定 0.5 */
  y?: number;
  /** 幅（出力幅に対する相対 0-1）。既定 0.25 */
  width?: number;
  opacity?: number;
  /** 回転（度）。既定 0 */
  rotation?: number;
};

/** 図形（まる/三角/四角）。縦横比・位置・大きさ・色を自由に変えられる。 */
export type ShapeKind = "rect" | "circle" | "triangle";
export type ShapeOverlay = OverlayBase & {
  type: "shape";
  shape: ShapeKind;
  /** 中心のX座標（出力幅に対する相対 0-1）。既定 0.5 */
  x?: number;
  /** 中心のY座標（出力高さに対する相対 0-1）。既定 0.5 */
  y?: number;
  /** 幅（出力幅に対する相対 0-1）。既定 0.2 */
  width?: number;
  /** 高さ（出力高さに対する相対 0-1）。既定 0.2。width と独立＝縦横比を変えられる */
  height?: number;
  /** 塗り色 */
  color?: string;
  opacity?: number;
  /** 回転（度）。既定 0 */
  rotation?: number;
};

export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay;

/** 直感操作（移動/拡縮/回転/色）でオーバーレイに当てる部分パッチ */
export type OverlayPatch = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  opacity?: number;
  rotation?: number;
  color?: string;
};

/** 効果音(SE)＝出力タイムライン上の一点で一度だけ鳴らす音 */
export type SeEvent = {
  id: string;
  /** 音源のURL / 絶対パス / asset://絶対パス */
  src: string;
  /** 出力タイムライン上の発音時刻(秒) */
  atSec: number;
  /** 音量 0-1。既定 1 */
  volume?: number;
};

export type AudioSettings = {
  /** 元動画の音声を消すか */
  muteOriginal?: boolean;
  /** BGM の絶対パス or URL or asset://絶対パス（全編ループ） */
  bgmPath?: string;
  bgmVolume?: number;
  /** 効果音イベント（出力時刻で一度ずつ再生） */
  se?: SeEvent[];
  /** 書き出し時に音量ノーマライズ(loudnorm)を適用するか */
  normalize?: boolean;
};

export type EDL = {
  /** スキーマ世代。破壊的変更時に上げる */
  schema: 1;
  source: SourceInfo;
  output: OutputInfo;
  clips: Clip[];
  overlays: Overlay[];
  audio?: AudioSettings;
};

// ============================================================================
// プロジェクト（ディスク永続化の単位）
// ============================================================================

export type HistoryEntry = {
  /** 履歴ファイル名 (v0001.json 等) の連番 */
  index: number;
  /** 何の編集だったか（人間可読の短い説明） */
  label: string;
  /** ISO8601 */
  at: string;
  /** この時点での clips 数 / 出力尺（一覧表示用） */
  clipCount: number;
  durationSec: number;
};

export type TranscriptStatus = "none" | "running" | "done" | "error";

export type ProjectMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: SourceInfo;
  output: OutputInfo;
  /** 現在の履歴位置（この index の EDL が現在状態） */
  historyIndex: number;
  /** 履歴の最大 index（redo 可能範囲の上限） */
  historyMax: number;
  transcript: TranscriptStatus;
};

// ============================================================================
// 文字起こし（whisper.cpp 出力を正規化したもの）
// ============================================================================

export type TranscriptWord = {
  text: string;
  startSec: number;
  endSec: number;
};

export type TranscriptSegment = {
  id: number;
  startSec: number;
  endSec: number;
  text: string;
  words?: TranscriptWord[];
};

export type Transcript = {
  language: string;
  segments: TranscriptSegment[];
};

// ============================================================================
// プリセット（ワンクリックでよくある編集）
// ============================================================================

export type PresetId =
  | "trimSilence" // 長い無音/間を自動カット
  | "removeFillers" // 「えー」「あー」等のフィラー語カット
  | "autoSubtitle" // 喋っているセリフに自動字幕
  | "tightenGaps" // ジャンプカット圧縮（間を詰める/早送り）
  | "trimEnds" // 冒頭・末尾の無音をトリム
  | "cleanupRepeats" // 繰り返し再生/ぶつ切りのかけらを掃除
  | "speedUp" // 全体の再生速度を上げる
  | "colorSpeakers" // 話者ごとに字幕色を変える（既存字幕にも適用）
  | "normalizeAudio"; // 音量ノーマライズ

export type PresetOptions = {
  /** trimSilence: これより長い無音(秒)をカット */
  silenceMinSec?: number;
  /** trimSilence: 無音と判定する音量しきい値(dB, 例 -30) */
  silenceThresholdDb?: number;
  /** trimSilence/tightenGaps: カット時に前後へ残す余白(秒) */
  paddingSec?: number;
  /** removeFillers: 追加で除外したいフィラー語 */
  extraFillers?: string[];
  /** autoSubtitle: 1行最大文字数 */
  subtitleMaxChars?: number;
  /** speedUp: 全体の再生速度倍率（1.25 / 1.5 / 2 など） */
  speedFactor?: number;
  /** autoSubtitle: 話者ごとに字幕の色を変える（会話の間で話者を推定） */
  colorBySpeaker?: boolean;
};

export type PresetRequest = {
  presets: PresetId[];
  options?: PresetOptions;
};
