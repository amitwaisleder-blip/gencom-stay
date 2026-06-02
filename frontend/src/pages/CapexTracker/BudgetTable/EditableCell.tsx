import { useEffect, useState } from "react";

/** Inline-editable cell content. Renders a styled `<input>` that visually
 *  matches the surrounding cell — no popup, no modal — and commits its value
 *  on blur or Enter. Escape reverts. */
export function EditableCell({
  value,
  type,
  align = "left",
  fontMono = false,
  onCommit,
}: {
  value: string | number | null;
  type: "text" | "number";
  align?: "left" | "right";
  fontMono?: boolean;
  onCommit: (next: string | number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(toDraft(value));

  useEffect(() => {
    setDraft(toDraft(value));
  }, [value]);

  function commit() {
    if (type === "number") {
      const cleaned = draft.replace(/[$,\s]/g, "");
      const n = cleaned === "" ? 0 : Number(cleaned);
      const final = Number.isFinite(n) ? n : 0;
      if (final !== Number(value ?? 0)) onCommit(final);
      return;
    }
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== (typeof value === "string" ? value : value == null ? null : String(value))) {
      onCommit(next);
    }
  }

  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(toDraft(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className={`w-full px-1.5 py-0.5 border border-transparent hover:border-gencom-sand focus:border-gencom-green focus:bg-white rounded text-xs ${
        align === "right" ? "text-right" : "text-left"
      } ${fontMono ? "font-mono" : ""} bg-transparent outline-none`}
    />
  );
}


function toDraft(v: string | number | null): string {
  if (v == null) return "";
  return String(v);
}
