// EditableCell — the visual + interaction primitive for every input in
// the Cash Flow Returns canvas.
//
// Looks identical to a Num cell when not being edited. Hovering shows a
// subtle gold tint + cursor so the user can instantly tell input cells
// from derived ones. Clicking swaps in an inline input; Enter or blur
// saves, Escape cancels.

import { useEffect, useRef, useState, type ReactNode } from "react";


export type EditableKind = "money" | "pct" | "decimal" | "int" | "text";


function formatFor(kind: EditableKind, value: number | string, digits?: number): string {
  if (kind === "text") return String(value ?? "");
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  if (kind === "money") return Math.round(n).toLocaleString("en-US");
  if (kind === "int") return Math.round(n).toLocaleString("en-US");
  if (kind === "pct") return (n * 100).toFixed(digits ?? 2) + "%";
  return n.toFixed(digits ?? 2);
}


function parseFor(kind: EditableKind, raw: string): number | string | null {
  if (kind === "text") return raw;
  const cleaned = raw.replace(/[,\s$€%]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (kind === "pct") return n / 100;
  if (kind === "int") return Math.round(n);
  return n;
}


export default function EditableCell({
  value, onChange, kind = "money", digits, width, bold, subtle,
  /** Shown in the browser tooltip when hovering — use for hints like
   *  "% growth 3.0% · Y2 ADR". */
  title,
  /** Render a custom display (e.g. with trailing "x" for multiples). */
  display,
}: {
  value: number | string;
  onChange: (v: number | string) => void;
  kind?: EditableKind;
  digits?: number;
  width?: number | string;
  bold?: boolean;
  subtle?: boolean;
  title?: string;
  display?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() => rawFor(kind, value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (!editing) setDraft(rawFor(kind, value)); }, [value, editing, kind]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const parsed = parseFor(kind, draft);
    if (parsed !== null) onChange(parsed);
    setEditing(false);
  }

  function cancel() {
    setDraft(rawFor(kind, value));
    setEditing(false);
  }

  const textCls = subtle
    ? "text-[10px] italic text-[#6b6f78]"
    : bold
      ? "text-[11px] font-semibold text-[#1a1d24]"
      : "text-[11px] text-[#1a1d24]";

  if (editing) {
    return (
      <td
        className="px-0 py-0 align-middle"
        style={{ width, background: "rgba(184, 149, 85, 0.18)" }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") cancel();
            else if (e.key === "Tab") commit();
          }}
          className={`w-full px-2 py-[3px] text-right font-mono tabular-nums outline-none bg-transparent ${textCls}`}
        />
      </td>
    );
  }

  return (
    <td
      className={`px-2 py-[3px] align-middle text-right font-mono tabular-nums whitespace-nowrap ${textCls} cursor-pointer transition`}
      style={{
        width,
        background: "rgba(184, 149, 85, 0.04)",
        borderBottom: "1px dotted rgba(184, 149, 85, 0.35)",
      }}
      title={title ?? "Click to edit"}
      onClick={() => setEditing(true)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(184, 149, 85, 0.14)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(184, 149, 85, 0.04)"; }}
    >
      {display ?? formatFor(kind, value, digits)}
    </td>
  );
}


function rawFor(kind: EditableKind, value: number | string): string {
  if (kind === "text") return String(value ?? "");
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  if (kind === "pct") return (n * 100).toString();
  if (kind === "int") return Math.round(n).toString();
  return n.toString();
}


// ---------------------------------------------------------------------
// ReadOnlyCell — same right-aligned styling as Num, but with a tooltip
// slot that documents the derivation for an auditor. Use for every cell
// that's computed from inputs.
// ---------------------------------------------------------------------
export function DerivedCell({
  children, bold, subtle, width, derivation,
}: {
  children?: ReactNode;
  bold?: boolean;
  subtle?: boolean;
  width?: number | string;
  /** Text explaining how this cell is derived — shown as a tooltip. */
  derivation?: string;
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
      title={derivation}
    >
      {children}
    </td>
  );
}
