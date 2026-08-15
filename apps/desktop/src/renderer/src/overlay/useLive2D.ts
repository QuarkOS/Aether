import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Live2DController {
  setMouth(value: number): void;
  setExpression(name: string): void;
  focus(x: number, y: number): void;
  destroy(): void;
}

/**
 * Attempts to load a Live2D model into a canvas. Returns a controller when the
 * Cubism core + PixiJS + model all load; otherwise returns null so the caller
 * can render the 2D fallback avatar. Everything is dynamically imported so a
 * missing runtime never breaks the app.
 */
export function useLive2D(
  canvas: HTMLCanvasElement | null,
  modelUrl: string | null,
  scale: number,
): { controller: Live2DController | null; failed: boolean } {
  const [controller, setController] = useState<Live2DController | null>(null);
  const [failed, setFailed] = useState(false);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    setController(null);
    setFailed(false);

    if (!canvas || !modelUrl) {
      setFailed(true);
      return;
    }
    // The Cubism core must be present on window before importing the display lib.
    if (!(window as any).Live2DCubismCore) {
      console.warn("[live2d] Cubism core not loaded; using fallback avatar.");
      setFailed(true);
      return;
    }

    let app: any = null;
    let model: any = null;

    (async () => {
      try {
        const PIXI = await import("pixi.js");
        const { Live2DModel } = (await import("pixi-live2d-display-lipsyncpatch")) as any;
        Live2DModel.registerTicker(PIXI.Ticker);

        app = new PIXI.Application({
          view: canvas,
          backgroundAlpha: 0,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          resizeTo: canvas.parentElement ?? undefined,
        });

        model = await Live2DModel.from(modelUrl, { autoInteract: false });
        if (disposed.current) {
          model.destroy();
          app.destroy();
          return;
        }

        app.stage.addChild(model);
        const anchor = 0.5;
        model.anchor.set(anchor, anchor);
        model.position.set(canvas.clientWidth / 2, canvas.clientHeight * 0.5);
        model.scale.set(scale);

        const ctrl: Live2DController = {
          setMouth: (value: number) => {
            try {
              model.internalModel.coreModel.setParameterValueById(
                "ParamMouthOpenY",
                Math.max(0, Math.min(1, value)),
              );
            } catch {
              /* param name varies by model */
            }
          },
          setExpression: (name: string) => {
            try {
              model.expression(name);
            } catch {
              /* model may not define this expression */
            }
          },
          focus: (x: number, y: number) => {
            try {
              model.focus(x, y);
            } catch {
              /* ignore */
            }
          },
          destroy: () => {
            try {
              model?.destroy();
              app?.destroy();
            } catch {
              /* ignore */
            }
          },
        };
        setController(ctrl);
      } catch (err) {
        console.error("[live2d] failed to load model, using fallback:", err);
        setFailed(true);
      }
    })();

    return () => {
      disposed.current = true;
      try {
        model?.destroy();
        app?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [canvas, modelUrl, scale]);

  return { controller, failed };
}
