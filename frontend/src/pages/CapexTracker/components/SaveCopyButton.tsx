import { useState } from "react";

import { capexApi } from "../lib/capexApi";

type Kind = "invoice" | "contract" | "budget";

/** Detect Chrome/Edge desktop's File System Access API. Other browsers
 *  (Firefox, Safari) get the button hidden — the user said they're on
 *  Chrome but I'd rather no-op silently than show a broken control. */
function pickerSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

function extensionOf(name: string | undefined): string {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

/** Post-parse "Save a copy" action — opens a native Save As dialog with
 *  an AI-suggested filename built from prior saves of the same kind, then
 *  records what the user actually chose so the next suggestion follows
 *  their evolving naming convention. */
export function SaveCopyButton({
  file,
  kind,
  metadata,
  className,
}: {
  file: File | null;
  kind: Kind;
  metadata: Record<string, unknown>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pickerSupported() || !file) return null;

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSavedAs(null);
    try {
      const ext = extensionOf(file.name);
      // 1. Ask the backend for a name. AI follows the pattern from prior
      //    Save-As'd filenames of this kind.
      const { filename } = await capexApi.filenameSuggest(kind, metadata, ext);

      // 2. Native Save As dialog. The user can edit the name and pick
      //    any folder — Box, Desktop, anywhere they have write access.
      const handle = await (window as unknown as {
        showSaveFilePicker: (opts: {
          suggestedName?: string;
          types?: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: filename,
        types: ext
          ? [
              {
                description: kind.charAt(0).toUpperCase() + kind.slice(1),
                accept: { [file.type || "application/octet-stream"]: [ext] },
              },
            ]
          : undefined,
      });

      // 3. Write the file bytes.
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();

      // 4. Record the chosen filename so the next suggest call learns from it.
      const finalName = handle.name || filename;
      try {
        await capexApi.filenameRecord(kind, finalName, metadata);
      } catch {
        /* recording is best-effort; don't interrupt the success state */
      }

      setSavedAs(finalName);
    } catch (e) {
      // AbortError is the user closing the picker — silent dismiss.
      if ((e as DOMException)?.name === "AbortError") return;
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="text-xs h-9 px-3 rounded-md border border-gencom-gold bg-gencom-gold/10 text-gencom-ink font-semibold hover:bg-gencom-gold/20 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
        title="Save a copy of the original file to a folder of your choice (Box, Desktop, anywhere)."
      >
        <span aria-hidden>💾</span>
        {busy ? "Saving…" : savedAs ? "Saved ✓" : "Save a copy"}
      </button>
      {savedAs && (
        <div className="mt-1 text-[11px] text-gencom-green truncate" title={savedAs}>
          Saved as {savedAs}
        </div>
      )}
      {error && (
        <div className="mt-1 text-[11px] text-red-700 truncate" title={error}>
          {error}
        </div>
      )}
    </div>
  );
}
