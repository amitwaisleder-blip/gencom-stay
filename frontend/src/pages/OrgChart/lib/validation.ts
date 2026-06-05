// Ownership % validation. For every box that has children, sum the
// children's ownershipPct values and flag if they don't reach 100%.
// Children with no percentage set are listed separately as "missing".

import type { Box, ChartState } from "./types";

export type Validation = {
  /** parentId → details. Keyed by parent so the badge code can do
   *  O(1) lookups when rendering. */
  parents: Map<string, ParentReport>;
};

export type ParentReport = {
  parentId: string;
  parentName: string;
  childCount: number;
  /** Sum of children that DO have an ownershipPct set. */
  sum: number;
  /** Children flagged as having no ownershipPct. */
  missing: Box[];
  /** True when sum is within tolerance of 100. */
  ok: boolean;
};

const TOLERANCE = 0.01;

export function validate(chart: ChartState): Validation {
  const childrenOf = new Map<string, string[]>();
  for (const c of chart.connectors) {
    const arr = childrenOf.get(c.fromBoxId) ?? [];
    arr.push(c.toBoxId);
    childrenOf.set(c.fromBoxId, arr);
  }
  const byId = new Map(chart.boxes.map((b) => [b.id, b]));

  const parents = new Map<string, ParentReport>();
  for (const [parentId, childIds] of childrenOf) {
    if (childIds.length < 2) continue; // single-child branches don't need to sum
    const parent = byId.get(parentId);
    if (!parent) continue;
    let sum = 0;
    const missing: Box[] = [];
    for (const cid of childIds) {
      const c = byId.get(cid);
      if (!c) continue;
      if (c.ownershipPct == null) missing.push(c);
      else sum += c.ownershipPct;
    }
    const ok = missing.length === 0 && Math.abs(sum - 100) <= TOLERANCE;
    parents.set(parentId, {
      parentId,
      parentName: parent.name,
      childCount: childIds.length,
      sum,
      missing,
      ok,
    });
  }
  return { parents };
}

export function warningCount(v: Validation): number {
  let n = 0;
  for (const r of v.parents.values()) if (!r.ok) n++;
  return n;
}
