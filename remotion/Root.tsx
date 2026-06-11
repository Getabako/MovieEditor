import React from "react";
import { Composition } from "remotion";
import { Editor } from "./Editor";
import type { EditorProps } from "./types";
import { totalFrames } from "@/lib/edl";
import type { EDL } from "@/lib/types";

// Renderer 用のプレースホルダ（実際の値は inputProps で渡る）
const PLACEHOLDER_EDL: EDL = {
  schema: 1,
  source: { path: "", fps: 30, width: 1280, height: 720, durationSec: 1 },
  output: { width: 1280, height: 720, fps: 30 },
  clips: [{ id: "clip-0", srcStartSec: 0, srcEndSec: 1 }],
  overlays: [],
  audio: {},
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Editor"
      component={Editor as React.FC<Record<string, unknown>>}
      durationInFrames={30}
      fps={30}
      width={1280}
      height={720}
      defaultProps={{ edl: PLACEHOLDER_EDL, srcUrl: "" } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as EditorProps;
        return {
          durationInFrames: totalFrames(p.edl),
          fps: p.edl.output.fps,
          width: p.edl.output.width,
          height: p.edl.output.height,
        };
      }}
    />
  );
};
