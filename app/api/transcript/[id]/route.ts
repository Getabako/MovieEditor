import { paths, readJson } from "@/lib/paths";
import type { Transcript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 文字起こし(transcript.json)を返す。無ければ exists:false。 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = readJson<Transcript>(paths.transcriptFile(id));
  if (!t) return Response.json({ exists: false, transcript: null });
  return Response.json({ exists: true, transcript: t });
}
