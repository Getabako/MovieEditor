import fs from "node:fs";
import path from "node:path";

// ============================================================================
// 台本生成プロンプト（汎用）
// テイスト（口調/構成/締め方など）は studio/script-style.md に書く。空なら一般的な構成で生成する。
// このファイルにはチャンネル固有の文言を持たせない（テイストは後から学習させる前提）。
// ============================================================================

export type ScriptFormat = "explainer" | "review" | "free";

export type ScriptInput = {
  theme: string; // テーマ/お題（必須）
  format: ScriptFormat;
  minutes?: number; // 想定尺（分）
  notes?: string; // 追加の要望・盛り込みたい情報
};

const STYLE_FILE = path.join(process.cwd(), "studio", "script-style.md");

function readStyle(): string {
  try {
    return fs.readFileSync(STYLE_FILE, "utf-8");
  } catch {
    return "";
  }
}

export const FORMAT_LABELS: Record<ScriptFormat, string> = {
  explainer: "解説",
  review: "レビュー",
  free: "自由（指定なし）",
};

const FORMAT_HINT: Record<ScriptFormat, string> = {
  explainer: "テーマを分かりやすく解説する構成（定義→要点→具体例→まとめ）。",
  review: "対象を実際に試した目線でレビューする構成（結論→良い点/悪い点→おすすめの使い方）。",
  free: "決まった型に縛られず、テーマに最適な構成で。",
};

export function buildScriptPrompt(input: ScriptInput): string {
  const style = readStyle();
  const minutes = input.minutes && input.minutes > 0 ? input.minutes : null;

  return [
    "あなたは YouTube動画の放送作家です。",
    "そのまま読み上げられる完成台本を日本語で書いてください。",
    "",
    "## 基本ルール（一般的な良い構成）",
    "- 結論ファースト。冒頭の数秒で強いフックと『この動画を見るメリット』を提示する。",
    "- 間延びさせない。要点・数字・具体例で密度を保つ。",
    "- 客観性のため、良い面と悪い面（メリット/デメリット）はできるだけセットで触れる。",
    "- 終盤は視聴者へのコメント誘導（具体的な問いかけ）で締める。",
    minutes ? `- 想定尺は約${minutes}分。その長さで間延びしない情報密度にする。` : "",
    `- 構成の方向性: ${FORMAT_HINT[input.format]}`,
    "- ただし、下の【台本スタイル】に記載がある場合は、口調・構成・締め方ともそちらを最優先で厳守する。",
    "",
    "## 出力形式",
    "- そのまま読める“喋り原稿”として書く（ト書きは最小限、必要なら【テロップ：…】の形で挿す）。",
    "- セクション見出しを付ける。",
    "- 余計な前置き・解説・謝辞は書かず、台本本文だけを出力する。",
    "",
    "## お題",
    `テーマ: ${input.theme}`,
    `フォーマット: ${FORMAT_LABELS[input.format]}`,
    input.notes ? `盛り込みたい点・要望: ${input.notes}` : "",
    "",
    "---",
    "# 【台本スタイル】（一次ソース。記載があれば最優先で従う）",
    style || "(まだ未設定。一般的な構成で書いてください)",
  ]
    .filter(Boolean)
    .join("\n");
}
