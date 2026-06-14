import fs from "node:fs";
import path from "node:path";

// ============================================================================
// サムネ生成プロンプト（汎用）
// 様式は studio/thumbnail-style.md に書く。空なら一般的なYouTubeサムネとして生成する。
// チャンネル固有の文言はここに持たせない（テイストは後から学習させる前提）。
// ============================================================================

export type ThumbnailInput = {
  mainCopy: string; // メインコピー（画面上半分の大きい文字）
  subCopy?: string; // サブコピー（右下）
  scene: string; // 背景/被写体の説明
  badge?: string; // 左上バッジ文言
};

const STYLE_FILE = path.join(process.cwd(), "studio", "thumbnail-style.md");

function readStyle(): string {
  try {
    return fs.readFileSync(STYLE_FILE, "utf-8");
  } catch {
    return "";
  }
}

/**
 * @param outPath 生成画像を保存させる絶対パス（PNG）
 */
export function buildThumbnailPrompt(input: ThumbnailInput, outPath: string): string {
  return [
    "あなたは YouTube動画のサムネイル制作者です。",
    "下記【サムネのテイスト】に従い、画像生成ツールでYouTubeサムネ画像を1枚作ってください。",
    "（テイストが未設定なら、一般的に見やすいサムネ＝大きな文字・高コントラスト・三分割構図で作る）",
    "",
    "## 作業手順（重要）",
    "1. 16:9・1920×1080 のサムネ画像を生成する。",
    `2. 生成した画像を必ず次の絶対パスに PNG で保存する: ${outPath}`,
    "3. 保存できたら、最後のメッセージで『保存しました』と一言だけ返す（画像をテキストに貼らない）。",
    "",
    "## このサムネの内容",
    `背景/被写体: ${input.scene}`,
    `メインコピー（画面上半分・大きく・高コントラスト）: ${input.mainCopy}`,
    input.subCopy ? `サブコピー（右下）: ${input.subCopy}` : "",
    input.badge ? `左上バッジ: ${input.badge}` : "",
    "- 日本語テキストは一字一句正確に描画する（文字化け・字形崩れ厳禁）。",
    "",
    "---",
    "# 【サムネのテイスト】（一次ソース。記載があれば最優先で従う）",
    readStyle() || "(まだ未設定。一般的なサムネとして作ってください)",
  ]
    .filter(Boolean)
    .join("\n");
}
