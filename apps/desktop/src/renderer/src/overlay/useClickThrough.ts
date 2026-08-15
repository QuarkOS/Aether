import { useEffect } from "react";

/**
 * Makes the transparent overlay click-through except when the cursor is over an
 * element marked `data-interactive`. Uses forwarded mouse-move events + hit
 * testing so empty space lets clicks pass to the app underneath.
 */
export function useClickThrough(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      void window.aether.setInteractiveRegion({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    let interactive = false;
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const overInteractive = Boolean(el?.closest("[data-interactive]"));
      if (overInteractive !== interactive) {
        interactive = overInteractive;
        void window.aether.setInteractiveRegion(
          overInteractive ? { x: e.clientX, y: e.clientY, width: 1, height: 1 } : null,
        );
      }
    };
    document.addEventListener("mousemove", onMove);
    // Start in pass-through mode.
    void window.aether.setInteractiveRegion(null);
    return () => {
      document.removeEventListener("mousemove", onMove);
      void window.aether.setInteractiveRegion(null);
    };
  }, [enabled]);
}
