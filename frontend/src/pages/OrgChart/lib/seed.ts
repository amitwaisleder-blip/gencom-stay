// Initial chart shown on first load and after Reset. Mirrors the kind
// of legal/PE entity diagram the tool exists to draw — top-level
// holding LLC with two member entities below summing to 100%.

import type { ChartState } from "./types";
import { defaultsFor } from "./themes";

export function seedChart(): ChartState {
  const d = defaultsFor("hyatt-blue");
  return {
    version: 1,
    title: "TPYM Holdings Ownership Structure",
    theme: "hyatt-blue",
    uniformSize: true,
    boxes: [
      {
        id: "b_root",
        name: "TPYM Holdings, LLC",
        entityType: "LLC",
        ownershipPct: null,
        ...d,
        x: 360, y: 80, width: 200, height: 80,
      },
      {
        id: "b_pe",
        name: "Pyramid Equity Partners, LP",
        entityType: "LP",
        ownershipPct: 60,
        ...d,
        x: 200, y: 240, width: 200, height: 80,
      },
      {
        id: "b_family",
        name: "Alibhai Family Trust",
        entityType: "Trust",
        ownershipPct: 40,
        ...d,
        x: 520, y: 240, width: 200, height: 80,
      },
    ],
    connectors: [
      { id: "c_pe",     fromBoxId: "b_root", toBoxId: "b_pe",     routeStyle: "orthogonal", showArrowhead: true },
      { id: "c_family", fromBoxId: "b_root", toBoxId: "b_family", routeStyle: "orthogonal", showArrowhead: true },
    ],
  };
}
