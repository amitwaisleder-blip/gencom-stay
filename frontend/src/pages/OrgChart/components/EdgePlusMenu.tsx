// Small popover shown when the user clicks the green "+" button on
// any edge of a box. Three choices:
//   1. New box        — spawns a new connected child in that direction
//   2. Connect to existing — enters target-pick mode; the next box
//                            click finishes the connection.
//   3. Resize         — enters resize mode; user drags any edge or
//                       corner of the source box to adjust its size.
// Anchored to the click position so it appears near the source button.

import { useEffect, useRef } from "react";
import { Box as BoxIcon, Link2, Move } from "lucide-react";

export function EdgePlusMenu({
  anchor,
  onPickNewBox,
  onPickConnectExisting,
  onPickResize,
  onClose,
}: {
  anchor: { x: number; y: number };
  onPickNewBox: () => void;
  onPickConnectExisting: () => void;
  onPickResize: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape. Pointer is captured at document
  // level so it's not blocked by the canvas's own pointer-capture.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to the viewport so the popover doesn't overflow off-screen
  // when the click was near a window edge.
  const w = 200;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, anchor.x + 8));
  const top = Math.min(window.innerHeight - 150, Math.max(8, anchor.y + 8));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Edge plus options"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5"
      style={{ left, top, width: w }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onPickNewBox}
        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition flex items-start gap-3"
      >
        <BoxIcon className="h-4 w-4 mt-0.5 text-emerald-700 shrink-0" />
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-gencom-ink">New box</span>
          <span className="block text-[11px] text-gencom-stone leading-snug">Add and link a fresh box in this direction.</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPickConnectExisting}
        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition flex items-start gap-3"
      >
        <Link2 className="h-4 w-4 mt-0.5 text-emerald-700 shrink-0" />
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-gencom-ink">Connect to existing</span>
          <span className="block text-[11px] text-gencom-stone leading-snug">Click any other box to draw a line.</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPickResize}
        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition flex items-start gap-3"
      >
        <Move className="h-4 w-4 mt-0.5 text-emerald-700 shrink-0" />
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-gencom-ink">Resize</span>
          <span className="block text-[11px] text-gencom-stone leading-snug">Drag any edge or corner to adjust dimensions.</span>
        </span>
      </button>
    </div>
  );
}
