import fs from "node:fs";
import path from "node:path";

// ============================================================================
// サムネ生成プロンプト（汎用）
// 様式は studio/thumbnail-style.md に書く。空なら一般的なYouTubeサムネとして生成する。
// チャンネル固有の文言はここに持たせない（テイストは後から学習させる前提）。
// ============================================================================

/** 参照画像の役割。生成時に合成方法を変える。 */
export type RefRole = "person" | "character" | "logo" | "other";

export type RefImage = {
  path: string; // 参照画像の絶対パス
  role: RefRole;
};

export type ThumbnailInput = {
  mainCopy: string; // メインコピー（画面上半分の大きい文字）
  subCopy?: string; // サブコピー（右下）
  scene: string; // 背景/被写体の説明
  badge?: string; // 左上バッジ文言
  refs?: RefImage[]; // 参照画像（人物/キャラ/ロゴ等）。サムネに合成する。
};

const ROLE_LABEL: Record<RefRole, string> = {
  person: "人物",
  character: "キャラクター",
  logo: "ロゴ",
  other: "参考",
};

/** 参照画像を使う場合の、役割別の合成指示ブロックを作る */
function buildRefsBlock(refs?: RefImage[]): string {
  if (!refs || refs.length === 0) return "";
  const lines = refs.map((r, i) => `  ${i + 1}. [${ROLE_LABEL[r.role]}] ${r.path}`);
  return [
    "",
    "## 参照画像の合成（重要）",
    "次の参照画像を読み込み、サムネに自然に取り込むこと。各画像を image_gen の入力リファレンスとして使い、人物/キャラはシーンと一体に、ロゴは正確に再現する。",
    ...lines,
    "- [人物]/[キャラクター]: 顔・髪・服・特徴を崩さず本人と分かる形で残し、背景シーンのライティング・色・影・遠近に馴染ませて自然に合成する（切り抜き貼り付けに見えないように）。主役として目立つ配置。",
    "- [ロゴ]: 形・色・文字を改変しない（書き換え・装飾の追加・歪み禁止）。視認できるサイズで隅などに配置。",
    "- [参考]: 雰囲気・配色・小物の参考として活用する。",
    "- 参照画像にある人物・ロゴを勝手に別人・別デザインに描き替えないこと。",
    "- 自社ロゴ・自社出演者以外の第三者の商標・顔は使わない（権利確認済みの素材のみ）。",
  ].join("\n");
}

const STYLE_FILE = path.join(process.cwd(), "studio", "thumbnail-style.md");

function readStyle(): string {
  try {
    return fs.readFileSync(STYLE_FILE, "utf-8");
  } catch {
    return "";
  }
}

/** 編集中の動画の内容（タイトル・テロップ・文字起こし）からサムネ要素を提案させる文脈 */
export type ThumbnailContext = {
  title: string;
  telops?: string[];
  transcript?: string;
};

/**
 * 動画の内容から、サムネの各入力欄(mainCopy/subCopy/scene/badge)を提案させるプロンプト（汎用）。
 * Codex には JSON のみを返させる。テイストは studio/thumbnail-style.md に従う。
 */
export function buildThumbnailSuggestPrompt(ctx: ThumbnailContext): string {
  return [
    "あなたは YouTube動画のサムネイル制作者です。",
    "下記【サムネのテイスト】を踏まえ、この動画にふさわしいサムネの要素を提案してください。",
    "（テイストが未設定なら、一般的に見やすいサムネとして提案する）",
    "",
    "## 出力（重要）",
    "次のJSONだけを出力する（前後に説明文・コードブロック記号を付けない）:",
    '{"mainCopy":"…","subCopy":"…","scene":"…","badge":"…"}',
    "- mainCopy: 画面上半分の大きい文字。3〜5語で、内容が一目で伝わるフック。",
    "- subCopy: 右下の補足コピー（無くてよければ空文字）。",
    "- scene: 背景/被写体の描写（日本語。動画内容に合う画。人物の有無も書く）。",
    "- badge: 左上バッジ文言（無くてよければ空文字）。",
    "",
    "## この動画の内容",
    `タイトル: ${ctx.title}`,
    ctx.telops && ctx.telops.length ? `テロップ抜粋: ${ctx.telops.slice(0, 40).join(" / ")}` : "",
    ctx.transcript ? `文字起こし抜粋: ${ctx.transcript.slice(0, 1500)}` : "",
    "",
    "---",
    "# 【サムネのテイスト】（一次ソース。記載があれば最優先で従う）",
    readStyle() || "(まだ未設定。一般的なサムネとして提案してください)",
  ]
    .filter(Boolean)
    .join("\n");
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
    buildRefsBlock(input.refs),
    "",
    "---",
    "# 【サムネのテイスト】（一次ソース。記載があれば最優先で従う）",
    readStyle() || "(まだ未設定。一般的なサムネとして作ってください)",
  ]
    .filter(Boolean)
    .join("\n");
}
