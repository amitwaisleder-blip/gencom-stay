export type CapexKind = "single" | "portfolio" | "project";

export type BreakdownItem = {
  label: string;
  description?: string | null;
  vendor?: string | null;
  qty?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  total: number;
  notes?: string | null;
};

export type CapexLineStatus =
  | "approved"
  | "in-progress"
  | "completed"
  | "pending"
  | "bidding"
  | "deferred";

export const LINE_STATUS_OPTIONS: CapexLineStatus[] = [
  "approved",
  "in-progress",
  "completed",
  "pending",
  "bidding",
  "deferred",
];

export type CapexLine = {
  id: string;
  hotel_id: string;
  code: string | null;
  group: string | null;
  category: string | null;
  project_name: string | null;
  description: string | null;
  vendor: string | null;
  original_total_budget: number;
  forecast_total_budget: number;
  notes: string | null;
  sort_order: number;
  status: CapexLineStatus | null;
  /** { "2025": { forecast: number; spend: number }, ... } */
  year_data: Record<string, { forecast?: number; spend?: number }> | null;
  /** Monthly cashflow per year — { "2025": { "1": 0, "2": 5000, ... "12": 0 }, "2026": ... }.
   *  When present this is the source of truth for line spend; year_data.spend is the fallback. */
  cashflow: Record<string, Record<string, number>> | null;
  breakdown: BreakdownItem[] | null;
  created_at: string;
  updated_at: string;
};

export type BudgetExtractLine = {
  code: string | null;
  group: string | null;
  category: string | null;
  project_name: string | null;
  description: string | null;
  vendor: string | null;
  original_total_budget: number;
  forecast_total_budget: number;
  year_data: Record<string, { forecast?: number; spend?: number }> | null;
  cashflow: Record<string, Record<string, number>> | null;
  notes: string | null;
  breakdown: BreakdownItem[] | null;
};

export type BudgetExtractResult = {
  lines: BudgetExtractLine[];
  document_title: string | null;
  primary_vendor: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low" | null;
  source_filename: string | null;
  line_count: number;
  doc_kind: "proposal" | "aggregated_budget" | null;
};


export type InvoiceSplit = {
  id?: string;
  line_id: string | null;
  amount: number;
  applied_year: number | null;
  applied_month: number | null;
  label?: string | null;
  description?: string | null;
  code?: string | null;
};

export type SuggestedSplit = {
  amount: number;
  label: string | null;
  description: string | null;
  code: string | null;
  suggested_line_id: string | null;
  confidence: number | null;
  reason: string | null;
};

export type CapexInvoice = {
  id: string;
  project_id: string;
  line_id: string | null;
  vendor: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number;
  description: string | null;
  applied_year: number | null;
  applied_month: number | null;
  confidence: number | null;
  match_status: "pending" | "matched" | "manual" | "unmatched";
  date_paid: string | null;
  payment_notes: string | null;
  splits: InvoiceSplit[] | null;
  original_filename: string | null;
  file_path: string;
  created_at: string;
  updated_at: string;
};

export type InvoiceParseLineMatch = {
  line_id: string;
  confidence: number;
  reason: string | null;
};

export type InvoiceParseResult = {
  invoice_id: string;
  vendor: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number;
  description: string | null;
  suggested_year: number | null;
  suggested_month: number | null;
  matches: InvoiceParseLineMatch[];
  best_match: InvoiceParseLineMatch | null;
  suggested_splits: SuggestedSplit[];
  threshold: number;
  above_threshold: boolean;
  source_filename: string | null;
  notes: string | null;
};

export type InvoiceApplyPayload = {
  /** Either line_id+applied_year+applied_month for single-line apply, OR
   *  splits[] for multi-line apply. When both are present, splits wins. */
  line_id?: string | null;
  applied_year?: number | null;
  applied_month?: number | null;
  splits?: InvoiceSplit[];
  vendor?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  total_amount?: number;
  description?: string | null;
  match_status?: "matched" | "manual";
};


export type DocType = "contract" | "agreement" | "proposal";
export type ForecastAction = "none" | "update" | "custom";

export type CapexDocument = {
  id: string;
  project_id: string;
  line_id: string | null;
  doc_type: DocType;
  vendor: string | null;
  amount: number | null;
  updates_forecast: boolean;
  file_path: string;
  original_filename: string | null;
  notes: string | null;
  created_at: string;
};

export type DocumentParseResult = {
  document_id: string;
  suggested_doc_type: DocType | null;
  vendor: string | null;
  amount: number | null;
  document_date: string | null;
  scope_summary: string | null;
  confidence: "high" | "medium" | "low" | null;
  notes: string | null;
  source_filename: string | null;
};

export type DocumentApplyPayload = {
  line_id: string;
  doc_type: DocType;
  forecast_action: ForecastAction;
  custom_amount?: number;
  vendor?: string | null;
  amount?: number;
  notes?: string | null;
};

export type HotelEnrichment = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  keys?: number | null;
  year_built?: number | null;
  last_renovation?: number | null;
  current_brand?: string | null;
  current_flag?: string | null;
  property_type?: string | null;
  floors?: number | null;
  notes?: string | null;
  enrichment_confidence?: string | null;
};

export type CapexHotel = HotelEnrichment & {
  id: string;
  project_id: string;
  name: string;
  image_path: string | null;
  logo_path: string | null;
  sort_order: number;
  line_count: number;
  forecast_total: number;
  spend_to_date: number;
  created_at: string;
  updated_at: string;
};

export type HotelLookupResult = {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  keys?: number | null;
  year_built?: number | null;
  last_renovation?: number | null;
  current_brand?: string | null;
  current_flag?: string | null;
  property_type?: string | null;
  floors?: number | null;
  notes?: string | null;
  confidence?: "high" | "medium" | "low" | null;
};

export type CapexProject = {
  id: string;
  kind: CapexKind;
  name: string;
  image_path: string | null;
  parent_hotel_name: string | null;
  year_start: number;
  year_end: number;
  /** 1..12 when set, null when not specified. */
  month_start: number | null;
  month_end: number | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  hotels: CapexHotel[];
};

export type CapexProjectCard = {
  id: string;
  kind: CapexKind;
  name: string;
  image_path: string | null;
  parent_hotel_name: string | null;
  year_start: number;
  year_end: number;
  month_start: number | null;
  month_end: number | null;
  updated_at: string;
  forecast_total: number;
  spend_to_date: number;
  remaining_current_year: number;
};

export type CreateHotelInput = HotelEnrichment & {
  name: string;
  image_path?: string | null;
  sort_order?: number;
};

export type CreateProjectPayload = {
  kind: CapexKind;
  name: string;
  image_path?: string | null;
  parent_hotel_name?: string | null;
  year_start: number;
  year_end: number;
  hotels?: CreateHotelInput[];
};

export const KIND_LABEL: Record<CapexKind, string> = {
  single: "Single Hotel",
  portfolio: "Portfolio",
  project: "Project",
};
