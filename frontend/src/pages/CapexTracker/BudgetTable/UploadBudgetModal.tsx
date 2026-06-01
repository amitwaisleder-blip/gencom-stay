import { useEffect, useRef, useState } from "react";
import { capexApi, fmtMoney } from "../lib/capexApi";
import type { BudgetExtractLine, BudgetExtractResult, CapexLine } from "../lib/types";
import { GhostButton, PrimaryButton } from "../wizards/sharedWizardUI";
import { SaveCopyButton } from "../components/SaveCopyButton";

/** Close-on-Escape handler. Used by the upload-style modals where clicking
 *  the backdrop has been disabled (it kept dismissing the modal mid-edit
 *  when users clicked between fields). Escape + the explicit Cancel/× +
 *  Save are the only ways out. */
function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

type Stage = "pick" | "parsing" | "review" | "saving";

/** Per-row action in "merge" mode: update a matched existing line, create a
 *  brand-new line, or skip this row entirely. Ignored in the other two
 *  apply modes (where the global mode decides the fate of every row). */
type RowAction = "update" | "create" | "skip";

type DraftLine = BudgetExtractLine & {
  tempId: string;
  included: boolean;
  /** Merge-mode only: the existing line this row is matched against (or null
   *  if no auto-match found). User can override via the per-row dropdown. */
  matchedLineId: string | null;
  /** Merge-mode only: what to do with this row at save time. */
  action: RowAction;
};

type ApplyMode = "new" | "existing" | "merge";
type ForecastMerge = "replace" | "add";

function normForMatch(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Auto-match an uploaded line against existing budget lines. Code-equality
 *  (case-insensitive, trimmed) wins; project_name equality is the fallback.
 *  Returns the matched line id or null. */
function findMatch(draft: BudgetExtractLine, existing: CapexLine[]): string | null {
  const code = normForMatch(draft.code);
  if (code) {
    const byCode = existing.find((l) => normForMatch(l.code) === code);
    if (byCode) return byCode.id;
  }
  const name = normForMatch(draft.project_name);
  if (name) {
    const byName = existing.find((l) => normForMatch(l.project_name) === name);
    if (byName) return byName.id;
  }
  return null;
}

function withDraftIds(lines: BudgetExtractLine[], existing: CapexLine[]): DraftLine[] {
  return lines.map((l, i) => {
    const matchedLineId = findMatch(l, existing);
    return {
      ...l,
      tempId: `${i}-${Math.random().toString(36).slice(2, 8)}`,
      included: true,
      matchedLineId,
      action: matchedLineId ? "update" : "create",
    };
  });
}

export function UploadBudgetModal({
  hotelId,
  existingLines,
  preselectedLineId,
  defaultApplyMode = "new",
  onClose,
  onCreated,
  onAppliedToLine,
  onMerged,
}: {
  hotelId: string;
  /** Lines already on the budget — used to populate the "apply to existing
   *  line" dropdown so a proposal can be merged into a placeholder rather
   *  than creating fresh rows. */
  existingLines: CapexLine[];
  /** When set, pre-selects this line in the "apply to existing" dropdown
   *  and (combined with defaultApplyMode="existing") lets the modal open
   *  ready to merge into a specific row. */
  preselectedLineId?: string;
  defaultApplyMode?: ApplyMode;
  onClose: () => void;
  onCreated: (lines: CapexLine[]) => void;
  onAppliedToLine: (line: CapexLine) => void;
  /** Fired when "Merge with existing budget" mode completes — combines both
   *  newly-created and updated lines so the caller can refresh its state in a
   *  single pass. If omitted, the modal falls back to firing onCreated and
   *  onAppliedToLine separately for each updated line. */
  onMerged?: (result: { created: CapexLine[]; updated: CapexLine[] }) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [extract, setExtract] = useState<BudgetExtractResult | null>(null);
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [primaryVendorOverride, setPrimaryVendorOverride] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyMode>(defaultApplyMode);
  const [targetLineId, setTargetLineId] = useState<string>(preselectedLineId ?? "");
  const [forecastMerge, setForecastMerge] = useState<ForecastMerge>("replace");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEscapeToClose(onClose);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setPickedFile(file);
    setError(null);
    setStage("parsing");
    try {
      const r = await capexApi.extractBudget(file);
      if (!r.lines || r.lines.length === 0) {
        setError("Claude couldn't find any line items in that file. Try a different upload, or add lines manually.");
        setStage("pick");
        return;
      }
      setExtract(r);
      setDrafts(withDraftIds(r.lines, existingLines));
      setPrimaryVendorOverride(r.primary_vendor ?? "");
      // Auto-suggest "merge" mode when there are existing lines AND at least
      // one uploaded row found a match. Otherwise stick with whatever the
      // caller defaulted to (typically "new"), so unmatched uploads don't
      // surprise the user with a merge UI.
      if (
        defaultApplyMode === "new" &&
        existingLines.length > 0 &&
        r.lines.some((l) => findMatch(l, existingLines) !== null)
      ) {
        setApplyMode("merge");
      }
      setStage("review");
    } catch (e) {
      setError(String(e));
      setStage("pick");
    }
  }

  function patchDraft(tempId: string, patch: Partial<DraftLine>) {
    setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)));
  }

  function toggleAll(included: boolean) {
    setDrafts((prev) => prev.map((d) => ({ ...d, included })));
  }

  function fillVendor() {
    const v = primaryVendorOverride.trim();
    if (!v) return;
    setDrafts((prev) => prev.map((d) => (d.vendor && d.vendor.trim() ? d : { ...d, vendor: v })));
  }

  async function save() {
    const selected = drafts.filter((d) => d.included);
    if (selected.length === 0) {
      setError("Select at least one line to save.");
      return;
    }

    if (applyMode === "merge") {
      const toUpdate = selected.filter((d) => d.action === "update" && d.matchedLineId);
      const toCreate = selected.filter((d) => d.action === "create");
      // "skip" rows are silently dropped — the user explicitly chose not to
      // touch them. They stay in the review table for traceability if the
      // user re-opens the modal later, but won't hit the server.
      if (toUpdate.length === 0 && toCreate.length === 0) {
        setError("Nothing to apply — every selected row is set to Skip.");
        return;
      }
      setStage("saving");
      setError(null);
      try {
        const sourceLabel = extract?.source_filename ?? "uploaded budget";
        // ── Updates: one PATCH per row. Field-merge policy:
        //   forecast → REPLACE (or ADD, based on the top-level forecastMerge
        //     toggle, mirroring the "Apply to existing line" mode).
        //   breakdown → REPLACE when the upload has a breakdown, else leave.
        //   year_data → REPLACE when the upload has year_data, else leave.
        //   vendor / group / category / description / project_name → fill the
        //     existing field ONLY if it's currently blank (don't overwrite
        //     curated taxonomy).
        //   code → never touched (it's the match key).
        //   original_total_budget → never touched (historical baseline).
        //   notes → append a one-line "Updated from <file>" trail.
        const updated: CapexLine[] = [];
        for (const d of toUpdate) {
          const target = existingLines.find((l) => l.id === d.matchedLineId);
          if (!target) continue;
          const uploadForecast = d.forecast_total_budget || d.original_total_budget || 0;
          const newForecast =
            forecastMerge === "replace"
              ? uploadForecast
              : (target.forecast_total_budget || 0) + uploadForecast;
          const patch: Partial<CapexLine> = {
            forecast_total_budget: newForecast,
          };
          if (d.breakdown && d.breakdown.length > 0) patch.breakdown = d.breakdown;
          if (d.year_data && Object.keys(d.year_data).length > 0) patch.year_data = d.year_data;
          if (!target.vendor && d.vendor) patch.vendor = d.vendor;
          if (!target.group && d.group) patch.group = d.group;
          if (!target.category && d.category) patch.category = d.category;
          if (!target.description && d.description) patch.description = d.description;
          if (!target.project_name && d.project_name) patch.project_name = d.project_name;
          const noteSuffix = `Updated from ${sourceLabel}`;
          patch.notes = target.notes ? `${target.notes}\n${noteSuffix}` : noteSuffix;
          const u = await capexApi.updateLine(target.id, patch);
          updated.push(u);
        }
        // ── Creates: one bulk POST.
        let created: CapexLine[] = [];
        if (toCreate.length > 0) {
          const payload = toCreate.map((d) => ({
            code: d.code || null,
            group: d.group || null,
            category: d.category || null,
            project_name: d.project_name || null,
            description: d.description || null,
            vendor: d.vendor || null,
            original_total_budget: d.original_total_budget || 0,
            forecast_total_budget: d.forecast_total_budget || d.original_total_budget || 0,
            year_data: d.year_data ?? undefined,
            notes: d.notes || null,
            breakdown: d.breakdown ?? undefined,
          }));
          created = await capexApi.bulkCreateLines(hotelId, payload);
        }
        if (onMerged) {
          onMerged({ created, updated });
        } else {
          if (created.length > 0) onCreated(created);
          for (const u of updated) onAppliedToLine(u);
        }
      } catch (e) {
        setError(String(e));
        setStage("review");
      }
      return;
    }

    if (applyMode === "existing") {
      const target = existingLines.find((l) => l.id === targetLineId);
      if (!target) {
        setError("Pick which existing line to apply this upload to.");
        return;
      }
      setStage("saving");
      setError(null);
      try {
        const uploadForecast = selected.reduce(
          (acc, d) => acc + (d.forecast_total_budget || d.original_total_budget || 0),
          0,
        );
        // Roll every selected draft into a single set of breakdown items on
        // the target. Each draft contributes either its own breakdown rows
        // (when present) or one synthesized roll-up row capturing its total.
        const newBreakdown = selected.flatMap((d) => {
          if (d.breakdown && d.breakdown.length > 0) return d.breakdown;
          const total = d.forecast_total_budget || d.original_total_budget || 0;
          if (!total && !d.description && !d.project_name) return [];
          return [
            {
              label: d.project_name || d.description || d.code || "Line",
              description: d.description ?? null,
              vendor: d.vendor ?? null,
              total,
            },
          ];
        });
        const mergedBreakdown = [...(target.breakdown ?? []), ...newBreakdown];
        const newForecast =
          forecastMerge === "replace"
            ? uploadForecast
            : (target.forecast_total_budget || 0) + uploadForecast;
        const vendorPick =
          target.vendor ||
          primaryVendorOverride.trim() ||
          extract?.primary_vendor ||
          selected.find((d) => d.vendor && d.vendor.trim())?.vendor ||
          null;
        const sourceLabel = extract?.source_filename ?? "uploaded budget";
        const noteSuffix = `Applied from ${sourceLabel} (${selected.length} item${
          selected.length === 1 ? "" : "s"
        })`;
        const mergedNotes = target.notes
          ? `${target.notes}\n${noteSuffix}`
          : noteSuffix;
        const updated = await capexApi.updateLine(target.id, {
          forecast_total_budget: newForecast,
          vendor: vendorPick,
          breakdown: mergedBreakdown,
          notes: mergedNotes,
        });
        onAppliedToLine(updated);
      } catch (e) {
        setError(String(e));
        setStage("review");
      }
      return;
    }

    setStage("saving");
    setError(null);
    try {
      const payload = selected.map((d) => ({
        code: d.code || null,
        group: d.group || null,
        category: d.category || null,
        project_name: d.project_name || null,
        description: d.description || null,
        vendor: d.vendor || null,
        original_total_budget: d.original_total_budget || 0,
        forecast_total_budget: d.forecast_total_budget || d.original_total_budget || 0,
        year_data: d.year_data ?? undefined,
        notes: d.notes || null,
        breakdown: d.breakdown ?? undefined,
      }));
      const created = await capexApi.bulkCreateLines(hotelId, payload);
      onCreated(created);
    } catch (e) {
      setError(String(e));
      setStage("review");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Upload budget</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {stage === "review" ? "Review extracted lines" : "Upload a budget document"}
            </h2>
            <p className="text-xs text-gencom-stone mt-1">
              Claude will parse the file and pre-populate scope, cost breakdown, budget, and vendor for every line.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {stage === "pick" && (
          <PickStage
            dragOver={dragOver}
            setDragOver={setDragOver}
            inputRef={inputRef}
            handleFiles={handleFiles}
          />
        )}

        {stage === "parsing" && (
          <div className="py-16 text-center">
            <Spinner large />
            <div className="text-sm text-gencom-stone mt-3">
              Parsing your budget with Claude — this can take 20-60 seconds for large documents.
            </div>
          </div>
        )}

        {stage === "review" && extract && (
          <ReviewStage
            extract={extract}
            drafts={drafts}
            primaryVendorOverride={primaryVendorOverride}
            setPrimaryVendorOverride={setPrimaryVendorOverride}
            patchDraft={patchDraft}
            toggleAll={toggleAll}
            fillVendor={fillVendor}
            existingLines={existingLines}
            applyMode={applyMode}
            setApplyMode={setApplyMode}
            targetLineId={targetLineId}
            setTargetLineId={setTargetLineId}
            forecastMerge={forecastMerge}
            setForecastMerge={setForecastMerge}
          />
        )}

        {stage === "saving" && (
          <div className="py-16 text-center">
            <Spinner large />
            <div className="text-sm text-gencom-stone mt-3">Saving lines…</div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {(stage === "review" || stage === "pick") && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="text-xs text-gencom-stone flex items-center gap-3">
              {stage === "review" && drafts.length > 0 && (
                <span>
                  {drafts.filter((d) => d.included).length} of {drafts.length} lines selected
                </span>
              )}
              {stage === "review" && (
                <SaveCopyButton
                  file={pickedFile}
                  kind="budget"
                  metadata={{
                    document_title: extract?.document_title,
                    primary_vendor: primaryVendorOverride || extract?.primary_vendor,
                    line_count: extract?.line_count,
                    hotel_id: hotelId,
                  }}
                />
              )}
            </div>
            <div className="flex gap-3">
              <GhostButton onClick={onClose}>Cancel</GhostButton>
              {stage === "review" && (() => {
                const selected = drafts.filter((d) => d.included);
                const mergeUpdates = selected.filter(
                  (d) => d.action === "update" && d.matchedLineId,
                ).length;
                const mergeCreates = selected.filter((d) => d.action === "create").length;
                const mergeUnresolved = selected.some(
                  (d) => d.action === "update" && !d.matchedLineId,
                );
                const disabled =
                  selected.length === 0 ||
                  (applyMode === "existing" && !targetLineId) ||
                  (applyMode === "merge" && (mergeUpdates + mergeCreates === 0 || mergeUnresolved));
                let label = `Save ${selected.length} lines`;
                if (applyMode === "existing") label = "Apply to selected line";
                else if (applyMode === "merge") {
                  const bits: string[] = [];
                  if (mergeUpdates > 0) bits.push(`update ${mergeUpdates}`);
                  if (mergeCreates > 0) bits.push(`create ${mergeCreates}`);
                  label = bits.length > 0 ? `Apply — ${bits.join(", ")}` : "Apply";
                }
                return (
                  <PrimaryButton onClick={save} disabled={disabled}>
                    {label}
                  </PrimaryButton>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function PickStage({
  dragOver,
  setDragOver,
  inputRef,
  handleFiles,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleFiles: (files: FileList | null) => void;
}) {
  return (
    <div>
      <div
        className={`relative rounded-xl border-2 border-dashed cursor-pointer transition aspect-[3/1] flex items-center justify-center ${
          dragOver
            ? "border-gencom-gold bg-gencom-gold/10"
            : "border-gencom-sand bg-gencom-mist hover:border-gencom-stone"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="text-center px-4">
          <div className="text-4xl mb-2">📄</div>
          <div className="text-sm font-semibold text-gencom-ink">Drop a budget file here, or click to choose</div>
          <div className="text-[11px] text-gencom-stone mt-1">PDF, XLSX, DOCX, CSV</div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.docx,.csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gencom-stone">
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Owner-side budget</div>
          Multi-line capex schedule across many vendors and categories. Claude will assign group / category by context.
        </div>
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Contractor proposal</div>
          One-vendor scope (e.g. elevator modernization quote). Claude will tag the vendor across every line.
        </div>
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Excel cashflow</div>
          Per-year breakdowns import as year_data — your year columns will populate automatically.
        </div>
      </div>
    </div>
  );
}


function ReviewStage({
  extract,
  drafts,
  primaryVendorOverride,
  setPrimaryVendorOverride,
  patchDraft,
  toggleAll,
  fillVendor,
  existingLines,
  applyMode,
  setApplyMode,
  targetLineId,
  setTargetLineId,
  forecastMerge,
  setForecastMerge,
}: {
  extract: BudgetExtractResult;
  drafts: DraftLine[];
  primaryVendorOverride: string;
  setPrimaryVendorOverride: (v: string) => void;
  patchDraft: (tempId: string, patch: Partial<DraftLine>) => void;
  toggleAll: (included: boolean) => void;
  fillVendor: () => void;
  existingLines: CapexLine[];
  applyMode: ApplyMode;
  setApplyMode: (m: ApplyMode) => void;
  targetLineId: string;
  setTargetLineId: (id: string) => void;
  forecastMerge: ForecastMerge;
  setForecastMerge: (m: ForecastMerge) => void;
}) {
  const totalForecast = drafts.filter((d) => d.included).reduce((acc, d) => acc + (d.forecast_total_budget ?? 0), 0);
  const totalOriginal = drafts.filter((d) => d.included).reduce((acc, d) => acc + (d.original_total_budget ?? 0), 0);

  const sortedExistingLines = [...existingLines].sort((a, b) => {
    const ac = (a.code ?? "").trim();
    const bc = (b.code ?? "").trim();
    if (ac && bc) return ac.localeCompare(bc, undefined, { numeric: true });
    return (a.project_name ?? "").localeCompare(b.project_name ?? "");
  });
  const target = sortedExistingLines.find((l) => l.id === targetLineId);
  const targetCurrentForecast = target?.forecast_total_budget ?? 0;
  const projectedTargetForecast =
    forecastMerge === "replace" ? totalForecast : targetCurrentForecast + totalForecast;

  const docKindLabel =
    extract.doc_kind === "proposal"
      ? "Proposal — sub-items rolled up into one line"
      : extract.doc_kind === "aggregated_budget"
      ? "Aggregated budget — one line per project row"
      : null;

  return (
    <div className="space-y-4">
      {docKindLabel && (
        <div className="rounded-md border border-gencom-gold/40 bg-gencom-gold/10 px-4 py-2.5 text-sm text-gencom-ink">
          <span className="text-gencom-gold mr-2">●</span>
          <span className="font-semibold">Detected: </span>
          {docKindLabel}
        </div>
      )}

      <div className="rounded-md border-2 border-gencom-sand bg-white p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
          How should this upload be applied?
        </div>
        <div className="inline-flex rounded-md border-2 border-gencom-sand overflow-hidden">
          <button
            type="button"
            onClick={() => setApplyMode("new")}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider transition ${
              applyMode === "new"
                ? "bg-emerald-700 text-white font-semibold"
                : "bg-white text-gencom-stone hover:text-gencom-ink"
            }`}
          >
            Create new lines
          </button>
          <button
            type="button"
            onClick={() => setApplyMode("merge")}
            disabled={existingLines.length === 0}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider transition border-l-2 border-gencom-sand ${
              applyMode === "merge"
                ? "bg-emerald-700 text-white font-semibold"
                : "bg-white text-gencom-stone hover:text-gencom-ink disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
            title={
              existingLines.length === 0
                ? "No existing lines on this budget yet — add a line first."
                : "Match each uploaded row against an existing line by code or name. Matched rows update the existing line; unmatched rows create new lines."
            }
          >
            Merge with existing budget
          </button>
          <button
            type="button"
            onClick={() => setApplyMode("existing")}
            disabled={existingLines.length === 0}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider transition border-l-2 border-gencom-sand ${
              applyMode === "existing"
                ? "bg-emerald-700 text-white font-semibold"
                : "bg-white text-gencom-stone hover:text-gencom-ink disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
            title={
              existingLines.length === 0
                ? "No existing lines on this budget yet — add a line first."
                : "Roll this proposal into ONE existing line on the budget"
            }
          >
            Roll up into one line
          </button>
        </div>
        {applyMode === "existing" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1">
                Existing line
              </div>
              <select
                value={targetLineId}
                onChange={(e) => setTargetLineId(e.target.value)}
                className="w-full px-2 py-1.5 border border-gencom-sand rounded text-sm bg-white"
              >
                <option value="">— Select a line —</option>
                {sortedExistingLines.map((l) => {
                  const code = (l.code ?? "").trim();
                  const name = (l.project_name ?? l.description ?? "(unnamed)").trim() || "(unnamed)";
                  const fc = fmtMoney(l.forecast_total_budget);
                  const label = code ? `${code} · ${name} — ${fc}` : `${name} — ${fc}`;
                  return (
                    <option key={l.id} value={l.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {target && (
                <div className="mt-1 text-[11px] text-gencom-stone">
                  Current forecast: <span className="text-gencom-ink font-semibold">{fmtMoney(targetCurrentForecast)}</span>
                  {target.vendor && (
                    <>
                      {" · "}
                      Vendor: <span className="text-gencom-ink">{target.vendor}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1">
                Forecast handling
              </div>
              <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden">
                <button
                  type="button"
                  onClick={() => setForecastMerge("replace")}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-wider transition ${
                    forecastMerge === "replace"
                      ? "bg-gencom-gold/20 text-gencom-ink font-semibold"
                      : "bg-white text-gencom-stone hover:text-gencom-ink"
                  }`}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setForecastMerge("add")}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-wider transition border-l border-gencom-sand ${
                    forecastMerge === "add"
                      ? "bg-gencom-gold/20 text-gencom-ink font-semibold"
                      : "bg-white text-gencom-stone hover:text-gencom-ink"
                  }`}
                >
                  Add to existing
                </button>
              </div>
              {target && (
                <div className="mt-1 text-[11px] text-gencom-stone">
                  New forecast: <span className="text-gencom-ink font-semibold">{fmtMoney(projectedTargetForecast)}</span>
                </div>
              )}
            </div>
            <div className="md:col-span-2 text-[11px] text-gencom-stone italic">
              Selected line items below will be appended to the existing line's cost breakdown. Code, group, and category on the existing line are preserved.
            </div>
          </div>
        )}
        {applyMode === "merge" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-gencom-stone">
                Auto-matched:
              </span>
              <span className="text-emerald-800 font-semibold">
                {drafts.filter((d) => d.included && d.action === "update").length} update
              </span>
              <span className="text-gencom-stone">·</span>
              <span className="text-gencom-gold font-semibold">
                {drafts.filter((d) => d.included && d.action === "create").length} create
              </span>
              <span className="text-gencom-stone">·</span>
              <span className="text-gencom-stone font-semibold">
                {drafts.filter((d) => d.included && d.action === "skip").length} skip
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[10px] uppercase tracking-wider text-gencom-stone">
                Forecast handling on updates
              </div>
              <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden">
                <button
                  type="button"
                  onClick={() => setForecastMerge("replace")}
                  className={`px-3 py-1 text-[11px] uppercase tracking-wider transition ${
                    forecastMerge === "replace"
                      ? "bg-gencom-gold/20 text-gencom-ink font-semibold"
                      : "bg-white text-gencom-stone hover:text-gencom-ink"
                  }`}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setForecastMerge("add")}
                  className={`px-3 py-1 text-[11px] uppercase tracking-wider transition border-l border-gencom-sand ${
                    forecastMerge === "add"
                      ? "bg-gencom-gold/20 text-gencom-ink font-semibold"
                      : "bg-white text-gencom-stone hover:text-gencom-ink"
                  }`}
                >
                  Add to existing
                </button>
              </div>
            </div>
            <div className="text-[11px] text-gencom-stone italic">
              Each row below has its own action. Updates overwrite forecast (or add to it), fill blank fields, and replace the cost breakdown — code, group, and category on the existing line are preserved unless previously blank.
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-md border border-gencom-sand bg-gencom-mist/40 p-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">Source</div>
          <div className="text-sm text-gencom-ink font-medium truncate" title={extract.source_filename ?? ""}>
            {extract.source_filename ?? "—"}
          </div>
          {extract.document_title && (
            <div className="text-[11px] text-gencom-stone italic mt-0.5 line-clamp-2">
              {extract.document_title}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">Primary vendor</div>
          <div className="flex gap-2 items-center">
            <input
              value={primaryVendorOverride}
              onChange={(e) => setPrimaryVendorOverride(e.target.value)}
              className="flex-1 px-2 py-1 border border-gencom-sand rounded text-sm"
              placeholder="(none — multi-vendor)"
            />
            <button
              type="button"
              onClick={fillVendor}
              className="text-[10px] uppercase tracking-wider text-gencom-gold hover:text-gencom-ink whitespace-nowrap"
              title="Fill vendor on every line that doesn't already have one"
            >
              Apply to blank lines
            </button>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">AI confidence</div>
          <div className="text-sm font-semibold">
            {extract.confidence === "high" ? (
              <span className="text-emerald-700">high</span>
            ) : extract.confidence === "medium" ? (
              <span className="text-gencom-gold">medium</span>
            ) : extract.confidence === "low" ? (
              <span className="text-red-700">low</span>
            ) : (
              <span className="text-gencom-stone">—</span>
            )}
          </div>
        </div>
      </div>

      {extract.notes && (
        <div className="rounded-md border border-gencom-sand bg-white p-3 text-xs text-gencom-stone italic">
          <span className="font-semibold not-italic text-gencom-ink">Claude notes: </span>
          {extract.notes}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="text-[11px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
          >
            Select all
          </button>
          <span className="text-gencom-stone/40">·</span>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="text-[11px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
          >
            Deselect all
          </button>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-gencom-stone">
            Original: <span className="text-gencom-ink font-semibold">{fmtMoney(totalOriginal)}</span>
          </span>
          <span className="text-gencom-stone">
            Forecast: <span className="text-gencom-ink font-semibold">{fmtMoney(totalForecast)}</span>
          </span>
        </div>
      </div>

      <div className="rounded-md border border-gencom-sand overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone">
            <tr>
              <th className="w-8 px-2 py-2 text-center"></th>
              <th className="w-6 px-1 py-2"></th>
              {applyMode === "merge" && (
                <th className="px-2 py-2 text-left w-56">Action</th>
              )}
              <th className="px-2 py-2 text-left">Code</th>
              <th className="px-2 py-2 text-left">Group</th>
              <th className="px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-left">Project name</th>
              <th className="px-2 py-2 text-left">Vendor</th>
              <th className="px-2 py-2 text-right">Original</th>
              <th className="px-2 py-2 text-right">Forecast</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <DraftLineRow
                key={d.tempId}
                draft={d}
                patchDraft={patchDraft}
                mergeMode={applyMode === "merge"}
                existingLines={sortedExistingLines}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gencom-stone">
        Tip: edit any field inline before saving. Year-by-year breakdowns from the source (if any) are preserved automatically.
      </p>
    </div>
  );
}


function DraftLineRow({
  draft: d,
  patchDraft,
  mergeMode,
  existingLines,
}: {
  draft: DraftLine;
  patchDraft: (tempId: string, patch: Partial<DraftLine>) => void;
  mergeMode: boolean;
  existingLines: CapexLine[];
}) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = d.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;
  const matched = d.matchedLineId
    ? existingLines.find((l) => l.id === d.matchedLineId) ?? null
    : null;
  return (
    <>
      <tr className={`border-t border-gencom-sand/60 ${d.included ? "" : "opacity-40"}`}>
        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={d.included}
            onChange={(e) => patchDraft(d.tempId, { included: e.target.checked })}
            className="accent-gencom-gold"
          />
        </td>
        <td className="px-1 py-1.5 text-center">
          {hasBreakdown ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-gencom-gold hover:text-gencom-ink"
              title={`${breakdown.length} sub-items rolled up into this line`}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : null}
        </td>
        {mergeMode && (
          <td className="px-2 py-1.5 align-top">
            <RowActionSelector
              draft={d}
              matched={matched}
              existingLines={existingLines}
              patchDraft={patchDraft}
            />
          </td>
        )}
        <td className="px-2 py-1.5">
          <CellInput value={d.code ?? ""} onChange={(v) => patchDraft(d.tempId, { code: v || null })} placeholder="—" />
        </td>
        <td className="px-2 py-1.5">
          <CellInput value={d.group ?? ""} onChange={(v) => patchDraft(d.tempId, { group: v || null })} placeholder="—" />
        </td>
        <td className="px-2 py-1.5">
          <CellInput value={d.category ?? ""} onChange={(v) => patchDraft(d.tempId, { category: v || null })} placeholder="—" />
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            <CellInput
              value={d.project_name ?? ""}
              onChange={(v) => patchDraft(d.tempId, { project_name: v || null })}
              placeholder="—"
            />
            {hasBreakdown && (
              <span className="text-[10px] uppercase tracking-wider text-gencom-gold whitespace-nowrap">
                {breakdown.length} items
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5">
          <CellInput value={d.vendor ?? ""} onChange={(v) => patchDraft(d.tempId, { vendor: v || null })} placeholder="—" />
        </td>
        <td className="px-2 py-1.5 text-right">
          <CellNumberInput
            value={d.original_total_budget}
            onChange={(v) => patchDraft(d.tempId, { original_total_budget: v })}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          <CellNumberInput
            value={d.forecast_total_budget}
            onChange={(v) => patchDraft(d.tempId, { forecast_total_budget: v })}
          />
        </td>
      </tr>
      {expanded && hasBreakdown && (
        <tr className="bg-gencom-mist/30">
          <td colSpan={mergeMode ? 10 : 9} className="px-6 py-2">
            <DraftBreakdownTable items={breakdown} />
          </td>
        </tr>
      )}
    </>
  );
}


function RowActionSelector({
  draft: d,
  matched,
  existingLines,
  patchDraft,
}: {
  draft: DraftLine;
  matched: CapexLine | null;
  existingLines: CapexLine[];
  patchDraft: (tempId: string, patch: Partial<DraftLine>) => void;
}) {
  // The select uses a synthetic value: "create", "skip", or "update:<lineId>".
  // We carry the matched line id inside the value so the user can re-target
  // an update to a different existing line without leaving the dropdown.
  const value =
    d.action === "create" ? "create" : d.action === "skip" ? "skip" : `update:${d.matchedLineId ?? ""}`;
  return (
    <div className="space-y-0.5">
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "create") {
            patchDraft(d.tempId, { action: "create" });
          } else if (v === "skip") {
            patchDraft(d.tempId, { action: "skip" });
          } else if (v.startsWith("update:")) {
            const id = v.slice("update:".length);
            patchDraft(d.tempId, { action: "update", matchedLineId: id || null });
          }
        }}
        className={`w-full px-1.5 py-0.5 border rounded text-[11px] bg-white ${
          d.action === "update"
            ? "border-emerald-400 text-emerald-900"
            : d.action === "skip"
            ? "border-gencom-sand text-gencom-stone"
            : "border-gencom-gold/60 text-gencom-ink"
        }`}
      >
        <option value="create">+ Create new line</option>
        <option value="skip">Skip</option>
        {existingLines.length > 0 && (
          <optgroup label={matched ? "Update existing line" : "Update an existing line"}>
            {existingLines.map((l) => {
              const code = (l.code ?? "").trim();
              const name = (l.project_name ?? l.description ?? "(unnamed)").trim() || "(unnamed)";
              const label = code ? `${code} · ${name}` : name;
              return (
                <option key={l.id} value={`update:${l.id}`}>
                  ↻ {label}
                </option>
              );
            })}
          </optgroup>
        )}
      </select>
      {d.action === "update" && matched && (
        <div className="text-[10px] text-emerald-700 truncate" title={matched.project_name ?? ""}>
          → {matched.code ? `${matched.code} · ` : ""}
          {matched.project_name ?? matched.description ?? "(unnamed)"}
        </div>
      )}
      {d.action === "update" && !matched && (
        <div className="text-[10px] text-red-700">Pick a line to update</div>
      )}
    </div>
  );
}


function DraftBreakdownTable({ items }: { items: import("../lib/types").BreakdownItem[] }) {
  const subtotal = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
  return (
    <div className="rounded-md border border-gencom-sand bg-white">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gencom-stone border-b border-gencom-sand bg-gencom-mist/40">
        Cost breakdown ({items.length} items)
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-[9px] uppercase tracking-wider text-gencom-stone/80">
          <tr>
            <th className="px-3 py-1 text-left font-semibold">Item</th>
            <th className="px-3 py-1 text-right font-semibold">Qty</th>
            <th className="px-3 py-1 text-left font-semibold">Unit</th>
            <th className="px-3 py-1 text-right font-semibold">Unit cost</th>
            <th className="px-3 py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-t border-gencom-sand/40">
              <td className="px-3 py-1">
                <div className="text-gencom-ink">{it.label}</div>
                {it.description && <div className="text-[10px] text-gencom-stone line-clamp-1 max-w-[260px]">{it.description}</div>}
              </td>
              <td className="px-3 py-1 text-right text-gencom-stone">{it.qty ?? "—"}</td>
              <td className="px-3 py-1 text-gencom-stone">{it.unit ?? "—"}</td>
              <td className="px-3 py-1 text-right text-gencom-stone">{it.unit_cost != null ? fmtMoney(it.unit_cost) : "—"}</td>
              <td className="px-3 py-1 text-right text-gencom-ink font-semibold">{fmtMoney(it.total)}</td>
            </tr>
          ))}
          <tr className="border-t border-gencom-sand bg-gencom-mist/20">
            <td colSpan={4} className="px-3 py-1 text-right text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
              Subtotal
            </td>
            <td className="px-3 py-1 text-right text-gencom-ink font-bold">{fmtMoney(subtotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function CellInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-1.5 py-0.5 border border-transparent hover:border-gencom-sand focus:border-gencom-gold focus:bg-white rounded text-xs bg-transparent"
    />
  );
}


function CellNumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-28 px-1.5 py-0.5 border border-transparent hover:border-gencom-sand focus:border-gencom-gold focus:bg-white rounded text-xs text-right bg-transparent"
    />
  );
}


function Spinner({ large }: { large?: boolean }) {
  const size = large ? "h-8 w-8" : "h-3 w-3";
  return (
    <svg className={`animate-spin ${size} mx-auto text-gencom-gold`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
