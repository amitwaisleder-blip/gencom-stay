// Add-intern dialog. Opens from a header button or the empty-state on
// the Interns landing page. Creates an active intern with empty resume
// + skills; the user fills in details by clicking into the new card.

import { useRef, useState, type ReactNode } from "react";
import { FileText, Sparkles, UserPlus } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsyncPending } from "@/lib/use-async-pending";
import type { Education, Experience, Project, Resume, ResumeFile, ResumeLink } from "@/data";
import { getStore } from "@/data";

import { addInternAction } from "../../app/actions";

type ParseResponse = {
  name: string;
  school: string;
  bio: string;
  education: Array<Omit<Education, "id">>;
  experience: Array<Omit<Experience, "id">>;
  projects: Array<Omit<Project, "id">>;
  links: Array<Omit<ResumeLink, "id">>;
};

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusMonthsISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function AddInternDialog({
  children,
  onAdded,
}: {
  children?: ReactNode;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(plusMonthsISO(3));
  const [bio, setBio] = useState("");
  // Parsed resume — pre-filled by AI when the user uploads a file.
  // We attach it to the new intern on save.
  const [parsedResume, setParsedResume] = useState<Resume | null>(null);
  const [resumeFile, setResumeFile] = useState<ResumeFile | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseStats, setParseStats] = useState<{ educations: number; experiences: number; projects: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useAsyncPending();

  function reset() {
    setName("");
    setSchool("");
    setStart(todayISO());
    setEnd(plusMonthsISO(3));
    setBio("");
    setParsedResume(null);
    setResumeFile(null);
    setParseError(null);
    setParseStats(null);
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > RESUME_MAX_BYTES) {
      setParseError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 5 MB).`);
      return;
    }
    setParseBusy(true);
    setParseError(null);
    setParseStats(null);
    try {
      // Send the file to the backend for Claude to parse. The backend
      // is on the same origin in dev (Vite proxy → :8000); in embed
      // mode the proxy handles cross-origin too.
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/intern-program/parse-resume", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { detail?: string }).detail || `Parse failed (${res.status}).`);
      }
      const data = (await res.json()) as ParseResponse;

      // Pre-fill the simple fields if Claude found something.
      if (data.name) setName(data.name);
      if (data.school) setSchool(data.school);
      if (data.bio) setBio(data.bio);

      // Build the structured Resume with stable per-row IDs that match
      // the rest of the InternProgram's expectations.
      const resume: Resume = {
        education: data.education.map((e) => ({ ...e, id: newId("edu") })),
        experience: data.experience.map((e) => ({ ...e, id: newId("exp") })),
        projects: data.projects.map((p) => ({ ...p, id: newId("proj") })),
        links: data.links.map((l) => ({ ...l, id: newId("link") })),
      };
      setParsedResume(resume);
      setParseStats({
        educations: resume.education.length,
        experiences: resume.experience.length,
        projects: resume.projects.length,
      });

      // Also stash the original file as a base64 data URL so it shows
      // up under "Resume on file" on the new intern's card / profile.
      const dataUrl = await readAsDataUrl(file);
      setResumeFile({ url: dataUrl, name: file.name, uploadedAt: new Date().toISOString() });
    } catch (err) {
      setParseError((err as Error).message);
    } finally {
      setParseBusy(false);
    }
  }

  function submit() {
    startTransition(async () => {
      const intern = await addInternAction({
        name: name.trim(),
        school: school.trim(),
        programStart: start,
        programEnd: end,
        bio: bio.trim(),
        status: "active",
      });
      // The store's addIntern creates an empty resume + no file. If we
      // parsed something, attach it now via the same setters used by
      // the regular profile editors.
      const store = getStore();
      if (parsedResume) {
        await store.setResume(intern.id, parsedResume);
      }
      if (resumeFile) {
        await store.setResumeFile(intern.id, resumeFile);
      }
      onAdded?.();
      setOpen(false);
      reset();
    });
  }

  const trigger = children ?? (
    <Button>
      <UserPlus className="mr-1.5 h-4 w-4" />
      Add intern
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add an intern</DialogTitle>
          <DialogDescription>
            Just the basics — you can fill in resume, skills, schedule, and goals from the intern's profile after.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Optional resume upload — Claude parses + pre-fills the
              fields below. The file is also attached to the intern as
              "Resume on file" so it lives on after the dialog closes. */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-[13px] font-semibold">Have a resume? Upload it.</span>
            </div>
            <p className="text-[12px] text-muted-foreground mt-1">
              AI reads it and pre-fills the fields below — name, school, bio, education, experience, projects. You can edit anything after.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={handleResumeUpload}
            />
            <div className="mt-2.5 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={parseBusy}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                {parseBusy ? "Reading…" : resumeFile ? "Replace resume" : "Upload resume"}
              </Button>
              {resumeFile && !parseBusy && (
                <span className="text-[11.5px] text-muted-foreground truncate" title={resumeFile.name}>
                  {resumeFile.name}
                </span>
              )}
            </div>
            {parseStats && (
              <p className="text-[11.5px] text-emerald-700 mt-2">
                Pre-filled from resume: {parseStats.educations} education{parseStats.educations === 1 ? "" : "s"}, {parseStats.experiences} role{parseStats.experiences === 1 ? "" : "s"}, {parseStats.projects} project{parseStats.projects === 1 ? "" : "s"}.
              </p>
            )}
            {parseError && (
              <p className="text-[11.5px] text-destructive mt-2">{parseError}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="add-intern-name">Name</Label>
            <Input
              id="add-intern-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-intern-school">School</Label>
            <Input
              id="add-intern-school"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="Cornell University"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-intern-start">Program start</Label>
              <Input id="add-intern-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-intern-end">Program end</Label>
              <Input id="add-intern-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-intern-bio">Short bio (optional)</Label>
            <Textarea
              id="add-intern-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What they're studying, what kind of work they're drawn to."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={pending || !name.trim() || !school.trim() || !start || !end}
          >
            {pending ? "Adding…" : "Add intern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
