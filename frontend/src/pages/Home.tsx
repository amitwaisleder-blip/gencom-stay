import { useRef, useState } from "react";
import { Link } from "react-router-dom";

type Tile = {
  to: string;
  title: string;
  subtitle: string;
  blurb: string;
  icon: string;
  external?: boolean; // if true, open `to` in a new window instead of routing
  /** Keep the title's natural casing instead of transforming to uppercase. */
  noUppercase?: boolean;
};

const TILES: Tile[] = [
  {
    to: "/projects",
    title: "Full Budget Generator",
    subtitle: "Detailed, scope-driven renovation budgets",
    blurb:
      "Highly detailed and nuanced — import PIPs & OMs, build scope line-by-line, tune soft costs, and export to the Gencom template.",
    icon: "🏗️",
  },
  {
    to: "/fast-budget",
    title: "ROM CAPEX Budget",
    subtitle: "Quick budget with minimal inputs",
    blurb:
      "Produce a rough order-of-magnitude CAPEX budget from a handful of data points — keys, tier, market, and a few scope toggles.",
    icon: "⚡",
  },
  {
    to: "/capex-tracker",
    title: "Capex Tracker",
    subtitle: "Budget · Invoice · Forecast",
    blurb:
      "Track capex budgets and invoices across single hotels, portfolios, and discrete projects. Upload budgets, auto-match invoices to lines via Claude, and roll spend up to forecast.",
    icon: "📊",
  },
  {
    to: "/schedule-generator",
    title: "Schedule Generator",
    subtitle: "Project schedules & milestones",
    blurb:
      "Build renovation schedules from scope and target dates — milestones, dependencies, critical path, and Gantt-style timelines you can hand to GCs and owners.",
    icon: "📅",
  },
  {
    to: "/airkarim",
    title: "AirKarim",
    subtitle: "Executive trip itineraries",
    blurb:
      "Author and preview business-trip itineraries — flights, lodging, meetings, dining, ground, contacts. Tap through the owner's iPhone mockup to review before sending.",
    icon: "✈︎",
  },
  {
    to: "/inbox-briefing",
    title: "Inbox Briefing",
    subtitle: "AI-triaged morning email digest",
    blurb:
      "Daily AI triage of the CEO's inbox for his executive assistant — adaptive setup, tier-sorted briefing, calendar context, and a separate preview of what lands in the CEO's morning email.",
    icon: "✉︎",
    noUppercase: true,
  },
  {
    to: "/gencom-stay",
    title: "Gencom Stay",
    subtitle: "Internal owner / F&F stay portal",
    blurb:
      "Browse the Gencom portfolio and request complimentary or discounted stays. Each property lists rates, blackout dates, and the contact your request routes to.",
    icon: "⌂",
  },
  {
    to: "/intern-program",
    title: "Intern Program",
    subtitle: "Cohorts, mentors, assignments",
    blurb:
      "Portal for the Gencom intern program — placements, project assignments, mentor pairings, and end-of-cycle reviews. Under construction.",
    icon: "🎓",
  },
  {
    to: "/org-chart",
    title: "Org Chart",
    subtitle: "Build and edit org structures",
    blurb:
      "Sketch reporting lines for any team or property — add people, set who reports to whom, drop in photos. Useful for new hire onboarding and structure conversations with PwC, lenders, and JV partners.",
    icon: "🌳",
  },
  {
    to: "/asset-management",
    title: "Asset Management Reporting",
    subtitle: "Portfolio & property reports",
    blurb:
      "Owner-reporting-quality dashboards and exports for every property under management. Occupancy, ADR, RevPAR, capex status, and variance narratives in one place.",
    icon: "📈",
  },
  {
    to: "/financial-modeling",
    title: "Financial Modeling",
    subtitle: "Deal underwriting & hold models",
    blurb:
      "Underwrite new deals and refresh hold-period models — acquisition, renovation, stabilization, refinance, and exit assumptions in one workbook.",
    icon: "🧮",
  },
  {
    to: "/gen-cal",
    title: "GenCal",
    subtitle: "Company-wide shared calendar",
    blurb:
      "Single source of truth for company-wide dates, events, and milestones. Holidays, parties, board meetings, property milestones, birthdays, and anniversaries in one view.",
    icon: "🗓",
    noUppercase: true,
  },
  {
    to: "/lunch-menu",
    title: "Lunch Menu",
    subtitle: "History, metrics, favorites, predictions",
    blurb:
      "Track what the office serves week to week. Spot rotation patterns, favorite your go-to dishes, and see a best-guess of next week's menu based on historical data.",
    icon: "🍽",
  },
  {
    to: "/catering",
    title: "Catering Request",
    subtitle: "Order in for meetings & events",
    blurb:
      "Submit a catering request for an upcoming meeting or office event. Pick the menu, headcount, and timing — request routes to the front desk for ordering.",
    icon: "🥡",
  },
  {
    to: "/cash-flow-returns",
    title: "Cash Flow Returns",
    subtitle: "Hotel acquisition underwriting",
    blurb:
      "Live financial models for every deal in the pipeline. Mirrors the Hamilton investment-package layout with editable assumptions, live recalc, and sensitivity grids.",
    icon: "💼",
    noUppercase: true,
  },
  {
    to: "/pip-generator",
    title: "PIP Generator",
    subtitle: "Narrow scope for early-stage deals",
    blurb:
      "Builds a PIP-style scope list you can review and then push into the Full Budget Generator for detailed pricing.",
    icon: "📋",
  },
  {
    to: "/cost-db",
    title: "Cost Database",
    subtitle: "Pricing methodology & unit costs",
    blurb:
      "Reference and edit the pricing database that powers every budget. Pricing methodology sits on top, searchable DB below.",
    icon: "💲",
  },
];

export default function Home() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
      {TILES.map((t) => (
        <HomeTile key={t.to} tile={t} />
      ))}
    </div>
  );
}


function HomeTile({ tile: t }: { tile: Tile }) {
  // Two-stage hover behavior:
  //   · Immediate (CSS) — emoji desaturates → glows, tile lifts 1px,
  //     shadow blooms. Quick visual feedback on every hover-in.
  //   · After 2s of sustained hover (JS-driven `dwelling` flag) — tile
  //     starts SLOWLY scaling up, so a user lingering on a tile gets a
  //     gentle "you've been looking at me" cue without distracting users
  //     who are just sweeping the cursor across the grid.
  // Hover-out cancels the timer and snaps back quickly via the default
  // (non-hover) transition duration.
  const [dwelling, setDwelling] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onEnter() {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = setTimeout(() => {
      setDwelling(true);
      dwellTimer.current = null;
    }, 2000);
  }

  function onLeave() {
    if (dwellTimer.current) {
      clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
    setDwelling(false);
  }

  const tileClass =
    "group relative flex flex-col bg-white border border-gencom-sand rounded-xl p-5 pr-14 shadow-sm " +
    "transition-all duration-300 ease-out hover:shadow-2xl hover:-translate-y-1 hover:border-gencom-stone/40 " +
    (dwelling ? "scale-[1.04] [transition-duration:2500ms]" : "");

  const body = (
    <>
      {/* Corner emoji — grayscale by default, lights up + grows on hover. */}
      <span
        className="absolute top-3 right-3 text-2xl leading-none grayscale opacity-50 transition-all duration-300 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-125 group-hover:drop-shadow-[0_0_8px_rgba(184,149,85,0.55)]"
        aria-hidden="true"
      >
        {t.icon}
      </span>
      <div className="t-eyebrow">{t.subtitle}</div>
      <div className={`mt-2 font-display text-xl font-bold tracking-wide text-gencom-ink leading-tight ${t.noUppercase ? "" : "uppercase"}`}>
        {t.title}
      </div>
      <div className="mt-2 text-[13px] text-gencom-stone leading-snug">
        {t.blurb}
      </div>
      <div className="mt-auto pt-3 flex items-center justify-between">
        <span className="t-eyebrow text-gencom-stone">
          {t.external ? "Open in new window" : "Open"}
        </span>
        <span className="text-gencom-stone text-sm group-hover:translate-x-0.5 group-hover:text-gencom-ink transition">
          {t.external ? "↗" : "→"}
        </span>
      </div>
    </>
  );

  if (t.external) {
    return (
      <a
        href={t.to}
        target="_blank"
        rel="noopener noreferrer"
        className={tileClass}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {body}
      </a>
    );
  }
  return (
    <Link to={t.to} className={tileClass} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {body}
    </Link>
  );
}
