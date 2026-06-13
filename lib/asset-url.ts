import type { EDL, Overlay } from "./types";

// ============================================================================
// 素材(画像/音声)のURL解決。
// ユーザーが追加した素材は EDL に `asset://<絶対パス>` で保持し、
//  - プレビュー(ブラウザ): 相対 `/api/file?path=...`（Nextアプリ origin に解決）
//  - 書き出し(Remotion renderer): 絶対 `${origin}/api/file?path=...`
// に変換して使う。weedman/... (staticFile) や http(s) はそのまま。
// ============================================================================

export const ASSET_PREFIX = "asset://";

/** 絶対パスを asset:// 形式に */
export function toAsset(absPath: string): string {
  return ASSET_PREFIX + absPath;
}

/** asset:// を配信URLへ。origin="" なら相対（プレビュー用）、絶対originなら書き出し用 */
export function assetToUrl(src: string | undefined, origin = ""): string | undefined {
  if (!src) return src;
  if (src.startsWith(ASSET_PREFIX)) {
    const p = src.slice(ASSET_PREFIX.length);
    return `${origin}/api/file?path=${encodeURIComponent(p)}`;
  }
  return src;
}

function mapOverlay(o: Overlay, origin: string): Overlay {
  if (o.type === "image") {
    return { ...o, src: assetToUrl(o.src, origin) ?? o.src };
  }
  return o;
}

/** EDL内の全 asset:// を配信URLに変換した新EDLを返す（プレビュー/書き出し共通の前処理） */
export function prepareEdl(edl: EDL, origin = ""): EDL {
  return {
    ...edl,
    overlays: edl.overlays.map((o) => mapOverlay(o, origin)),
    audio: edl.audio
      ? {
          ...edl.audio,
          bgmPath: assetToUrl(edl.audio.bgmPath, origin),
          se: edl.audio.se?.map((s) => ({ ...s, src: assetToUrl(s.src, origin) ?? s.src })),
        }
      : edl.audio,
  };
}
