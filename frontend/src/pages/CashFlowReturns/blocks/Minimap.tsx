// Canvas overview minimap. Draws the full model as a scaled-down
// silhouette of its block rectangles with an outlined viewport showing
// the current scroll position. Clicking anywhere jumps the scroll
// container to that spot.
//
// Design: gold-tinted rects per category group (left column / center /
// right / sensitivity), neutral stroke outline for each block, and a
// gold viewport rectangle that tracks the scroll container live.

import { useEffect, useRef, useState } from "react";


export type MiniBlock = {
  id: string;
  label: string;
  /** Position + size in canvas coordinates (matches the live canvas px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Color group — "left" | "center" | "right" | "sensitivity" */
  tone?: "left" | "center" | "right" | "sensitivity";
};


const TONE_FILL: Record<NonNullable<MiniBlock["tone"]>, string> = {
  left: "#e8e2cf",
  center: "#f0ebd9",
  right: "#ead6c8",
  sensitivity: "#e3cfb3",
};


export default function Minimap({
  blocks, canvasWidth, canvasHeight, scrollRef, zoom = 1,
}: {
  blocks: MiniBlock[];
  canvasWidth: number;
  canvasHeight: number;
  /** Ref to the scroll container that wraps the canvas. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Current CSS zoom applied to the canvas content — needed so the
   *  viewport rect stays accurate when the user zooms in or out. */
  zoom?: number;
}) {
  // The minimap itself is capped to a small footprint; scale everything
  // inside it to fit.
  const MINI_W = 200;
  const MINI_H = Math.round(MINI_W * (canvasHeight / canvasWidth));
  const scale = MINI_W / canvasWidth;

  const [viewport, setViewport] = useState({ x: 0, y: 0, w: MINI_W, h: MINI_H });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function update() {
      const sc = scrollRef.current;
      if (!sc) return;
      // scroll container dimensions are in CSS pixels; CSS `zoom` means
      // the CANVAS content is z× larger in CSS px. Divide by zoom to
      // recover canvas-space coordinates before applying the minimap's
      // downscale factor.
      const vx = (sc.scrollLeft / zoom) * scale;
      const vy = (sc.scrollTop / zoom) * scale;
      const vw = Math.min(MINI_W - vx, (sc.clientWidth / zoom) * scale);
      const vh = Math.min(MINI_H - vy, (sc.clientHeight / zoom) * scale);
      setViewport({ x: vx, y: vy, w: vw, h: vh });
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollRef, scale, zoom]);

  function onClick(e: React.MouseEvent<SVGSVGElement>) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Canvas-space target, then scale into CSS-px space via zoom.
    const targetLeft = ((clickX / MINI_W) * canvasWidth - (el.clientWidth / zoom) / 2) * zoom;
    const targetTop = ((clickY / MINI_H) * canvasHeight - (el.clientHeight / zoom) / 2) * zoom;
    el.scrollTo({ left: Math.max(0, targetLeft), top: Math.max(0, targetTop), behavior: "smooth" });
  }

  return (
    <div
      className="fixed right-4 bottom-4 bg-white/95 backdrop-blur-sm shadow-xl border border-[#d9d4c8] rounded-md p-2"
      style={{ zIndex: 30 }}
    >
      <div className="text-[9px] uppercase tracking-[0.2em] text-[#6b6f78] font-semibold mb-1.5 px-0.5">
        Canvas overview
      </div>
      <svg
        width={MINI_W}
        height={MINI_H}
        onClick={onClick}
        style={{ cursor: "pointer", display: "block" }}
      >
        <rect x={0} y={0} width={MINI_W} height={MINI_H} fill="#faf7f1" />
        {blocks.map((b) => (
          <g key={b.id}>
            <rect
              x={b.x * scale}
              y={b.y * scale}
              width={b.w * scale}
              height={b.h * scale}
              fill={TONE_FILL[b.tone ?? "center"]}
              stroke="#b89555"
              strokeOpacity={0.25}
              strokeWidth={0.5}
            />
          </g>
        ))}
        {/* Viewport rectangle */}
        <rect
          x={viewport.x}
          y={viewport.y}
          width={Math.max(4, viewport.w)}
          height={Math.max(4, viewport.h)}
          fill="rgba(184, 149, 85, 0.12)"
          stroke="#b89555"
          strokeWidth={1.5}
          style={{ pointerEvents: "none" }}
        />
      </svg>
    </div>
  );
}
