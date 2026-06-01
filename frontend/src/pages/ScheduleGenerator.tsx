import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PropertyCard, type SchedulePreview, type ScheduleTask, type ScheduleAiDurations, type ScheduleExtractedPip } from "../lib/api";

// ============================================================================
// Schedule Generator — wizard skeleton
//
// Mirrors the FastBudget click-to-advance UX (Step N / Total header, big
// answer cards, Back/Next nav). State is local-only for now; AI duration
// recommendations, blackout-aware scheduling, and Excel/Gantt output are
// stubbed and will be wired up in later passes.
// ============================================================================

// ---------- Types ----------------------------------------------------------

type ProjectType =
  | "full_renovation"
  | "recertification"
  | "soft_goods"
  | "mep_modernization"
  | "structural"
  | "amenity"
  | "";

type InputMode = "pip" | "budget" | "quick_rom" | "";

type Tier = "boutique" | "mid" | "global" | "";
type AorModel = "in_house" | "id_in_house" | "separate" | "not_required" | "";
type YesNoTbd = "yes" | "no" | "tbd" | "";
type YesNoNa = "yes" | "no" | "n/a" | "";
type YesNoPartial = "yes" | "no" | "partial" | "";

type DateRange = { id: string; from: string; to: string; label: string };

type WizardState = {
  projectType: ProjectType;
  inputMode: InputMode;
  source: {
    kind: "file" | "project" | "";
    fileName?: string;
    projectId?: string;
    projectName?: string;
  };
  property: {
    name: string;
    brand: string;
    location: string;
    keys: number | "";
    propertyType: "" | "Urban" | "Resort" | "Branded Residential";
    seasonality: string;
    pm: string;
    idFirm: string;
    gc: string;
  };
  scope: Record<string, boolean>;
  scopeNotes: string;
  startDate: string;
  targetCompletion: string;
  completionType: "hard" | "soft" | "";
  blackouts: DateRange[];
  heavyOccupancy: DateRange[];
  preDesign: {
    idFirmSelected: YesNoTbd;
    pmInPlace: YesNoTbd;
    rfpNeeded: YesNoNa;
  };
  designTeam: {
    idFirmName: string;
    idFirmTier: Tier;
    aorModel: AorModel;
    aorTier: Tier | "n/a";
  };
  designProcess: {
    brandStandards: YesNoNa;
    brand: string;
    brandApprovalGates: boolean;
    brandApprovalPhases: { concept: boolean; sd: boolean; dd: boolean; cd: boolean };
    ownerCycles: { concept: number; sd: number; dd: number; cd: number };
    competition: boolean;
    competitionFirms: number | "";
    mockup: boolean;
    mockupPhase: "end_dd" | "mid_cd" | "end_cd" | "";
    survey: YesNoPartial;
    surveyType: "field" | "matterport" | "full" | "";
    procurementAgent: YesNoTbd;
    procurementAgentEngagement: "dd" | "cd_start" | "ffe_spec" | "";
  };
  designTimeline: {
    concept: number | "";
    sd: number | "";
    dd: number | "";
    cd: number | "";
  };
  preConstruction: {
    gcSelectionMethod: "bid" | "negotiated" | "design_build" | "";
    permitJurisdiction: string;
    permitWeeks: number | "";
  };
  construction: {
    phased: boolean;
    phaseCount: number | "";
    floorsPerPhase: number | "";
    amenitiesSequencing: string;
  };
  closeout: {
    punchListWeeks: number | "";
    ffeOverlap: boolean;
    softOpening: boolean;
  };
  recert: {
    recertType: "25_year" | "40_year" | "50_year" | "other" | "";
    investigationType: "visual_gpr" | "full_structural" | "phased" | "";
    repairFocus: { concrete: boolean; waterproofing: boolean; structural: boolean; facade: boolean; mep: boolean };
    occupancy: "fully_occupied" | "phased" | "vacated" | "";
    filings: { tr1: boolean; tr4: boolean; tr8: boolean; other: boolean };
    filingsOther: string;
  };
  unit: "weeks" | "days";
};

type PaneKind =
  | "project_type"
  | "input_mode"
  | "project_source"
  | "property_context"
  | "scope_selection"
  | "start_date"
  | "target_completion"
  | "blackouts"
  | "heavy_occupancy"
  | "pre_design"
  | "design_team"
  | "design_process"
  | "design_timeline"
  | "pre_construction"
  | "construction_phasing"
  | "closeout"
  | "recert_questions"
  | "unit_of_measure"
  | "generate";

type Pane = { kind: PaneKind; title: string };

// ---------- Constants ------------------------------------------------------

const PROJECT_TYPES: { value: ProjectType; label: string; blurb: string }[] = [
  {
    value: "full_renovation",
    label: "Full Renovation",
    blurb: "PIP-driven hotel renovation — Pre-Design through Closeout.",
  },
  {
    value: "recertification",
    label: "Building Recertification",
    blurb: "25 / 40 / 50-year recert — investigation, repair, filing.",
  },
  {
    value: "soft_goods",
    label: "Soft-Goods Refresh",
    blurb: "FF&E refresh with abbreviated design phases.",
  },
  {
    value: "mep_modernization",
    label: "MEP / Vertical Transportation",
    blurb: "Elevator mod, MEP equipment replacement.",
  },
  {
    value: "structural",
    label: "Structural Repair",
    blurb: "GPR / engineering-investigation driven repair work.",
  },
  {
    value: "amenity",
    label: "Amenity Addition / Repositioning",
    blurb: "New or reworked amenities — pool, F&B, spa, fitness.",
  },
];

const INPUT_MODES: { value: InputMode; label: string; blurb: string }[] = [
  {
    value: "pip",
    label: "PIP-Driven",
    blurb: "Pull a PIP from PIP Generator or drop in a PDF / Word / Excel.",
  },
  {
    value: "budget",
    label: "Budget-Driven",
    blurb: "Pick a project from Budget Generator, ROM Capex archive, or Project Financials.",
  },
  {
    value: "quick_rom",
    label: "Quick ROM",
    blurb: "Answer a short series of questions — no PIP or budget required.",
  },
];

const STANDARD_SCOPE = [
  "Guestrooms",
  "Guest Corridors",
  "Lobby & Public Areas",
  "F&B Outlets",
  "Meeting & Function Space",
  "Spa & Wellness",
  "Pool & Outdoor Amenities",
  "Fitness Center",
  "Retail",
  "Back of House",
  "MEP / Building Systems",
  "Building Envelope / Facade",
  "Vertical Transportation",
  "Structural / Recert Work",
  "Site / Landscape",
];

// Project-type → which panes to show. Soft-goods, recert, MEP, and structural
// flows are simplified vs. a full renovation.
const PANES_BY_TYPE: Record<Exclude<ProjectType, "">, PaneKind[]> = {
  full_renovation: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "pre_design", "design_team", "design_process", "design_timeline",
    "pre_construction", "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
  recertification: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "recert_questions",
    "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "pre_construction", "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
  soft_goods: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "design_team", "design_timeline",
    "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
  mep_modernization: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "pre_construction", "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
  structural: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "pre_construction", "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
  amenity: [
    "project_type", "input_mode", "project_source", "property_context",
    "scope_selection", "start_date", "target_completion",
    "blackouts", "heavy_occupancy",
    "pre_design", "design_team", "design_process", "design_timeline",
    "pre_construction", "construction_phasing", "closeout",
    "unit_of_measure", "generate",
  ],
};

const PANE_TITLE: Record<PaneKind, string> = {
  project_type: "Project Type",
  input_mode: "Input Mode",
  project_source: "Project Source",
  property_context: "Property Context",
  scope_selection: "Scope Selection",
  start_date: "Start Date",
  target_completion: "Target Completion",
  blackouts: "Blackout Periods",
  heavy_occupancy: "Heavy Occupancy Periods",
  pre_design: "Pre-Design",
  design_team: "Design Team",
  design_process: "Design Process",
  design_timeline: "Design Timeline",
  pre_construction: "Pre-Construction",
  construction_phasing: "Construction Phasing",
  closeout: "Closeout",
  recert_questions: "Recertification Details",
  unit_of_measure: "Unit of Measure",
  generate: "Generate Schedule",
};

// ---------- Helpers --------------------------------------------------------

function emptyState(): WizardState {
  return {
    projectType: "",
    inputMode: "",
    source: { kind: "" },
    property: {
      name: "",
      brand: "",
      location: "",
      keys: "",
      propertyType: "",
      seasonality: "",
      pm: "",
      idFirm: "",
      gc: "",
    },
    scope: Object.fromEntries(STANDARD_SCOPE.map((s) => [s, false])),
    scopeNotes: "",
    startDate: "",
    targetCompletion: "",
    completionType: "",
    blackouts: [],
    heavyOccupancy: [],
    preDesign: { idFirmSelected: "", pmInPlace: "", rfpNeeded: "" },
    designTeam: { idFirmName: "", idFirmTier: "", aorModel: "", aorTier: "" },
    designProcess: {
      brandStandards: "",
      brand: "",
      brandApprovalGates: false,
      brandApprovalPhases: { concept: false, sd: false, dd: false, cd: false },
      ownerCycles: { concept: 1, sd: 1, dd: 1, cd: 1 },
      competition: false,
      competitionFirms: "",
      mockup: false,
      mockupPhase: "",
      survey: "",
      surveyType: "",
      procurementAgent: "",
      procurementAgentEngagement: "",
    },
    designTimeline: { concept: "", sd: "", dd: "", cd: "" },
    preConstruction: { gcSelectionMethod: "", permitJurisdiction: "", permitWeeks: "" },
    construction: { phased: false, phaseCount: "", floorsPerPhase: "", amenitiesSequencing: "" },
    closeout: { punchListWeeks: "", ffeOverlap: false, softOpening: false },
    recert: {
      recertType: "",
      investigationType: "",
      repairFocus: { concrete: false, waterproofing: false, structural: false, facade: false, mep: false },
      occupancy: "",
      filings: { tr1: false, tr4: false, tr8: false, other: false },
      filingsOther: "",
    },
    unit: "weeks",
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// US-style MM/DD/YYYY for display. ISO is fine on the wire and inside HTML5
// date inputs, but everywhere a human reads a date — table rows, summaries,
// banners — we render this format to match what owners and GCs expect.
function fmtDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// Brands considered "branded" for purposes of auto-defaulting brand-standards
// review on the Design Process page. Independents / boutiques / unknowns get
// "no" by default; a recognized chain brand gets "yes" + brand pre-filled.
const BRANDED_KEYWORDS = [
  "marriott", "ritz-carlton", "ritz carlton", "ritzcarlton",
  "st. regis", "st regis", "edition", "w hotel", "westin", "sheraton",
  "jw marriott", "renaissance", "courtyard", "ac hotels", "moxy", "le meridien",
  "autograph", "tribute",
  "hilton", "waldorf", "conrad", "doubletree", "embassy suites", "hampton",
  "hyatt", "park hyatt", "andaz", "thompson",
  "intercontinental", "kimpton", "hotel indigo", "ihg",
  "accor", "sofitel", "fairmont", "raffles", "swissôtel", "swissotel", "novotel", "pullman",
  "four seasons",
  "rosewood", "mandarin oriental", "aman", "six senses",
  "wyndham",
  "best western",
];

function inferBrandStatus(brand: string): "yes" | "no" | "" {
  if (!brand) return "";
  const lower = brand.toLowerCase().trim();
  // Independent / boutique / unbranded → no brand standards review.
  if (/(independent|boutique|unbranded|none|n\/a|na)/i.test(lower)) return "no";
  if (BRANDED_KEYWORDS.some((kw) => lower.includes(kw))) return "yes";
  return "";  // unknown — leave field empty so the user can choose
}

// ============================================================================
// Save / resume — localStorage with a single slot keyed per browser
// ============================================================================

const SAVE_KEY = "gencom_schedule_wizard_v1";

type Saved = { state: WizardState; step: number; savedAt: string };

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.state || typeof parsed?.step !== "number") return null;
    return parsed as Saved;
  } catch {
    return null;
  }
}

function persistSaved(state: WizardState, step: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, step, savedAt: new Date().toISOString() }));
  } catch {
    // quota / disabled — best-effort
  }
}

function clearSaved() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* */ }
}

// ============================================================================
// Main component
// ============================================================================

export default function ScheduleGenerator() {
  const [state, setState] = useState<WizardState>(emptyState);
  const [step, setStep] = useState(1);
  const topRef = useRef<HTMLDivElement | null>(null);
  // Resume banner — shown on Step 1 when a saved session exists. Cleared
  // either by accepting (load) or dismissing (clear).
  const [resumeOffer, setResumeOffer] = useState<Saved | null>(null);

  // On mount, surface a saved session if one exists. We don't auto-load —
  // that would surprise users who just want to start fresh — instead we
  // offer it as a one-click "Resume" banner on the Project Type page.
  useEffect(() => {
    const s = loadSaved();
    if (s) setResumeOffer(s);
  }, []);

  // Persist after every state/step change. Cheap to write, and the user can
  // close the tab mid-wizard without losing inputs.
  useEffect(() => {
    // Skip persisting the empty initial state to avoid clobbering a real save
    // before the user has actually entered anything.
    if (state.projectType === "" && step === 1) return;
    persistSaved(state, step);
  }, [state, step]);

  // Pane sequence — driven by project type AND input mode. Quick ROM has no
  // project source to choose, so we drop that page entirely (it would just
  // waste a click). Until a project type is picked, only the first two panes
  // exist so the user can't skip ahead via the progress bar.
  const panes: Pane[] = useMemo(() => {
    if (!state.projectType) {
      return [
        { kind: "project_type", title: PANE_TITLE.project_type },
        { kind: "input_mode", title: PANE_TITLE.input_mode },
      ];
    }
    let kinds = PANES_BY_TYPE[state.projectType];
    if (state.inputMode === "quick_rom") {
      kinds = kinds.filter((k) => k !== "project_source");
    }
    return kinds.map((k) => ({ kind: k, title: PANE_TITLE[k] }));
  }, [state.projectType, state.inputMode]);

  const totalSteps = panes.length;

  // Clamp if pane sequence shrinks (e.g., user changes project type).
  useEffect(() => {
    if (step > totalSteps) setStep(totalSteps);
  }, [step, totalSteps]);

  // Scroll to top on each step change so the user lands on the page header.
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const currentPane = panes[step - 1];

  function goNext() {
    if (step < totalSteps) setStep(step + 1);
  }
  function goBack() {
    if (step > 1) setStep(step - 1);
  }
  function goToStep(n: number) {
    if (n >= 1 && n <= totalSteps) setStep(n);
  }
  function startOver() {
    if (!window.confirm("Start over? All entries will be cleared.")) return;
    setState(emptyState());
    setStep(1);
    clearSaved();
    setResumeOffer(null);
  }

  function acceptResume() {
    if (!resumeOffer) return;
    setState(resumeOffer.state);
    setStep(resumeOffer.step);
    setResumeOffer(null);
  }
  function dismissResume() {
    clearSaved();
    setResumeOffer(null);
  }

  // Patch helper — narrow setter for nested fields.
  function patch<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // Picking a project from the source list pre-fills the wizard's property
  // context so the user doesn't re-key obvious fields.
  function loadFromProject(p: PropertyCard) {
    setState((s) => ({
      ...s,
      source: { kind: "project", projectId: p.id, projectName: p.name ?? "Untitled" },
      property: {
        ...s.property,
        name: p.name ?? s.property.name,
        brand: p.target_brand || p.current_brand || s.property.brand,
        location: [p.city, p.state].filter(Boolean).join(", ") || s.property.location,
        keys: typeof p.keys === "number" ? p.keys : s.property.keys,
      },
    }));
  }

  // ROM Capex archive uses a different shape (PropertyBasics, not PropertyCard).
  // Map across into the schedule's property fields so the user lands on
  // Property Context with everything pre-filled.
  function loadFromArchive(a: RomArchiveItem) {
    const b = a.basics ?? {};
    // ROM archive stores propertyType as one of "Urban High-Rise" | "Resort" |
    // "Airport" | "Suburban" | "Conversion". Map down to the schedule's
    // smaller enum: anything urban-ish → "Urban", resorts → "Resort".
    const ptypeMap: Record<string, WizardState["property"]["propertyType"]> = {
      "Urban High-Rise": "Urban",
      "Suburban": "Urban",
      "Airport": "Urban",
      "Conversion": "Urban",
      "Resort": "Resort",
    };
    setState((s) => ({
      ...s,
      source: { kind: "project", projectId: a.id, projectName: a.name },
      property: {
        ...s.property,
        name: b.name || a.name || s.property.name,
        brand: b.brand || s.property.brand,
        location: [b.city, b.stateOrCountry].filter(Boolean).join(", ") || s.property.location,
        keys: typeof b.roomCount === "number" ? b.roomCount : s.property.keys,
        propertyType: (b.propertyType && ptypeMap[b.propertyType]) || s.property.propertyType,
      },
    }));
  }

  // Dropping in a PIP file extracts property + scope; merge the extracted
  // payload over the current wizard state without nuking user-typed fields.
  function loadFromPipFile(file: File, extracted: ScheduleExtractedPip) {
    setState((s) => {
      const next = { ...s };
      next.source = { kind: "file", fileName: file.name };
      const ep = extracted.property;
      next.property = {
        ...s.property,
        name: ep.name || s.property.name,
        brand: ep.brand || s.property.brand,
        location: ep.location || s.property.location,
        keys: typeof ep.keys === "number" ? ep.keys : s.property.keys,
        propertyType: ep.propertyType || s.property.propertyType,
      };
      // OR-merge: user-checked items stay checked even if the extractor
      // didn't see them; extractor-checked items get added.
      const mergedScope: Record<string, boolean> = { ...s.scope };
      for (const [k, v] of Object.entries(extracted.scope)) {
        if (v) mergedScope[k] = true;
      }
      next.scope = mergedScope;
      if (extracted.notes && !s.scopeNotes) next.scopeNotes = extracted.notes;
      return next;
    });
  }

  // Per-pane "can advance" guard. Prevents Next when the user hasn't answered
  // the page's primary question. Skeleton-level — tighten later.
  function canAdvance(): boolean {
    switch (currentPane?.kind) {
      case "project_type":
        return !!state.projectType;
      case "input_mode":
        return !!state.inputMode;
      case "project_source":
        return state.source.kind !== "";
      case "property_context":
        return state.property.name.trim().length > 0;
      case "start_date":
        return !!state.startDate;
      case "target_completion":
        return !!state.targetCompletion && !!state.completionType;
      case "unit_of_measure":
        return !!state.unit;
      default:
        return true;
    }
  }

  return (
    <div ref={topRef} className="max-w-5xl mx-auto">
      {resumeOffer && step === 1 && state.projectType === "" && (
        <div className="mb-3 p-3 border border-gencom-gold bg-gencom-gold/10 rounded-md flex items-center gap-3">
          <div className="t-body flex-1">
            <span className="font-semibold">Resume previous schedule?</span>
            <span className="t-micro ml-2">
              Saved {new Date(resumeOffer.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {resumeOffer.state.property.name ? ` · ${resumeOffer.state.property.name}` : ""}
              {` · Step ${resumeOffer.step}`}
            </span>
          </div>
          <button onClick={acceptResume} className="t-eyebrow px-3 py-1.5 bg-emerald-700 text-white rounded-md hover:bg-emerald-800">Resume</button>
          <button onClick={dismissResume} className="t-eyebrow px-3 py-1.5 border border-gencom-sand bg-white rounded-md hover:bg-gencom-mist/60">Dismiss</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-gencom-sand p-5 shadow-sm">
        <StepHeader
          step={step}
          total={totalSteps}
          title={currentPane?.title ?? ""}
          titleFor={(n) => panes[n - 1]?.title ?? ""}
          onJump={goToStep}
        />

        <div className="min-h-[480px]">
          {currentPane?.kind === "project_type" && (
            <ProjectTypePane
              value={state.projectType}
              onChange={(v) => patch("projectType", v)}
              onAdvance={goNext}
            />
          )}
          {currentPane?.kind === "input_mode" && (
            <InputModePane
              value={state.inputMode}
              onChange={(v) => patch("inputMode", v)}
              onAdvance={goNext}
            />
          )}
          {currentPane?.kind === "project_source" && (
            <ProjectSourcePane
              mode={state.inputMode}
              source={state.source}
              onChange={(s) => patch("source", s)}
              onLoadProject={loadFromProject}
              onLoadArchive={loadFromArchive}
              onLoadPipFile={loadFromPipFile}
            />
          )}
          {currentPane?.kind === "property_context" && (
            <PropertyContextPane
              value={state.property}
              onChange={(p) => patch("property", p)}
            />
          )}
          {currentPane?.kind === "scope_selection" && (
            <ScopeSelectionPane
              scope={state.scope}
              notes={state.scopeNotes}
              onScopeChange={(s) => patch("scope", s)}
              onNotesChange={(n) => patch("scopeNotes", n)}
            />
          )}
          {currentPane?.kind === "start_date" && (
            <StartDatePane
              value={state.startDate}
              onChange={(v) => patch("startDate", v)}
            />
          )}
          {currentPane?.kind === "target_completion" && (
            <TargetCompletionPane
              date={state.targetCompletion}
              type={state.completionType}
              onDateChange={(v) => patch("targetCompletion", v)}
              onTypeChange={(v) => patch("completionType", v)}
            />
          )}
          {currentPane?.kind === "blackouts" && (
            <DateRangePane
              title="Blackout Periods"
              blurb="Date ranges where construction cannot occur — holidays, owner blackouts, major events."
              ranges={state.blackouts}
              onChange={(r) => patch("blackouts", r)}
            />
          )}
          {currentPane?.kind === "heavy_occupancy" && (
            <DateRangePane
              title="Heavy Occupancy Periods"
              blurb="Periods where construction must be limited or avoided — high season."
              ranges={state.heavyOccupancy}
              onChange={(r) => patch("heavyOccupancy", r)}
            />
          )}
          {currentPane?.kind === "pre_design" && (
            <PreDesignPane
              value={state.preDesign}
              onChange={(v) => patch("preDesign", v)}
            />
          )}
          {currentPane?.kind === "design_team" && (
            <DesignTeamPane
              value={state.designTeam}
              onChange={(v) => patch("designTeam", v)}
            />
          )}
          {currentPane?.kind === "design_process" && (
            <DesignProcessPane
              value={state.designProcess}
              onChange={(v) => patch("designProcess", v)}
              propertyBrand={state.property.brand}
            />
          )}
          {currentPane?.kind === "design_timeline" && (
            <DesignTimelinePane
              value={state.designTimeline}
              onChange={(v) => patch("designTimeline", v)}
              fullState={state}
            />
          )}
          {currentPane?.kind === "pre_construction" && (
            <PreConstructionPane
              value={state.preConstruction}
              onChange={(v) => patch("preConstruction", v)}
            />
          )}
          {currentPane?.kind === "construction_phasing" && (
            <ConstructionPhasingPane
              value={state.construction}
              onChange={(v) => patch("construction", v)}
            />
          )}
          {currentPane?.kind === "closeout" && (
            <CloseoutPane value={state.closeout} onChange={(v) => patch("closeout", v)} />
          )}
          {currentPane?.kind === "recert_questions" && (
            <RecertQuestionsPane value={state.recert} onChange={(v) => patch("recert", v)} />
          )}
          {currentPane?.kind === "unit_of_measure" && (
            <UnitOfMeasurePane value={state.unit} onChange={(v) => patch("unit", v)} />
          )}
          {currentPane?.kind === "generate" && <GeneratePane state={state} />}
        </div>

        {/* Footer nav */}
        <div className="mt-6 flex items-center gap-3 pt-4 border-t border-gencom-sand">
          <button
            type="button"
            onClick={goBack}
            disabled={step <= 1}
            className="t-body font-semibold px-4 py-2 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={step <= 1}
            className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            title="Jump back to the first step without clearing inputs"
          >
            ⇤ Back to Beginning
          </button>
          <button
            type="button"
            onClick={startOver}
            className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
          >
            ↺ Start Over
          </button>
          <div className="flex-1" />
          {step < totalSteps && (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance()}
              className="t-body font-semibold px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// StepHeader (matches FastBudget pattern)
// ============================================================================

function StepHeader({
  step, total, title, titleFor, onJump,
}: {
  step: number;
  total: number;
  title: string;
  titleFor?: (n: number) => string;
  onJump?: (n: number) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="t-h2 capitalize truncate">{title}</div>
        <div className="t-eyebrow whitespace-nowrap">Step {step} / {total}</div>
      </div>
      <div className="mt-3 flex gap-[3px]">
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const cls = n < step
            ? "bg-emerald-700"
            : n === step
              ? "bg-gencom-gold"
              : "bg-gencom-sand";
          const label = titleFor ? titleFor(n) : "";
          return (
            <button
              key={i}
              type="button"
              onClick={onJump ? () => onJump(n) : undefined}
              disabled={!onJump || n > step}
              title={label ? `Step ${n}: ${label}` : `Step ${n}`}
              className={`group relative flex-1 h-4 flex items-center ${onJump && n <= step ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className={`h-1.5 w-full rounded-full transition-all ${cls}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Reusable bits
// ============================================================================

function ChoiceCard({
  selected, onClick, label, blurb, badge,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  blurb?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left w-full p-4 rounded-lg border-2 transition ${
        selected
          ? "border-emerald-700 bg-emerald-50"
          : "border-gencom-sand bg-white hover:border-emerald-700 hover:bg-emerald-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`t-body font-semibold ${selected ? "text-emerald-700" : "text-gencom-ink"}`}>
          {label}
        </div>
        {badge && (
          <span className="t-micro px-1.5 py-0.5 rounded bg-gencom-mist border border-gencom-sand">
            {badge}
          </span>
        )}
      </div>
      {blurb && <div className="t-micro mt-1">{blurb}</div>}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="t-eyebrow mb-1.5">{children}</div>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-emerald-700 ${props.className ?? ""}`}
    />
  );
}

function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput type="number" {...props} />;
}

function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput type="date" {...props} />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="t-micro px-2 py-0.5 rounded-full bg-gencom-mist border border-gencom-sand text-gencom-stone">
      {children}
    </span>
  );
}

// ============================================================================
// Panes
// ============================================================================

function ProjectTypePane({
  value, onChange, onAdvance,
}: {
  value: ProjectType;
  onChange: (v: ProjectType) => void;
  onAdvance: () => void;
}) {
  return (
    <div>
      <div className="t-body mb-4">
        Pick the project type. This drives the schedule template — phase set, default durations,
        and which questions you'll be asked.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PROJECT_TYPES.map((p) => (
          <ChoiceCard
            key={p.value}
            selected={value === p.value}
            onClick={() => {
              onChange(p.value);
              // Small UX nicety: tapping a card auto-advances the wizard,
              // matching FastBudget's "click to continue" feel.
              setTimeout(onAdvance, 120);
            }}
            label={p.label}
            blurb={p.blurb}
          />
        ))}
      </div>
    </div>
  );
}

function InputModePane({
  value, onChange, onAdvance,
}: {
  value: InputMode;
  onChange: (v: InputMode) => void;
  onAdvance: () => void;
}) {
  return (
    <div>
      <div className="t-body mb-4">
        Where is the project information coming from? All three paths produce the same schedule
        format — only the inputs differ.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {INPUT_MODES.map((m) => (
          <ChoiceCard
            key={m.value}
            selected={value === m.value}
            onClick={() => {
              onChange(m.value);
              setTimeout(onAdvance, 120);
            }}
            label={m.label}
            blurb={m.blurb}
          />
        ))}
      </div>
    </div>
  );
}

// Mirrors the structure FastBudget writes — we only read a subset, but
// duplicate the type here so the archive contract is local and obvious.
type RomArchiveItem = {
  id: string;
  name: string;
  savedAt: string;
  basics?: {
    name?: string;
    brand?: string;
    city?: string;
    stateOrCountry?: string;
    roomCount?: number | "";
    propertyType?: string;
  };
};

function loadRomArchive(): RomArchiveItem[] {
  try {
    const raw = localStorage.getItem("gencom_fast_budget_archive_v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ProjectSourcePane({
  mode, source, onChange, onLoadProject, onLoadArchive, onLoadPipFile,
}: {
  mode: InputMode;
  source: WizardState["source"];
  onChange: (s: WizardState["source"]) => void;
  onLoadProject: (p: PropertyCard) => void;
  onLoadArchive: (a: RomArchiveItem) => void;
  onLoadPipFile: (file: File, extracted: ScheduleExtractedPip) => void;
}) {
  const [properties, setProperties] = useState<PropertyCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pull live property list once when the pane mounts. Used by both PIP and
  // Budget modes — the PIP Generator and Budget Generator both write to the
  // same `properties` table.
  useEffect(() => {
    if (mode === "quick_rom") return;
    let cancelled = false;
    setLoadError(null);
    api.listProperties(false)
      .then((list) => { if (!cancelled) setProperties(list); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [mode]);

  async function handleFileDrop(file: File) {
    setExtracting(true);
    setExtractError(null);
    setExtractNote(null);
    try {
      const result = await api.scheduleExtractPip(file);
      onLoadPipFile(file, result);
      const checked = Object.values(result.scope).filter(Boolean).length;
      setExtractNote(
        `Extracted ${checked} scope item${checked === 1 ? "" : "s"} from "${file.name}". Review on later steps.`,
      );
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  if (mode === "quick_rom") {
    return (
      <div className="t-body">
        Quick ROM mode — no source needed. We'll go straight to property context next.
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onChange({ kind: "project", projectName: "Quick ROM (no source)" })}
            className={`px-4 py-2 rounded-md border-2 ${
              source.kind === "project"
                ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                : "border-gencom-sand hover:border-emerald-700"
            }`}
          >
            Continue without a source
          </button>
        </div>
      </div>
    );
  }

  if (mode === "pip") {
    return (
      <div>
        <div className="t-body mb-4">
          Pull a project from the PIP Generator, or drop in a PIP file. Claude extracts a
          high-level scope list and seeds the next pages.
        </div>

        {/* File drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileDrop(f);
          }}
          className={`p-6 border-2 border-dashed rounded-md text-center mb-4 transition ${
            extracting ? "border-emerald-700 bg-emerald-50" : "border-gencom-sand hover:border-emerald-700 hover:bg-emerald-50/40"
          }`}
        >
          <div className="t-body mb-2">
            {extracting ? "Reading PIP with Claude…" : "Drop a PIP file here, or"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileDrop(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting}
            className="t-body font-semibold px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
          >
            Browse files
          </button>
          <div className="t-micro mt-2">PDF · DOCX · XLSX · TXT</div>
        </div>
        {extractNote && (
          <div className="mb-4 p-3 border border-emerald-300 bg-emerald-50 text-emerald-800 t-body rounded-md">
            ✓ {extractNote}
          </div>
        )}
        {extractError && (
          <div className="mb-4 p-3 border border-red-300 bg-red-50 text-red-700 t-body rounded-md">
            {extractError}
          </div>
        )}

        <div className="t-eyebrow mb-2">Or pick a project</div>
        <ProjectList properties={properties} loadError={loadError}
                     selectedId={source.kind === "project" ? source.projectId : undefined}
                     onPick={onLoadProject} />
      </div>
    );
  }

  // Budget mode — properties + ROM Capex archive
  const archive = loadRomArchive();
  return (
    <div>
      <div className="t-body mb-4">
        Pick a project — we'll inherit its property context. (Scope inheritance from the
        full Budget Generator lands in the next pass; for now scope stays opt-in.)
      </div>

      <div className="t-eyebrow mb-2">Properties</div>
      <ProjectList properties={properties} loadError={loadError}
                   selectedId={source.kind === "project" ? source.projectId : undefined}
                   onPick={onLoadProject} />

      {archive.length > 0 && (
        <div className="mt-5">
          <div className="t-eyebrow mb-2">ROM Capex Archive ({archive.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {archive.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onLoadArchive(a)}
                className={`text-left p-3 rounded-md border-2 ${
                  source.kind === "project" && source.projectId === a.id
                    ? "border-emerald-700 bg-emerald-50"
                    : "border-gencom-sand hover:border-emerald-700"
                }`}
              >
                <div className="t-body font-semibold">{a.name}</div>
                <div className="t-micro">
                  Saved {new Date(a.savedAt).toLocaleDateString()}
                  {a.basics?.roomCount ? ` · ${a.basics.roomCount} keys` : ""}
                  {a.basics?.brand ? ` · ${a.basics.brand}` : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectList({
  properties, loadError, selectedId, onPick,
}: {
  properties: PropertyCard[] | null;
  loadError: string | null;
  selectedId: string | undefined;
  onPick: (p: PropertyCard) => void;
}) {
  if (loadError) {
    return (
      <div className="p-3 border border-red-300 bg-red-50 text-red-700 t-body rounded-md">
        Failed to load projects: {loadError}
      </div>
    );
  }
  if (properties === null) {
    return <div className="t-micro italic text-gencom-stone">Loading projects…</div>;
  }
  if (properties.length === 0) {
    return (
      <div className="t-micro italic text-gencom-stone">
        No projects yet. Create one in the PIP Generator or Budget Generator first.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
      {properties.map((p) => {
        const sel = selectedId === p.id;
        const loc = [p.city, p.state].filter(Boolean).join(", ");
        const brand = p.target_brand || p.current_brand;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className={`text-left p-3 rounded-md border-2 ${
              sel ? "border-emerald-700 bg-emerald-50" : "border-gencom-sand hover:border-emerald-700"
            }`}
          >
            <div className="t-body font-semibold truncate">{p.name || "Untitled"}</div>
            <div className="t-micro">
              {brand ? `${brand}` : ""}
              {loc ? `${brand ? " · " : ""}${loc}` : ""}
              {p.keys ? ` · ${p.keys} keys` : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PropertyContextPane({
  value, onChange,
}: {
  value: WizardState["property"];
  onChange: (p: WizardState["property"]) => void;
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  function set<K extends keyof WizardState["property"]>(k: K, v: WizardState["property"][K]) {
    onChange({ ...value, [k]: v });
  }

  async function aiAutofill() {
    if (!value.name.trim()) {
      setAiError("Enter a property name first.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const r = await api.fastBudgetEnrich({ name: value.name, city_hint: value.location || undefined });
      // FastBudget's enrich returns a wider property_type enum than the
      // schedule's (Urban / Resort / Branded Residential). Map the closest fit.
      const ptMap: Record<string, WizardState["property"]["propertyType"]> = {
        "Urban High-Rise": "Urban",
        "Suburban": "Urban",
        "Airport": "Urban",
        "Conversion": "Urban",
        "Resort": "Resort",
      };
      // Don't clobber fields the user already filled in — only fill blanks.
      const filled: string[] = [];
      const next: WizardState["property"] = { ...value };
      if (!next.brand && r.brand) { next.brand = r.brand; filled.push("brand"); }
      if (!next.location && (r.city || r.state_or_country)) {
        next.location = [r.city, r.state_or_country].filter(Boolean).join(", ");
        filled.push("location");
      }
      if (next.keys === "" && typeof r.room_count === "number") {
        next.keys = r.room_count;
        filled.push("keys");
      }
      if (!next.propertyType && r.property_type) {
        const mapped = ptMap[r.property_type];
        if (mapped) { next.propertyType = mapped; filled.push("type"); }
      }
      onChange(next);
      setAiNote(filled.length
        ? `Filled: ${filled.join(", ")}${r.confidence ? ` · confidence ${r.confidence}` : ""}`
        : "Claude returned no new fields beyond what you've entered.");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      <div className="t-body mb-4">
        Confirm the property context. Auto-filled when you pulled from a project source —
        otherwise enter the property name and click <span className="font-semibold">AI Autofill</span> to
        have Claude look up the rest.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <FieldLabel>Property name</FieldLabel>
          <div className="flex gap-2">
            <TextInput value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g., Ritz-Carlton Central Park" />
            <button
              type="button"
              onClick={aiAutofill}
              disabled={aiLoading || !value.name.trim()}
              className="t-body font-semibold whitespace-nowrap px-4 py-2 bg-gencom-gold text-gencom-ink rounded-md hover:bg-gencom-gold/80 disabled:opacity-50"
              title="Use Claude to look up brand, location, key count, and property type"
            >
              {aiLoading ? "Looking up…" : "✨ AI Autofill"}
            </button>
          </div>
          {aiNote && (
            <div className="mt-2 t-micro text-emerald-800">{aiNote}</div>
          )}
          {aiError && (
            <div className="mt-2 t-micro text-red-700">{aiError}</div>
          )}
        </div>
        <div>
          <FieldLabel>Brand</FieldLabel>
          <TextInput value={value.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g., Ritz-Carlton, Marriott, Independent" />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <TextInput value={value.location} onChange={(e) => set("location", e.target.value)} placeholder="City, State" />
        </div>
        <div>
          <FieldLabel>Number of keys</FieldLabel>
          <NumberInput value={value.keys} onChange={(e) => set("keys", e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g., 250" />
        </div>
        <div>
          <FieldLabel>Property type</FieldLabel>
          <select
            value={value.propertyType}
            onChange={(e) => set("propertyType", e.target.value as WizardState["property"]["propertyType"])}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white"
          >
            <option value="">— pick one —</option>
            <option value="Urban">Urban</option>
            <option value="Resort">Resort</option>
            <option value="Branded Residential">Branded Residential</option>
          </select>
        </div>
        <div>
          <FieldLabel>Seasonality / occupancy notes</FieldLabel>
          <TextInput value={value.seasonality} onChange={(e) => set("seasonality", e.target.value)} placeholder="e.g., high season Dec–Apr" />
        </div>
        <div>
          <FieldLabel>Project Manager (if assigned)</FieldLabel>
          <TextInput value={value.pm} onChange={(e) => set("pm", e.target.value)} />
        </div>
        <div>
          <FieldLabel>ID Firm (if assigned)</FieldLabel>
          <TextInput value={value.idFirm} onChange={(e) => set("idFirm", e.target.value)} />
        </div>
        <div>
          <FieldLabel>GC (if assigned)</FieldLabel>
          <TextInput value={value.gc} onChange={(e) => set("gc", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function ScopeSelectionPane({
  scope, notes, onScopeChange, onNotesChange,
}: {
  scope: Record<string, boolean>;
  notes: string;
  onScopeChange: (s: Record<string, boolean>) => void;
  onNotesChange: (n: string) => void;
}) {
  const all = STANDARD_SCOPE;
  function toggle(k: string) {
    onScopeChange({ ...scope, [k]: !scope[k] });
  }
  const selectedCount = Object.values(scope).filter(Boolean).length;
  return (
    <div>
      <div className="t-body mb-4">
        Check everything in scope. All items are <span className="font-semibold">opt-in</span> —
        nothing is selected by default. Keep it high-level (e.g., "Guestrooms," not "Soft goods only in suites").
      </div>
      <div className="t-eyebrow mb-2">{selectedCount} selected</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {all.map((label) => {
          const sel = !!scope[label];
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggle(label)}
              className={`text-left flex items-center gap-2 px-3 py-2 rounded-md border-2 ${
                sel
                  ? "border-emerald-700 bg-emerald-50"
                  : "border-gencom-sand bg-white hover:border-emerald-700"
              }`}
            >
              <span className={`inline-block w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[10px] ${
                sel ? "border-emerald-700 bg-emerald-700" : "border-gencom-sand bg-white"
              }`}>{sel ? "✓" : ""}</span>
              <span className="t-body">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <FieldLabel>Notes (optional)</FieldLabel>
        <TextInput value={notes} onChange={(e) => onNotesChange(e.target.value)} placeholder="Anything specific about scope (e.g., guestroom phasing notes, exclusions)" />
      </div>
    </div>
  );
}

function StartDatePane({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="t-body mb-4">When can pre-design kick off?</div>
      <div className="max-w-xs">
        <FieldLabel>Start date</FieldLabel>
        <DateInput value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      <div className="t-micro mt-2">All downstream phases flow from this date.</div>
    </div>
  );
}

function TargetCompletionPane({
  date, type, onDateChange, onTypeChange,
}: {
  date: string;
  type: WizardState["completionType"];
  onDateChange: (v: string) => void;
  onTypeChange: (v: WizardState["completionType"]) => void;
}) {
  return (
    <div>
      <div className="t-body mb-4">When does this need to be done?</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div>
          <FieldLabel>Target completion</FieldLabel>
          <DateInput value={date} onChange={(e) => onDateChange(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Hard or soft target?</FieldLabel>
          <div className="flex gap-2">
            <ChoiceCard
              selected={type === "hard"}
              onClick={() => onTypeChange("hard")}
              label="Hard"
              blurb="Schedule will be compressed if needed."
            />
            <ChoiceCard
              selected={type === "soft"}
              onClick={() => onTypeChange("soft")}
              label="Soft"
              blurb="Standard durations; flag if we slip."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DateRangePane({
  title, blurb, ranges, onChange,
}: {
  title: string;
  blurb: string;
  ranges: DateRange[];
  onChange: (r: DateRange[]) => void;
}) {
  function add() {
    onChange([...ranges, { id: uid(), from: "", to: "", label: "" }]);
  }
  function update(i: number, patch: Partial<DateRange>) {
    onChange(ranges.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    onChange(ranges.filter((_, idx) => idx !== i));
  }
  return (
    <div>
      <div className="t-body mb-4">{blurb}</div>
      <div className="space-y-2">
        {ranges.length === 0 && (
          <div className="t-micro text-gencom-stone italic">None added yet. Click below to add one — or skip if not applicable.</div>
        )}
        {ranges.map((r, i) => (
          <div key={r.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end p-3 border border-gencom-sand rounded-md bg-gencom-mist/30">
            <div>
              <FieldLabel>From</FieldLabel>
              <DateInput value={r.from} onChange={(e) => update(i, { from: e.target.value })} />
            </div>
            <div>
              <FieldLabel>To</FieldLabel>
              <DateInput value={r.to} onChange={(e) => update(i, { to: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Label</FieldLabel>
              <TextInput value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={title.includes("Blackout") ? "e.g., Christmas / New Year" : "e.g., Summer high season"} />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="t-eyebrow px-3 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="t-body font-semibold mt-3 px-4 py-2 border border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50"
      >
        + Add range
      </button>
    </div>
  );
}

function PreDesignPane({
  value, onChange,
}: {
  value: WizardState["preDesign"];
  onChange: (v: WizardState["preDesign"]) => void;
}) {
  function set<K extends keyof WizardState["preDesign"]>(k: K, v: WizardState["preDesign"][K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div>
      <div className="t-body mb-4">Quick pre-design check.</div>
      <div className="space-y-5">
        <div>
          <FieldLabel>Is the ID firm already selected?</FieldLabel>
          <div className="flex gap-2">
            {(["yes", "no", "tbd"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.idFirmSelected === v} onClick={() => set("idFirmSelected", v)} label={v.toUpperCase()} />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Is the PM in place?</FieldLabel>
          <div className="flex gap-2">
            {(["yes", "no", "tbd"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.pmInPlace === v} onClick={() => set("pmInPlace", v)} label={v.toUpperCase()} />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Is an RFP needed (ID firm / PM / both)?</FieldLabel>
          <div className="flex gap-2">
            {(["yes", "no", "n/a"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.rfpNeeded === v} onClick={() => set("rfpNeeded", v)} label={v.toUpperCase()} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignTeamPane({
  value, onChange,
}: {
  value: WizardState["designTeam"];
  onChange: (v: WizardState["designTeam"]) => void;
}) {
  function set<K extends keyof WizardState["designTeam"]>(k: K, v: WizardState["designTeam"][K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div>
      <div className="t-body mb-4">Design team composition. Tier classification feeds the AI duration recommendations.</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="t-eyebrow mb-2">ID Firm</div>
          <FieldLabel>Firm name</FieldLabel>
          <TextInput value={value.idFirmName} onChange={(e) => set("idFirmName", e.target.value)} placeholder="e.g., Champalimaud" />
          <div className="mt-3">
            <FieldLabel>Tier</FieldLabel>
            <div className="flex gap-2">
              {(["boutique", "mid", "global"] as const).map((t) => (
                <ChoiceCard key={t} selected={value.idFirmTier === t} onClick={() => set("idFirmTier", t)} label={t === "mid" ? "Mid-size" : t[0].toUpperCase() + t.slice(1)} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="t-eyebrow mb-2">Architect of Record</div>
          <FieldLabel>Engagement model</FieldLabel>
          <div className="space-y-2">
            {([
              ["in_house", "In-house / Owner's architect"],
              ["id_in_house", "ID firm's in-house architect"],
              ["separate", "Separate AOR"],
              ["not_required", "Not required"],
            ] as const).map(([v, label]) => (
              <ChoiceCard key={v} selected={value.aorModel === v} onClick={() => set("aorModel", v)} label={label} />
            ))}
          </div>
          <div className="mt-3">
            <FieldLabel>Architect tier</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {(["boutique", "mid", "global", "n/a"] as const).map((t) => (
                <ChoiceCard key={t} selected={value.aorTier === t} onClick={() => set("aorTier", t as Tier | "n/a")} label={t === "mid" ? "Mid-size" : t === "n/a" ? "N/A" : t[0].toUpperCase() + t.slice(1)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignProcessPane({
  value, onChange, propertyBrand,
}: {
  value: WizardState["designProcess"];
  onChange: (v: WizardState["designProcess"]) => void;
  propertyBrand: string;
}) {
  function set<K extends keyof WizardState["designProcess"]>(k: K, v: WizardState["designProcess"][K]) {
    onChange({ ...value, [k]: v });
  }
  const phases = ["concept", "sd", "dd", "cd"] as const;

  // Auto-fill brand standards Y/N from the property's brand. Runs once when
  // we land on this pane (i.e. propertyBrand became non-empty) and only when
  // the user hasn't already answered the question — never overwrites their
  // explicit choice.
  useEffect(() => {
    const inferred = inferBrandStatus(propertyBrand);
    if (!inferred || value.brandStandards) return;
    const next = { ...value, brandStandards: inferred } as WizardState["designProcess"];
    if (inferred === "yes" && !value.brand) next.brand = propertyBrand;
    onChange(next);
    // We deliberately omit value/onChange from deps — propertyBrand changing
    // is the only signal that should trigger a re-evaluation. Re-running on
    // every onChange would fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyBrand]);
  return (
    <div>
      <div className="t-body mb-4">
        Design process variables. All seven questions feed the AI's design timeline recommendation.
      </div>
      <div className="space-y-5">
        {/* 1. Brand standards review */}
        <div>
          <FieldLabel>1. Brand standards review required?</FieldLabel>
          <div className="flex gap-2 mb-2">
            {(["yes", "no", "n/a"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.brandStandards === v} onClick={() => set("brandStandards", v)} label={v.toUpperCase()} />
            ))}
          </div>
          {value.brandStandards === "yes" && (
            <TextInput value={value.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Which brand? (Marriott, Hilton, IHG, Hyatt, Accor, etc.)" />
          )}
        </div>

        {/* 2. Brand approval gates */}
        <div>
          <FieldLabel>2. Brand approval gates required (separate from owner approval)?</FieldLabel>
          <div className="flex gap-2 mb-2">
            <ChoiceCard selected={value.brandApprovalGates} onClick={() => set("brandApprovalGates", true)} label="YES" />
            <ChoiceCard selected={!value.brandApprovalGates} onClick={() => set("brandApprovalGates", false)} label="NO" />
          </div>
          {value.brandApprovalGates && (
            <div className="flex gap-2 flex-wrap">
              {phases.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set("brandApprovalPhases", { ...value.brandApprovalPhases, [p]: !value.brandApprovalPhases[p] })}
                  className={`px-3 py-1.5 rounded-md border-2 t-body ${
                    value.brandApprovalPhases[p]
                      ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                      : "border-gencom-sand"
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Owner review cycles */}
        <div>
          <FieldLabel>3. Owner review cycles per phase</FieldLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {phases.map((p) => (
              <div key={p}>
                <div className="t-micro mb-1">{p.toUpperCase()}</div>
                <select
                  value={value.ownerCycles[p]}
                  onChange={(e) => set("ownerCycles", { ...value.ownerCycles, [p]: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white"
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}{n === 3 ? "+" : ""} cycle{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Multi-firm competition */}
        <div>
          <FieldLabel>4. Concept design competition (multi-firm)?</FieldLabel>
          <div className="flex gap-2 mb-2">
            <ChoiceCard selected={value.competition} onClick={() => set("competition", true)} label="YES" />
            <ChoiceCard selected={!value.competition} onClick={() => set("competition", false)} label="NO" />
          </div>
          {value.competition && (
            <div className="max-w-xs">
              <FieldLabel># of firms</FieldLabel>
              <NumberInput value={value.competitionFirms} onChange={(e) => set("competitionFirms", e.target.value === "" ? "" : Number(e.target.value))} placeholder="2 / 3 / 4+" />
            </div>
          )}
        </div>

        {/* 5. Mockup */}
        <div>
          <FieldLabel>5. Model room / mockup required?</FieldLabel>
          <div className="flex gap-2 mb-2">
            <ChoiceCard selected={value.mockup} onClick={() => set("mockup", true)} label="YES" />
            <ChoiceCard selected={!value.mockup} onClick={() => set("mockup", false)} label="NO" />
          </div>
          {value.mockup && (
            <div className="flex gap-2 flex-wrap">
              {([["end_dd", "End of DD"], ["mid_cd", "Mid-CD"], ["end_cd", "End of CD"]] as const).map(([v, label]) => (
                <ChoiceCard key={v} selected={value.mockupPhase === v} onClick={() => set("mockupPhase", v)} label={label} />
              ))}
            </div>
          )}
        </div>

        {/* 6. Survey */}
        <div>
          <FieldLabel>6. Existing conditions / as-built survey needed?</FieldLabel>
          <div className="flex gap-2 mb-2">
            {(["yes", "no", "partial"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.survey === v} onClick={() => set("survey", v)} label={v === "partial" ? "Partial" : v.toUpperCase()} />
            ))}
          </div>
          {(value.survey === "yes" || value.survey === "partial") && (
            <div className="flex gap-2 flex-wrap">
              {([
                ["field", "Field measure only"],
                ["matterport", "Matterport 3D scan"],
                ["full", "Full architectural survey"],
              ] as const).map(([v, label]) => (
                <ChoiceCard key={v} selected={value.surveyType === v} onClick={() => set("surveyType", v)} label={label} />
              ))}
            </div>
          )}
        </div>

        {/* 7. Procurement agent */}
        <div>
          <FieldLabel>7. FF&E procurement agent involved?</FieldLabel>
          <div className="flex gap-2 mb-2">
            {(["yes", "no", "tbd"] as const).map((v) => (
              <ChoiceCard key={v} selected={value.procurementAgent === v} onClick={() => set("procurementAgent", v)} label={v.toUpperCase()} />
            ))}
          </div>
          {value.procurementAgent === "yes" && (
            <div className="flex gap-2 flex-wrap">
              {([
                ["dd", "During DD"],
                ["cd_start", "Start of CD"],
                ["ffe_spec", "At FF&E specification"],
              ] as const).map(([v, label]) => (
                <ChoiceCard key={v} selected={value.procurementAgentEngagement === v} onClick={() => set("procurementAgentEngagement", v)} label={label} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DesignTimelinePane({
  value, onChange, fullState,
}: {
  value: WizardState["designTimeline"];
  onChange: (v: WizardState["designTimeline"]) => void;
  fullState: WizardState;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<ScheduleAiDurations["rationale"] | null>(null);

  function set<K extends keyof WizardState["designTimeline"]>(k: K, v: WizardState["designTimeline"][K]) {
    onChange({ ...value, [k]: v });
  }
  async function aiRecommend() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.scheduleAiDurations(fullState as unknown as Record<string, unknown>);
      onChange({ concept: result.concept, sd: result.sd, dd: result.dd, cd: result.cd });
      setRationale(result.rationale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  function clear() {
    onChange({ concept: "", sd: "", dd: "", cd: "" });
    setRationale(null);
  }
  const phases: { key: keyof WizardState["designTimeline"]; label: string; range: string }[] = [
    { key: "concept", label: "Concept Design", range: "Typical: 4–8 weeks" },
    { key: "sd",      label: "Schematic Design", range: "Typical: 8–12 weeks" },
    { key: "dd",      label: "Design Development", range: "Typical: 10–14 weeks" },
    { key: "cd",      label: "CD / FF&E Specifications", range: "Typical: 10–14 weeks" },
  ];
  return (
    <div>
      <div className="t-body mb-4">
        Set durations per design phase. Click <span className="font-semibold">AI Recommend</span> to
        auto-fill based on your earlier answers, then edit any value.
      </div>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={aiRecommend}
          disabled={loading}
          className="t-body font-semibold px-4 py-2 bg-gencom-gold text-gencom-ink rounded-md hover:bg-gencom-gold/80 disabled:opacity-60"
        >
          {loading ? "Thinking…" : "✨ AI Recommend Timeline"}
        </button>
        <button
          type="button"
          onClick={clear}
          className="t-body font-semibold px-4 py-2 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
        >
          Clear
        </button>
      </div>
      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 text-red-700 t-body rounded-md">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {phases.map((p) => (
          <div key={p.key} className="p-4 border border-gencom-sand rounded-md bg-gencom-mist/20">
            <FieldLabel>{p.label}</FieldLabel>
            <div className="flex items-center gap-2">
              <NumberInput
                value={value[p.key]}
                onChange={(e) => set(p.key, e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="weeks"
                className="max-w-[120px]"
              />
              <Pill>weeks</Pill>
            </div>
            <div className="t-micro mt-2">{p.range}</div>
            {rationale?.[p.key] && (
              <div className="mt-2 p-2 bg-gencom-gold/15 border border-gencom-gold/40 rounded text-[11px] text-gencom-ink">
                <span className="font-semibold">AI: </span>{rationale[p.key]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreConstructionPane({
  value, onChange,
}: {
  value: WizardState["preConstruction"];
  onChange: (v: WizardState["preConstruction"]) => void;
}) {
  function set<K extends keyof WizardState["preConstruction"]>(k: K, v: WizardState["preConstruction"][K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div>
      <div className="t-body mb-4">Pre-construction logistics — GC selection and permitting.</div>
      <div className="space-y-5">
        <div>
          <FieldLabel>GC selection method</FieldLabel>
          <div className="flex gap-2 flex-wrap">
            {([
              ["bid", "Open bid"],
              ["negotiated", "Negotiated"],
              ["design_build", "Design-build"],
            ] as const).map(([v, label]) => (
              <ChoiceCard key={v} selected={value.gcSelectionMethod === v} onClick={() => set("gcSelectionMethod", v)} label={label} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Permit jurisdiction</FieldLabel>
            <TextInput value={value.permitJurisdiction} onChange={(e) => set("permitJurisdiction", e.target.value)} placeholder="e.g., NYC DOB, City of Miami Beach" />
          </div>
          <div>
            <FieldLabel>Expected permit duration (weeks)</FieldLabel>
            <NumberInput value={value.permitWeeks} onChange={(e) => set("permitWeeks", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConstructionPhasingPane({
  value, onChange,
}: {
  value: WizardState["construction"];
  onChange: (v: WizardState["construction"]) => void;
}) {
  function set<K extends keyof WizardState["construction"]>(k: K, v: WizardState["construction"][K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div>
      <div className="t-body mb-4">How will construction be phased?</div>
      <div className="space-y-5">
        <div>
          <FieldLabel>Phased rollout?</FieldLabel>
          <div className="flex gap-2">
            <ChoiceCard selected={value.phased} onClick={() => set("phased", true)} label="YES" blurb="e.g., guestrooms in waves" />
            <ChoiceCard selected={!value.phased} onClick={() => set("phased", false)} label="NO" blurb="Single continuous build" />
          </div>
        </div>
        {value.phased && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel># of phases</FieldLabel>
              <NumberInput value={value.phaseCount} onChange={(e) => set("phaseCount", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div>
              <FieldLabel>Floors per phase</FieldLabel>
              <NumberInput value={value.floorsPerPhase} onChange={(e) => set("floorsPerPhase", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
        )}
        <div>
          <FieldLabel>Amenities sequencing notes</FieldLabel>
          <TextInput value={value.amenitiesSequencing} onChange={(e) => set("amenitiesSequencing", e.target.value)} placeholder="e.g., F&B opens with first guestroom phase; spa last" />
        </div>
      </div>
    </div>
  );
}

function RecertQuestionsPane({
  value, onChange,
}: {
  value: WizardState["recert"];
  onChange: (v: WizardState["recert"]) => void;
}) {
  function set<K extends keyof WizardState["recert"]>(k: K, v: WizardState["recert"][K]) {
    onChange({ ...value, [k]: v });
  }
  function toggleFocus(k: keyof WizardState["recert"]["repairFocus"]) {
    onChange({ ...value, repairFocus: { ...value.repairFocus, [k]: !value.repairFocus[k] } });
  }
  function toggleFiling(k: keyof WizardState["recert"]["filings"]) {
    onChange({ ...value, filings: { ...value.filings, [k]: !value.filings[k] } });
  }
  return (
    <div>
      <div className="t-body mb-4">
        Recertification specifics. These drive the investigation and filing
        durations rather than design phases.
      </div>
      <div className="space-y-5">
        <div>
          <FieldLabel>Recert type</FieldLabel>
          <div className="flex gap-2 flex-wrap">
            {([
              ["25_year", "25-Year"],
              ["40_year", "40-Year"],
              ["50_year", "50-Year"],
              ["other", "Other"],
            ] as const).map(([v, label]) => (
              <ChoiceCard key={v} selected={value.recertType === v} onClick={() => set("recertType", v)} label={label} />
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Engineering investigation type</FieldLabel>
          <div className="space-y-2">
            {([
              ["visual_gpr", "Visual + GPR scan", "Standard investigation — visual survey + ground-penetrating radar"],
              ["full_structural", "Full structural assessment", "Includes core sampling, instrumented testing, structural calcs"],
              ["phased", "Phased investigation", "Initial visual + targeted follow-up where issues are found"],
            ] as const).map(([v, label, blurb]) => (
              <ChoiceCard key={v} selected={value.investigationType === v} onClick={() => set("investigationType", v)} label={label} blurb={blurb} />
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Repair scope focus (multi-select)</FieldLabel>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {([
              ["concrete", "Concrete repair / spalling"],
              ["waterproofing", "Waterproofing"],
              ["structural", "Structural reinforcement"],
              ["facade", "Facade / cladding"],
              ["mep", "MEP penetrations / risers"],
            ] as const).map(([k, label]) => {
              const sel = value.repairFocus[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleFocus(k)}
                  className={`text-left flex items-center gap-2 px-3 py-2 rounded-md border-2 ${
                    sel ? "border-emerald-700 bg-emerald-50" : "border-gencom-sand hover:border-emerald-700"
                  }`}
                >
                  <span className={`inline-block w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[10px] ${
                    sel ? "border-emerald-700 bg-emerald-700" : "border-gencom-sand bg-white"
                  }`}>{sel ? "✓" : ""}</span>
                  <span className="t-body">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Owner occupancy during repairs</FieldLabel>
          <div className="space-y-2">
            {([
              ["fully_occupied", "Fully occupied", "Repairs proceed alongside guest operations — slower, requires noise/dust controls"],
              ["phased", "Phased / floor-by-floor", "Wings or floors taken out of service in waves"],
              ["vacated", "Vacated", "Building empty for the duration — fastest path"],
            ] as const).map(([v, label, blurb]) => (
              <ChoiceCard key={v} selected={value.occupancy === v} onClick={() => set("occupancy", v)} label={label} blurb={blurb} />
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Filing requirements (NYC TR-series — leave blank if non-NYC)</FieldLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              ["tr1", "TR1 (technical statements)"],
              ["tr4", "TR4 (energy compliance)"],
              ["tr8", "TR8 (energy code progress)"],
              ["other", "Other"],
            ] as const).map(([k, label]) => {
              const sel = value.filings[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleFiling(k)}
                  className={`text-left flex items-center gap-2 px-3 py-2 rounded-md border-2 ${
                    sel ? "border-emerald-700 bg-emerald-50" : "border-gencom-sand hover:border-emerald-700"
                  }`}
                >
                  <span className={`inline-block w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[10px] ${
                    sel ? "border-emerald-700 bg-emerald-700" : "border-gencom-sand bg-white"
                  }`}>{sel ? "✓" : ""}</span>
                  <span className="t-body">{label}</span>
                </button>
              );
            })}
          </div>
          {value.filings.other && (
            <div className="mt-2">
              <TextInput
                value={value.filingsOther}
                onChange={(e) => set("filingsOther", e.target.value)}
                placeholder="Describe other filing requirements"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseoutPane({
  value, onChange,
}: {
  value: WizardState["closeout"];
  onChange: (v: WizardState["closeout"]) => void;
}) {
  function set<K extends keyof WizardState["closeout"]>(k: K, v: WizardState["closeout"][K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div>
      <div className="t-body mb-4">Closeout details.</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <FieldLabel>Punch list duration (weeks)</FieldLabel>
          <NumberInput value={value.punchListWeeks} onChange={(e) => set("punchListWeeks", e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div>
          <FieldLabel>FF&E install overlaps with construction?</FieldLabel>
          <div className="flex gap-2">
            <ChoiceCard selected={value.ffeOverlap} onClick={() => set("ffeOverlap", true)} label="YES" />
            <ChoiceCard selected={!value.ffeOverlap} onClick={() => set("ffeOverlap", false)} label="NO" />
          </div>
        </div>
        <div>
          <FieldLabel>Soft opening?</FieldLabel>
          <div className="flex gap-2">
            <ChoiceCard selected={value.softOpening} onClick={() => set("softOpening", true)} label="YES" />
            <ChoiceCard selected={!value.softOpening} onClick={() => set("softOpening", false)} label="NO" />
          </div>
        </div>
      </div>
    </div>
  );
}

function UnitOfMeasurePane({
  value, onChange,
}: {
  value: WizardState["unit"];
  onChange: (v: WizardState["unit"]) => void;
}) {
  return (
    <div>
      <div className="t-body mb-4">
        Unit of measure for the schedule. Default is weeks; switch to days for short-duration projects
        (e.g., a 6-week soft-goods turn).
      </div>
      <div className="flex gap-2 max-w-md">
        <ChoiceCard selected={value === "weeks"} onClick={() => onChange("weeks")} label="Weeks" blurb="Default — most projects." />
        <ChoiceCard selected={value === "days"} onClick={() => onChange("days")} label="Days" blurb="For short or fast-track projects." />
      </div>
    </div>
  );
}

function GeneratePane({ state }: { state: WizardState }) {
  const selectedScope = Object.entries(state.scope).filter(([, v]) => v).map(([k]) => k);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.schedulePreview(state as unknown as Record<string, unknown>);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function download(kind: "xlsx" | "html" | "pdf" | "pptx") {
    setExporting(true);
    setError(null);
    try {
      const fetcher = {
        xlsx: api.scheduleExportXlsx,
        html: api.scheduleExportHtml,
        pdf:  api.scheduleExportPdf,
        pptx: api.scheduleExportPptx,
      }[kind];
      const blob = await fetcher(state as unknown as Record<string, unknown>);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (state.property.name || "schedule").replace(/[^\w-]+/g, "_");
      a.download = `${safe}_Schedule_${new Date().toISOString().slice(0, 10)}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="t-body mb-4">
        Ready to generate. Click <span className="font-semibold">Generate Schedule</span> for an
        in-app preview, or <span className="font-semibold">Download Excel</span> for the
        spreadsheet. AI duration tuning, blackout-aware reflow, and the interactive Gantt land in
        the next pass.
      </div>

      <div className="p-4 bg-gencom-mist/40 border border-gencom-sand rounded-md mb-4">
        <div className="t-eyebrow mb-2">Summary</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 t-body">
          <div><span className="font-semibold">Project type:</span> {state.projectType || "—"}</div>
          <div><span className="font-semibold">Input mode:</span> {state.inputMode || "—"}</div>
          <div><span className="font-semibold">Property:</span> {state.property.name || "—"}</div>
          <div><span className="font-semibold">Brand:</span> {state.property.brand || "—"}</div>
          <div><span className="font-semibold">Keys:</span> {state.property.keys || "—"}</div>
          <div><span className="font-semibold">Type:</span> {state.property.propertyType || "—"}</div>
          <div><span className="font-semibold">Start:</span> {state.startDate ? fmtDate(state.startDate) : "—"}</div>
          <div><span className="font-semibold">Target completion:</span> {state.targetCompletion ? fmtDate(state.targetCompletion) : "—"} ({state.completionType || "—"})</div>
          <div><span className="font-semibold">Unit:</span> {state.unit}</div>
          <div><span className="font-semibold">Scope items:</span> {selectedScope.length}</div>
        </div>
        {selectedScope.length > 0 && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {selectedScope.map((s) => <Pill key={s}>{s}</Pill>)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="t-body font-semibold px-5 py-2.5 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? "Generating…" : preview ? "Regenerate" : "Generate Schedule"}
        </button>
        <button
          type="button"
          onClick={() => download("xlsx")}
          disabled={exporting}
          className="t-body font-semibold px-5 py-2.5 border-2 border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "↓ Download Excel"}
        </button>
        <button
          type="button"
          onClick={() => download("pdf")}
          disabled={exporting}
          className="t-body font-semibold px-5 py-2.5 border-2 border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "↓ Download PDF"}
        </button>
        <button
          type="button"
          onClick={() => download("pptx")}
          disabled={exporting}
          className="t-body font-semibold px-5 py-2.5 border-2 border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "↓ Download PowerPoint"}
        </button>
        <button
          type="button"
          onClick={() => download("html")}
          disabled={exporting}
          className="t-body font-semibold px-5 py-2.5 border-2 border-gencom-gold text-gencom-ink rounded-md hover:bg-gencom-gold/15 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "↓ Download HTML"}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 border border-red-300 bg-red-50 text-red-700 t-body rounded-md">
          {error}
        </div>
      )}

      {preview && <SchedulePreviewBlock preview={preview} />}

      <details className="mt-6">
        <summary className="t-eyebrow cursor-pointer">View raw state</summary>
        <pre className="mt-2 p-3 text-[11px] bg-gencom-mist/40 border border-gencom-sand rounded-md overflow-auto max-h-80">
{JSON.stringify(state, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function SchedulePreviewBlock({ preview }: { preview: SchedulePreview }) {
  const [view, setView] = useState<"gantt" | "table">("gantt");
  return (
    <div className="mt-5">
      {preview.warnings.length > 0 && (
        <div className="mb-3 p-3 border border-amber-300 bg-amber-50 text-amber-900 t-body rounded-md space-y-1">
          {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="t-eyebrow">
          Schedule preview — {preview.tasks.filter((t) => t.type !== "phase_header").length} tasks
        </div>
        <div className="flex gap-1 border border-gencom-sand rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setView("gantt")}
            className={`t-eyebrow px-3 py-1 ${view === "gantt" ? "bg-emerald-700 text-white" : "bg-white text-gencom-ink hover:bg-gencom-mist/60"}`}
          >Gantt</button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={`t-eyebrow px-3 py-1 ${view === "table" ? "bg-emerald-700 text-white" : "bg-white text-gencom-ink hover:bg-gencom-mist/60"}`}
          >Table</button>
        </div>
      </div>

      {view === "gantt" ? <GanttPreview preview={preview} /> : <TablePreview preview={preview} />}

      <div className="t-eyebrow mt-4 mb-2">Milestones</div>
      <div className="border border-gencom-sand rounded-md overflow-hidden">
        <table className="w-full t-body">
          <thead className="bg-gencom-mist">
            <tr>
              <th className="text-left px-3 py-2 t-eyebrow">Milestone</th>
              <th className="text-left px-3 py-2 t-eyebrow">Start</th>
              <th className="text-left px-3 py-2 t-eyebrow">End</th>
              <th className="text-left px-3 py-2 t-eyebrow">Duration</th>
            </tr>
          </thead>
          <tbody>
            {preview.milestones.map((m, i) => (
              <tr key={i} className="border-t border-gencom-sand">
                <td className="px-3 py-1.5">{m.name}</td>
                <td className="px-3 py-1.5">{fmtDate(m.start)}</td>
                <td className="px-3 py-1.5">{fmtDate(m.end)}</td>
                <td className="px-3 py-1.5">{m.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TablePreview({ preview }: { preview: SchedulePreview }) {
  return (
    <div className="border border-gencom-sand rounded-md overflow-hidden">
      <table className="w-full t-body">
        <thead className="bg-emerald-700 text-white">
          <tr>
            <th className="text-left px-3 py-2 t-eyebrow">Task</th>
            <th className="text-left px-3 py-2 t-eyebrow">Type</th>
            <th className="text-left px-3 py-2 t-eyebrow">Start</th>
            <th className="text-left px-3 py-2 t-eyebrow">End</th>
            <th className="text-right px-3 py-2 t-eyebrow">Wks</th>
          </tr>
        </thead>
        <tbody>
          {preview.tasks.map((t, i) => <ScheduleRow key={i} t={t} />)}
        </tbody>
      </table>
    </div>
  );
}

// Visual Gantt — read-only horizontal bar chart matching the Excel layout.
// Drag-to-adjust + auto-cascade is a deferred follow-up; this block is just
// for at-a-glance review on the Generate page.
function GanttPreview({ preview }: { preview: SchedulePreview }) {
  // Column geometry — matches the HTML export defaults.
  const CELL = 18;       // px per week
  const ROW = 28;        // px per task row
  const INFO_W = 280;    // left task-info width

  const tasks = preview.tasks;
  if (tasks.length === 0) return null;

  // Build the weekly grid spanning every task. Snap to Mondays so the column
  // edges stay consistent with the Excel/HTML exports.
  const parse = (s: string) => new Date(s + "T00:00:00");
  const monday = (d: Date) => {
    const d2 = new Date(d); const dow = (d2.getDay() + 6) % 7; d2.setDate(d2.getDate() - dow); return d2;
  };
  const allStarts = tasks.map((t) => parse(t.start));
  const allEnds = tasks.map((t) => parse(t.end));
  const gridStart = monday(new Date(Math.min(...allStarts.map((d) => d.getTime()))));
  const gridEnd = monday(new Date(Math.max(...allEnds.map((d) => d.getTime()))));
  const weeks: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 7)) {
    weeks.push(new Date(d));
  }
  weeks.push(new Date(gridEnd.getTime() + 7 * 86400_000)); // tail buffer

  const gridPx = weeks.length * CELL;

  // Month banner spans
  const months: { label: string; col: number; span: number }[] = [];
  let spanStart = 0;
  let prevMonth = -1;
  weeks.forEach((m, i) => {
    if (m.getMonth() !== prevMonth) {
      if (prevMonth !== -1) {
        months.push({ label: weeks[spanStart].toLocaleDateString(undefined, { month: "short", year: "2-digit" }), col: spanStart, span: i - spanStart });
      }
      spanStart = i;
      prevMonth = m.getMonth();
    }
  });
  months.push({ label: weeks[spanStart].toLocaleDateString(undefined, { month: "short", year: "2-digit" }), col: spanStart, span: weeks.length - spanStart });

  function colFor(d: Date): number {
    const days = (monday(d).getTime() - gridStart.getTime()) / 86400_000;
    return Math.max(0, Math.round(days / 7));
  }

  return (
    <div className="border border-gencom-sand rounded-md overflow-auto">
      <div style={{ width: INFO_W + gridPx, position: "relative" }}>
        {/* Header */}
        <div style={{ display: "flex", height: 24, position: "sticky", top: 0, zIndex: 2, background: "white" }}>
          <div style={{ width: INFO_W, background: "#2D5A27", color: "white", fontSize: 11, fontWeight: 600, padding: "4px 12px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Task / Milestone
          </div>
          <div style={{ position: "relative", width: gridPx, height: 24, background: "#B89555" }}>
            {months.map((m, i) => (
              <div key={i} style={{
                position: "absolute", left: m.col * CELL, width: m.span * CELL, height: 24,
                lineHeight: "24px", textAlign: "center", color: "white", fontSize: 10, fontWeight: 700,
                borderRight: "1px solid rgba(255,255,255,0.4)",
              }}>{m.label}</div>
            ))}
          </div>
        </div>
        {/* Body rows */}
        {tasks.map((t, idx) => {
          const sCol = colFor(parse(t.start));
          const eCol = Math.max(sCol + 1, colFor(parse(t.end)) + 1);
          const isPhase = t.type === "phase_header";
          const isMilestone = t.type === "milestone";
          const barColor = isMilestone ? "#B89555" :
                           isPhase ? "#B89555" :
                           t.type === "independent" ? "#B89555" : "#6FA88A";
          return (
            <div key={idx} style={{
              display: "flex", height: ROW, borderBottom: "1px solid #d9d4c8",
              background: isPhase ? "rgba(184,149,85,0.18)" : "white",
            }}>
              <div style={{
                width: INFO_W, padding: `0 12px 0 ${12 + t.indent * 12}px`, fontSize: 12,
                display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontWeight: isPhase ? 700 : 400, color: isPhase ? "#2D5A27" : "#1a1d24",
              }} title={t.name}>{t.name}</div>
              <div style={{ position: "relative", width: gridPx, height: ROW }}>
                {isMilestone ? (
                  <div style={{
                    position: "absolute", left: sCol * CELL - 6, top: ROW / 2 - 6,
                    width: 12, height: 12, background: barColor, transform: "rotate(45deg)",
                  }} title={t.name} />
                ) : (
                  <div style={{
                    position: "absolute", left: sCol * CELL + 1, top: 6,
                    width: (eCol - sCol) * CELL - 2, height: ROW - 12, background: barColor,
                    borderRadius: 3, opacity: isPhase ? 0.55 : 1,
                  }} title={`${t.name} · ${fmtDate(t.start)} → ${fmtDate(t.end)} · ${t.weeks}w`} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleRow({ t }: { t: ScheduleTask }) {
  const isPhase = t.type === "phase_header";
  const isMilestone = t.type === "milestone";
  return (
    <tr className={`border-t border-gencom-sand ${isPhase ? "bg-gencom-gold/15 font-semibold" : ""}`}>
      <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + t.indent * 16}px` }}>
        {t.name}
      </td>
      <td className="px-3 py-1.5 capitalize">
        {isPhase ? "" : isMilestone ? "Milestone" : t.type}
      </td>
      <td className="px-3 py-1.5">{fmtDate(t.start)}</td>
      <td className="px-3 py-1.5">{fmtDate(t.end)}</td>
      <td className="px-3 py-1.5 text-right">{isMilestone ? "—" : t.weeks}</td>
    </tr>
  );
}
