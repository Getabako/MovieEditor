# MovieEditor

既存の動画を読み込み、**口頭/自然言語の指示**で非破壊編集するローカルツール。
編集の頭脳は **Codex App Server**（既存サブスクの範囲で動作）、プレビューと書き出しは **Remotion**。

```
動画読込 → EDL(編集状態) → Player でリアルタイムプレビュー
                ↑↓                    ↑
   口頭指示(Codex) / プリセット / 手動    タイムラインで進む/戻る
                ↓
        履歴に積む(undo/redo/復元) = 常時autosave
                ↓
          Remotion で MP4 書き出し
```

## できること

- **動画の読み込み**: フォルダ内の動画をワンクリック選択、または絶対パス指定
- **口頭/自然言語で編集**: 「最初の30秒カット」「"ありがとうございました"と言ってる所で終わり」「300フレーム目にタイトル」「今映ってるシーンに字幕」など。音声入力(🎤)対応
- **タイムライン**: 再生位置を進める/戻す、区間選択して「ここ」を指示の対象に
- **ワンクリック処理(プリセット)**: チェックするだけで一括適用
  - 長い無音/間を自動カット
  - 「えー」「あー」等のフィラー語カット
  - 喋りに自動字幕
  - 間を詰める(ジャンプカット圧縮)
  - 冒頭・末尾の無音トリム
  - 音量ノーマライズ
- **履歴**: 何度でも編集でき、いくつでも前の状態に戻せる。作業途中も自動保存
- **書き出し**: Remotion で MP4 出力

## 仕組み（非破壊編集）

元動画は一切書き換えない。編集状態は **EDL(Edit Decision List)** という JSON で表現する。

- `clips[]`: 元動画から切り出す区間（カット/トリム/早送り/音量）
- `overlays[]`: テキスト・画像オーバーレイ（字幕など）
- これを Remotion の `<OffthreadVideo>` が解釈して Player / Renderer で描画する

「○○と言っているところ」「○○なシーン」は、whisper.cpp の文字起こし(単語タイムスタンプ付き)を
Codex が検索して特定する。映像で確認が必要な場合は Codex が ffmpeg でフレームを書き出して判断する。

## セットアップ

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

### 文字起こし（whisper.cpp）を使う場合

「○○と言っているところ」系の指示・自動字幕・フィラーカットには文字起こしが必要。

```bash
brew install whisper-cpp
mkdir -p ~/whisper.cpp/models && cd ~/whisper.cpp/models
curl -L -o ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

バイナリ/モデルの場所は環境変数で上書き可能:
`WHISPER_CLI=/path/to/whisper-cli WHISPER_MODEL=/path/to/model.bin`

### 必要なもの

- Node.js 20+ / pnpm
- ffmpeg, ffprobe (`brew install ffmpeg`)
- codex CLI（`codex app-server` が使えること）
- whisper.cpp（文字起こし機能を使う場合のみ）

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `MOVIEEDITOR_DATA_ROOT` | `~/.movieeditor-data` | プロジェクト/履歴/書き出しの保存先 |
| `MOVIEEDITOR_MODEL` | `gpt-5.5` | Codex のモデル |
| `MOVIEEDITOR_EFFORT` | `medium` | Codex の effort |
| `WHISPER_CLI` / `WHISPER_MODEL` | 自動検出 | whisper.cpp のパス |

## データの場所

`~/.movieeditor-data/projects/<id>/`
- `project.json` メタ / `edl.json` 現在の編集状態
- `history/` 履歴スナップショット（undo/redo/復元の実体）
- `transcript.json` 文字起こし / `exports/` 書き出した MP4
