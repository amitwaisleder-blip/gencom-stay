export type Tab = "brief" | "priority" | "drafts";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "brief", label: "Brief", icon: "📋" },
  { id: "priority", label: "Priority", icon: "📥" },
  { id: "drafts", label: "Drafts", icon: "✍️" },
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
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab ${active === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <span className="tab-icon">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
          {t.id === "drafts" && draftCount > 0 && (
            <span className="tab-badge">{draftCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
