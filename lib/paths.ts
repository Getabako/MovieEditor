import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** データ保存ルート。元動画とは別に、プロジェクト/履歴/字幕/書き出しを保持する。 */
const ROOT =
  process.env.MOVIEEDITOR_DATA_ROOT ??
  path.join(os.homedir(), ".movieeditor-data");

export const paths = {
  root: ROOT,
  projects: path.join(ROOT, "projects"),
  projectDir(id: string) {
    return path.join(ROOT, "projects", id);
  },
  /** プロジェクトメタ */
  metaFile(id: string) {
    return path.join(this.projectDir(id), "project.json");
  },
  /** 現在の EDL */
  edlFile(id: string) {
    return path.join(this.projectDir(id), "edl.json");
  },
  /** 履歴ディレクトリ（v0001.json ...） */
  historyDir(id: string) {
    return path.join(this.projectDir(id), "history");
  },
  historyFile(id: string, index: number) {
    return path.join(this.historyDir(id), `v${String(index).padStart(4, "0")}.json`);
  },
  /** 字幕（whisper 正規化済み） */
  transcriptFile(id: string) {
    return path.join(this.projectDir(id), "transcript.json");
  },
  /** プレビュー用の軽量プロキシ動画（低解像度・キーフレーム多め） */
  proxyFile(id: string) {
    return path.join(this.projectDir(id), "proxy.mp4");
  },
  /** Codex の作業ディレクトリ（編集案の受け渡し場所） */
  codexDir(id: string) {
    return path.join(this.projectDir(id), "_codex");
  },
  /** フレーム抽出キャッシュ（サムネ/シーン確認用） */
  framesDir(id: string) {
    return path.join(this.projectDir(id), "frames");
  },
  /** 書き出し MP4 */
  exportsDir(id: string) {
    return path.join(this.projectDir(id), "exports");
  },
  /** 一時ファイル（音声抽出など） */
  tmpDir(id: string) {
    return path.join(this.projectDir(id), "tmp");
  },
  /** スタジオ（台本/サムネ）の成果物置き場。プロジェクト(動画)とは独立。 */
  studioDir: path.join(ROOT, "studio"),
  scriptsDir: path.join(ROOT, "studio", "scripts"),
  thumbnailsDir: path.join(ROOT, "studio", "thumbnails"),
};

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

/** タイムスタンプ + ランダムの読みやすい ID */
export function newId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rnd}`;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(file: string, data: unknown) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
