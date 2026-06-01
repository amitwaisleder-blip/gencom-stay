import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import { api, type DocumentRow, type DocumentType, type ExtractionResult } from "../lib/api";

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "pip", label: "PIP" },
  { value: "om", label: "OM" },
  { value: "brochure", label: "Brochure" },
  { value: "walk_notes", label: "Walk notes" },
  { value: "walk_photo", label: "Walk photo" },
  { value: "other", label: "Other" },
];

const PHASES = [
  "Uploading files…",
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

export default function UploadExtract() {
  const { id: propertyId } = useParams<{ id: string }>();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [pendingTypes, setPendingTypes] = useState<Record<string, DocumentType>>({});
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh() {
    if (!propertyId) return;
    const rows = await api.listDocuments(propertyId);
    setDocs(rows);
  }

  useEffect(() => { refresh(); }, [propertyId]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }

  function addFiles(files: File[]) {
    setPending((p) => [...p, ...files]);
    setPendingTypes((t) => {
      const next = { ...t };
      for (const f of files) next[f.name] = guessType(f.name);
      return next;
    });
  }

  async function doUpload() {
    if (!propertyId || pending.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocuments(propertyId, pending, pendingTypes);
      setPending([]);
      setPendingTypes({});
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function doExtract() {
    if (!propertyId) return;
    setExtracting(true);
    setError(null);
    setResult(null);
    // Rotate the phase text while extraction runs. Stops when the call returns.
    setPhaseIdx(0);
    const phaseTimer = setInterval(() => setPhaseIdx((i) => Math.min(i + 1, PHASES.length - 1)), 8000);
    try {
      const r = await api.runExtraction(propertyId);
      setResult(r);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      clearInterval(phaseTimer);
      setExtracting(false);
    }
  }

  if (!propertyId) return null;

  return (
    <div>
      <div className="mb-3 text-sm text-gencom-stone">
        <Link to="/projects" className="hover:text-gencom-ink">Projects</Link> / Upload & Extract
      </div>
      <PropertyNav />
      <h1 className="font-display text-3xl mb-6">Upload documents</h1>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="mb-4 p-12 border-2 border-dashed border-gencom-sand rounded-lg text-center bg-white"
      >
        <div className="font-display text-lg mb-1">Drop your PIP, OM, walk notes, and photos here</div>
        <div className="text-sm text-gencom-stone mb-3">or</div>
        <label className="px-4 py-2 bg-gencom-ink text-gencom-mist rounded-md cursor-pointer hover:bg-gencom-ink/90">
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

      {pending.length > 0 && (
        <div className="mb-4 bg-white border border-gencom-sand rounded-lg p-4">
          <div className="font-medium mb-2">Pending upload ({pending.length})</div>
          <div className="space-y-2 text-sm">
            {pending.map((f) => (
              <div key={f.name} className="flex items-center gap-3">
                <div className="flex-1 truncate">{f.name}</div>
                <select
                  value={pendingTypes[f.name]}
                  onChange={(e) => setPendingTypes({ ...pendingTypes, [f.name]: e.target.value as DocumentType })}
                  className="border border-gencom-sand rounded px-2 py-1 text-xs"
                >
                  {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button
                  onClick={() => { setPending(pending.filter((x) => x !== f)); }}
                  className="text-gencom-stone hover:text-red-700"
                >×</button>
              </div>
            ))}
          </div>
          <button
            onClick={doUpload}
            disabled={uploading}
            className="mt-3 px-4 py-2 bg-gencom-gold text-white rounded-md hover:bg-gencom-gold/90 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      )}

      {docs.length > 0 && (
        <div className="mb-4 bg-white border border-gencom-sand rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Uploaded ({docs.length})</div>
            <button
              onClick={doExtract}
              disabled={extracting || docs.length === 0}
              className="px-4 py-2 bg-gencom-ink text-gencom-mist rounded-md hover:bg-gencom-ink/90 disabled:opacity-50"
            >
              {extracting ? PHASES[phaseIdx] : "Extract"}
            </button>
          </div>
          <div className="space-y-1 text-sm">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-1 border-b border-gencom-sand/50 last:border-0">
                <div>
                  <span className="font-medium">{d.filename}</span>
                  <span className="ml-2 text-xs text-gencom-stone">{d.document_type.toUpperCase()}{d.page_count ? ` · ${d.page_count}p` : ""}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  d.extraction_status === "complete" ? "bg-green-100 text-green-800" :
                  d.extraction_status === "running" ? "bg-gencom-gold/20" :
                  d.extraction_status === "failed" ? "bg-red-100 text-red-800" :
                  "bg-gencom-sand"
                }`}>{d.extraction_status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="mb-4 bg-white border border-gencom-gold rounded-lg p-5">
          <div className="font-display text-xl mb-2">Extraction complete ✓</div>
          <ul className="text-sm space-y-1 mb-3">
            <li>{result.documents_processed} documents processed in {result.duration_seconds.toFixed(1)}s</li>
            <li>{result.scope_items_created} scope items created</li>
            <li>{result.property_fields_updated.length} property fields populated: {result.property_fields_updated.join(", ") || "(none)"}</li>
          </ul>
          {result.warnings.length > 0 && (
            <details className="text-xs text-amber-800">
              <summary>{result.warnings.length} warnings</summary>
              <ul className="mt-1 list-disc list-inside">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigate(`/properties/${propertyId}/scope`)}
              className="px-4 py-2 bg-gencom-ink text-gencom-mist rounded-md"
            >
              Review scope →
            </button>
            <button
              onClick={() => navigate(`/properties/${propertyId}/setup`)}
              className="px-4 py-2 border border-gencom-sand rounded-md hover:bg-white"
            >
              Review property info
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 text-sm bg-red-50 text-red-800 border border-red-200 rounded">
          {error}
        </div>
      )}
    </div>
  );
}
