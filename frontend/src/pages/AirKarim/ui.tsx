import type { ReactNode } from "react";

export function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
export function fmtDayLabel(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function toDatetimeLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromDatetimeLocal(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return d.toISOString();
}

export const ak = {
  input: "w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400",
  label: "block text-[11px] uppercase tracking-[0.15em] text-slate-500 font-semibold mb-1",
  btn: "text-sm px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700",
  btnPrimary: "text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800",
  btnDanger: "text-sm px-3 py-1.5 rounded-md border border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
  btnGhost: "text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100",
  card: "border border-slate-200 rounded-lg bg-white",
  tableHead: "bg-slate-50 text-slate-500 text-[11px] uppercase tracking-[0.12em]",
  tableRow: "border-t border-slate-200 hover:bg-slate-50/60",
};

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className={ak.label}>{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </label>
  );
}

export function SectionCard({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={`${ak.card} overflow-hidden mb-4`}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/60 border-b border-slate-200">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-md px-3 py-2 mb-3">
      {children}
    </div>
  );
}
