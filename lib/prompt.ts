import type { EDL } from "./types";

export type EditContext = {
  /** 現在の出力タイムライン上の再生位置(秒) */
  playheadSec?: number;
  /** タイムライン上で選択中の区間(秒)。あれば「ここ」系の指示の対象 */
  selection?: { startSec: number; endSec: number } | null;
  /** transcript.json が存在するか */
  hasTranscript: boolean;
  /** 元動画上の現在位置（参考情報） */
  playheadSourceSec?: number | null;
};

/**
 * Codex(app-server) に渡す編集指示プロンプトを組み立てる。
 * Codex は projectDir をカレントに動き、_codex/edl.next.json に新しい EDL を書き出す。
 * 必要なら shell/ffmpeg でフレームを書き出して内容を確認してよい。
 */
export function buildEditPrompt(args: {
  projectDir: string;
  edl: EDL;
  instruction: string;
  ctx: EditContext;
}): string {
  const { projectDir, edl, instruction, ctx } = args;
  const sel = ctx.selection
    ? `選択区間: ${ctx.selection.startSec.toFixed(2)}s - ${ctx.selection.endSec.toFixed(2)}s（出力タイムライン上）`
    : "選択区間: なし";
  const head =
    ctx.playheadSec != null
      ? `再生ヘッド: 出力 ${ctx.playheadSec.toFixed(2)}s` +
        (ctx.playheadSourceSec != null ? ` ≒ 元動画 ${ctx.playheadSourceSec.toFixed(2)}s` : "")
      : "再生ヘッド: 不明";

  return `あなたは動画編集アシスタントです。ユーザーの自然言語の指示に従って、編集状態を表す EDL(JSON) を更新します。

# 動作ルール（厳守）
1. 現在の EDL は \`${projectDir}/edl.json\` にあります。まずこれを読んでください。
2. 編集後の新しい EDL を \`${projectDir}/_codex/edl.next.json\` に**JSONとして**書き出してください。これが唯一の成果物です。
3. 元動画ファイルは絶対に変更しないでください（非破壊編集）。EDL の clips/overlays を編集するだけです。
4. \`source\` と \`output\` は基本そのまま維持。clips の in/out 秒や overlays を編集します。
5. 不明確な点があっても質問せず、最も妥当な解釈で編集を完了してください。
6. 完了したら、何をしたかを1〜2文の日本語で要約してください（これが履歴ラベルになります）。
7. **繰り返し再生を作らないこと**: clips は元動画上で前から後ろへ進む順に並べ、区間を重複させない（同じ元動画区間を二度再生しない）。隣り合うクリップの srcEndSec と次の srcStartSec を逆転・重複させない。
8. **ぶつ切りのかけらを作らないこと**: 長さ0.3秒未満の極小クリップを残さない。カットで生じた隙間は前後のクリップに寄せる。
9. ユーザーが「繰り返しを削除/ぶつ切りを直して」と言ったら、重複再生している区間と0.3秒未満のかけらを取り除く。

# EDL スキーマ（要点）
- \`clips[]\`: 元動画から切り出す区間。\`srcStartSec\`〜\`srcEndSec\`（元動画の秒）。順に連結されて出力になる。
  - カット = 該当区間を含むクリップを分割して不要部分を削除する。
  - 早送り/スロー = クリップに \`speed\`（2=2倍速 等）。
  - 音量 = クリップに \`volume\`(0-1)。
- \`overlays[]\`: 出力タイムライン上の時刻(\`startSec\`/\`endSec\`)で表示する要素。
  - テキスト: \`{type:"text", text, x,y(0-1相対,中心基準), fontSize, color, align, variant, speaker, isSubtitle, isSceneTitle}\`
    - \`variant:"subtitle"\`(既定)= 画面下の字幕。丸ゴシック＋二重縁取りで自動装飾される。色は \`color\`（話者で変えるなら話者ごとに色を分ける）。
    - \`variant:"title"\`= **各シーンの見出し**。x,y は省略で左上に出る。短い単語/フレーズで端的に（例「環境構築」「インストール」「実演」）。背景帯＋白フチで目立つ装飾が自動で付く。シーンが変わる区切りごとに置く。\`isSceneTitle:true\` を付ける。
  - 速度: クリップの \`speed\`(>1で早送り)。全体を早めるなら全 clip に同じ speed を付ける。
  - 画像: \`{type:"image", src(絶対パス), x,y, width(0-1), opacity}\`
- \`audio\`: \`{muteOriginal, bgmPath, bgmVolume, normalize}\`

# 装飾の指示への対応
- 「各シーンのタイトルを左上に」= transcript から話題の区切りを見つけ、各区切りの先頭に \`variant:"title"\` のテキストを短い単語で置く（出力タイムライン時刻で）。
- 「話者ごとに色を変える」= 字幕の \`color\` を話者ごとに分け、\`speaker\` に "A"/"B" 等を入れる。
- 字幕の縁取り/フォントは描画側で自動（丸ゴシック＋YouTube風二重縁取り）。色だけ指定すればよい。

# 時間の指定について
- 「○フレーム目」= 秒に変換（fps=${edl.output.fps}）。例: 300フレーム = ${(300 / edl.output.fps).toFixed(2)}s。
- 「ここ」「今のシーン」= 下記の再生ヘッド/選択区間を基準にする。
- 「○○と言っているところ」「○○なシーン」= ${
    ctx.hasTranscript
      ? "`" + projectDir + "/transcript.json` に文字起こし(セグメント/単語のタイムスタンプ)があります。これを grep して該当時刻を特定してください。"
      : "文字起こしはまだありません。映像で判断が必要なら `ffmpeg -ss <秒> -i <元動画> -frames:v 1 out.png` でフレームを書き出して確認してよいです。"
  }
- EDL 内の時刻は基本「元動画の秒」(clips) と「出力タイムラインの秒」(overlays) が混在します。混同しないこと。

# 現在のコンテキスト
- ${head}
- ${sel}
- 出力解像度: ${edl.output.width}x${edl.output.height} @ ${edl.output.fps}fps
- 現在のクリップ数: ${edl.clips.length} / オーバーレイ数: ${edl.overlays.length}

# ユーザーの指示
${instruction}

上記に従って \`${projectDir}/_codex/edl.next.json\` を書き出してください。`;
}
