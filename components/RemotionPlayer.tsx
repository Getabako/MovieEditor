"use client";

import React from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Editor } from "@/remotion/Editor";
import type { EditorProps } from "@/remotion/types";

/**
 * @remotion/player のラッパー。
 * next/dynamic(ssr:false) は ref を転送しないため、ref を通常の prop(playerRef) として受け取る。
 */
export default function RemotionPlayer({
  playerRef,
  edl,
  srcUrl,
  durationInFrames,
  realtimeSpeed = false,
}: {
  playerRef: React.Ref<PlayerRef>;
  edl: EditorProps["edl"];
  srcUrl: string;
  durationInFrames: number;
  realtimeSpeed?: boolean;
}) {
  return (
    <Player
      ref={playerRef}
      component={Editor as React.FC<Record<string, unknown>>}
      inputProps={
        { edl, srcUrl, mode: "preview", realtimeSpeed } as unknown as Record<string, unknown>
      }
      durationInFrames={durationInFrames}
      fps={edl.output.fps}
      compositionWidth={edl.output.width}
      compositionHeight={edl.output.height}
      style={{ width: "100%", height: "100%" }}
      controls
      acknowledgeRemotionLicense
    />
  );
}
