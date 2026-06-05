import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  api,
  type DocumentRow, type Property, type Scenario, type ScopeItem,
} from "../lib/api";
import { totalKeys, type GuestroomMix } from "../lib/guestroomTemplates";

export type Issue = {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** Relative URL to navigate to in order to resolve the issue. */
  link: string;
  linkLabel: string;
};

/**
 * Derives a live list of issues from the current property state.
 * Runs against the backend whenever the propertyId changes; polls on focus.
 */
export default function IssuesBell() {
  // Pull the property id out of the URL if we're on a property page.
  const params = useParams();
  const propertyId = params.id as string | undefined;

  const [issues, setIssues] = useState<Issue[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!propertyId) { setIssues([]); return; }
    try {
      const [property, scope, scenarios, documents, divisionsResp] = await Promise.all([
        api.getProperty(propertyId),
        api.listScope(propertyId),
        api.listScenarios(propertyId),
        api.listDocuments(propertyId).catch(() => [] as DocumentRow[]),
        api.listDivisions().catch(() => ({ divisions: [] as string[] })),
      ]);
      setIssues(computeIssues({
        propertyId, property, scope, scenarios, documents,
        templateDivisions: divisionsResp.divisions,
      }));
    } catch (_) {
      setIssues([]);
    }
  }

  useEffect(() => { refresh(); }, [propertyId]);

  // Refresh on window focus so the bell reflects recent edits.
  useEffect(() => {
    function onFocus() { refresh(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  // Click-outside + Esc to close.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!propertyId) return null;

  const count = issues.length;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-md hover:bg-gencom-mist"
        aria-label={`${count} issue${count === 1 ? "" : "s"}`}
        title={`${count} issue${count === 1 ? "" : "s"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={count === 0 ? "text-gencom-stone" : errorCount > 0 ? "text-red-600" : "text-amber-600"}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${
            errorCount > 0 ? "bg-red-600" : "bg-amber-600"
          }`}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-[380px] bg-white border border-gencom-sand rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gencom-sand bg-gencom-mist/40 flex items-center justify-between">
            <div className="font-semibold text-sm uppercase tracking-wider">Issues</div>
            <button onClick={() => setOpen(false)} className="text-gencom-stone hover:text-gencom-ink text-sm">×</button>
          </div>
          {count === 0 ? (
            <div className="p-8 text-center text-sm text-gencom-stone">
              <div className="mb-1">✓ Everything looks good.</div>
              <div className="text-xs">No conflicts or missing info detected.</div>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-auto">
              {issues.map((issue) => (
                <li key={issue.id} className="px-4 py-3 border-b border-gencom-sand/50 last:border-0 hover:bg-gencom-mist/30">
                  <div className="flex items-start gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      issue.severity === "error" ? "bg-red-600" :
                      issue.severity === "warning" ? "bg-amber-600" :
                      "bg-blue-600"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gencom-ink">{issue.message}</div>
                      <a
                        href={issue.link}
                        onClick={() => setOpen(false)}
                        className="text-xs text-gencom-green hover:underline inline-block mt-0.5"
                      >
                        {issue.linkLabel} →
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Issue-detection rules ────────────────────────────────────────────
function computeIssues(args: {
  propertyId: string;
  property: Property;
  scope: ScopeItem[];
  scenarios: Scenario[];
  documents: DocumentRow[];
  templateDivisions: string[];
}): Issue[] {
  const { propertyId, property, scope, scenarios, documents, templateDivisions } = args;
  const issues: Issue[] = [];

  const setupLink = `/properties/${propertyId}/setup`;
  const scopeLink = `/properties/${propertyId}/scope`;
  const summaryLink = `/properties/${propertyId}/summary`;

  // 1. Missing critical property fields
  const criticals: Array<[keyof Property, string]> = [
    ["name", "property name"],
    ["keys", "key count"],
    ["target_brand", "target brand"],
    ["target_brand_tier", "brand tier"],
    ["property_type", "property type"],
  ];
  for (const [key, label] of criticals) {
    const v = property[key];
    const isBlank = v == null || v === "" || (typeof v === "string" && v.trim().toLowerCase() === "untitled deal");
    if (isBlank) {
      issues.push({
        id: `missing_${String(key)}`,
        severity: "error",
        message: `Missing ${label}.`,
        link: setupLink,
        linkLabel: "Fix on Setup",
      });
    }
  }

  // 2. Guestroom matrix vs. declared keys mismatch
  const mix = (property.guestroom_mix as GuestroomMix) ?? null;
  const matrixTotal = totalKeys(mix);
  if (mix && matrixTotal > 0 && property.keys != null && property.keys !== matrixTotal) {
    issues.push({
      id: "keys_matrix_mismatch",
      severity: "warning",
      message: `Guestroom matrix totals ${matrixTotal} but key count is ${property.keys}.`,
      link: setupLink,
      linkLabel: "Reconcile on Setup",
    });
  }

  // 3. No documents uploaded but scope exists from extraction
  const extractedScope = scope.filter((i) => i.source !== "manual" && !i.deleted);
  if (documents.length === 0 && extractedScope.length === 0 && scope.filter((s) => !s.deleted).length === 0) {
    issues.push({
      id: "no_docs_no_scope",
      severity: "info",
      message: "No PIP or OM uploaded, and no scope items added yet.",
      link: setupLink,
      linkLabel: "Upload a PIP",
    });
  } else if (documents.length === 0 && extractedScope.length === 0 && scope.filter((s) => !s.deleted).length > 0) {
    issues.push({
      id: "no_docs_manual_only",
      severity: "info",
      message: "Scope is all manual — upload a PIP to auto-extract more items.",
      link: setupLink,
      linkLabel: "Upload a PIP",
    });
  }

  // 4. Scope items in divisions that don't match the template
  if (templateDivisions.length > 0) {
    const templateSet = new Set(templateDivisions.map((d) => d.toLowerCase()));
    const unmapped = new Set<string>();
    for (const item of scope) {
      if (!item.deleted && !templateSet.has(item.division.toLowerCase())) {
        unmapped.add(item.division);
      }
    }
    if (unmapped.size > 0) {
      issues.push({
        id: "unmapped_divisions",
        severity: "warning",
        message: `${unmapped.size} scope division${unmapped.size > 1 ? "s" : ""} don't match the Excel template: ${Array.from(unmapped).slice(0, 3).join(", ")}${unmapped.size > 3 ? "…" : ""}`,
        link: scopeLink,
        linkLabel: "Review on Scope",
      });
    }
  }

  // 5. Failed document extractions
  const failed = documents.filter((d) => d.extraction_status === "failed");
  if (failed.length > 0) {
    issues.push({
      id: "extraction_failed",
      severity: "error",
      message: `${failed.length} document extraction${failed.length > 1 ? "s" : ""} failed — ${(failed[0].extraction_error ?? "").slice(0, 80)}`,
      link: setupLink,
      linkLabel: "Retry on Setup",
    });
  }

  // 6. Scenarios exist but no scope items
  const activeScope = scope.filter((s) => !s.deleted && s.included_in_budget);
  if (scenarios.length > 0 && activeScope.length === 0) {
    issues.push({
      id: "no_scope",
      severity: "warning",
      message: "No scope items yet — scenarios will all total $0.",
      link: scopeLink,
      linkLabel: "Add scope items",
    });
  }

  // 7. Intake answers conflict with scenario settings
  const intake = (property.intake_answers ?? {}) as Record<string, { value?: string }>;
  const defaultScenario = scenarios.find((s) => s.is_default) ?? scenarios[0];
  if (defaultScenario && defaultScenario.soft_cost_breakdown) {
    // Contingency percentage from Q21
    const q21 = intake["q21"]?.value;
    const intakeContingencyPct: Record<string, number> = {
      "5_pct": 0.05, "7_pct": 0.07, "10_pct": 0.10, "15_pct": 0.15,
    };
    const intakeContingency = q21 ? intakeContingencyPct[q21] : undefined;
    if (intakeContingency != null) {
      const contLine = defaultScenario.soft_cost_breakdown.find((l) =>
        (l.group === "contingency" || l.name.toLowerCase().includes("contingency")) && l.pct != null
      );
      if (contLine && Math.abs((contLine.pct ?? 0) - intakeContingency) > 0.001) {
        issues.push({
          id: "contingency_mismatch",
          severity: "info",
          message: `Intake says contingency is ${(intakeContingency * 100).toFixed(0)}% but scenario has ${((contLine.pct ?? 0) * 100).toFixed(0)}%.`,
          link: summaryLink,
          linkLabel: "Reconcile on Summary",
        });
      }
    }

    // Escalation from Q23
    const q23 = intake["q23"]?.value;
    const intakeEscalation: Record<string, number> = {
      "2_pct": 0.02, "3_pct": 0.03, "5_pct": 0.05, "7_plus": 0.07, "none": 0,
    };
    const intakeEsc = q23 ? intakeEscalation[q23] : undefined;
    if (intakeEsc != null && Math.abs((defaultScenario.escalation_pct ?? 0) - intakeEsc) > 0.001) {
      issues.push({
        id: "escalation_mismatch",
        severity: "info",
        message: `Intake says escalation is ${(intakeEsc * 100).toFixed(0)}% but scenario has ${((defaultScenario.escalation_pct ?? 0) * 100).toFixed(0)}%.`,
        link: summaryLink,
        linkLabel: "Reconcile on Summary",
      });
    }
  }

  return issues;
}
