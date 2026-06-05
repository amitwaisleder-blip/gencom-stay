// Org Chart project home — lists projects from localStorage, lets the
// user create / open / rename / duplicate / delete. Each card links to
// the editor at /org-chart/:id. Layout mirrors other Gencom app
// home screens (project cards in a responsive grid).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Copy, FileText, Pencil, Plus, Trash2,
} from "lucide-react";

import { NewProjectModal } from "./components/NewProjectModal";
import {
  createProject, deleteProject, duplicateProject, getProject, listProjects,
  renameProject, updateProjectHotel,
} from "./lib/storage";
import type { HotelMeta, ProjectMeta } from "./lib/storage";

/** Resize an image File to a JPEG data URL with max edge `maxEdge`.
 *  Used for drop-target uploads on project cards so the photo fits
 *  comfortably in localStorage. */
async function imageFileToResizedDataUrl(file: File, maxEdge = 600, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not decode image"));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function OrgChartHome() {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const [creating, setCreating] = useState(false);
  // Set when the user clicks Edit on a card — opens the project modal
  // pre-populated so the user can tweak hotel name / address / photo /
  // key count, optionally re-running AI auto-fill.
  const [editing, setEditing] = useState<{ id: string; hotel: HotelMeta; name: string } | null>(null);
  const navigate = useNavigate();

  // Refresh on mount (covers cross-tab edits) and on storage events.
  useEffect(() => {
    function refresh() { setProjects(listProjects()); }
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function handleRename(p: ProjectMeta) {
    const name = window.prompt("Rename project", p.name);
    if (name === null) return;
    renameProject(p.id, name);
    setProjects(listProjects());
  }

  function handleDuplicate(p: ProjectMeta) {
    const newId = duplicateProject(p.id);
    if (newId) setProjects(listProjects());
  }

  function handleDelete(p: ProjectMeta) {
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    deleteProject(p.id);
    setProjects(listProjects());
  }

  function handleEdit(p: ProjectMeta) {
    const full = getProject(p.id);
    if (!full) return;
    setEditing({ id: p.id, hotel: full.hotel ?? emptyHotelMeta(), name: full.name });
  }

  /** Drop an image onto a card → resize and save it as the card photo.
   *  Only the first dropped file (and only if it's an image) is used. */
  async function handleDropImage(p: ProjectMeta, file: File) {
    if (!file.type.startsWith("image/")) {
      window.alert("Drop an image file (PNG, JPG, etc.) to set the project photo.");
      return;
    }
    try {
      const dataUrl = await imageFileToResizedDataUrl(file);
      const full = getProject(p.id);
      if (!full) return;
      const next: HotelMeta = { ...(full.hotel ?? emptyHotelMeta()), photoDataUrl: dataUrl };
      updateProjectHotel(p.id, next);
      setProjects(listProjects());
    } catch (err) {
      window.alert("Couldn't read that image: " + (err as Error).message);
    }
  }

  return (
    <div className="orgchart-home">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <div className="t-eyebrow">Org Charts</div>
          <h1 className="t-h1">Projects</h1>
          <p className="text-[13px] text-gencom-stone mt-1">
            Saved locally on this machine. Use Save in the editor to download a JSON copy you can hand off.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="ib-button-primary text-sm h-10 px-4 inline-flex items-center gap-2 shrink-0"
        >
          <Plus className="h-4 w-4" /> New project
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => navigate(`/org-chart/${p.id}`)}
              onRename={() => handleRename(p)}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p)}
              onEdit={() => handleEdit(p)}
              onDropImage={(f) => handleDropImage(p, f)}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewProjectModal
          onCancel={() => setCreating(false)}
          onCreate={({ name, hotel, chart }) => {
            const id = createProject(name, chart, hotel);
            setCreating(false);
            navigate(`/org-chart/${id}`);
          }}
        />
      )}

      {editing && (
        <NewProjectModal
          mode="edit"
          initialName={editing.name}
          initialHotel={editing.hotel}
          onCancel={() => setEditing(null)}
          onCreate={({ name, hotel }) => {
            // In edit mode the chart isn't replaced — only metadata
            // updates flow through. Rename and hotel are saved
            // independently so we don't bump non-meta fields.
            renameProject(editing.id, name);
            updateProjectHotel(editing.id, hotel);
            setProjects(listProjects());
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function emptyHotelMeta(): HotelMeta {
  return {
    hotelName: "",
    address: null, city: null, state: null, country: null,
    keyCount: null, yearBuilt: null, purchaseYear: null,
    brand: null, photoDataUrl: null,
  };
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-gencom-sand bg-white py-12 grid place-items-center">
      <div className="text-center max-w-sm">
        <div className="h-12 w-12 rounded-full bg-gencom-greensoft text-gencom-green grid place-items-center mx-auto mb-3">
          <FileText className="h-5 w-5" />
        </div>
        <div className="t-h3">No projects yet</div>
        <p className="text-[12.5px] text-gencom-stone mt-1 mb-4">
          Spin up your first ownership-structure chart. You can also import a .pptx from the editor.
        </p>
        <button
          onClick={onCreate}
          className="ib-button-primary text-sm h-9 px-4 inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> New project
        </button>
      </div>
    </div>
  );
}

function ProjectCard({
  project, onOpen, onRename, onDuplicate, onDelete, onEdit, onDropImage,
}: {
  project: ProjectMeta;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onDropImage: (file: File) => void;
}) {
  const hotel = project.hotel;
  const photo = hotel?.photoDataUrl ?? null;
  const subline = hotel
    ? [
        hotel.city,
        hotel.state,
        hotel.keyCount != null ? `${hotel.keyCount} keys` : null,
        hotel.yearBuilt != null ? `Built ${hotel.yearBuilt}` : null,
      ].filter(Boolean).join(" · ")
    : null;
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="orgchart-card group relative rounded-md border border-gencom-sand bg-white hover:border-gencom-green hover:shadow-md transition cursor-pointer overflow-hidden"
      onClick={onOpen}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onDropImage(f);
      }}
    >
      <div className="flex">
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <div className="t-eyebrow text-[10px]">Project</div>
          <div className="font-semibold text-[13.5px] leading-tight mt-0.5 truncate" title={project.name}>
            {project.name}
          </div>
          {subline && (
            <div className="text-[11px] text-gencom-stone mt-0.5 truncate" title={subline}>
              {subline}
            </div>
          )}
          <div className="text-[11px] text-gencom-stone mt-1.5 truncate">
            {project.boxCount} {project.boxCount === 1 ? "box" : "boxes"} · {project.connectorCount} {project.connectorCount === 1 ? "connection" : "connections"}
          </div>
          <div className="text-[11px] text-gencom-stone truncate">
            Edited {formatRelative(project.updatedAt)}
          </div>
        </div>
        <div className="w-[42%] shrink-0 aspect-square bg-gencom-mist relative overflow-hidden border-l border-gencom-sand">
          {photo ? (
            <img src={photo} alt={project.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-gencom-sand">
              <Building2 className="h-8 w-8" />
            </div>
          )}
          {dragOver && (
            <div className="absolute inset-0 grid place-items-center bg-gencom-green/85 text-white text-[11px] font-semibold text-center px-2 pointer-events-none">
              Drop image
            </div>
          )}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-gencom-sand bg-white/85 backdrop-blur-sm px-2 py-1.5 flex items-center gap-1 translate-y-full group-hover:translate-y-0 transition-transform duration-150 pointer-events-none group-hover:pointer-events-auto">
        <CardAction title="Edit hotel name / address / photo (with optional AI auto-fill)" onClick={onEdit} icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" />
        <CardAction title="Rename project" onClick={onRename} icon={<FileText className="h-3.5 w-3.5" />} label="Rename" />
        <CardAction title="Duplicate" onClick={onDuplicate} icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" />
        <div className="flex-1" />
        <CardAction title="Delete" onClick={onDelete} icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete" danger />
      </div>
    </div>
  );
}

function CardAction({
  title, onClick, icon, label, danger,
}: { title: string; onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={
        "inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded hover:bg-gencom-mist " +
        (danger ? "text-red-700 hover:bg-red-50" : "text-gencom-ink")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}
