import { Inbox, Star, PenLine, type LucideIcon } from "lucide-react";

export type Tab = "brief" | "priority" | "drafts";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "brief", label: "Brief", icon: Inbox },
  { id: "priority", label: "Priority", icon: Star },
  { id: "drafts", label: "Drafts", icon: PenLine },
];

export function TabBar({
  active,
  onChange,
  draftCount,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  draftCount: number;
}) {
  return (
    <nav className="tab-bar">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`tab ${active === id ? "active" : ""}`}
          onClick={() => onChange(id)}
        >
          <span className="tab-icon-wrap">
            <Icon size={21} strokeWidth={2} />
            {id === "drafts" && draftCount > 0 && (
              <span className="tab-badge">{draftCount}</span>
            )}
          </span>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
