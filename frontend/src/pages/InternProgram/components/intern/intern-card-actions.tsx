// Per-card actions on the Interns landing page: upload / replace / view /
// delete the intern's resume PDF, and delete the intern. Uses the
// localStorage-backed InternStore via the action wrappers — no fetch.
// The resume file is held inline as a base64 data URL on the intern
// record, so it survives reloads without needing a server route.

import { useRef, useState } from "react";
import { FileText, FileUp, FileX, Trash2 } from "lucide-react";

import { deleteInternAction, setResumeFileAction } from "../../app/actions";
import type { Intern } from "../../data";

const ACCEPT = ".pdf,.docx,.doc";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — keeps localStorage from blowing up.

export function InternCardActions({
  internId,
  internName,
  resumeFile,
  onChanged,
}: {
  internId: string;
  internName: string;
  resumeFile?: Intern["resumeFile"];
  onChanged?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"upload" | "delete-resume" | "delete-intern" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function stop(e: React.MouseEvent | React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error || new Error("Failed to read file"));
      r.readAsDataURL(file);
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 5 MB).`);
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const url = await readAsDataUrl(file);
      await setResumeFileAction(internId, {
        url,
        name: file.name,
        uploadedAt: new Date().toISOString(),
      });
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteResume(e: React.MouseEvent) {
    stop(e);
    if (!resumeFile) return;
    const ok = window.confirm(
      `Remove ${internName}'s resume "${resumeFile.name}"?`,
    );
    if (!ok) return;
    setBusy("delete-resume");
    setError(null);
    try {
      await setResumeFileAction(internId, null);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteIntern(e: React.MouseEvent) {
    stop(e);
    const ok = window.confirm(
      `Delete ${internName}? This permanently removes their dashboard, deliverables, goals, kudos, schedule, and feedback.`,
    );
    if (!ok) return;
    setBusy("delete-intern");
    setError(null);
    try {
      await deleteInternAction(internId);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1" onClick={stop}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      {resumeFile && (
        <a
          href={resumeFile.url}
          target="_blank"
          rel="noreferrer"
          download={resumeFile.name}
          onClick={stop}
          aria-label={`View resume for ${internName}`}
          title={resumeFile.name}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <FileText className="h-4 w-4" />
        </a>
      )}
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          fileInputRef.current?.click();
        }}
        disabled={busy !== null}
        aria-label={resumeFile ? `Replace resume for ${internName}` : `Upload resume for ${internName}`}
        title={resumeFile ? "Replace resume…" : "Upload resume…"}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <FileUp className="h-4 w-4" />
      </button>
      {resumeFile && (
        <button
          type="button"
          onClick={handleDeleteResume}
          disabled={busy !== null}
          aria-label={`Delete resume for ${internName}`}
          title="Delete resume"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          <FileX className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={handleDeleteIntern}
        disabled={busy !== null}
        aria-label={`Delete ${internName}`}
        title="Delete intern"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {busy === "upload" && (
        <span className="ml-1 text-[11px] text-muted-foreground">Uploading…</span>
      )}
      {busy === "delete-resume" && (
        <span className="ml-1 text-[11px] text-muted-foreground">Removing…</span>
      )}
      {busy === "delete-intern" && (
        <span className="ml-1 text-[11px] text-muted-foreground">Deleting…</span>
      )}
      {error && (
        <span className="ml-1 text-[11px] text-destructive truncate max-w-[160px]" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
