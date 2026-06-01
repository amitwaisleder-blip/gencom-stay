// ─── Types ────────────────────────────────────────────────────────────────
export type Property = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  current_brand: string | null;
  current_flag: string | null;
  target_brand: string | null;
  target_flag: string | null;
  target_brand_tier: string | null;
  property_type: string | null;
  year_built: number | null;
  year_last_renovated: number | null;
  keys: number | null;
  guestroom_mix: Record<string, number> | null;
  thumbnail_path: string | null;
  deal_notes: string | null;
  floors: number | null;
  towers: number | null;
  total_gsf: number | null;
  envelope_notes: string | null;
  roof_type: string | null;
  roof_age: number | null;
  passenger_elevators: number | null;
  service_elevators: number | null;
  elevator_modernization_status: string | null;
  fb_outlets: Array<{ name: string; type: string; seats?: number }> | null;
  meeting_space_json: { ballroom_sqft?: number; breakout_count?: number; largest_breakout_sqft?: number } | null;
  pools_json: { count?: number; type?: string } | null;
  spa_treatment_rooms: number | null;
  fitness_sqft: number | null;
  parking_type: string | null;
  parking_spaces: number | null;
  mep_json: { chiller_age?: number; boiler_age?: number; other?: string } | null;
  sprinklered: boolean | null;
  fire_alarm_age: number | null;
  fl_recert_status: string | null;
  documents_available: Record<string, { available: boolean; file_path?: string; link?: string; uploaded_at?: string }> | null;
  matterport_url: string | null;
  walk_dates: string[] | null;
  walk_attendees: string[] | null;
  field_provenance: Record<string, {
    source?: string; source_document_id?: string; source_page?: number;
    source_excerpt?: string; confidence?: "high" | "medium" | "low";
    ai_extracted?: boolean; edited_by_user?: boolean;
  }> | null;
  soft_costs_synced: boolean;
  intake_answers: Record<string, { value?: string; see_pip?: boolean }> | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type PropertyCard = Pick<
  Property,
  | "id" | "name" | "current_brand" | "current_flag" | "target_brand" | "target_flag"
  | "address" | "city" | "state" | "keys" | "year_built"
  | "thumbnail_path" | "archived" | "updated_at"
> & {
  default_scenario_total: number;
  dollars_per_key: number;
  hard_total: number;
  soft_total: number;
  grand_total: number;
  required_total: number;
  required_recommended_total: number;
  full_scope_total: number;
  setup_complete: boolean;
};

export type ScopeItem = {
  id: string;
  property_id: string;
  division: string;
  sub_area: string | null;
  line_item: string;
  description: string | null;
  quantity: number;
  unit: string;
  suggested_unit_cost: number | null;
  override_unit_cost: number | null;
  effective_unit_cost: number;
  effective_quantity: number;
  line_total: number;
  source: "pip" | "walk_notes" | "om" | "manual";
  source_document_id: string | null;
  source_page: number | null;
  source_excerpt: string | null;
  priority: "required" | "recommended" | "optional" | "na";
  confidence: "high" | "medium" | "low";
  notes: string | null;
  included_in_budget: boolean;
  cost_db_item_id: string | null;
  multiplier_basis:
    | "keys" | "floors" | "keys_pct" | "doubles" | "suites"
    | "kings_only" | "double_double_only" | "non_suite"
    | null;
  deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type CostItem = {
  id: string;
  item_name: string;
  unit: string;
  brand_tier: string;
  suggested_cost: number;
  historical_range_low: number | null;
  historical_range_high: number | null;
  source: "actual_project" | "benchmark" | "ai_estimate" | "user_seeded";
  notes: string | null;
  archived: boolean;
  last_used_at: string | null;
  last_used_property_id: string | null;
  last_used_property_name: string | null;
  created_at: string;
  updated_at: string;
};

export type CostMatchResult = {
  cost_db_item_id: string | null;
  suggested_cost: number | null;
  match_type: "exact" | "fuzzy" | "cross_tier" | "ai_fallback" | "none";
  confidence: "high" | "medium" | "low";
  matched_item_name: string | null;
  explanation: string | null;
};

export type SoftCostLine = {
  name: string;
  pct?: number | null;
  fixed?: number | null;
  group?: "soft" | "contingency" | "dev_fee";
  basis_divisions?: string[] | null;
  basis_categories?: string[] | null;
  basis_exclude_dm?: boolean;
  basis_exclude_it_boh?: boolean;
  basis_soft_lines?: string[];
  include_dm?: boolean; // legacy
};

export const SOFT_COST_BASIS_CATEGORIES = [
  "Casegoods",
  "Softgoods",
  "Floor finishes",
  "Wallcover",
  "Window Cover",
] as const;

export type Scenario = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  soft_cost_pct: number;
  soft_cost_breakdown: SoftCostLine[] | null;
  contingency_pct: number;
  escalation_pct: number;
  ffe_pct: number;
  ose_pct: number;
  tech_pct: number;
  other_line_items: any;
  auto_filter: any;
  created_at: string;
};

export type ScenarioTotals = {
  scenario_id: string;
  scenario_name: string;
  division_subtotals: Record<string, number>;
  base_total: number;
  soft_costs: number;
  contingency: number;
  dev_fee: number;
  escalation: number;
  ffe: number;
  ose: number;
  tech: number;
  grand_total: number;
  dollars_per_key: number;
  dollars_per_gsf: number;
  priority_breakdown: Record<string, number>;
  soft_cost_line_amounts: Record<string, number>;
};

export type ExportRecord = {
  id: string;
  property_id: string;
  exported_at: string;
  filename: string;
  file_path: string;
  download_url: string;
  scenarios_included: string[];
  note: string | null;
};

export type TemplateScan = {
  found: boolean;
  path?: string;
  sheets: Array<{
    name: string; max_row: number; max_col: number;
    bold_rows: Array<{ row: number; text: string }>;
  }>;
  divisions: Array<{
    name: string; sheet: string; row: number;
    line_start: number; line_end: number; total_row: number | null;
    header_col: number;
  }>;
};

export type TemplateMap = {
  divisions: TemplateScan["divisions"];
  confirmed_at?: string;
};

export type DocumentType = "pip" | "om" | "brochure" | "walk_notes" | "walk_photo" | "other";

export type DocumentRow = {
  id: string;
  property_id: string;
  filename: string;
  file_path: string;
  document_type: DocumentType;
  uploaded_at: string;
  page_count: number | null;
  extraction_status: "pending" | "running" | "complete" | "failed";
  extraction_ran_at: string | null;
  extraction_error: string | null;
};

/** Which PIP extraction prompt variant to use. */
export type ExtractionGranularity = "compact" | "standard" | "detailed";

export type ExtractionResult = {
  documents_processed: number;
  property_fields_updated: string[];
  scope_items_created: number;
  scope_items_soft_deleted?: number;
  warnings: string[];
  duration_seconds: number;
};

// ─── HTTP helper ──────────────────────────────────────────────────────────
async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── API ──────────────────────────────────────────────────────────────────
export const api = {
  // Properties
  listProperties: (archived = false) =>
    fetch(`/api/properties?archived=${archived}`).then(j<PropertyCard[]>),
  getProperty: (id: string) => fetch(`/api/properties/${id}`).then(j<Property>),
  createProperty: (payload: Partial<Property>) =>
    fetch("/api/properties", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<Property>),
  updateProperty: (id: string, payload: Partial<Property>) =>
    fetch(`/api/properties/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<Property>),
  archiveProperty: (id: string) =>
    fetch(`/api/properties/${id}/archive`, { method: "POST" }).then(j<Property>),
  restoreProperty: (id: string) =>
    fetch(`/api/properties/${id}/restore`, { method: "POST" }).then(j<Property>),
  deleteProperty: (id: string) =>
    fetch(`/api/properties/${id}`, { method: "DELETE" }).then(j<void>),
  duplicateProperty: (id: string) =>
    fetch(`/api/properties/${id}/duplicate`, { method: "POST" }).then(j<Property>),
  uploadThumbnail: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/properties/${id}/thumbnail`, { method: "POST", body: fd }).then(j<Property>);
  },
  deleteThumbnail: (id: string) =>
    fetch(`/api/properties/${id}/thumbnail`, { method: "DELETE" }).then(j<Property>),

  // Template
  scanTemplate: () => fetch("/api/template/scan").then(j<TemplateScan>),
  getTemplateMap: () => fetch("/api/template/map").then(j<{ map: TemplateMap | null }>),
  saveTemplateMap: (m: TemplateMap) =>
    fetch("/api/template/map", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m),
    }).then(j<{ ok: true }>),
  listDivisions: () => fetch("/api/template/divisions").then(j<{ divisions: string[] }>),
  uploadTemplate: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/template/upload", { method: "POST", body: fd }).then(j<TemplateScan>);
  },

  // Scope
  listScope: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/scope`).then(j<ScopeItem[]>),
  createScope: (propertyId: string, payload: Partial<ScopeItem>) =>
    fetch(`/api/properties/${propertyId}/scope`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<ScopeItem>),
  updateScope: (propertyId: string, itemId: string, payload: Partial<ScopeItem>) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<ScopeItem>),
  deleteScope: (propertyId: string, itemId: string) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}`, { method: "DELETE" }).then(j<void>),
  deleteAllScope: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/scope/all`, { method: "DELETE" }).then(j<void>),
  restoreScope: (propertyId: string, itemId: string) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/restore`, { method: "POST" }).then(j<ScopeItem>),
  rematchScope: (propertyId: string, itemId: string) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/rematch`, { method: "POST" }).then(j<CostMatchResult>),

  // Cost DB
  listCostDb: (params: { q?: string; tier?: string; source?: string } = {}) => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.tier) p.set("tier", params.tier);
    if (params.source) p.set("source", params.source);
    return fetch(`/api/cost-db?${p.toString()}`).then(j<CostItem[]>);
  },
  createCostItem: (payload: Partial<CostItem>) =>
    fetch(`/api/cost-db`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<CostItem>),
  updateCostItem: (id: string, payload: Partial<CostItem>) =>
    fetch(`/api/cost-db/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<CostItem>),
  deleteCostItem: (id: string) =>
    fetch(`/api/cost-db/${id}`, { method: "DELETE" }).then(j<void>),
  importCostCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/cost-db/import-csv`, { method: "POST", body: fd }).then(
      j<{ imported: number; errors: any[] }>,
    );
  },

  // Scenarios
  listScenarios: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/scenarios`).then(j<Scenario[]>),
  updateScenario: (propertyId: string, scenarioId: string, payload: Partial<Scenario>) =>
    fetch(`/api/properties/${propertyId}/scenarios/${scenarioId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<Scenario>),
  scenarioTotals: (propertyId: string, scenarioId: string) =>
    fetch(`/api/properties/${propertyId}/scenarios/${scenarioId}/totals`).then(j<ScenarioTotals>),

  // Exports
  listExports: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/exports`).then(j<ExportRecord[]>),
  createExport: (propertyId: string, payload: { scenarios: string[]; note?: string; filename?: string }) =>
    fetch(`/api/properties/${propertyId}/exports`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<any>),

  // Documents + extraction (Phase C)
  listDocuments: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/documents`).then(j<DocumentRow[]>),
  uploadDocuments: (propertyId: string, files: File[], types: Record<string, DocumentType>) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.append("types_json", JSON.stringify(types));
    return fetch(`/api/properties/${propertyId}/documents`, { method: "POST", body: fd })
      .then(j<DocumentRow[]>);
  },
  runExtraction: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/extract`, { method: "POST" }).then(j<ExtractionResult>),
  runSingleDocExtraction: (propertyId: string, docId: string) =>
    fetch(`/api/properties/${propertyId}/documents/${docId}/extract`, { method: "POST" })
      .then(j<ExtractionResult>),
  runExtractionPreview: (propertyId: string, granularity: ExtractionGranularity = "standard") =>
    fetch(`/api/properties/${propertyId}/extract-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ granularity }),
    }).then(j<ExtractionPreviewResult>),
  importScopeBatch: (propertyId: string, items: ScopeSuggestion[]) =>
    fetch(`/api/properties/${propertyId}/scope/import-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }).then(j<{ scope_items_created: number; warnings: string[] }>),

  // Break-down + cost helpers (Phase D+)
  scopeBreakdown: (propertyId: string, itemId: string) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/breakdown`, { method: "POST" })
      .then(j<{ suggestions: BreakdownSuggestion[] }>),
  /** "+ Add Scope" row button in the extraction preview — given a specific
   *  scope item's description text (the PIP narrative just below the line
   *  item), split it into granular sub-items. Uses the same suggestion shape
   *  as scopeBreakdownPreview so both feed the BreakdownModal. */
  scopeAddFromDescription: (propertyId: string, body: { description: string; label?: string; division?: string; source?: string }) =>
    fetch(`/api/properties/${propertyId}/scope/add-scope-from-description`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<{ suggestions: BreakdownSuggestion[] }>),
  scopeBreakdownPreview: (propertyId: string, item: { label: string; description?: string; division?: string; source?: string }) =>
    fetch(`/api/properties/${propertyId}/scope/breakdown-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    }).then(j<{ suggestions: BreakdownSuggestion[] }>),
  applyScopeBreakdown: (propertyId: string, itemId: string, suggestions: BreakdownSuggestion[]) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/apply-breakdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suggestions }),
    }).then(j<{ created: ScopeItem[]; soft_deleted_id: string }>),
  scopeCostMatches: (propertyId: string, itemId: string, limit = 5) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/cost-matches?limit=${limit}`)
      .then(j<{ matches: CostMatchRow[] }>),
  scopeAiCost: (propertyId: string, itemId: string) =>
    fetch(`/api/properties/${propertyId}/scope/${itemId}/ai-cost`, { method: "POST" })
      .then(j<AiCostResult>),
  scopeSuggestions: (propertyId: string) =>
    fetch(`/api/properties/${propertyId}/scope/suggestions`, { method: "POST" })
      .then(j<{ suggestions: ScopeReviewSuggestion[] }>),
  scopeBatchCost: (propertyId: string, body: {
    source: "ai" | "db" | "ai_or_db";
    divisions?: string[] | null;
    only_uncosted?: boolean;
    confidence_threshold?: "high" | "medium" | "low";
  }) => fetch(`/api/properties/${propertyId}/scope/batch-cost`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(j<BatchCostResult>),

  // Deferred maintenance costs DB — separate from the main cost DB. Rows
  // are extracted from proposals/estimates with context (contractor, date,
  // city, hotel) attached.
  listDmCostCategories: () =>
    fetch("/api/dm-costs/categories").then(j<{ categories: Record<string, string[]> }>),
  listDmCosts: (params: { q?: string; category?: string; subcategory?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.subcategory) qs.set("subcategory", params.subcategory);
    return fetch(`/api/dm-costs?${qs.toString()}`).then(j<DmCostItem[]>);
  },
  createDmCost: (payload: Partial<DmCostItem>) =>
    fetch("/api/dm-costs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<DmCostItem>),
  updateDmCost: (id: string, payload: Partial<DmCostItem>) =>
    fetch(`/api/dm-costs/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(j<DmCostItem>),
  deleteDmCost: (id: string) =>
    fetch(`/api/dm-costs/${id}`, { method: "DELETE" }).then(j<void>),
  // PIP Generator helpers
  pipLookupProperty: (name: string) =>
    fetch("/api/pip/ai-lookup-property", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    }).then(j<PipPropertyLookup>),
  pipRecommendScope: (answers: Record<string, unknown>) =>
    fetch("/api/pip/ai-recommend-scope", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }),
    }).then(j<{ recommendations: PipScopeRecommendation[] }>),

  extractDmCosts: (file: File, overrides: {
    contractor?: string; hotel_name?: string; city?: string; state?: string; year?: number;
  } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (overrides.contractor) fd.append("override_contractor", overrides.contractor);
    if (overrides.hotel_name) fd.append("override_hotel_name", overrides.hotel_name);
    if (overrides.city) fd.append("override_city", overrides.city);
    if (overrides.state) fd.append("override_state", overrides.state);
    if (overrides.year) fd.append("override_year", String(overrides.year));
    return fetch("/api/dm-costs/extract", { method: "POST", body: fd })
      .then(j<DmExtractResult>);
  },

  // Fast Budget — ROM wizard enrichment
  fastBudgetEnrich: (payload: { name: string; city_hint?: string }) =>
    fetch("/api/fast-budget/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<FastBudgetEnrichResult>),

  // Fast Budget — Low/Mid/High scope narrative generator
  fastBudgetScopeDescription: (payload: ScopeDescriptionRequest) =>
    fetch("/api/fast-budget/scope-description", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<ScopeDescriptionResult>),

  // Fast Budget — PPTX export. Returns the Blob directly (caller saves it).
  fastBudgetExportPptx: async (payload: PptxExportRequest): Promise<Blob> => {
    const res = await fetch("/api/fast-budget/export-pptx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PPTX export failed (${res.status}): ${body || res.statusText}`);
    }
    return res.blob();
  },

  // Schedule Generator — preview returns task list + milestones JSON.
  schedulePreview: (state: Record<string, unknown>) =>
    fetch("/api/schedule/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    }).then(j<SchedulePreview>),

  // Schedule Generator — Excel export. Returns the Blob directly.
  scheduleExportXlsx: async (state: Record<string, unknown>): Promise<Blob> => {
    const res = await fetch("/api/schedule/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Schedule export failed (${res.status}): ${body || res.statusText}`);
    }
    return res.blob();
  },

  // Schedule Generator — HTML export.
  scheduleExportHtml: async (state: Record<string, unknown>): Promise<Blob> => {
    const res = await fetch("/api/schedule/export-html", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTML export failed (${res.status}): ${body || res.statusText}`);
    }
    return res.blob();
  },

  // Schedule Generator — PDF export.
  scheduleExportPdf: async (state: Record<string, unknown>): Promise<Blob> => {
    const res = await fetch("/api/schedule/export-pdf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PDF export failed (${res.status}): ${body || res.statusText}`);
    }
    return res.blob();
  },

  // Schedule Generator — PowerPoint export.
  scheduleExportPptx: async (state: Record<string, unknown>): Promise<Blob> => {
    const res = await fetch("/api/schedule/export-pptx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PPTX export failed (${res.status}): ${body || res.statusText}`);
    }
    return res.blob();
  },

  // Schedule Generator — AI duration recommendations.
  scheduleAiDurations: (state: Record<string, unknown>) =>
    fetch("/api/schedule/ai-durations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    }).then(j<ScheduleAiDurations>),

  // Schedule Generator — PIP file extraction (multipart upload).
  scheduleExtractPip: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/schedule/extract-pip", {
      method: "POST",
      body: fd,
    }).then(j<ScheduleExtractedPip>);
  },
};

export type ScheduleAiDurations = {
  concept: number;
  sd: number;
  dd: number;
  cd: number;
  rationale: { concept: string; sd: string; dd: string; cd: string };
};

export type ScheduleExtractedPip = {
  property: {
    name: string | null;
    brand: string | null;
    location: string | null;
    keys: number | null;
    propertyType: "Urban" | "Resort" | "Branded Residential" | null;
  };
  scope: Record<string, boolean>;
  notes: string;
};

// ─── Schedule Generator types ─────────────────────────────────────────────
export type ScheduleTaskType = "phase_header" | "independent" | "dependent" | "milestone";
export type ScheduleTask = {
  name: string;
  phase: string;
  type: ScheduleTaskType;
  start: string;
  end: string;
  weeks: number;
  override_date: string | null;
  notes: string | null;
  indent: number;
};
export type ScheduleMilestone = {
  name: string;
  start: string;
  end: string;
  duration: string;
};
export type SchedulePreview = {
  project_name: string;
  project_type: string;
  unit: "weeks" | "days";
  warnings: string[];
  tasks: ScheduleTask[];
  milestones: ScheduleMilestone[];
};

export type ScopeBudgetLevel = {
  total: number;
  per_key: number;
  hard: number;
  soft: number;
};

export type ScopeDescriptionRequest = {
  name: string;
  city?: string | null;
  state_or_country?: string | null;
  brand?: string | null;
  tier?: string | null;
  property_type?: string | null;
  room_count?: number | null;
  suite_count?: number | null;
  year_built?: number | null;
  last_renovation?: number | null;
  included_areas: string[];
  budgets: {
    low: ScopeBudgetLevel;
    mid: ScopeBudgetLevel;
    high: ScopeBudgetLevel;
  };
};

export type ScopeDescriptionResult = {
  low: string;
  mid: string;
  high: string;
};

export type PptxRange = { low: number; mid: number; high: number };

export type PptxLine = {
  area: string;
  scope: string;
  low: number;
  mid: number;
  high: number;
  category: string; // "dm" | "interior" | "custom"
};

export type PptxSoftRow = {
  label: string;
  pct?: number | null;
  basis?: string | null;
  low: number;
  mid: number;
  high: number;
};

export type PptxExportRequest = {
  name: string;
  city?: string | null;
  state_or_country?: string | null;
  brand?: string | null;
  tier?: string | null;
  property_type?: string | null;
  room_count?: number | null;
  suite_count?: number | null;
  year_built?: number | null;
  last_renovation?: number | null;
  region_key?: string | null;
  hard_range: PptxRange;
  softs_range: PptxRange;
  dev_fee_range: PptxRange;
  grand_range: PptxRange;
  per_key_range: PptxRange;
  dm_subtotal: PptxRange;
  interior_subtotal: PptxRange;
  lines: PptxLine[];
  softs: PptxSoftRow[];
  dev_fee_rows: PptxSoftRow[];
  scope_low?: string | null;
  scope_mid?: string | null;
  scope_high?: string | null;
};

export type FastBudgetEnrichResult = {
  name: string;
  city: string | null;
  state_or_country: string | null;
  brand: string | null;
  tier: string | null;
  room_count: number | null;
  suite_count: number | null;
  floors: number | null;
  year_built: number | null;
  last_renovation: number | null;
  property_type: string | null;
  gross_sf: number | null;
  region_key: string | null;
  confidence: string | null;
  notes: string | null;
};

export type DmCostItem = {
  id: string;
  category: string | null;
  subcategory: string | null;
  scope: string;
  unit: string | null;
  quantity: number | null;
  cost: number | null;
  unit_cost: number | null;
  contractor: string | null;
  estimate_date: string | null;
  year: number | null;
  city: string | null;
  state: string | null;
  hotel_name: string | null;
  notes: string | null;
  source_filename: string | null;
  source_page: number | null;
  source_excerpt: string | null;
  ai_extracted: boolean;
};

export type PipPropertyLookup = {
  match_found: boolean;
  confidence: "high" | "medium" | "low";
  resolved_name: string | null;
  brand_flag: string | null;
  brand_flag_other: string | null;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    full_address: string | null;
  } | null;
  property_type: string | null;
  year_built: number | null;
  year_last_renovated: number | null;
  total_keys: number | null;
  room_mix: {
    standard: number | null;
    suite: number | null;
    presidential: number | null;
    ada: number | null;
  } | null;
  notes: string | null;
};

export type PipScopeRecommendation = {
  category: string;
  item: string;
  reason: string;
  priority: "required" | "recommended" | "optional";
};

export type DmExtractResult = {
  created: number;
  items: DmCostItem[];
  document_context: Record<string, string | number | null>;
  warnings: string[];
};

export type BreakdownSuggestion = {
  label: string;
  description?: string;
  division: string;
  unit: string;
  quantity: number;
  multiplier_basis?: "keys" | "floors" | "keys_pct" | "doubles" | "suites" | null;
  priority?: "required" | "recommended" | "optional" | "na";
  rationale?: string;
};

export type CostMatchRow = {
  cost_db_item_id: string;
  item_name: string;
  unit: string;
  brand_tier: string;
  suggested_cost: number;
  original_cost?: number;
  score: number;
  tier_adjusted: boolean;
  source: string;
};

export type AiCostResult = {
  suggested_cost: number;
  confidence: "high" | "medium" | "low";
  explanation: string;
  range_low?: number;
  range_high?: number;
};

export type ScopeReviewSuggestion = {
  kind: "missing" | "quantity" | "nonsense";
  title: string;
  detail: string;
  suggested_line_item: string | null;
  suggested_division: string | null;
  suggested_quantity?: number | null;
  suggested_unit?: string | null;
  suggested_multiplier_basis?: string | null;
  suggested_priority?: "required" | "recommended" | "optional" | "na" | null;
  related_item_id: string | null;
};

export type BatchCostResult = {
  updated: number;
  skipped: number;
  total_candidates: number;
  errors: string[];
  items: Array<{
    id: string;
    line_item: string;
    division: string;
    suggested_unit_cost: number;
    source: string;
  }>;
};

export type ScopeSuggestion = {
  division: string;
  sub_area?: string | null;
  line_item: string;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  multiplier_basis?: "keys" | "floors" | "keys_pct" | "doubles" | "suites" | null;
  priority?: "required" | "recommended" | "optional" | "na";
  confidence?: "high" | "medium" | "low";
  source?: string;
  source_document_id?: string | null;
  source_document_filename?: string;
  source_page?: number | null;
  source_excerpt?: string | null;
  notes?: string | null;
};

export type ExtractionPreviewResult = {
  documents_processed: number;
  property_fields_updated: string[];
  scope_suggestions: ScopeSuggestion[];
  warnings: string[];
  duration_seconds: number;
};

// ─── Formatters ───────────────────────────────────────────────────────────
export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) > 1 ? "s" : ""} ago`;
}
