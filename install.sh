#!/usr/bin/env bash
# Movie Editor — one-line installer & launcher
#
# 友達向けの 1 行コマンド (このスクリプトを GitHub に置いた後):
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Getabako/MovieEditor/main/install.sh)"
#
# 何度貼っても OK。初回は全部インストール、2 回目以降は既存のものを使って起動するだけ。

set -e

# --- 設定（公開時に書き換える） ----------------------------------------
GH_REPO="${MOVIEEDITOR_REPO:-Getabako/MovieEditor}"
BRANCH="${MOVIEEDITOR_BRANCH:-main}"
# インストール先：デスクトップにわかりやすく置く。中身を開いて AI（codex / Claude）に
# 直してもらえるよう、隠しフォルダではなくデスクトップの "MovieEditor" フォルダにする。
INSTALL_DIR="${MOVIEEDITOR_HOME:-$HOME/Desktop/MovieEditor}"
# -----------------------------------------------------------------------

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }

cyan "▶ Movie Editor セットアップを開始します"

# 1. OS チェック
if [[ "$(uname)" != "Darwin" ]]; then
  red "✗ install.sh は macOS 向けです。"
  red ""
  red "Windows の方は PowerShell を開いて以下の 1 行を実行してください:"
  red "  iwr -useb https://raw.githubusercontent.com/$GH_REPO/main/install.ps1 | iex"
  exit 1
fi

# 2. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  cyan "▶ Homebrew をインストールします（初回のみ・数分かかります）"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -d /opt/homebrew/bin ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -d /usr/local/bin ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

# 3. Node.js
if ! command -v node >/dev/null 2>&1; then
  cyan "▶ Node.js をインストールします"
  brew install node
fi

# 4. Codex CLI
if ! command -v codex >/dev/null 2>&1; then
  cyan "▶ Codex CLI をインストールします"
  brew install codex
fi

# 5. git（普通入ってるが念のため）
command -v git >/dev/null 2>&1 || brew install git

# 5b. ffmpeg（音声抽出・無音解析・プレビュー軽量化に必須）
command -v ffmpeg >/dev/null 2>&1 || { cyan "▶ ffmpeg をインストール"; brew install ffmpeg; }

# 5c. whisper.cpp（字幕の文字起こしに使う）＋ 日本語モデル
if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper-cpp >/dev/null 2>&1; then
  cyan "▶ whisper.cpp をインストール（字幕の文字起こし用）"
  brew install whisper-cpp
fi
WHISPER_MODEL_DIR="$HOME/whisper.cpp/models"
WHISPER_MODEL="$WHISPER_MODEL_DIR/ggml-large-v3-turbo.bin"
if [[ ! -f "$WHISPER_MODEL" ]]; then
  cyan "▶ 文字起こしモデルを取得します（初回のみ・約1.5GB・数分）"
  mkdir -p "$WHISPER_MODEL_DIR"
  curl -L --fail -o "$WHISPER_MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin" \
    || red "  ! モデル取得に失敗。字幕(自動文字起こし)は後で再取得すれば使えます。"
fi

# 6. リポジトリを取得 or 更新
if [[ -d "$INSTALL_DIR/.git" ]]; then
  # ローカルで修正している人（AI に直してもらった等）の変更を消さないように、
  # 未コミットの修正がある場合は自動更新（reset --hard）をスキップして保持する。
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null)" ]]; then
    cyan "▶ あなたの修正を保持したまま起動します（自動更新はスキップ）"
    cyan "  最新版に戻したい時は: cd \"$INSTALL_DIR\" && git reset --hard origin/$BRANCH"
  else
    cyan "▶ 既存のアプリを最新版に更新します"
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --quiet --hard "origin/$BRANCH"
  fi
else
  cyan "▶ アプリをダウンロードします → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  rm -rf "$INSTALL_DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" \
    "https://github.com/$GH_REPO.git" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# 7. 依存と本番ビルド（コミットが変わった or 成果物が無いなら再ビルド）
CUR_SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
MARK_FILE="$INSTALL_DIR/.next/.built-sha"
LAST_SHA=""
[[ -f "$MARK_FILE" ]] && LAST_SHA="$(cat "$MARK_FILE" 2>/dev/null || echo)"

NEED_BUILD=0
[[ ! -d node_modules ]] && NEED_BUILD=1
[[ ! -f .next/BUILD_ID ]] && NEED_BUILD=1
[[ "$CUR_SHA" != "$LAST_SHA" ]] && NEED_BUILD=1
# ローカルで直したソースがビルドより新しければ、その修正を反映するため再ビルド
if [[ -f "$MARK_FILE" ]] && [[ -n "$(find app lib components remotion public next.config.ts package.json -newer "$MARK_FILE" 2>/dev/null || true)" ]]; then
  NEED_BUILD=1
fi

if command -v pnpm >/dev/null 2>&1; then
  PKG=pnpm
else
  PKG=npm
fi

if [[ "$NEED_BUILD" -eq 1 ]]; then
  cyan "▶ アプリを準備中（初回 or 更新があった時のみ・1〜2分）"
  if [[ "$PKG" == "pnpm" ]]; then
    pnpm install --silent
    pnpm build >/dev/null
  else
    npm install --silent
    npm run build >/dev/null
  fi
  mkdir -p "$INSTALL_DIR/.next"
  echo "$CUR_SHA" > "$MARK_FILE"
fi

# 8. ChatGPT へのログイン状態を確認（必要なら本人にやってもらう）
if ! codex login status >/dev/null 2>&1; then
  cyan ""
  cyan "▶ 初回ログイン: ChatGPT アカウントと接続します"
  cyan "  ブラウザが開きます。ChatGPT (Plus/Pro/Business) でサインインしてください。"
  cyan ""
  codex login || {
    red "ログインがキャンセルされました。次回もう一度この 1 行を実行してください。"
    exit 1
  }
fi

# 9. 起動（ブラウザを自動で開いてから本番サーバを起動）
green ""
green "✓ 起動します。ブラウザが自動で開きます。終了は Ctrl+C。"
green "  動画を読み込むには、画面の枠にドラッグ＆ドロップ or「ファイルを選択」。"
green ""
( sleep 4; open "http://localhost:3000" >/dev/null 2>&1 || true ) &
exec $PKG run start
