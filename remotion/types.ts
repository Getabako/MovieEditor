import type { EDL } from "@/lib/types";

/** Editor コンポジションの入力 props */
export type EditorProps = {
  edl: EDL;
  /** 元動画の配信URL（Player/Renderer 共通） */
  srcUrl: string;
  /**
   * 描画モード。
   * - "preview"(Player): リアルタイム再生に強い <Video>(HTML5) を使う。
   *   多数クリップでも境界シークが速く、シーンの一瞬の再表示(見かけの繰り返し)が起きにくい。
   * - "render"(書き出し): フレーム単位で正確な <OffthreadVideo> を使う。
   * 未指定は "render"。
   */
  mode?: "preview" | "render";
  /**
   * プレビューでも実際の速度(speed)で再生してよいか。
   * 軽量プロキシ動画を使う場合のみ true（巨大な元動画では黒画面になるため通常 false）。
   */
  realtimeSpeed?: boolean;
};

export type { EDL };
