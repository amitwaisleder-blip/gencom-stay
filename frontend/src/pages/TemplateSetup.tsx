import { useEffect, useState } from "react";
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
    <div>
      <h1 className="font-display text-3xl mb-2">Template setup</h1>
      <p className="text-gencom-stone mb-6 max-w-2xl">
        The app reads your Gencom Excel budget template to learn its division structure. Upload it here; the app
        will detect divisions automatically and ask you to confirm the mapping.
      </p>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 text-sm text-red-800 rounded">{error}</div>
      )}

      <div className="mb-6 bg-white border border-gencom-sand rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">
              {scan?.found ? "Template loaded" : "No template uploaded yet"}
            </div>
            {scan?.path && <div className="text-xs text-gencom-stone">{scan.path}</div>}
          </div>
          <label className="bg-gencom-ink text-gencom-mist px-4 py-2 rounded-md text-sm cursor-pointer hover:bg-gencom-ink/90">
            {uploading ? "Uploading…" : scan?.found ? "Replace template" : "Upload template"}
            <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {scan?.found && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-2xl">Detected divisions</h2>
            <button
              onClick={confirmMap}
              className="bg-gencom-gold text-white px-4 py-2 rounded-md text-sm hover:bg-gencom-gold/90"
            >
              {mapSaved ? "Re-confirm mapping" : "Confirm mapping"}
            </button>
          </div>
          {scan.divisions.length === 0 ? (
            <div className="text-sm text-gencom-stone bg-white border border-dashed border-gencom-sand rounded-lg p-6">
              No divisions auto-detected. Division detection looks for <b>bold</b> cells in column A of the first sheet.
              You can still upload a template and use it, but extraction mapping may require manual editing of
              <code className="mx-1 text-xs">backend/template_map.json</code>.
            </div>
          ) : (
            <ul className="bg-white border border-gencom-sand rounded-lg divide-y divide-gencom-sand">
              {scan.divisions.map((d, i) => (
                <li key={i} className="p-3 flex items-center justify-between text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-xs text-gencom-stone">
                    {d.sheet} · row {d.row}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-gencom-stone">All sheets in this template ({scan.sheets.length})</summary>
            <div className="mt-2 bg-white border border-gencom-sand rounded-lg p-4 space-y-2">
              {scan.sheets.map((s) => (
                <div key={s.name}>
                  <div className="font-medium">{s.name}</div>
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
