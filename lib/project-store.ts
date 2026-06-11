import fs from "node:fs";
import path from "node:path";
import { paths, ensureDir, newId, readJson, writeJson } from "./paths";
import type { EDL, ProjectMeta, HistoryEntry, SourceInfo } from "./types";
import { initialEDL, totalDuration, validateEDL, normalizeEDL } from "./edl";

// ============================================================================
// プロジェクトの永続化・履歴管理。
// 編集が起きるたびに EDL をスナップショット化して history/ に保存することで、
// undo/redo と「いくつか前の状態に戻す」を実現する。EDL 書き込み = autosave。
// ============================================================================

export function listProjects(): ProjectMeta[] {
  ensureDir(paths.projects);
  const ids = fs
    .readdirSync(paths.projects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const metas = ids
    .map((id) => readJson<ProjectMeta>(paths.metaFile(id)))
    .filter((m): m is ProjectMeta => !!m);
  return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getMeta(id: string): ProjectMeta | null {
  return readJson<ProjectMeta>(paths.metaFile(id));
}

export function getEDL(id: string): EDL | null {
  return readJson<EDL>(paths.edlFile(id));
}

/** 新規プロジェクト作成（元動画パス + メタから初期 EDL を作る） */
export function createProject(source: SourceInfo, title: string): ProjectMeta {
  const id = newId();
  ensureDir(paths.projectDir(id));
  ensureDir(paths.historyDir(id));
  ensureDir(paths.codexDir(id));
  ensureDir(paths.exportsDir(id));

  const edl = initialEDL(source);
  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    source,
    output: edl.output,
    historyIndex: 0,
    historyMax: 0,
    transcript: "none",
  };

  writeJson(paths.edlFile(id), edl);
  writeJson(paths.historyFile(id, 0), edl);
  writeJson(paths.metaFile(id), meta);
  writeHistoryEntry(id, {
    index: 0,
    label: "読み込み（元動画まるごと）",
    at: now,
    clipCount: edl.clips.length,
    durationSec: totalDuration(edl),
  });
  return meta;
}

/** 履歴の説明インデックス（history/_log.json） */
function historyLogFile(id: string) {
  return path.join(paths.historyDir(id), "_log.json");
}
export function getHistoryLog(id: string): HistoryEntry[] {
  return readJson<HistoryEntry[]>(historyLogFile(id)) ?? [];
}
function writeHistoryEntry(id: string, entry: HistoryEntry) {
  const log = getHistoryLog(id);
  // 同じ index があれば置き換え（redo 分岐を切る時に使う）
  const filtered = log.filter((e) => e.index <= entry.index - 1);
  filtered.push(entry);
  writeJson(historyLogFile(id), filtered);
}

/**
 * 新しい編集状態をコミットする。
 * 現在位置(historyIndex)より先にある redo 分は破棄して、新しい枝を作る。
 * これが autosave の本体でもある。
 */
export function commitEDL(id: string, edl: EDL, label: string): ProjectMeta {
  const meta = getMeta(id);
  if (!meta) throw new Error("project not found");
  // 繰り返し再生・ぶつ切り(かけら)を正規化（字幕も追従）してからコミットする
  const validated = normalizeEDL(validateEDL(edl));

  const nextIndex = meta.historyIndex + 1;
  // 先にある履歴ファイル(redo分)を削除
  for (let i = nextIndex; i <= meta.historyMax; i++) {
    const f = paths.historyFile(id, i);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const now = new Date().toISOString();
  writeJson(paths.historyFile(id, nextIndex), validated);
  writeJson(paths.edlFile(id), validated);
  writeHistoryEntry(id, {
    index: nextIndex,
    label,
    at: now,
    clipCount: validated.clips.length,
    durationSec: totalDuration(validated),
  });

  const updated: ProjectMeta = {
    ...meta,
    updatedAt: now,
    output: validated.output,
    historyIndex: nextIndex,
    historyMax: nextIndex,
  };
  writeJson(paths.metaFile(id), updated);
  return updated;
}

/** 指定した履歴 index の状態へジャンプ（undo/redo/任意復元）。EDL は保持したまま位置だけ移す。 */
export function gotoHistory(id: string, index: number): { meta: ProjectMeta; edl: EDL } {
  const meta = getMeta(id);
  if (!meta) throw new Error("project not found");
  const clamped = Math.max(0, Math.min(index, meta.historyMax));
  const edl = readJson<EDL>(paths.historyFile(id, clamped));
  if (!edl) throw new Error(`履歴 v${clamped} が見つかりません`);
  writeJson(paths.edlFile(id), edl);
  const updated: ProjectMeta = {
    ...meta,
    historyIndex: clamped,
    output: edl.output,
    updatedAt: new Date().toISOString(),
  };
  writeJson(paths.metaFile(id), updated);
  return { meta: updated, edl };
}

export function undo(id: string) {
  const meta = getMeta(id);
  if (!meta) throw new Error("project not found");
  return gotoHistory(id, meta.historyIndex - 1);
}
export function redo(id: string) {
  const meta = getMeta(id);
  if (!meta) throw new Error("project not found");
  return gotoHistory(id, meta.historyIndex + 1);
}

/** プロジェクトを丸ごと削除（履歴・字幕・書き出しを含む作業データ。元動画は触らない）。 */
export function deleteProject(id: string): boolean {
  const dir = paths.projectDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function setTranscriptStatus(id: string, status: ProjectMeta["transcript"]) {
  const meta = getMeta(id);
  if (!meta) return;
  writeJson(paths.metaFile(id), { ...meta, transcript: status });
}
