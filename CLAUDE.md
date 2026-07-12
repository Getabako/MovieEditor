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

## ターミナルで直接指示されたときの動作（重要・追加運用）

このフォルダで Claude Code を開き、ユーザーが元動画と口頭/自然言語の編集指示を渡した場合は、Web UI を待たず、**このツール（既存動画の非破壊編集→MP4 書き出し）として一気に仕上げる**。普段は UI を起動して使う（README 参照）が、ターミナルで直接渡されたときはこの手順で動く。

1. **仕様を把握する**: `lib/prompt.ts`（`buildEditPrompt`）と上記アーキテクチャ（EDL が真実、座標系の区別）を踏まえる。
2. **案件フォルダ**: `generated/<案件名>/` に元動画を置き、`edl.json`・`exports/` などをこのフォルダ内に作る（既定の `~/.movieeditor-data/projects/<id>/` ではなく、ターミナル運用ではこのフォルダに集約して見つけやすくする）。
3. **編集する**: 指示を `buildEditPrompt` の規約で Codex に渡し、EDL を更新 → 検証 → Remotion で `exports/` に MP4 書き出し。動画内に画像生成が要る場面でも**有料画像 API は使わない**（Codex 内蔵 image_gen のみ）。
4. **アップロード**: 自動公開機能は無し（ローカル書き出しのみ）。
5. **報告**: 書き出した MP4 のパスを数行で報告する。
