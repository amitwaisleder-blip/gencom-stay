/** Column model for the Budget Table. The year columns are dynamic — derived
 *  from the parent project's `year_start..year_end` range, so they slot in
 *  between the static columns at runtime. */

export type ColumnId =
  | "code"
  | "group"
  | "category"
  | "project_name"
  | "description"
  | "vendor"
  | "status"
  | "original_total_budget"
  | "forecast_total_budget"
  | "balance"
  | "notes"
  | `year_${number}`;

export type ColumnDef = {
  id: ColumnId;
  label: string;
  align: "left" | "right";
  /** Default visibility. Year columns default visible regardless. */
  defaultVisible: boolean;
  /** Default proportional width (relative units). */
  defaultWeight: number;
  /** Sortable? */
  sortable: boolean;
  /** "year" gets the special spend-to-date / projected split treatment.
   *  "currency" right-aligns and formats. "text" plain. "status" renders
   *  a colored pill / dropdown. */
  variant: "text" | "currency" | "year" | "status";
};


export function staticColumns(): ColumnDef[] {
  return [
    { id: "vendor", label: "Vendor", align: "left", defaultVisible: true, defaultWeight: 1.4, sortable: true, variant: "text" },
    { id: "code", label: "Code", align: "left", defaultVisible: true, defaultWeight: 1, sortable: true, variant: "text" },
    { id: "group", label: "Group", align: "left", defaultVisible: true, defaultWeight: 1.4, sortable: true, variant: "text" },
    { id: "category", label: "Category", align: "left", defaultVisible: true, defaultWeight: 1.4, sortable: true, variant: "text" },
    { id: "project_name", label: "Project Name", align: "left", defaultVisible: true, defaultWeight: 1.6, sortable: true, variant: "text" },
    { id: "description", label: "Description", align: "left", defaultVisible: true, defaultWeight: 2.4, sortable: true, variant: "text" },
    { id: "status", label: "Status", align: "left", defaultVisible: true, defaultWeight: 1.3, sortable: true, variant: "status" },
    { id: "original_total_budget", label: "Original Budget", align: "right", defaultVisible: true, defaultWeight: 1.2, sortable: true, variant: "currency" },
    { id: "forecast_total_budget", label: "Forecast Budget", align: "right", defaultVisible: true, defaultWeight: 1.2, sortable: true, variant: "currency" },
  ];
}


export function yearColumns(yearStart: number, yearEnd: number): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (let y = yearStart; y <= yearEnd; y++) {
    out.push({
      id: `year_${y}`,
      label: `${y}`,
      align: "right",
      defaultVisible: true,
      defaultWeight: 1.4,
      sortable: true,
      variant: "year",
    });
  }
  return out;
}


export function trailingColumns(): ColumnDef[] {
  return [
    { id: "balance", label: "Balance", align: "right", defaultVisible: true, defaultWeight: 1.2, sortable: true, variant: "currency" },
    { id: "notes", label: "Notes", align: "left", defaultVisible: true, defaultWeight: 1.6, sortable: false, variant: "text" },
  ];
}


export function allColumns(yearStart: number, yearEnd: number): ColumnDef[] {
  return [...staticColumns(), ...yearColumns(yearStart, yearEnd), ...trailingColumns()];
}
