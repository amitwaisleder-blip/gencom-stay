import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { differenceInWeeks, format } from "date-fns";
import { Calendar, Camera, GraduationCap, Pencil } from "lucide-react";

import type { Intern } from "@/data";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/initials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fromISO } from "@/lib/dates";
import { useRole } from "@/lib/role";
import { canEdit } from "@/lib/visibility";

import { saveBioAction } from "../../app/actions";
import { EditBioDialog } from "./edit-bio-dialog";

const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

export function ProfileHeader({ intern }: { intern: Intern }) {
  const { role } = useRole();
  const canEditBio = canEdit(role, "bio");
  const start = fromISO(intern.programStart);
  const end = fromISO(intern.programEnd);
  const weeks = Math.max(1, differenceInWeeks(end, start));

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Portal target lives in the module sub-header (top of the page)
  // alongside the role switcher. The element is rendered once on
  // mount; we attach when it's available and detach on unmount.
  const [editSlot, setEditSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setEditSlot(document.getElementById("intern-module-subheader-edit-slot"));
    return () => setEditSlot(null);
  }, []);

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error || new Error("Failed to read image"));
      r.readAsDataURL(file);
    });
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Pick an image file.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 3 MB).`);
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      await saveBioAction(intern.id, { photoUrl: dataUrl });
      window.location.reload();
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  const editButton = canEditBio ? (
    <EditBioDialog intern={intern}>
      <Button variant="outline" size="sm">
        <Pencil className="h-3.5 w-3.5" />
        Edit Profile
      </Button>
    </EditBioDialog>
  ) : null;

  return (
    <>
      {/* Edit Profile lives next to the role switcher in the sub-header. */}
      {editButton && editSlot && createPortal(editButton, editSlot)}

      <header className="flex flex-col items-center gap-1.5 pt-1 pb-2 text-center">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhoto}
        />
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={!canEditBio || photoBusy}
          title={canEditBio ? "Upload a profile photo" : intern.name}
          className="relative group/avatar rounded-full focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-default"
        >
          <Avatar className="h-14 w-14 ring-1 ring-border">
            <AvatarImage src={intern.photoUrl} alt="" />
            <AvatarFallback className="text-[14px] font-semibold">{initialsOf(intern.name)}</AvatarFallback>
          </Avatar>
          {canEditBio && (
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity"
            >
              <Camera className="h-3.5 w-3.5" />
            </span>
          )}
        </button>

        <div className="flex items-center justify-center gap-2 flex-wrap">
          <h1 className="text-[22px] font-bold tracking-tight text-gencom-ink leading-tight">
            {intern.name}
          </h1>
          {intern.status === "active" ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="muted">Completed</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <GraduationCap className="h-3 w-3 text-accent/80 shrink-0" />
            <span className="text-foreground/80">{intern.school}</span>
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Calendar className="h-3 w-3 text-accent/80 shrink-0" />
            {format(start, "MMM d, yyyy")} — {format(end, "MMM d, yyyy")}
            <span className="text-border mx-1">·</span>
            <span>{weeks} wks</span>
          </span>
        </div>
        {(photoBusy || photoError) && (
          <div className="text-[11px]">
            {photoBusy && <span className="text-muted-foreground">Uploading photo…</span>}
            {photoError && <span className="text-destructive">{photoError}</span>}
          </div>
        )}
      </header>
    </>
  );
}
