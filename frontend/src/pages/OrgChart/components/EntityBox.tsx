// One entity card on the canvas. Visual:
//   - small uppercase entity-type label
//   - bold name (line-clamp 2)
//   - ownership % bottom-right (when set)
//   - hover edge "+" buttons spawn child boxes (top/right/bottom/left)
//   - bottom-right green link dot — drag to another box to connect
//   - click → select; drag → reposition (handled by parent canvas)
//   - double-click name → inline edit, Enter/blur saves, Escape cancels

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";

import type { Box } from "../lib/types";

/** Convert points (1pt = 1/72in) to CSS pixels at 96 DPI. */
function ptToPx(pt: number): number {
  return pt * (96 / 72);
}

export type Edge = "top" | "right" | "bottom" | "left";

export function EntityBox({
  box,
  selected,
  warning,
  animating,
  isLinkTarget,
  multiSelected,
  isLinkPickTarget,
  edgeAction,
  onSelect,
  onPointerDownStartDrag,
  onEdgePlus,
  onStartLink,
  onRename,
  onContextMenu,
}: {
  box: Box;
  selected: boolean;
  warning: boolean;
  /** When true (briefly during Auto-arrange) interpolates left/top
   *  via a CSS transition. Off during normal drag so movement
   *  follows the cursor 1:1. */
  animating?: boolean;
  /** True while the user is dragging from another box's link handle
   *  and currently hovering THIS box. Highlights as a drop target. */
  isLinkTarget?: boolean;
  /** Visual treatment when the box is part of a multi-selection. */
  multiSelected?: boolean;
  /** Highlights the box as a "click me to connect" target while the
   *  user is in target-picking mode (after choosing "Connect to
   *  existing" from an edge `+` menu). */
  isLinkPickTarget?: boolean;
  /** When set, the box has been right-click-armed for an action ("new
   *  box" or "connect to existing"). The four edge "+" buttons render
   *  so the user can pick the direction, then the parent executes the
   *  action. Without this, edge affordances stay hidden. */
  edgeAction?: "newBox" | "connect";
  onSelect: (opts?: { shift?: boolean }) => void;
  onPointerDownStartDrag: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Click on an edge `+` button. The parent decides whether to spawn
   *  a new box, open a menu (new box vs connect-to-existing), etc.
   *  Receives the edge clicked + the screen-space coords of the click
   *  so the parent can position a popover. */
  onEdgePlus: (edge: Edge, anchor: { x: number; y: number }) => void;
  /** Pointerdown on the link handle. Canvas takes over to track the
   *  drag and figure out which box (if any) the cursor lands on. */
  onStartLink: (e: React.PointerEvent<HTMLElement>) => void;
  /** Save the new name when the user finishes inline editing. */
  onRename: (next: string) => void;
  /** Right-click on the box. Receives the screen-space click coords so
   *  the parent can anchor a context menu near the cursor. */
  onContextMenu?: (anchor: { x: number; y: number }) => void;
}) {
  const fmtPct = (n: number) => {
    const s = n.toFixed(2);
    return s.replace(/\.?0+$/, "") + "%";
  };

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(box.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync draft when the box changes upstream and we're not editing.
  useEffect(() => {
    if (!editing) setDraftName(box.name);
  }, [box.name, editing]);
  // Auto-focus the input when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commitRename() {
    setEditing(false);
    const next = draftName.trim();
    if (next && next !== box.name) onRename(next);
    else setDraftName(box.name);
  }
  function cancelRename() {
    setEditing(false);
    setDraftName(box.name);
  }

  // Real-units font size for the NAME row. Default 11pt — close to
  // the prior 15px CSS default (≈11.25pt) and a familiar "Word
  // default body" reference.
  const namePx = ptToPx(box.fontSizePt ?? 11);
  // Horizontal alignment applied to the entity-name row plus the
  // jurisdiction / notes rows. Entity-type stays left and the
  // ownership-% row keeps its right-aligned tabular nums.
  const textAlign: "left" | "center" | "right" = box.textAlign ?? "left";

  return (
    <div
      onPointerDown={(e) => {
        if (editing) return; // don't start a drag while inline-editing
        onPointerDownStartDrag(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!editing) onSelect({ shift: e.shiftKey });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setDraftName(box.name);
        setEditing(true);
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className={
        "absolute group select-none transition-shadow " +
        (isLinkTarget || isLinkPickTarget
          ? "ring-4 ring-gencom-green ring-offset-2 ring-offset-transparent shadow-lg"
          : selected
          ? "ring-2 ring-gencom-green ring-offset-2 ring-offset-transparent shadow-md"
          : multiSelected
          ? "ring-2 ring-gencom-green ring-offset-2 ring-offset-transparent shadow-md"
          : "hover:shadow-md")
      }
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        background: box.fillColor,
        border: `${box.borderWidth ?? 1.5}px solid ${box.borderColor}`,
        color: box.textColor,
        borderRadius: 8,
        cursor: box.locked ? "default" : "grab",
        transition: animating ? "left 350ms ease, top 350ms ease" : undefined,
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className="h-full w-full flex flex-col overflow-hidden"
        style={{ padding: namePx * 0.55, gap: namePx * 0.25 }}
      >
        {/* Top row: entity type (left) + ownership % (right). Both
            render at the same smaller body-text size as jurisdiction
            and notes so the header reads as an eyebrow rather than a
            second-largest text element. The whole row is hidden when
            `hideEntityType` is set AND there's no ownership % to
            show — the next text row (the name) bumps up to fill the
            top of the box. */}
        {(!box.hideEntityType || box.ownershipPct != null) && (
          <div className="flex items-baseline justify-between gap-2">
            {!box.hideEntityType && (
              <div
                className="leading-tight truncate"
                style={{
                  color: box.textColor,
                  opacity: 0.6,
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: Math.max(8, namePx * 0.7),
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {box.entityType}
              </div>
            )}
            {box.ownershipPct != null && (
              <div
                className="leading-tight tabular-nums shrink-0 ml-auto"
                style={{
                  color: box.textColor,
                  opacity: 0.6,
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: Math.max(8, namePx * 0.7),
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                }}
              >
                {fmtPct(box.ownershipPct)}
              </div>
            )}
          </div>
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="w-full bg-white/90 border border-gencom-green rounded px-1 outline-none"
            style={{
              color: box.textColor,
              fontFamily: box.fontFamily || "'Cormorant Garamond', Georgia, serif",
              fontSize: namePx,
              fontWeight: 500,
              lineHeight: 1.25,
            }}
          />
        ) : (
          <div
            className="line-clamp-2"
            style={{
              color: box.textColor,
              fontFamily: box.fontFamily || "'Cormorant Garamond', Georgia, serif",
              fontSize: namePx,
              fontWeight: 500,
              lineHeight: 1.25,
              textAlign,
            }}
            title={box.name || "Untitled"}
          >
            {box.name || "Untitled"}
          </div>
        )}
        {box.jurisdiction && box.jurisdiction.trim() !== "" && (
          <div
            className="truncate"
            style={{
              color: box.textColor,
              opacity: 0.6,
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: Math.max(8, namePx * 0.7),
              lineHeight: 1.2,
              textAlign,
            }}
            title={box.jurisdiction}
          >
            {box.jurisdiction}
          </div>
        )}
        {box.notes && box.notes.trim() !== "" && (
          <div
            className="truncate italic"
            style={{
              color: box.textColor,
              opacity: 0.6,
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: Math.max(8, namePx * 0.7),
              lineHeight: 1.2,
              textAlign,
            }}
            title={box.notes}
          >
            {box.notes}
          </div>
        )}
      </div>

      {warning && (
        <div
          className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 grid place-items-center"
          title="Children's ownership doesn't sum to 100%"
        >
          <AlertTriangle className="h-3 w-3" />
        </div>
      )}

      {/* Edge "+" buttons — only visible when the user has armed the
          box for a "new box" or "connect" action via the right-click
          context menu. By default the box has no edge affordances so
          the canvas stays clean. Suppressed for locked boxes so the
          user can't accidentally spawn / resize off them. */}
      {!box.locked && edgeAction && (
        <>
          <EdgePlus edge="top"    onClick={(p) => onEdgePlus("top", p)} />
          <EdgePlus edge="right"  onClick={(p) => onEdgePlus("right", p)} />
          <EdgePlus edge="bottom" onClick={(p) => onEdgePlus("bottom", p)} />
          <EdgePlus edge="left"   onClick={(p) => onEdgePlus("left", p)} />
        </>
      )}

      {/* Locked-box badge replaces the legacy bottom-right link button
          (which has been removed — connect now lives in the right-click
          menu). Locked boxes still need a visible affordance. */}
      {box.locked && (
        <div
          className="absolute -bottom-2 -right-2 h-6 w-6 rounded-full bg-gencom-stone text-white grid place-items-center shadow-md"
          title="Locked — unlock from the property panel to move or resize"
          aria-label="Locked"
        >
          <Lock className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

function EdgePlus({ edge, onClick }: { edge: Edge; onClick: (anchor: { x: number; y: number }) => void }) {
  const pos: Record<Edge, string> = {
    top:    "left-1/2 -top-3 -translate-x-1/2",
    bottom: "left-1/2 -bottom-3 -translate-x-1/2",
    left:   "top-1/2 -left-3 -translate-y-1/2",
    right:  "top-1/2 -right-3 -translate-y-1/2",
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // Pass the click's screen-space coords up so the parent can
        // anchor a popover near the button.
        onClick({ x: e.clientX, y: e.clientY });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={`${edge} — add box or connect`}
      aria-label={`${edge} edge — add box or connect to an existing one`}
      className={
        "absolute h-5 w-5 rounded-full bg-gencom-green text-white text-xs leading-none grid place-items-center shadow-sm opacity-0 group-hover:opacity-100 transition " +
        pos[edge]
      }
    >
      +
    </button>
  );
}
