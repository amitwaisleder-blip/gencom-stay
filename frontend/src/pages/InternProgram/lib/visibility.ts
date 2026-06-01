// Role-based visibility — single source of truth for who can see and
// edit what. Mirrors the table from the spec exactly so reviewers can
// audit it line-by-line. Components consume `can(role, action)` and
// never inline role checks.

import type { Role } from "@/data";

export type Feature =
  | "bio" | "skills" | "scheduler" | "deliverables" | "learningGoals"
  | "managerFeedback" | "mentorMatching" | "coffeeChatDirectory"
  | "shadowDayRequests" | "kudos" | "returnOfferTracker" | "portfolio";

export type Action = "view" | "edit-own" | "edit-any" | "comment" | "post" | "request" | "approve" | "export";

type Matrix = Record<Feature, Partial<Record<Role, Action[]>>>;

// Decoded from the spec's role table. "edit-own" means the actor only
// has write access to their own slice (their bio, their feedback rows,
// their listing). "edit-any" is unrestricted edit. "comment" is a
// limited-write affordance specific to learning goals.
const MATRIX: Matrix = {
  bio: {
    intern:  ["view", "edit-own"],
    manager: ["view"],
    hr:      ["view"],
    exec:    ["view"],
  },
  skills: {
    intern:  ["view", "edit-own"],
    manager: ["view"],
    hr:      ["view"],
    exec:    ["view"],
  },
  scheduler: {
    intern:  ["view", "request"],
    manager: ["view", "edit-any"],
    hr:      ["view", "edit-any"],
    exec:    ["view"],
  },
  deliverables: {
    intern:  ["view", "edit-own"],
    manager: ["view"],
    hr:      ["view"],
    exec:    ["view"],
  },
  learningGoals: {
    intern:  ["view", "edit-own"],
    manager: ["view", "comment"],
    hr:      ["view"],
    exec:    ["view"],
  },
  managerFeedback: {
    intern:  [],
    manager: ["edit-own"],
    hr:      ["view"],
    exec:    ["view"],
  },
  mentorMatching: {
    intern:  ["view"],
    manager: ["view"],
    hr:      ["view", "edit-any"],
    exec:    ["view"],
  },
  coffeeChatDirectory: {
    intern:  ["view", "request"],
    manager: ["view", "edit-own"],
    hr:      ["view", "edit-any"],
    exec:    ["view", "edit-own"],
  },
  shadowDayRequests: {
    intern:  ["view", "request"],
    manager: ["view", "approve"],
    hr:      ["view"],
    exec:    ["view"],
  },
  kudos: {
    intern:  ["view"],
    manager: ["view", "post"],
    hr:      ["view", "post"],
    exec:    ["view", "post"],
  },
  returnOfferTracker: {
    intern:  [],
    manager: ["view", "edit-own"],
    hr:      ["view"],
    exec:    ["view"],
  },
  portfolio: {
    intern:  ["view", "export"],
    manager: ["view"],
    hr:      ["view"],
    exec:    ["view"],
  },
};

export function actionsFor(role: Role, feature: Feature): Action[] {
  return MATRIX[feature][role] ?? [];
}

export function can(role: Role, feature: Feature, action: Action): boolean {
  return actionsFor(role, feature).includes(action);
}

/** Convenience — true if the actor can write to the feature in any
 *  capacity (own or any). Use for showing "edit" affordances. */
export function canEdit(role: Role, feature: Feature): boolean {
  const a = actionsFor(role, feature);
  return a.includes("edit-own") || a.includes("edit-any");
}

export function canView(role: Role, feature: Feature): boolean {
  return actionsFor(role, feature).includes("view");
}

export const ROLE_LABEL: Record<Role, string> = {
  intern:  "Intern",
  manager: "Manager",
  hr:      "HR",
  exec:    "Exec",
};
