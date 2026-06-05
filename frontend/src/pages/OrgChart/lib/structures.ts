// Starter structures the user can pick from in the new-project modal.
// Each builds an initial set of boxes + connectors so the chart isn't
// empty when the editor opens. Boxes use the active theme's defaults.

import type { Box, ChartState, Connector } from "./types";
import { DEFAULT_BOX_H, DEFAULT_BOX_W } from "./types";
import { defaultsFor } from "./themes";

export type StructureKey =
  | "single-llc"
  | "holdco-opco"
  | "two-investor"
  | "trust-controlled"
  | "blank";

export const STRUCTURE_OPTIONS: { key: StructureKey; label: string; description: string }[] = [
  { key: "single-llc",       label: "Single LLC",        description: "One ownership entity. Good starting point for solo deals." },
  { key: "holdco-opco",      label: "Holdco / Opco",     description: "Two-tier: holding company over an operating company." },
  { key: "two-investor",     label: "Two-investor JV",   description: "Holdco with two LP / Trust members below." },
  { key: "trust-controlled", label: "Trust-controlled",  description: "Family trust over an LLC over the property." },
  { key: "blank",            label: "Empty canvas",      description: "Start from scratch — add boxes manually." },
];

function newId(): string {
  return "id_" + Math.random().toString(36).slice(2, 10);
}

/** Build a fresh chart with the given structure and theme. The hotel
 *  name is dropped onto the leaf entity so the chart already reflects
 *  the property when it opens. */
export function buildChart(args: {
  structure: StructureKey;
  themeKey: ChartState["theme"];
  hotelName: string;
  title: string;
}): ChartState {
  const d = defaultsFor(args.themeKey);
  const mk = (over: Partial<Box>): Box => ({
    id: newId(),
    name: "Untitled",
    entityType: "LLC",
    ownershipPct: null,
    fillColor: d.fillColor,
    borderColor: d.borderColor,
    textColor: d.textColor,
    x: 0, y: 0,
    width: DEFAULT_BOX_W, height: DEFAULT_BOX_H,
    ...over,
  });

  const propertyName = args.hotelName.trim() || "Property";

  let boxes: Box[] = [];
  const connectors: Connector[] = [];

  switch (args.structure) {
    case "blank":
      boxes = [];
      break;
    case "single-llc":
      boxes = [mk({ name: propertyName, entityType: "LLC", x: 360, y: 120, ownershipPct: 100 })];
      break;
    case "holdco-opco": {
      const hold = mk({ name: `${propertyName} Holdings`, entityType: "LLC", x: 360, y: 80, ownershipPct: 100 });
      const op = mk({ name: `${propertyName} Operating`, entityType: "LLC", x: 360, y: 280, ownershipPct: 100 });
      boxes = [hold, op];
      connectors.push({ id: newId(), fromBoxId: hold.id, toBoxId: op.id, routeStyle: "orthogonal", showArrowhead: true });
      break;
    }
    case "two-investor": {
      const hold = mk({ name: `${propertyName} Holdings`, entityType: "LLC", x: 380, y: 80, ownershipPct: 100 });
      const lpA = mk({ name: "LP Investor A", entityType: "LP", x: 200, y: 280, ownershipPct: 60 });
      const lpB = mk({ name: "LP Investor B", entityType: "Trust", x: 560, y: 280, ownershipPct: 40 });
      boxes = [hold, lpA, lpB];
      connectors.push(
        { id: newId(), fromBoxId: hold.id, toBoxId: lpA.id, routeStyle: "orthogonal", showArrowhead: true },
        { id: newId(), fromBoxId: hold.id, toBoxId: lpB.id, routeStyle: "orthogonal", showArrowhead: true },
      );
      break;
    }
    case "trust-controlled": {
      const trust = mk({ name: "Family Trust", entityType: "Trust", x: 360, y: 60, ownershipPct: 100 });
      const llc = mk({ name: `${propertyName} Holdings`, entityType: "LLC", x: 360, y: 240, ownershipPct: 100 });
      const op = mk({ name: propertyName, entityType: "LLC", x: 360, y: 420, ownershipPct: 100 });
      boxes = [trust, llc, op];
      connectors.push(
        { id: newId(), fromBoxId: trust.id, toBoxId: llc.id, routeStyle: "orthogonal", showArrowhead: true },
        { id: newId(), fromBoxId: llc.id,   toBoxId: op.id,  routeStyle: "orthogonal", showArrowhead: true },
      );
      break;
    }
  }

  return {
    version: 1,
    title: args.title,
    theme: args.themeKey,
    boxes,
    connectors,
  };
}
