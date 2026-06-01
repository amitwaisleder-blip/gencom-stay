import { useEffect, useMemo, useState } from "react";
import { api, type DocumentRow, type DocumentType, type ExtractionGranularity, type ExtractionResult, type ExtractionPreviewResult, type ScopeSuggestion, type BreakdownSuggestion, type Property } from "../lib/api";
import { subAreaGroupsForDivision, subAreasForDivision } from "../lib/subAreas";
import { checkBudgetSanity } from "../lib/budgetSanity";
import { useChatContext } from "../lib/chatContext";

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "pip", label: "PIP" },
  { value: "om", label: "OM" },
  { value: "brochure", label: "Brochure" },
  { value: "walk_notes", label: "Walk notes" },
  { value: "walk_photo", label: "Walk photo" },
  { value: "other", label: "Other" },
];

const PHASES = [
  "Uploading…",
  "Reading documents…",
  "Extracting property metadata…",
  "Identifying scope items…",
  "Matching to cost database…",
  "Consolidating…",
];

function guessType(filename: string): DocumentType {
  const name = filename.toLowerCase();
  if (name.match(/\.(jpg|jpeg|png|heic|gif)$/)) return "walk_photo";
  if (name.includes("pip")) return "pip";
  if (name.includes("om") || name.includes("offering") || name.includes("memorand")) return "om";
  if (name.includes("walk") || name.includes("site visit") || name.includes("notes")) return "walk_notes";
  if (name.includes("brochure") || name.includes("marketing")) return "brochure";
  return "other";
}

type Props = {
  propertyId: string;
  /** Called after extraction succeeds with the extraction result summary.
   *  Use this to reload the property and re-check for missing fields. */
  onExtracted?: (result: ExtractionResult) => void;
};

export default function UploadExtractPanel({ propertyId, onExtracted }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [pendingTypes, setPendingTypes] = useState<Record<string, DocumentType>>({});
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [extractStartedAt, setExtractStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [preview, setPreview] = useState<ExtractionPreviewResult | null>(null);
  const [previewItems, setPreviewItems] = useState<(ScopeSuggestion & { _id: string; _include: boolean })[]>([]);
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [importing, setImporting] = useState(false);
  /** When non-null, the version-picker modal is shown. User picks one of
   *  three budgeting versions BEFORE the extraction request actually fires. */
  const [showVersionPicker, setShowVersionPicker] = useState(false);
  const { setExtraContext } = useChatContext();

  // Publish preview items to the chat's extra-context whenever they change,
  // so the user can ask Claude about pending / flagged items before import.
  useEffect(() => {
    if (!preview || previewItems.length === 0) {
      setExtraContext("");
      return;
    }
    const lines = [
      `## Pending scope extracted from ${preview.documents_processed} document${preview.documents_processed !== 1 ? "s" : ""} (NOT YET IMPORTED — user is reviewing)`,
      `${previewItems.length} items total · ${previewItems.filter((p) => p._include).length} currently checked to import`,
      "",
      ...previewItems.map((it, i) => {
        const parts = [
          `${i + 1}. [${it.division}${it.sub_area ? " / " + it.sub_area : ""}]`,
          it.line_item,
          it.priority ? `(${it.priority})` : "",
          it.confidence ? `conf=${it.confidence}` : "",
          it._include ? "" : "· EXCLUDED",
        ].filter(Boolean);
        const line = `  ${parts.join(" ")}`;
        const extras: string[] = [];
        if (it.description) extras.push(`     desc: ${it.description}`);
        if (it.source_excerpt) extras.push(`     source: "${it.source_excerpt}" (${it.source_document_filename ?? "doc"}${it.source_page ? " p." + it.source_page : ""})`);
        return [line, ...extras].join("\n");
      }),
    ];
    setExtraContext(lines.join("\n"));
    return () => setExtraContext("");
  }, [preview, previewItems, setExtraContext]);

  // Elapsed-time ticker while an extraction is in flight.
  useEffect(() => {
    if (extractStartedAt == null) return;
    const id = setInterval(() => setElapsedMs(Date.now() - extractStartedAt), 250);
    return () => clearInterval(id);
  }, [extractStartedAt]);

  async function refreshDocs() {
    const rows = await api.listDocuments(propertyId);
    setDocs(rows);
  }

  useEffect(() => { refreshDocs(); }, [propertyId]);

  function addFiles(files: File[]) {
    setPending((p) => [...p, ...files]);
    setPendingTypes((t) => {
      const next = { ...t };
      for (const f of files) next[f.name] = guessType(f.name);
      return next;
    });
  }

  async function doUpload() {
    if (pending.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocuments(propertyId, pending, pendingTypes);
      setPending([]);
      setPendingTypes({});
      await refreshDocs();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  function openExtractVersionPicker() {
    // Version picker is shown FIRST. The actual extraction only fires
    // once the user picks a granularity, so no autofill happens before
    // they've chosen the budgeting format.
    setShowVersionPicker(true);
  }

  async function runExtract(granularity: ExtractionGranularity) {
    setShowVersionPicker(false);
    setExtracting(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewItems([]);
    setPhaseIdx(0);
    setElapsedMs(0);
    setExtractStartedAt(Date.now());
    const phaseTimer = setInterval(() => setPhaseIdx((i) => Math.min(i + 1, PHASES.length - 1)), 8000);
    try {
      const p = await api.runExtractionPreview(propertyId, granularity);
      setPreview(p);
      setPreviewItems(p.scope_suggestions.map((s, i) => ({
        ...s,
        _id: `sug_${i}`,
        _include: true,
      })));
      // Refresh the property snapshot so the sanity check uses whatever
      // keys / tier just got auto-populated.
      try { setPreviewProperty(await api.getProperty(propertyId)); } catch { /* ignore */ }
      await refreshDocs();
    } catch (e) {
      setError(String(e));
    } finally {
      clearInterval(phaseTimer);
      setExtracting(false);
      setExtractStartedAt(null);
    }
  }

  async function doImportPreview() {
    if (!preview) return;
    const approved = previewItems
      .filter((p) => p._include && p.line_item.trim())
      .map(({ _id, _include, ...rest }) => rest as ScopeSuggestion);
    if (approved.length === 0) {
      alert("Select at least one item to import.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const r = await api.importScopeBatch(propertyId, approved);
      setResult({
        documents_processed: preview.documents_processed,
        property_fields_updated: preview.property_fields_updated,
        scope_items_created: r.scope_items_created,
        warnings: [...preview.warnings, ...r.warnings],
        duration_seconds: preview.duration_seconds,
      });
      setPreview(null);
      setPreviewItems([]);
      await refreshDocs();
      onExtracted?.({
        documents_processed: preview.documents_processed,
        property_fields_updated: preview.property_fields_updated,
        scope_items_created: r.scope_items_created,
        warnings: [...preview.warnings, ...r.warnings],
        duration_seconds: preview.duration_seconds,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setPreviewItems([]);
  }

  function patchPreviewItem(id: string, patch: Partial<ScopeSuggestion & { _include: boolean }>) {
    setPreviewItems((xs) => xs.map((x) => x._id === id ? { ...x, ...patch } : x));
  }

  async function doRetryOne(docId: string) {
    setRetryingDocId(docId);
    setError(null);
    setResult(null);
    try {
      const r = await api.runSingleDocExtraction(propertyId, docId);
      setResult(r);
      await refreshDocs();
      onExtracted?.(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setRetryingDocId(null);
    }
  }

  const canExtract = docs.length > 0 && !extracting && !retryingDocId;

  return (
    <div className="mb-6 bg-white border border-emerald-700/40 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gencom-mist/40"
      >
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-600"></span>
          <span className="font-display text-lg">Upload & Extract</span>
          <span className="text-xs text-gencom-stone">
            {docs.length === 0
              ? "Drop a PIP or OM to auto-populate this property"
              : `${docs.length} document${docs.length > 1 ? "s" : ""} uploaded`}
          </span>
        </div>
        <span className="text-gencom-stone">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gencom-sand space-y-3">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
            className="p-6 border-2 border-dashed border-gencom-sand rounded-lg text-center"
          >
            <div className="text-sm mb-2">Drop PIP, OM, walk notes, or photos here</div>
            <label className="inline-block px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs cursor-pointer hover:bg-emerald-700">
              Browse files
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.heic,.gif"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
              />
            </label>
          </div>

          {/* Pending uploads */}
          {pending.length > 0 && (
            <div className="bg-gencom-mist/60 border border-gencom-sand rounded-md p-3 text-sm">
              <div className="font-medium mb-2">Pending upload ({pending.length})</div>
              <div className="space-y-1.5">
                {pending.map((f) => (
                  <div key={f.name} className="flex items-center gap-2">
                    <div className="flex-1 truncate text-xs">{f.name}</div>
                    <select
                      value={pendingTypes[f.name]}
                      onChange={(e) => setPendingTypes({ ...pendingTypes, [f.name]: e.target.value as DocumentType })}
                      className="border border-gencom-sand rounded px-2 py-0.5 text-xs"
                    >
                      {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button
                      onClick={() => setPending(pending.filter((x) => x !== f))}
                      className="text-gencom-stone hover:text-red-700 text-sm"
                    >×</button>
                  </div>
                ))}
              </div>
              <button
                onClick={doUpload}
                disabled={uploading}
                className="mt-3 px-4 py-1.5 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          )}

          {/* Uploaded docs + extract */}
          {docs.length > 0 && (
            <div className="border border-gencom-sand rounded-md p-3 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Uploaded documents</div>
                <button
                  onClick={openExtractVersionPicker}
                  disabled={!canExtract}
                  className="px-4 py-1.5 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800 disabled:opacity-50"
                >
                  {extracting ? "Extracting…" : "Extract & Review"}
                </button>
              </div>

              {extracting && (
                <ExtractionProgress
                  phaseIdx={phaseIdx}
                  phases={PHASES}
                  elapsedMs={elapsedMs}
                  docCount={docs.length}
                />
              )}

              <div className="space-y-1">
                {docs.map((d) => {
                  const isRetrying = retryingDocId === d.id;
                  return (
                    <div key={d.id} className="flex items-center justify-between py-1 border-b border-gencom-sand/50 last:border-0 text-xs">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{d.filename}</span>
                        <span className="ml-2 text-gencom-stone">
                          {d.document_type.toUpperCase()}{d.page_count ? ` · ${d.page_count}p` : ""}
                        </span>
                        {d.extraction_error && (
                          <div className="text-[11px] text-red-700 mt-0.5 truncate" title={d.extraction_error}>
                            {d.extraction_error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => doRetryOne(d.id)}
                          disabled={extracting || !!retryingDocId}
                          title="Re-run extraction for just this document (soft-deletes prior AI-extracted items from it)"
                          className="px-2 py-0.5 border border-gencom-sand rounded text-[11px] hover:bg-gencom-mist/60 disabled:opacity-40"
                        >
                          {isRetrying ? "Retrying…" : "Retry"}
                        </button>
                        <span className={`px-2 py-0.5 rounded ${
                          d.extraction_status === "complete" ? "bg-green-100 text-green-800" :
                          d.extraction_status === "running" ? "bg-gencom-gold/20" :
                          d.extraction_status === "failed" ? "bg-red-100 text-red-800" :
                          "bg-gencom-sand"
                        }`}>{d.extraction_status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview — scope review before import */}
          {preview && (
            <PreviewReview
              propertyId={propertyId}
              property={previewProperty}
              preview={preview}
              items={previewItems}
              onPatch={patchPreviewItem}
              onReplace={(id, newItems) => {
                setPreviewItems((xs) => {
                  const idx = xs.findIndex((x) => x._id === id);
                  if (idx < 0) return xs;
                  const withIds = newItems.map((n, i) => ({
                    ...n,
                    _id: `${id}_x${i}_${Date.now()}`,
                    _include: true,
                  }));
                  return [...xs.slice(0, idx), ...withIds, ...xs.slice(idx + 1)];
                });
              }}
              onImport={doImportPreview}
              onCancel={cancelPreview}
              importing={importing}
            />
          )}

          {/* Extraction result */}
          {result && (
            <div className="bg-emerald-50 border border-emerald-600/40 rounded-md p-3 text-sm">
              <div className="font-medium mb-1">Extraction complete · {result.duration_seconds.toFixed(1)}s</div>
              <ul className="text-xs space-y-0.5">
                <li>{result.documents_processed} document(s) processed</li>
                <li>{result.scope_items_created} scope items created</li>
                <li>{result.property_fields_updated.length} property fields populated{result.property_fields_updated.length > 0 ? `: ${result.property_fields_updated.join(", ")}` : ""}</li>
              </ul>
              {result.warnings.length > 0 && (
                <details className="mt-2 text-xs text-amber-800">
                  <summary>{result.warnings.length} warning(s)</summary>
                  <ul className="mt-1 list-disc list-inside">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 text-sm bg-red-50 text-red-800 border border-red-200 rounded">{error}</div>
          )}
        </div>
      )}

      {showVersionPicker && (
        <ExtractVersionPicker
          onCancel={() => setShowVersionPicker(false)}
          onConfirm={runExtract}
        />
      )}
    </div>
  );
}


// ─── Extract-version picker (modal shown before extraction runs) ─────────
function ExtractVersionPicker({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (g: ExtractionGranularity) => void;
}) {
  const [choice, setChoice] = useState<ExtractionGranularity>("standard");

  const VERSIONS: {
    key: ExtractionGranularity;
    title: string;
    subtitle: string;
    description: string;
    expectedCount: string;
  }[] = [
    {
      key: "compact",
      title: "Version 1 · Compact",
      subtitle: "General areas",
      description:
        "One line per major area as laid out in the PIP — Lobby, Guestroom, Guestroom Bathroom, Ballroom, etc. Each row's description lists the sub-requirements that roll up into it. Best for high-level budgets or feasibility estimates.",
      expectedCount: "~15–30 rows",
    },
    {
      key: "standard",
      title: "Version 2 · Standard",
      subtitle: "Current extraction layout",
      description:
        "One line per distinct PIP requirement. The default format — balances completeness with row-count. Matches how most IC and design teams review PIPs.",
      expectedCount: "~40–80 rows",
    },
    {
      key: "detailed",
      title: "Version 3 · Detailed",
      subtitle: "Every specific component",
      description:
        "Breaks every package directive into individual components — carpet, drapery, headboard, nightstand, lamps, etc. each get their own row. Best for buyers pricing line-by-line or for tight-spec procurement.",
      expectedCount: "~80–250+ rows",
    },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-gencom-sand">
          <div className="font-display text-xl">Choose a budgeting version</div>
          <div className="text-xs text-gencom-stone mt-0.5">
            Pick how much detail you want in the scope before Claude reads the PIP.
            Nothing is autofilled until you confirm.
          </div>
        </div>

        <div className="p-4 space-y-2">
          {VERSIONS.map((v) => {
            const selected = choice === v.key;
            return (
              <label
                key={v.key}
                className={`block border rounded-md p-3 cursor-pointer transition ${
                  selected
                    ? "border-emerald-700 bg-emerald-50/40 ring-1 ring-emerald-700/30"
                    : "border-gencom-sand hover:border-emerald-700/50 hover:bg-gencom-mist/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="extract-version"
                    checked={selected}
                    onChange={() => setChoice(v.key)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{v.title}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gencom-mist text-gencom-stone">
                        {v.subtitle}
                      </span>
                      <span className="text-[11px] text-gencom-stone ml-auto font-mono">
                        {v.expectedCount}
                      </span>
                    </div>
                    <div className="text-xs text-gencom-stone mt-1 leading-relaxed">
                      {v.description}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gencom-sand flex justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gencom-sand rounded-md hover:bg-gencom-mist/60"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(choice)}
            className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded-md font-semibold hover:bg-emerald-800"
          >
            Extract with this version →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function ExtractionProgress({
  phaseIdx, phases, elapsedMs, docCount,
}: {
  phaseIdx: number;
  phases: readonly string[];
  elapsedMs: number;
  docCount: number;
}) {
  // Rough typical time on Sonnet 4.6: ~25s per doc for metadata + scope pair
  // of Claude calls at 32k tokens, plus ~15s for consolidation. Opus 4.7 runs
  // roughly 2× slower — if that's the configured model, the bar will sit at
  // 95% while the real response finishes.
  const expectedSec = docCount * 25 + 15;
  // Phase-based progress estimate, capped at 95% so the bar never looks
  // "done" before the call actually returns. Blend in time-based progress
  // so the bar keeps moving during long phases (big PDFs sit on "Reading").
  const phaseProgress = (phaseIdx + 1) / phases.length;
  const timeProgress = Math.min(elapsedMs / (expectedSec * 1000), 0.95);
  const progress = Math.min(Math.max(phaseProgress, timeProgress), 0.95);

  return (
    <div className="mb-3 bg-gencom-mist/50 border border-gencom-sand rounded-md p-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <div className="text-gencom-ink font-medium">
          {phases[phaseIdx]}
        </div>
        <div className="font-mono text-gencom-stone">
          {formatElapsed(elapsedMs)}
          {" "}
          <span className="text-gencom-stone/70">
            / ~{Math.floor(expectedSec / 60)}:{(expectedSec % 60).toString().padStart(2, "0")} expected
          </span>
        </div>
      </div>
      <div className="h-2 bg-white border border-gencom-sand rounded overflow-hidden">
        <div
          className="h-full bg-emerald-600 transition-all duration-500 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="text-[10px] text-gencom-stone mt-1.5">
        Streaming Claude's response. A 14-page PIP usually takes ~1 min on Sonnet 4.6, ~3 min on Opus 4.7.
        {elapsedMs > expectedSec * 1000 + 30_000 && (
          <span className="ml-1 text-amber-700">Taking longer than expected — still running, not stuck.</span>
        )}
      </div>
    </div>
  );
}


// ─── Preview review UI ──────────────────────────────────────────────────
type PreviewItem = ScopeSuggestion & { _id: string; _include: boolean };

function PreviewReview({
  propertyId, property, preview, items, onPatch, onReplace, onImport, onCancel, importing,
}: {
  propertyId: string;
  property: Property | null;
  preview: ExtractionPreviewResult;
  items: PreviewItem[];
  onPatch: (id: string, patch: Partial<ScopeSuggestion & { _include: boolean }>) => void;
  onReplace: (id: string, newItems: ScopeSuggestion[]) => void;
  onImport: () => void;
  onCancel: () => void;
  importing: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showQuestions, setShowQuestions] = useState(false);
  const [breakdownState, setBreakdownState] = useState<null | {
    itemId: string;
    sourceLabel: string;
    loading: boolean;
    suggestions: BreakdownSuggestion[];
    accepted: Set<number>;
    error: string | null;
  }>(null);

  async function openBreakdown(it: PreviewItem) {
    setBreakdownState({
      itemId: it._id,
      sourceLabel: it.line_item,
      loading: true,
      suggestions: [],
      accepted: new Set(),
      error: null,
    });
    try {
      const { suggestions } = await api.scopeBreakdownPreview(propertyId, {
        label: it.line_item,
        description: it.description ?? undefined,
        division: it.division,
        source: it.source,
      });
      setBreakdownState((b) => b ? {
        ...b,
        loading: false,
        suggestions,
        accepted: new Set(suggestions.map((_, i) => i)),
      } : null);
    } catch (e) {
      setBreakdownState((b) => b ? { ...b, loading: false, error: String(e) } : null);
    }
  }

  // "+ Add Scope" — anchors on the row's PIP narrative description instead
  // of the short line-item label. Surfaces every distinct requirement in
  // that paragraph as its own suggestion. Same modal + onReplace flow as
  // the AI-breakdown button.
  async function openAddScope(it: PreviewItem) {
    const desc = (it.description ?? "").trim();
    if (!desc) return; // Guarded by render-time check too.
    setBreakdownState({
      itemId: it._id,
      sourceLabel: it.line_item,
      loading: true,
      suggestions: [],
      accepted: new Set(),
      error: null,
    });
    try {
      const { suggestions } = await api.scopeAddFromDescription(propertyId, {
        description: desc,
        label: it.line_item,
        division: it.division,
        source: it.source,
      });
      setBreakdownState((b) => b ? {
        ...b,
        loading: false,
        suggestions,
        accepted: new Set(suggestions.map((_, i) => i)),
      } : null);
    } catch (e) {
      setBreakdownState((b) => b ? { ...b, loading: false, error: String(e) } : null);
    }
  }

  function confirmBreakdown() {
    if (!breakdownState) return;
    const chosen = breakdownState.suggestions
      .filter((_, i) => breakdownState.accepted.has(i))
      .map<ScopeSuggestion>((s) => ({
        division: s.division,
        line_item: s.label,
        description: s.description ?? null,
        quantity: s.quantity,
        unit: s.unit,
        multiplier_basis: s.multiplier_basis ?? null,
        priority: s.priority ?? "required",
        confidence: "medium",
        source: "pip",
      }));
    if (chosen.length === 0) {
      setBreakdownState(null);
      return;
    }
    onReplace(breakdownState.itemId, chosen);
    setBreakdownState(null);
  }

  const byDivision = useMemo(() => {
    const m: Record<string, PreviewItem[]> = {};
    for (const it of items) (m[it.division] ||= []).push(it);
    return m;
  }, [items]);

  const includedCount = items.filter((i) => i._include).length;
  const unclear = items.filter(
    (i) => i._include && (i.confidence === "low" || (!i.source_excerpt && i.source !== "manual"))
  );

  function setDivisionInclude(div: string, on: boolean) {
    for (const it of byDivision[div] ?? []) onPatch(it._id, { _include: on });
  }

  return (
    <div className="bg-amber-50/60 border border-amber-400 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-display text-lg">Review extracted scope — approve before import</div>
          <div className="text-xs text-gencom-stone">
            {preview.documents_processed} doc{preview.documents_processed !== 1 ? "s" : ""} ·
            {" "}<b>{items.length}</b> items extracted ·
            {" "}<b>{includedCount}</b> selected for import
          </div>
          {preview.property_fields_updated.length > 0 && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-600/30 rounded px-2 py-1 mt-1.5">
              <b>✓ {preview.property_fields_updated.length} property field{preview.property_fields_updated.length !== 1 ? "s" : ""} auto-populated from the PIP:</b>
              {" "}{preview.property_fields_updated.map((f) => f.replace(/_/g, " ")).join(", ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs border border-gencom-sand rounded-md hover:bg-white"
          >
            Discard
          </button>
          <button
            onClick={onImport}
            disabled={importing || includedCount === 0}
            className="px-4 py-1.5 text-xs bg-emerald-700 text-white rounded-md font-semibold hover:bg-emerald-800 disabled:opacity-50"
          >
            {importing ? "Importing…" : `Import ${includedCount} item${includedCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {unclear.length > 0 && (
        <div className="mb-2 text-xs border border-amber-400/60 bg-white rounded p-2">
          <button
            onClick={() => setShowQuestions((v) => !v)}
            className="font-medium text-amber-800 hover:underline"
          >
            {showQuestions ? "▾" : "▸"} {unclear.length} item{unclear.length !== 1 ? "s" : ""} flagged as unclear — click to review
          </button>
          {showQuestions && (
            <div className="mt-2 space-y-2 text-gencom-ink">
              {unclear.map((u) => (
                <div key={u._id} className="flex items-start gap-2 pl-2 border-l-2 border-amber-400 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{u.line_item}</div>
                    <div className="text-[11px] text-gencom-stone">
                      {u.division}
                      {u.sub_area ? ` · ${u.sub_area}` : ""}
                      {" · "}conf {u.confidence ?? "?"}
                      {!u.source_excerpt && " · no source excerpt"}
                    </div>
                    {u.description && (
                      <div className="text-[11px] text-gencom-stone mt-0.5 line-clamp-2">{u.description}</div>
                    )}
                    <div className="text-[10px] italic text-gencom-stone mt-0.5">
                      💬 Chat has full context on these items — ask away.
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => onPatch(u._id, { _include: true })}
                      className={`text-[10px] px-2 py-0.5 rounded border whitespace-nowrap ${
                        u._include
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                          : "border-gencom-sand text-gencom-stone hover:border-emerald-700 hover:text-emerald-700"
                      }`}
                      title="Keep this item — will be created on import"
                    >
                      {u._include ? "✓ will import" : "+ add"}
                    </button>
                    <button
                      onClick={() => {
                        // Scroll the main preview row into view so inline fields
                        // are editable. Each section div has an anchor id set
                        // below on the preview row itself.
                        const el = document.getElementById(`preview-row-${u._id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          el.classList.add("ring-2", "ring-emerald-500");
                          setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 2500);
                        }
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-gencom-sand text-gencom-stone hover:border-gencom-ink hover:text-gencom-ink whitespace-nowrap"
                      title="Jump to this item in the main preview list to edit"
                    >
                      ✎ edit
                    </button>
                    <button
                      onClick={() => onPatch(u._id, { _include: false })}
                      className={`text-[10px] px-2 py-0.5 rounded border whitespace-nowrap ${
                        !u._include
                          ? "border-red-400 bg-red-50 text-red-700"
                          : "border-gencom-sand text-gencom-stone hover:border-red-400 hover:text-red-700"
                      }`}
                      title="Skip this item on import (just this one — can re-enable via the checkbox in the main list)"
                    >
                      {!u._include ? "✗ skipping" : "× skip"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {Object.entries(byDivision).sort().map(([div, list]) => {
          const isOpen = expanded[div] ?? true;
          const onCount = list.filter((i) => i._include).length;
          return (
            <div key={div} className="bg-white border border-gencom-sand rounded-md">
              {/* Click ANYWHERE on the header to toggle expand/collapse; the
                  checkbox stops propagation so it can still select-all rows
                  without collapsing the section. */}
              <div
                onClick={() => setExpanded((e) => ({ ...e, [div]: !isOpen }))}
                role="button"
                aria-expanded={isOpen}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-gencom-mist/40 transition-colors ${
                  isOpen ? "border-b border-gencom-sand" : ""
                }`}
              >
                <span className="text-gencom-stone w-5" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
                <input
                  type="checkbox"
                  checked={onCount === list.length}
                  ref={(el) => {
                    if (el) el.indeterminate = onCount > 0 && onCount < list.length;
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDivisionInclude(div, e.target.checked)}
                />
                <div className="font-medium">{div}</div>
                <div className="text-xs text-gencom-stone ml-auto">
                  {onCount}/{list.length} selected
                </div>
              </div>
              {isOpen && (
                <div className="divide-y divide-gencom-sand/60">
                  {list.map((it) => (
                    <PreviewRow
                      key={it._id}
                      item={it}
                      onPatch={onPatch}
                      onBreakdown={() => openBreakdown(it)}
                      onAddScope={() => openAddScope(it)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {preview.warnings.length > 0 && (
        <details className="mt-2 text-xs text-amber-800">
          <summary>{preview.warnings.length} extraction warning(s)</summary>
          <ul className="mt-1 list-disc list-inside">
            {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      {breakdownState && (
        <BreakdownPreviewModal
          state={breakdownState}
          onToggle={(idx) => setBreakdownState((b) => {
            if (!b) return b;
            const next = new Set(b.accepted);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return { ...b, accepted: next };
          })}
          onConfirm={confirmBreakdown}
          onCancel={() => setBreakdownState(null)}
        />
      )}
    </div>
  );
}

function BreakdownPreviewModal({
  state, onToggle, onConfirm, onCancel,
}: {
  state: { itemId: string; sourceLabel: string; loading: boolean; suggestions: BreakdownSuggestion[]; accepted: Set<number>; error: string | null };
  onToggle: (idx: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gencom-sand">
          <div className="font-display text-xl">Break this line into specific items</div>
          <div className="text-xs text-gencom-stone mt-0.5">
            Replacing (in preview): <b>{state.sourceLabel}</b>
          </div>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {state.loading && <div className="text-sm text-gencom-stone">Asking Claude…</div>}
          {state.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{state.error}</div>}
          {!state.loading && !state.error && state.suggestions.length === 0 && (
            <div className="text-sm text-gencom-stone">Claude returned no suggestions.</div>
          )}
          {!state.loading && state.suggestions.length > 0 && (
            <>
              <div className="text-xs text-gencom-stone mb-3">
                {state.accepted.size} of {state.suggestions.length} selected. Uncheck items you don't want.
              </div>
              <div className="space-y-2">
                {state.suggestions.map((s, idx) => {
                  const checked = state.accepted.has(idx);
                  return (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition ${
                        checked ? "border-emerald-700 bg-emerald-50/40" : "border-gencom-sand hover:border-gencom-stone/50"
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => onToggle(idx)} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{s.label}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gencom-mist text-gencom-stone">{s.division}</span>
                          {s.priority && s.priority !== "na" && <span className="text-[11px] text-gencom-stone">{s.priority}</span>}
                        </div>
                        {s.description && <div className="text-xs text-gencom-stone mt-0.5">{s.description}</div>}
                        <div className="text-[11px] text-gencom-stone mt-1 font-mono">
                          {s.quantity} {s.unit}
                          {s.multiplier_basis && <span> · × {s.multiplier_basis}</span>}
                        </div>
                        {s.rationale && <div className="text-[11px] italic text-gencom-stone/80 mt-1">{s.rationale}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gencom-sand flex justify-between gap-3">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gencom-sand rounded-md hover:bg-gencom-mist/60">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={state.loading || state.accepted.size === 0}
            className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
          >
            Replace with {state.accepted.size} item{state.accepted.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_UNITS = [
  "each", "sf", "sy", "lf", "rooms", "floors", "ls", "allowance", "lot",
  "per key", "% of keys", "doubles only", "suites only",
];

// Divisions the preview row offers when the user wants to move an imported
// item to a different category. Order matches the Excel export sections.
const PREVIEW_DIVISIONS = [
  "DEFERRED MAINTENANCE",
  "COMMON AREA",
  "MEETING SPACE",
  "F&B",
  "CORRIDORS",
  "GUESTROOMS",
  "SUITES",
  "SIGNATURE SUITES",
  "MISC. ITEMS",
];

const BASIS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "× 1 (none)" },
  { value: "keys", label: "× keys" },
  { value: "keys_pct", label: "% of keys" },
  { value: "doubles", label: "× doubles" },
  { value: "suites", label: "× suites" },
  { value: "floors", label: "× floors" },
];

function PreviewRow({
  item, onPatch, onBreakdown, onAddScope,
}: {
  item: PreviewItem;
  onPatch: (id: string, patch: Partial<ScopeSuggestion & { _include: boolean }>) => void;
  onBreakdown: () => void;
  onAddScope: () => void;
}) {
  const descRef = (item.description ?? "");
  // Heuristic: highlight the "break down" button for descriptions that look
  // like compound scope (contain "including", commas/semicolons separating
  // noun phrases, or "and … and"). Button is always available.
  const looksCompound =
    /including|,.*,.*(,|and)|;|\band\b.*\band\b/i.test(descRef) ||
    (descRef.length > 120 && /,/.test(descRef));
  // Only show "+ Add Scope" when there's actual narrative text to work from.
  const hasDescription = descRef.trim().length > 0;

  return (
    <div id={`preview-row-${item._id}`} className={`p-2 transition-[box-shadow] ${item._include ? "" : "opacity-50"}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={item._include}
          onChange={(e) => onPatch(item._id, { _include: e.target.checked })}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <input
              type="text"
              value={item.line_item}
              onChange={(e) => onPatch(item._id, { line_item: e.target.value })}
              className="flex-1 min-w-[140px] text-sm font-medium bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1"
            />
            {/* Category + sub-area dropdowns — moved up next to the line-item
                label so the user can re-classify without scrolling. */}
            <select
              value={item.division}
              onChange={(e) => {
                const newDiv = e.target.value;
                // If the current sub-area doesn't exist under the new division,
                // clear it so the user can pick a fresh one.
                const validSubs = subAreasForDivision(newDiv);
                const keepSub = item.sub_area && validSubs.includes(item.sub_area)
                  ? item.sub_area : null;
                onPatch(item._id, { division: newDiv, sub_area: keepSub });
              }}
              className="shrink-0 text-[10px] px-1 py-0.5 border border-gencom-sand rounded uppercase tracking-wide bg-white"
              title="Move this item to a different category"
            >
              {PREVIEW_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              {!PREVIEW_DIVISIONS.includes(item.division) && (
                <option value={item.division}>{item.division}</option>
              )}
            </select>
            <select
              value={item.sub_area ?? ""}
              onChange={(e) => onPatch(item._id, { sub_area: e.target.value || null })}
              className={`shrink-0 text-[10px] px-1 py-0.5 border rounded ${
                item.sub_area
                  ? "border-emerald-700/60 bg-emerald-50/60 text-emerald-800"
                  : "border-gencom-sand bg-white text-gencom-stone"
              }`}
              title="Sub-area (Claude suggested this — edit if needed)"
            >
              <option value="">↳ sub-area</option>
              {subAreaGroupsForDivision(item.division).map((g, i) => (
                g.label ? (
                  <optgroup key={`g${i}`} label={g.label}>
                    <option value={g.label}>{g.label}</option>
                    {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </optgroup>
                ) : (
                  g.options.map((o) => <option key={o} value={o}>{o}</option>)
                )
              ))}
              {item.sub_area && !subAreasForDivision(item.division).includes(item.sub_area) && (
                <option value={item.sub_area}>{item.sub_area}</option>
              )}
            </select>
            <button
              onClick={onBreakdown}
              title={looksCompound
                ? "This description looks like a compound scope. Click to break it down into individual items."
                : "Break this into more specific items with AI"}
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                looksCompound
                  ? "border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-gencom-sand text-gencom-stone hover:border-emerald-700 hover:text-emerald-700"
              }`}
            >
              🪄 AI break down
            </button>
            {hasDescription && (
              <button
                onClick={onAddScope}
                title="Read the PIP narrative below and pull every distinct scope line it calls for."
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              >
                + Add Scope
              </button>
            )}
          </div>
          <textarea
            value={item.description ?? ""}
            onChange={(e) => onPatch(item._id, { description: e.target.value })}
            placeholder="Description / context…"
            rows={1}
            className="w-full text-xs text-gencom-stone bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 mt-0.5 resize-none"
          />
          {item.source_excerpt && (
            <div className="mt-0.5 text-[11px] italic text-gencom-stone border-l-2 border-gencom-sand pl-2">
              "{item.source_excerpt}"
              {item.source_document_filename && (
                <span className="text-gencom-stone/70"> — {item.source_document_filename}{item.source_page ? ` p.${item.source_page}` : ""}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            step="any"
            value={item.quantity ?? ""}
            onChange={(e) => onPatch(item._id, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
            className="w-16 text-right text-sm font-mono border border-gencom-sand rounded px-1 py-0.5"
          />
          {item.multiplier_basis === "keys_pct" && <span className="text-xs text-gencom-stone">%</span>}
          <select
            value={item.unit ?? "each"}
            onChange={(e) => onPatch(item._id, { unit: e.target.value })}
            className="text-xs border border-gencom-sand rounded px-1 py-0.5 w-24"
          >
            {PREVIEW_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select
            value={item.multiplier_basis ?? ""}
            onChange={(e) => onPatch(item._id, { multiplier_basis: (e.target.value || null) as ScopeSuggestion["multiplier_basis"] })}
            className="text-xs border border-gencom-sand rounded px-1 py-0.5 w-28"
            title="Multiplier basis"
          >
            {BASIS_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select
            value={item.priority ?? "required"}
            onChange={(e) => onPatch(item._id, { priority: e.target.value as ScopeSuggestion["priority"] })}
            className="text-xs border border-gencom-sand rounded px-1 py-0.5 w-24"
          >
            {["required", "recommended", "optional", "na"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
