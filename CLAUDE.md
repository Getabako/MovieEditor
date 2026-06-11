# MovieEditor — 開発メモ（Claude向け）

口頭/自然言語の指示で既存動画を非破壊編集するローカルツール。Codex App Server + Remotion。
ShortMovie と同じ流儀（codex app-server を JSON-RPC で駆動）だが、こちらは「生成」ではなく
「既存動画の編集」が目的。

## アーキテクチャの要点

- **EDL が単一の真実**: `lib/types.ts` の `EDL`。元動画は不変、clips/overlays を編集する。
- **Remotion**: `remotion/Editor.tsx` が EDL を描画。Player(プレビュー)と Renderer(書き出し)で共用。
  - 元動画は `/api/source/[id]`（Range対応）で配信し、`<OffthreadVideo>` が読む。Player/Renderer 共通URL。
- **Codex 編集**: `app/api/edit` が `lib/prompt.ts` のプロンプトを投げ、Codex が `_codex/edl.next.json` を書く。
  検証(`validateEDL`)→ `commitEDL` で履歴に積む。
- **履歴/autosave**: `lib/project-store.ts`。編集ごとにスナップショット。undo/redo/任意復元。
- **プリセット**: `lib/presets.ts`。カット系は「元動画時刻の区間」を出して最後に `applyCuts`、
  字幕はカット後の出力時刻に `sourceToOutput` でマッピング。
- **文字起こし**: `lib/transcribe.ts`（whisper.cpp）。`lib/ffmpeg.ts` で音声抽出/無音検出/フレーム抽出。

## 重要な座標系の区別（混同注意）

- `clips[].srcStartSec/srcEndSec` = **元動画の秒**
- `overlays[].startSec/endSec` = **出力タイムラインの秒**
- 変換は `lib/edl.ts` の `outputToSource` / `sourceToOutput`

## バージョン固定

- Remotion 4.x / Next 16.2.6 / React 19.2.4 / Tailwind 4（ShortMovie と揃える）
- `next.config.ts` の `serverExternalPackages` に Remotion 一式（バンドルしない）

## 動作確認済み（iteration 1）

- 動画読込→EDL生成→Player配信、Codex編集（「最初の60秒カット」で clip が 60s 開始に）、undo/redo、履歴復元

## 未確認 / TODO

- ブラウザでの Player 実描画は手動確認が必要（自動テスト未）
- whisper.cpp 未インストール環境では文字起こし系プリセットはスキップされる
- export の Remotion フルレンダリング（2時間素材は重い）は実測未
- 手動タイムライン編集（トリムのドラッグ等）は選択UIまで。直接編集の `/api/edl` は用意済み
- 「○○なシーン」の映像判断（Codex がフレーム書き出し→確認）は実運用での精度確認が必要
