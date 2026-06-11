import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { listProjects, createProject } from "@/lib/project-store";
import { probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** プロジェクト一覧 */
export async function GET() {
  return Response.json({ projects: listProjects() });
}

/** 元動画パスから新規プロジェクトを作成 */
export async function POST(req: NextRequest) {
  const { sourcePath, title } = (await req.json()) as {
    sourcePath?: string;
    title?: string;
  };
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return Response.json(
      { error: `動画ファイルが見つかりません: ${sourcePath ?? "(未指定)"}` },
      { status: 400 },
    );
  }
  try {
    const source = await probeVideo(sourcePath);
    if (!source.durationSec) {
      return Response.json({ error: "動画の長さを取得できませんでした" }, { status: 400 });
    }
    const meta = createProject(source, title || path.basename(sourcePath));
    return Response.json({ project: meta });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
