import { useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { useRole } from "@/lib/role";
import { canView } from "@/lib/visibility";
import { cn } from "@/lib/cn";

type Tab = {
  href: (id: string) => string;
  label: string;
  match: (pathname: string, id: string) => boolean;
  // Visibility guard — return false to hide the tab for the current role.
  show?: (role: ReturnType<typeof useRole>["role"]) => boolean;
};

// Routes are mounted under /intern-program in the host pip-budget-app.
const ROOT = "/intern-program";

const TABS: Tab[] = [
  {
    href: (id) => `${ROOT}/${id}`,
    label: "Profile",
    match: (p, id) => p === `${ROOT}/${id}`,
  },
  {
    href: (id) => `${ROOT}/${id}/schedule`,
    label: "Schedule",
    match: (p, id) => p === `${ROOT}/${id}/schedule`,
  },
  {
    href: (id) => `${ROOT}/${id}/deliverables`,
    label: "Deliverables",
    match: (p, id) => p === `${ROOT}/${id}/deliverables`,
  },
  {
    href: (id) => `${ROOT}/${id}/goals`,
    label: "Learning goals",
    match: (p, id) => p === `${ROOT}/${id}/goals`,
  },
  {
    href: (id) => `${ROOT}/${id}/feedback`,
    label: "Manager feedback",
    match: (p, id) => p === `${ROOT}/${id}/feedback`,
    show: (role) => canView(role, "managerFeedback"),
  },
  {
    href: (id) => `${ROOT}/${id}/shadow-days`,
    label: "Shadow days",
    match: (p, id) => p === `${ROOT}/${id}/shadow-days`,
  },
  {
    href: (id) => `${ROOT}/${id}/return-offer`,
    label: "Return offer",
    match: (p, id) => p === `${ROOT}/${id}/return-offer`,
    show: (role) => canView(role, "returnOfferTracker"),
  },
];

export function InternTabNav({ internId }: { internId: string }) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { role } = useRole();
  const qs = useMemo(() => {
    // Preserve any in-flight role param so tab navigation doesn't snap
    // back to the default viewpoint mid-demo.
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [params]);

  const visible = TABS.filter((t) => !t.show || t.show(role));

  // Centered, equal-width green-on-active tabs — matches the
  // Budget/Cashflow/Invoices switcher in the Capex Tracker. Each cell
  // is fixed at w-32 so tab widths stay consistent across pages.
  return (
    <div className="flex justify-center">
      <nav
        role="tablist"
        aria-label="Intern sections"
        className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden"
      >
        {visible.map((t, i) => {
          const active = t.match(pathname, internId);
          return (
            <Link
              key={t.label}
              to={`${t.href(internId)}${qs}`}
              role="tab"
              aria-current={active ? "page" : undefined}
              className={cn(
                "w-32 py-1.5 text-center text-[10px] uppercase tracking-wider font-semibold transition whitespace-nowrap",
                i > 0 && "border-l-2 border-gencom-sand",
                active
                  ? "bg-gencom-green text-white"
                  : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
