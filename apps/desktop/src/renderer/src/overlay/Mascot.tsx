import { useEffect, useRef } from "react";
import type { AssistantState, Emotion } from "@aether/shared";

import { ImageAvatar } from "./ImageAvatar";
import { useLive2D } from "./useLive2D";

interface Props {
  emotion: Emotion;
  mouthOpen: number;
  gaze: { x: number; y: number };
  state: AssistantState;
  modelUrl: string | null;
  scale: number;
}

export function Mascot({ emotion, mouthOpen, gaze, state, modelUrl, scale }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { controller, failed } = useLive2D(canvasRef.current, modelUrl, scale);

  useEffect(() => {
    controller?.setMouth(mouthOpen);
  }, [controller, mouthOpen]);

  useEffect(() => {
    controller?.setExpression(emotion);
  }, [controller, emotion]);

  useEffect(() => {
    controller?.focus(gaze.x, gaze.y);
  }, [controller, gaze]);

  const useLive2DView = Boolean(controller) && !failed;

  return (
    <div className="mascot">
      <canvas
        ref={canvasRef}
        className="mascot__canvas"
        style={{ display: useLive2DView ? "block" : "none" }}
      />
      {!useLive2DView && (
        <ImageAvatar emotion={emotion} mouthOpen={mouthOpen} gaze={gaze} state={state} />
      )}
    </div>
  );
}
