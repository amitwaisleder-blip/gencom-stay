import type {
  BudgetExtractResult,
  CapexDocument,
  CapexHotel,
  CapexInvoice,
  CapexLine,
  CapexProject,
  CapexProjectCard,
  CreateProjectPayload,
  DocumentApplyPayload,
  DocumentParseResult,
  HotelLookupResult,
  InvoiceApplyPayload,
  InvoiceParseResult,
} from "./types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const BASE = "/api/capex-tracker";

export const capexApi = {
  // ─── Projects ─────────────────────────────────────────────────────────
  listProjects: (archived = false) =>
    fetch(`${BASE}/projects?archived=${archived}`).then(j<CapexProjectCard[]>),
  getProject: (id: string) => fetch(`${BASE}/projects/${id}`).then(j<CapexProject>),
  createProject: (payload: CreateProjectPayload) =>
    fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexProject>),
  updateProject: (id: string, payload: Partial<CapexProject>) =>
    fetch(`${BASE}/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexProject>),
  deleteProject: (id: string) =>
    fetch(`${BASE}/projects/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),

  // ─── AI-fill (Claude lookup) ──────────────────────────────────────────
  lookupHotel: (name: string, cityHint?: string) =>
    fetch(`${BASE}/lookup-hotel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, city_hint: cityHint || null }),
    }).then(j<HotelLookupResult>),

  // ─── Budget extraction (PDF/Excel/DOCX/CSV → structured lines) ────────
  extractBudget: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/extract-budget`, { method: "POST", body: fd }).then(
      j<BudgetExtractResult>,
    );
  },

  // ─── Invoice upload + auto-match ──────────────────────────────────────
  uploadInvoice: (projectId: string, file: File, threshold = 0.75) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("threshold", String(threshold));
    return fetch(`${BASE}/projects/${projectId}/invoices/upload`, {
      method: "POST",
      body: fd,
    }).then(j<InvoiceParseResult>);
  },
  applyInvoice: (projectId: string, invoiceId: string, payload: InvoiceApplyPayload) =>
    fetch(`${BASE}/projects/${projectId}/invoices/${invoiceId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexInvoice>),
  listInvoices: (projectId: string) =>
    fetch(`${BASE}/projects/${projectId}/invoices`).then(j<CapexInvoice[]>),
  deleteInvoice: (invoiceId: string) =>
    fetch(`${BASE}/invoices/${invoiceId}`, { method: "DELETE" }).then(j<{ ok: true }>),
  markInvoicePaid: (invoiceId: string, datePaid: string | null, paymentNotes?: string | null) =>
    fetch(`${BASE}/invoices/${invoiceId}/mark-paid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date_paid: datePaid, payment_notes: paymentNotes ?? null }),
    }).then(j<CapexInvoice>),
  updateInvoice: (invoiceId: string, payload: Partial<CapexInvoice>) =>
    fetch(`${BASE}/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexInvoice>),

  // Returns the URL the user should hit (browser-driven download via window.location).
  exportInvoiceTrackingUrl: (projectId: string, year: number, month: number, hotelId?: string) => {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (hotelId) params.set("hotel_id", hotelId);
    return `${BASE}/projects/${projectId}/invoices/export-tracking?${params}`;
  },
  exportFundingRequestUrl: (projectId: string, year: number, month: number, hotelId?: string) => {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (hotelId) params.set("hotel_id", hotelId);
    return `${BASE}/projects/${projectId}/invoices/export-funding-request?${params}`;
  },
  exportCashflowUrl: (projectId: string, hotelId?: string) => {
    const params = new URLSearchParams();
    if (hotelId) params.set("hotel_id", hotelId);
    const qs = params.toString();
    return `${BASE}/projects/${projectId}/cashflow/export${qs ? `?${qs}` : ""}`;
  },
  exportCashflowHtmlUrl: (projectId: string, hotelId?: string, opts?: { download?: boolean }) => {
    const params = new URLSearchParams();
    if (hotelId) params.set("hotel_id", hotelId);
    if (opts?.download) params.set("download", "1");
    const qs = params.toString();
    return `${BASE}/projects/${projectId}/cashflow/export-html${qs ? `?${qs}` : ""}`;
  },
  importCashflow: (projectId: string, file: File, hotelId?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (hotelId) fd.append("hotel_id", hotelId);
    return fetch(`${BASE}/projects/${projectId}/cashflow/import`, {
      method: "POST",
      body: fd,
    }).then(j<{
      matched: Array<{ line_id: string; code: string; years: number[] }>;
      unmatched: Array<{ code: string; row: number }>;
      matched_count: number;
      unmatched_count: number;
    }>);
  },

  // ─── Documents (contract / agreement / executed proposal) ─────────────
  uploadDocument: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/projects/${projectId}/documents/upload`, {
      method: "POST",
      body: fd,
    }).then(j<DocumentParseResult>);
  },
  applyDocument: (documentId: string, payload: DocumentApplyPayload) =>
    fetch(`${BASE}/documents/${documentId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexDocument>),
  listLineDocuments: (lineId: string) =>
    fetch(`${BASE}/lines/${lineId}/documents`).then(j<CapexDocument[]>),
  listProjectDocuments: (projectId: string) =>
    fetch(`${BASE}/projects/${projectId}/documents`).then(j<CapexDocument[]>),
  deleteDocument: (documentId: string) =>
    fetch(`${BASE}/documents/${documentId}`, { method: "DELETE" }).then(j<{ ok: true }>),

  uploadProjectImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/projects/${id}/image`, { method: "POST", body: fd }).then(
      j<{ ok: true; image_path: string }>,
    );
  },

  // ─── Hotels ───────────────────────────────────────────────────────────
  addHotel: (projectId: string, payload: { name: string; image_path?: string | null; sort_order?: number }) =>
    fetch(`${BASE}/projects/${projectId}/hotels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexHotel>),
  getHotel: (hotelId: string) => fetch(`${BASE}/hotels/${hotelId}`).then(j<CapexHotel>),
  updateHotel: (hotelId: string, payload: Partial<CapexHotel>) =>
    fetch(`${BASE}/hotels/${hotelId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexHotel>),
  deleteHotel: (hotelId: string) =>
    fetch(`${BASE}/hotels/${hotelId}`, { method: "DELETE" }).then(j<{ ok: true }>),
  uploadHotelImage: (hotelId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/hotels/${hotelId}/image`, { method: "POST", body: fd }).then(
      j<{ ok: true; image_path: string }>,
    );
  },
  uploadHotelLogo: (hotelId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/hotels/${hotelId}/logo`, { method: "POST", body: fd }).then(
      j<{ ok: true; logo_path: string }>,
    );
  },
  autoDetectHotelLogo: (hotelId: string) =>
    fetch(`${BASE}/hotels/${hotelId}/logo/auto`, { method: "POST" }).then(
      j<{
        ok: true;
        logo_path: string;
        source_domain?: string;
        canonical_brand?: string;
        confidence?: string;
      }>,
    ),
  clearHotelLogo: (hotelId: string) =>
    fetch(`${BASE}/hotels/${hotelId}/logo`, { method: "DELETE" }).then(j<{ ok: true }>),

  // ─── Lines ────────────────────────────────────────────────────────────
  listLines: (hotelId: string) =>
    fetch(`${BASE}/hotels/${hotelId}/lines`).then(j<CapexLine[]>),
  createLine: (hotelId: string, payload: Partial<CapexLine>) =>
    fetch(`${BASE}/hotels/${hotelId}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexLine>),
  bulkCreateLines: (hotelId: string, payload: Partial<CapexLine>[]) =>
    fetch(`${BASE}/hotels/${hotelId}/lines/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexLine[]>),
  updateLine: (lineId: string, payload: Partial<CapexLine>) =>
    fetch(`${BASE}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j<CapexLine>),
  deleteLine: (lineId: string) =>
    fetch(`${BASE}/lines/${lineId}`, { method: "DELETE" }).then(j<{ ok: true }>),

  filenameSuggest: (kind: "invoice" | "contract" | "budget", metadata: Record<string, unknown>, extension?: string) =>
    fetch(`${BASE}/filename-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, metadata, extension }),
    }).then(j<{ filename: string; pattern_examples: number }>),

  filenameRecord: (kind: "invoice" | "contract" | "budget", chosen_filename: string, metadata?: Record<string, unknown>) =>
    fetch(`${BASE}/filename-history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, chosen_filename, metadata }),
    }).then(j<{ ok: true; id: string }>),
};

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
