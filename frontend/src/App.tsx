import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useMatch } from "react-router-dom";
import BudgetSummary from "./pages/BudgetSummary";
import CostsCombined from "./pages/CostsCombined";
import Dashboard from "./pages/Dashboard";
import ExportPage from "./pages/ExportPage";
import FastBudget from "./pages/FastBudget";
import Home from "./pages/Home";
import PipGenerator from "./pages/PipGenerator";
import CapexTracker from "./pages/CapexTracker";
import AirKarim from "./pages/AirKarim";
import GencomStay from "./pages/GencomStay";
import InternProgram from "./pages/InternProgram/index";
import OrgChart from "./pages/OrgChart";
import AssetManagementReporting from "./pages/AssetManagementReporting";
import FinancialModeling from "./pages/FinancialModeling";
import ScheduleGenerator from "./pages/ScheduleGenerator";
import GenCal from "./pages/GenCal";
import LunchMenu from "./pages/LunchMenu";
import CashFlowReturns from "./pages/CashFlowReturns/app";
import CateringEmbed from "./pages/CateringEmbed";
import InboxBriefingEmbed from "./pages/InboxBriefingEmbed";
import IssuesBell from "./components/IssuesBell";
import ChatPanel from "./components/ChatPanel";
import PropertySetup from "./pages/PropertySetup";
import ScopeOverview from "./pages/ScopeOverview";
import ScopeReview from "./pages/ScopeReview";
import TemplateSetup from "./pages/TemplateSetup";

import { useParams } from "react-router-dom";
import { ChatContextProvider } from "./lib/chatContext";
import { api } from "./lib/api";

function UploadRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/properties/${id}/setup`} replace />;
}

const PROPERTY_TABS = [
  { path: "setup", label: "Setup" },
  { path: "scope", label: "Scope" },
  { path: "overview", label: "Overview" },
  { path: "summary", label: "Summary" },
  { path: "export", label: "Export" },
] as const;

function usePropertyIdFromUrl() {
  const match = useMatch("/properties/:id/*");
  return match?.params?.id;
}

function useHeaderSubtitle(): string {
  // Subtitle shown under "Gencom" — switches to reflect which tool the user
  // is currently in so the header reads like a breadcrumb.
  const loc = useLocation();
  const p = loc.pathname;
  if (p.startsWith("/properties/")) return "Budget Generator";
  if (p.startsWith("/pip-generator")) return "PIP Generator";
  if (p.startsWith("/fast-budget")) return "ROM CAPEX Budget";
  if (p.startsWith("/capex-tracker")) return "Capex Tracker";
  if (p.startsWith("/airkarim")) return "AirKarim";
  if (p.startsWith("/gencom-stay")) return "Gencom Stay";
  if (p.startsWith("/intern-program")) return "Intern Program";
  if (p.startsWith("/org-chart")) return "Org Chart";
  if (p.startsWith("/asset-management")) return "Asset Management Reporting";
  if (p.startsWith("/financial-modeling")) return "Financial Modeling";
  if (p.startsWith("/schedule-generator")) return "Schedule Generator";
  if (p.startsWith("/gen-cal")) return "GenCal";
  if (p.startsWith("/lunch-menu")) return "Lunch Menu";
  if (p.startsWith("/cash-flow-returns")) return "Cash Flow Returns";
  if (p.startsWith("/catering")) return "Catering Request";
  if (p.startsWith("/inbox-briefing")) return "Inbox Briefing";
  if (p.startsWith("/cost-db") || p.startsWith("/costs") || p.startsWith("/methodology")) return "Cost Database";
  if (p.startsWith("/template")) return "Template Setup";
  if (p.startsWith("/projects")) return "Projects";
  return "PIP → Budget";
}

function PropertyNameBadge() {
  // Small project-name line shown top-left under the Gencom logo/subtitle.
  // Sibling of the logo Link so clicking the name does NOT navigate Home.
  const id = usePropertyIdFromUrl();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setName(null); return; }
    let cancelled = false;
    api.getProperty(id)
      .then((p) => { if (!cancelled) setName(p.name ?? "Untitled"); })
      .catch(() => { if (!cancelled) setName(null); });
    return () => { cancelled = true; };
  }, [id]);

  if (!id) return null;
  return (
    <div className="truncate text-xs font-medium text-gencom-ink max-w-[240px] pl-[52px] -mt-1">
      {name ?? "…"}
    </div>
  );
}

function CenteredPageTitle() {
  const loc = useLocation();
  if (loc.pathname === "/") {
    return (
      <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 text-center pointer-events-none">
        <div
          className="font-display text-3xl font-extrabold uppercase tracking-[0.22em] text-gencom-ink whitespace-nowrap"
          style={{
            textShadow:
              "0 1px 0 rgba(184,149,85,0.25), 0 3px 10px rgba(26,29,36,0.18), 0 0 1px rgba(26,29,36,0.35)",
          }}
        >
          Gencom Dashboard
        </div>
      </div>
    );
  }
  // Other routes render their own titles inside the page content.
  return null;
}

function PropertyTabs() {
  const id = usePropertyIdFromUrl();
  const loc = useLocation();
  if (!id) return null;
  return (
    <div className="flex gap-2">
      {PROPERTY_TABS.map((t) => {
        const href = `/properties/${id}/${t.path}`;
        const active = loc.pathname.endsWith(`/${t.path}`);
        return (
          <Link
            key={t.path}
            to={href}
            className={`px-4 py-2 text-xs uppercase tracking-wider whitespace-nowrap rounded-md font-semibold transition shadow-sm ${
              active
                ? "bg-emerald-700 text-white ring-2 ring-emerald-700/30"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

function HeaderBrand() {
  const subtitle = useHeaderSubtitle();
  return (
    <Link to="/" className="flex items-center gap-3">
      <img
        src="/gencom-logo.png"
        alt="Gencom"
        className="h-10 w-10 rounded-full object-contain border border-gencom-sand"
        onError={(e) => {
          console.error("[logo] failed to load /gencom-logo.png", e);
          (e.currentTarget as HTMLImageElement).style.outline = "2px solid red";
        }}
        onLoad={() => console.log("[logo] loaded /gencom-logo.png")}
      />
      <div className="min-w-0">
        <div className="font-brand text-lg leading-none">Gencom</div>
        <div className="text-xs text-gencom-stone">{subtitle}</div>
      </div>
    </Link>
  );
}

function GlobalChatHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Single ChatPanel instance at the app root so the header chat button can
  // open it from any route. Off property pages, the panel simply closes.
  const id = usePropertyIdFromUrl();
  if (!id) return null;
  return <ChatPanel propertyId={id} open={open} onClose={onClose} />;
}

function PropertySubNav() {
  const id = usePropertyIdFromUrl();
  if (!id) return null;
  return (
    <div className="sticky top-[57px] z-30 border-b border-gencom-sand bg-white flex justify-center py-1">
      <PropertyTabs />
    </div>
  );
}

function PropertyHeaderActions({
  onOpenChat,
}: { onOpenChat: () => void }) {
  // Refresh + Chat were previously rendered on every page via PropertyNav —
  // moved into the sticky header to free vertical space and declutter pages.
  const id = usePropertyIdFromUrl();
  if (!id) return null;
  return (
    <>
      <button
        onClick={() => window.location.reload()}
        className="text-[11px] px-2 py-1 rounded border border-gencom-sand bg-white hover:bg-gencom-mist/60 text-gencom-stone hover:text-gencom-ink"
        title="Hard refresh this page"
      >
        ↻
      </button>
      <button
        onClick={onOpenChat}
        className="text-[11px] px-2 py-1 rounded bg-gencom-gold text-gencom-ink font-semibold hover:bg-gencom-gold/80"
        title="Ask Claude about this property"
      >
        💬
      </button>
    </>
  );
}

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <ChatContextProvider>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gencom-sand bg-white shadow-sm">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3 relative">
          <div className="flex-shrink-0 min-w-0">
            <HeaderBrand />
            <PropertyNameBadge />
          </div>
          <CenteredPageTitle />
          <nav className="flex gap-3 text-xs uppercase tracking-wider font-semibold text-gencom-stone items-center flex-shrink-0">
            <Link to="/" className="hover:text-gencom-ink">Home</Link>
            <Link to="/projects" className="hover:text-gencom-ink">Projects</Link>
            <Link to="/cost-db" className="hover:text-gencom-ink">Cost DB</Link>
            <Link to="/template" className="hover:text-gencom-ink">Template</Link>
            <IssuesBell />
            <PropertyHeaderActions onOpenChat={() => setChatOpen(true)} />
          </nav>
        </div>
      </header>
      <PropertySubNav />
      <GlobalChatHost open={chatOpen} onClose={() => setChatOpen(false)} />
      <main className="mx-auto max-w-none px-6 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Dashboard />} />
          <Route path="/fast-budget" element={<FastBudget />} />
          <Route path="/capex-tracker/*" element={<CapexTracker />} />
          <Route path="/airkarim/*" element={<AirKarim />} />
          <Route path="/gencom-stay/*" element={<GencomStay />} />
          <Route path="/intern-program/*" element={<InternProgram />} />
          <Route path="/org-chart/*" element={<OrgChart />} />
          <Route path="/asset-management" element={<AssetManagementReporting />} />
          <Route path="/financial-modeling" element={<FinancialModeling />} />
          <Route path="/schedule-generator" element={<ScheduleGenerator />} />
          <Route path="/gen-cal" element={<GenCal />} />
          <Route path="/lunch-menu" element={<LunchMenu />} />
          <Route path="/cash-flow-returns/*" element={<CashFlowReturns />} />
          <Route path="/catering" element={<CateringEmbed />} />
          <Route path="/inbox-briefing" element={<InboxBriefingEmbed />} />
          <Route path="/pip-generator" element={<PipGenerator />} />
          <Route path="/cost-db" element={<CostsCombined />} />
          {/* Intake questionnaire retired — old deep links drop to Setup. */}
          <Route path="/properties/:id/intake" element={<UploadRedirect />} />
          <Route path="/properties/:id/setup" element={<PropertySetup />} />
          {/* Legacy — upload has been merged into Setup. Redirect old bookmarks. */}
          <Route path="/properties/:id/upload" element={<UploadRedirect />} />
          <Route path="/properties/:id/scope" element={<ScopeReview />} />
          <Route path="/properties/:id/overview" element={<ScopeOverview />} />
          <Route path="/properties/:id/summary" element={<BudgetSummary />} />
          <Route path="/properties/:id/export" element={<ExportPage />} />
          {/* Legacy aliases — prior routes folded into the combined Cost DB page. */}
          <Route path="/methodology" element={<Navigate to="/cost-db" replace />} />
          <Route path="/costs" element={<Navigate to="/cost-db" replace />} />
          <Route path="/template" element={<TemplateSetup />} />
        </Routes>
      </main>
    </div>
    </ChatContextProvider>
  );
}
