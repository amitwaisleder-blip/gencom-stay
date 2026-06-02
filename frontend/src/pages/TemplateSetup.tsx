import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TemplateScan } from "../lib/api";

export default function TemplateSetup() {
  const [scan, setScan] = useState<TemplateScan | null>(null);
  const [mapSaved, setMapSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.scanTemplate().then(setScan).catch((e) => setError(String(e)));
    api.getTemplateMap().then((r) => setMapSaved(r.map != null));
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.uploadTemplate(file);
      setScan(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  async function confirmMap() {
    if (!scan) return;
    await api.saveTemplateMap({
      divisions: scan.divisions,
      confirmed_at: new Date().toISOString(),
    });
    setMapSaved(true);
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-1 text-sm text-gencom-stone">
        <Link to="/" className="hover:text-gencom-ink">Home</Link>
        {" / "}<span>Template Setup</span>
      </div>
      <h1 className="font-display text-2xl font-bold text-gencom-ink mb-2">Template setup</h1>
      <p className="text-gencom-stone mb-6 max-w-2xl">
        The app reads your Gencom Excel budget template to learn its division structure. Upload it here; the app
        will detect divisions automatically and ask you to confirm the mapping.
      </p>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 text-sm text-red-800 rounded-xl">{error}</div>
      )}

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-gencom-ink">
              {scan?.found ? "Template loaded" : "No template uploaded yet"}
            </div>
            {scan?.path && <div className="text-xs text-gencom-stone mt-0.5">{scan.path}</div>}
          </div>
          <label className="btn-primary cursor-pointer">
            {uploading ? "Uploading…" : scan?.found ? "Replace template" : "Upload template"}
            <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {scan?.found && (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold text-gencom-ink">Detected divisions</h2>
            <button onClick={confirmMap} className="btn-green">
              {mapSaved ? "Re-confirm mapping" : "Confirm mapping"}
            </button>
          </div>
          {scan.divisions.length === 0 ? (
            <div className="text-sm text-gencom-stone bg-white border border-dashed border-gencom-sand rounded-2xl p-6">
              No divisions auto-detected. Division detection looks for <b>bold</b> cells in column A of the first sheet.
              You can still upload a template and use it, but extraction mapping may require manual editing of
              <code className="mx-1 text-xs">backend/template_map.json</code>.
            </div>
          ) : (
            <ul className="card divide-y divide-gencom-sand overflow-hidden">
              {scan.divisions.map((d, i) => (
                <li key={i} className="p-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-gencom-ink">{d.name}</span>
                  <span className="text-xs text-gencom-stone">
                    {d.sheet} · row {d.row}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-gencom-stone hover:text-gencom-ink">All sheets in this template ({scan.sheets.length})</summary>
            <div className="card mt-2 p-4 space-y-2">
              {scan.sheets.map((s) => (
                <div key={s.name}>
                  <div className="font-medium text-gencom-ink">{s.name}</div>
                  <div className="text-xs text-gencom-stone">
                    {s.max_row} rows × {s.max_col} cols · {s.bold_rows.length} bold header rows
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
