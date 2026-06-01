// Shared visual frame for every block in the Cash Flow Returns canvas.
//
// The shell paints the dark-navy title bar at the top of each block that
// mirrors the Hamilton PDF, places the "Upload Doc" action in the top
// right corner without disrupting the block's own internal layout, and
// carries the warm off-white body background. Every calculation block
// renders inside one of these shells.

import { useState, type ReactNode } from "react";


export default function BlockShell({
  title, children, onUpload, width, accent = "#1e3a5f",
  collapsible = false, defaultCollapsed = false,
}: {
  title: string;
  children: ReactNode;
  /** Stage 8 will wire real uploads. For now Phase 2 renders a button
   *  placeholder that matches the intended interaction surface. */
  onUpload?: () => void;
  /** Optional fixed width so the canvas grid stays predictable. */
  width?: number | string;
  /** Override the navy title bar color — sensitivity blocks use a slightly
   *  lighter tone to cue the derivative nature of the grids. */
  accent?: string;
  /** Render a chevron in the header that hides the body on click. Used
   *  for blocks (e.g. Notes) the user wants out of the way once they're
   *  done editing. Off by default — every other block keeps its current
   *  behavior. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section
      className="bg-white border border-[#d9d4c8] rounded-sm overflow-hidden"
      style={{ width }}
    >
      <header
        className="px-2.5 py-1.5 flex items-center justify-between gap-2"
        style={{ background: accent, color: "#ffffff" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {collapsible && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="text-white/80 hover:text-white text-[10px] leading-none w-4 h-4 grid place-items-center shrink-0"
              title={collapsed ? "Expand" : "Collapse"}
              aria-expanded={!collapsed}
            >
              {collapsed ? "▸" : "▾"}
            </button>
          )}
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] truncate">
            {title}
          </h3>
        </div>
        {!collapsed && (
          <button
            onClick={onUpload ?? (() => alert("Upload doc — wired in Phase 8"))}
            className="text-[9px] uppercase tracking-[0.15em] font-semibold px-1.5 py-0.5 rounded border border-white/40 hover:bg-white/10 shrink-0"
            title="Upload a source document — extraction lands in Phase 8"
          >
            Upload Doc
          </button>
        )}
      </header>
      {!collapsed && <div>{children}</div>}
    </section>
  );
}


// ---------------------------------------------------------------------
// Shared bits — tight spreadsheet-style table primitives.
// ---------------------------------------------------------------------
export function Row({
  label, children, bold, subtle, faded,
}: {
  label: ReactNode;
  children: ReactNode;
  bold?: boolean;
  /** Rendered in italic gray for derived "% growth / margin" sub-rows. */
  subtle?: boolean;
  faded?: boolean;
}) {
  const labelStyle = subtle
    ? "text-[10px] italic text-[#6b6f78] pl-4"
    : bold
      ? "text-[11px] font-semibold text-[#1a1d24]"
      : "text-[11px] text-[#1a1d24]";
  return (
    <tr className={`${faded ? "opacity-60" : ""} ${bold ? "bg-[#f5f1e5]" : ""}`}>
      <td className={`px-2 py-[3px] align-middle whitespace-nowrap ${labelStyle}`}>{label}</td>
      {children}
    </tr>
  );
}


/** Right-aligned numeric cell with tabular figures, suitable for budget rows.
 *  `children` is optional so `<Num />` renders a blank placeholder cell. */
export function Num({
  children, bold, subtle, width,
}: {
  children?: ReactNode;
  bold?: boolean;
  subtle?: boolean;
  width?: number | string;
}) {
  const cls = subtle
    ? "text-[10px] italic text-[#6b6f78]"
    : bold
      ? "text-[11px] font-semibold text-[#1a1d24]"
      : "text-[11px] text-[#1a1d24]";
  return (
    <td
      className={`px-2 py-[3px] align-middle text-right font-mono tabular-nums whitespace-nowrap ${cls}`}
      style={{ width }}
    >
      {children}
    </td>
  );
}


/** A visual sub-header band inside a block — used for the "Per Key",
 *  "Dec-25 ... Dec-30", "Y1 ... Y5 Total" column-header rows. */
export function SubHeaderRow({ labels, firstColWidth }: {
  labels: { text: string; align?: "left" | "right" | "center" }[];
  firstColWidth?: number | string;
}) {
  return (
    <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
      {labels.map((l, i) => (
        <td
          key={i}
          className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f]"
          style={{
            textAlign: l.align ?? (i === 0 ? "left" : "right"),
            width: i === 0 ? firstColWidth : undefined,
          }}
        >
          {l.text}
        </td>
      ))}
    </tr>
  );
}
