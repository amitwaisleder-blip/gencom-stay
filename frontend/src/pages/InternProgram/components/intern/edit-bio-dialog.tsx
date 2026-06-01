"use client";

import { useRef, useState, type ReactNode } from "react";
import { FileText, FileUp, Trash2 } from "lucide-react";
import { useAsyncPending } from "@/lib/use-async-pending";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Intern, ResumeFile } from "@/data";
import { saveBioAction, setResumeFileAction } from "@/app/actions";

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export function EditBioDialog({ intern, children }: { intern: Intern; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(intern.name);
  const [school, setSchool] = useState(intern.school);
  const [bio, setBio] = useState(intern.bio);
  const [start, setStart] = useState(intern.programStart);
  const [end, setEnd] = useState(intern.programEnd);
  const [resumeFile, setResumeFileLocal] = useState<ResumeFile | undefined>(intern.resumeFile);
  const [resumeBusy, setResumeBusy] = useState<"upload" | "delete" | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useAsyncPending();

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error || new Error("Failed to read file"));
      r.readAsDataURL(file);
    });
  }

  async function uploadResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > RESUME_MAX_BYTES) {
      setResumeError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 5 MB).`);
      return;
    }
    setResumeBusy("upload");
    setResumeError(null);
    try {
      const url = await readAsDataUrl(file);
      const meta: ResumeFile = { url, name: file.name, uploadedAt: new Date().toISOString() };
      await setResumeFileAction(intern.id, meta);
      setResumeFileLocal(meta);
    } catch (err) {
      setResumeError((err as Error).message);
    } finally {
      setResumeBusy(null);
    }
  }

  async function deleteResume() {
    if (!resumeFile) return;
    const ok = window.confirm(`Remove the resume "${resumeFile.name}"?`);
    if (!ok) return;
    setResumeBusy("delete");
    setResumeError(null);
    try {
      await setResumeFileAction(intern.id, null);
      setResumeFileLocal(undefined);
    } catch (err) {
      setResumeError((err as Error).message);
    } finally {
      setResumeBusy(null);
    }
  }

  function submit() {
    startTransition(async () => {
      await saveBioAction(intern.id, { name, school, bio, programStart: start, programEnd: end });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Top-of-page details. Resume sections are edited separately so each save stays scoped.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bio-name">Name</Label>
            <Input id="bio-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bio-school">School</Label>
            <Input id="bio-school" value={school} onChange={(e) => setSchool(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bio-start">Program start</Label>
              <Input id="bio-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bio-end">Program end</Label>
              <Input id="bio-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bio-bio">Short bio</Label>
            <Textarea
              id="bio-bio"
              rows={5}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="2–3 sentences. What you're studying, what kind of work you're drawn to."
            />
            <span className="text-[11px] text-muted-foreground">
              Reads on your profile and your end-of-program portfolio.
            </span>
          </div>

          {/* Resume on file — saved independently of the dialog's main
              "Save changes" button so resume swaps don't bundle with the
              rest of the bio edit. */}
          <div className="grid gap-1.5 pt-1 border-t">
            <Label className="mt-2">Resume on file</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              className="hidden"
              onChange={uploadResume}
            />
            {resumeFile ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <a
                  href={resumeFile.url}
                  target="_blank"
                  rel="noreferrer"
                  download={resumeFile.name}
                  className="flex-1 min-w-0 truncate text-[13px] hover:underline"
                  title={resumeFile.name}
                >
                  {resumeFile.name}
                </a>
                <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={resumeBusy !== null}>
                  <FileUp className="mr-1 h-3.5 w-3.5" /> Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deleteResume}
                  disabled={resumeBusy !== null}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">
                <FileUp className="h-4 w-4 shrink-0" />
                <span className="flex-1">No resume uploaded.</span>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={resumeBusy !== null}>
                  Upload…
                </Button>
              </div>
            )}
            {resumeBusy && (
              <span className="text-[11px] text-muted-foreground">
                {resumeBusy === "upload" ? "Uploading…" : "Removing…"}
              </span>
            )}
            {resumeError && <span className="text-[11px] text-destructive">{resumeError}</span>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !name.trim() || !bio.trim()}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
