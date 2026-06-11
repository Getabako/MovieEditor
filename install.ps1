# Movie Editor — Windows one-line installer & launcher
#
# 友達向けの 1 行 (PowerShell):
#   iwr -useb https://raw.githubusercontent.com/Getabako/MovieEditor/main/install.ps1 | iex
#
# 何度貼っても OK。初回は全部インストール、2 回目以降は最新版に更新して起動。

$ErrorActionPreference = "Stop"

# --- 設定 ---
$GH_REPO   = if ($env:MOVIEEDITOR_REPO)   { $env:MOVIEEDITOR_REPO }   else { "Getabako/MovieEditor" }
$BRANCH    = if ($env:MOVIEEDITOR_BRANCH) { $env:MOVIEEDITOR_BRANCH } else { "main" }
# インストール先：デスクトップにわかりやすく置く（隠しフォルダにしない）。
# OneDrive でデスクトップがリダイレクトされている場合も考慮して GetFolderPath を使う。
$DesktopDir = [Environment]::GetFolderPath('Desktop')
$InstallDir = if ($env:MOVIEEDITOR_HOME)  { $env:MOVIEEDITOR_HOME }  else { Join-Path $DesktopDir "MovieEditor" }

function Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function OK($msg)   { Write-Host $msg -ForegroundColor Green }
function Err($msg)  { Write-Host $msg -ForegroundColor Red }

Info "▶ Movie Editor セットアップを開始します（Windows）"

# 1. winget 必須
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Err "✗ winget が見つかりません。Windows 10/11 (build 1809+) で Microsoft Store から 'App Installer' を入れてください。"
    exit 1
}

function Ensure-Pkg($cmd, $wingetId, $label) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Info "▶ $label をインストールします"
        winget install --id $wingetId -e --silent --accept-source-agreements --accept-package-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
}

# 2. Node.js
Ensure-Pkg "node"  "OpenJS.NodeJS.LTS"  "Node.js (LTS)"

# 3. git
Ensure-Pkg "git"   "Git.Git"            "Git"

# 4. gh (GitHub CLI)
Ensure-Pkg "gh"    "GitHub.cli"         "GitHub CLI"

# 5. Codex CLI
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Info "▶ Codex CLI をインストールします"
    npm install -g @openai/codex
}

# 5b. ffmpeg（音声抽出・無音解析・プレビュー軽量化に必須）
Ensure-Pkg "ffmpeg" "Gyan.FFmpeg" "ffmpeg"

# 5c. whisper（字幕の文字起こし）
# Windows では whisper.cpp のセットアップが煩雑なため任意とする。
# 未導入でもアプリは起動でき、字幕(自動文字起こし)のみスキップされる。
if (-not (Get-Command whisper-cli -ErrorAction SilentlyContinue)) {
    Info "▶ （任意）字幕の自動文字起こしを使う場合は whisper.cpp を別途導入してください。"
    Info "    未導入でも、編集・カット・タイトル・速度・書き出しは使えます。"
}

# 6. pnpm（任意。無くても npm で動く）
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Info "▶ pnpm を有効化します"
    corepack enable
}

# 7. リポジトリを取得 or 更新
if (Test-Path "$InstallDir\.git") {
    $dirty = git -C $InstallDir status --porcelain
    if ($dirty) {
        Info "▶ あなたの修正を保持したまま起動します（自動更新はスキップ）"
        Info "  最新版に戻したい時は: cd `"$InstallDir`"; git reset --hard origin/$BRANCH"
    } else {
        Info "▶ 既存のアプリを最新版に更新します"
        git -C $InstallDir fetch --quiet origin $BRANCH
        git -C $InstallDir reset --quiet --hard "origin/$BRANCH"
    }
} else {
    Info "▶ アプリをダウンロードします → $InstallDir"
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --quiet --depth 1 --branch $BRANCH "https://github.com/$GH_REPO.git" $InstallDir
}

Set-Location $InstallDir

# 8. コミットが変わった or 成果物が無いなら再ビルド
$CurSha = (git -C $InstallDir rev-parse HEAD).Trim()
$MarkFile = "$InstallDir\.next\.built-sha"
$LastSha = if (Test-Path $MarkFile) { (Get-Content $MarkFile -ErrorAction SilentlyContinue).Trim() } else { "" }

$NeedBuild = $false
if (-not (Test-Path "$InstallDir\node_modules")) { $NeedBuild = $true }
if (-not (Test-Path "$InstallDir\.next\BUILD_ID")) { $NeedBuild = $true }
if ($CurSha -ne $LastSha) { $NeedBuild = $true }
if (Test-Path $MarkFile) {
    $buildTime = (Get-Item $MarkFile).LastWriteTime
    $srcDirs = @("app","lib","components","remotion","public","next.config.ts","package.json") | Where-Object { Test-Path (Join-Path $InstallDir $_) }
    $newer = Get-ChildItem -Path $srcDirs -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $buildTime } | Select-Object -First 1
    if ($newer) { $NeedBuild = $true }
}

$PKG = if (Get-Command pnpm -ErrorAction SilentlyContinue) { "pnpm" } else { "npm" }

if ($NeedBuild) {
    Info "▶ アプリを準備中（初回 or 更新時のみ・1〜2分）"
    if ($PKG -eq "pnpm") {
        pnpm install --silent
        pnpm build | Out-Null
    } else {
        npm install --silent
        npm run build | Out-Null
    }
    New-Item -ItemType Directory -Force -Path "$InstallDir\.next" | Out-Null
    Set-Content -Path $MarkFile -Value $CurSha
}

# 9. ChatGPT ログイン状態
try { codex login status *>$null } catch {
    Info ""
    Info "▶ 初回ログイン: ChatGPT アカウントと接続します"
    Info "  ブラウザが開きます。サインインしてください。"
    Info ""
    codex login
}

# 10. 起動（ブラウザを自動で開いてから本番サーバを起動）
OK ""
OK "✓ 起動します。ブラウザが自動で開きます。終了は Ctrl+C。"
OK ""
Start-Job { Start-Sleep -Seconds 4; Start-Process "http://localhost:3000" } | Out-Null
if ($PKG -eq "pnpm") { pnpm run start } else { npm run start }
