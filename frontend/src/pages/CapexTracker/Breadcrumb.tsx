import { Link } from "react-router-dom";

export type BreadcrumbItem = { label: string; to?: string };

/** Standard breadcrumb across the Capex Tracker. Always starts with Dashboard
 *  so users can hop back to the Gencom Dashboard home from anywhere. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const trail: BreadcrumbItem[] = [{ label: "Dashboard", to: "/" }, ...items];
  return (
    <div className="mb-4 text-xs text-gencom-stone uppercase tracking-wider">
      {trail.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5 text-gencom-stone/50">›</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-gencom-ink">
              {item.label}
            </Link>
          ) : (
            <span className="text-gencom-ink">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
