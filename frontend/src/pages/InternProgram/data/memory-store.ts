// localStorage-backed in-memory implementation of InternStore. The
// host app runs in a browser tab — there's no Node fs — so we persist
// snapshots under a single localStorage key. First run rebuilds from
// seed; subsequent runs load + back-fill any newly-introduced top-level
// keys (so older snapshots keep working as features land).

import { nanoid } from "nanoid";

import type { InternStore } from "./store";
import type {
  CoffeeChatRequest, DateRange, Deliverable, FullTimer, Intern, Kudos,
  LearningGoal, ManagerFeedback, ReturnOfferEntry, ScheduleBlock,
  ShadowDayRequest, SkillEntry, SkillGroup, SkillTag,
} from "./types";
import { SEED } from "./seed";

type Snapshot = {
  interns: Intern[];
  internSkills: Record<string, SkillEntry[]>;
  skillTags: SkillTag[];
  fullTimers: FullTimer[];
  scheduleBlocks: ScheduleBlock[];
  deliverables: Deliverable[];
  learningGoals: LearningGoal[];
  feedback: ManagerFeedback[];
  kudos: Kudos[];
  returnOffers: ReturnOfferEntry[];
  shadowDays: ShadowDayRequest[];
  coffeeChats: CoffeeChatRequest[];
};

// v2: cohort grew from 1 active + 1 past intern to 3 active + 3 past.
// Bumping the version drops any v1 snapshot so the new seed wins on
// next load. Edits made under v1 are lost — acceptable for demo data.
const STORAGE_KEY = "intern-dashboard:store/v2";

let SNAP: Snapshot | null = null;

function freshSnapshot(): Snapshot {
  // structuredClone is widely supported in modern browsers (Chrome 98+,
  // Firefox 94+, Safari 15.4+) — falls back to JSON for the rare older
  // browser. Either way: deep copy so seeds aren't shared by reference.
  const clone = <T,>(v: T): T =>
    typeof structuredClone === "function"
      ? structuredClone(v)
      : JSON.parse(JSON.stringify(v));
  return {
    interns: clone([...SEED.interns]) as Intern[],
    internSkills: clone(SEED.internSkills) as Record<string, SkillEntry[]>,
    skillTags: clone([...SEED.skillTags]) as SkillTag[],
    fullTimers: clone([...SEED.fullTimers]) as FullTimer[],
    scheduleBlocks: clone([...SEED.scheduleBlocks]) as ScheduleBlock[],
    deliverables: clone([...SEED.deliverables]) as Deliverable[],
    learningGoals: clone([...SEED.learningGoals]) as LearningGoal[],
    feedback: clone([...SEED.feedback]) as ManagerFeedback[],
    kudos: clone([...SEED.kudos]) as Kudos[],
    returnOffers: clone([...SEED.returnOffers]) as ReturnOfferEntry[],
    shadowDays: clone([...SEED.shadowDays]) as ShadowDayRequest[],
    coffeeChats: clone([...SEED.coffeeChats]) as CoffeeChatRequest[],
  };
}

function hydrate(): Snapshot {
  if (SNAP) return SNAP;
  if (typeof localStorage === "undefined") {
    // SSR / non-browser context (none in pip-budget-app today, but keep
    // the path safe so unit tests under node don't blow up).
    SNAP = freshSnapshot();
    return SNAP;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw) as Partial<Snapshot>;
      SNAP = { ...freshSnapshot(), ...loaded } as Snapshot;
      return SNAP;
    }
  } catch {
    // Corrupt JSON — drop and reseed.
  }
  SNAP = freshSnapshot();
  persist();
  return SNAP;
}

function persist(): void {
  if (!SNAP || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SNAP));
  } catch (e) {
    // QuotaExceededError or similar — log and continue. We don't surface
    // this to the user for now; the in-memory copy still works.
    // eslint-disable-next-line no-console
    console.warn("[intern-dashboard] failed to persist store:", e);
  }
}

/** Reset the on-disk store to a fresh snapshot built from seed. Useful
 *  during demos and from a future "reset data" affordance. */
export function resetToSeed(): void {
  SNAP = freshSnapshot();
  persist();
}

class MemoryStore implements InternStore {
  // -------- Interns --------
  async listInterns(): Promise<Intern[]> {
    return [...hydrate().interns];
  }
  async getIntern(id: string): Promise<Intern | null> {
    return hydrate().interns.find((i) => i.id === id) ?? null;
  }
  async updateIntern(
    id: string,
    patch: Partial<Omit<Intern, "id" | "resume">>,
  ): Promise<Intern> {
    const s = hydrate();
    const idx = s.interns.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`Intern not found: ${id}`);
    s.interns[idx] = { ...s.interns[idx], ...patch };
    persist();
    return s.interns[idx];
  }
  async addIntern(input: {
    name: string;
    school: string;
    programStart: string;
    programEnd: string;
    bio?: string;
    status?: Intern["status"];
  }): Promise<Intern> {
    const s = hydrate();
    const intern: Intern = {
      id: nanoid(8),
      name: input.name.trim(),
      school: input.school.trim(),
      programStart: input.programStart,
      programEnd: input.programEnd,
      status: input.status ?? "active",
      bio: (input.bio ?? "").trim(),
      resume: { education: [], experience: [], projects: [], links: [] },
    };
    s.interns = [...s.interns, intern];
    s.internSkills[intern.id] = [];
    persist();
    return intern;
  }
  async setResume(internId: string, resume: Intern["resume"]): Promise<Intern> {
    const s = hydrate();
    const idx = s.interns.findIndex((i) => i.id === internId);
    if (idx === -1) throw new Error(`Intern not found: ${internId}`);
    s.interns[idx] = { ...s.interns[idx], resume };
    persist();
    return s.interns[idx];
  }
  async setResumeFile(internId: string, file: Intern["resumeFile"] | null): Promise<Intern> {
    const s = hydrate();
    const idx = s.interns.findIndex((i) => i.id === internId);
    if (idx === -1) throw new Error(`Intern not found: ${internId}`);
    const next = { ...s.interns[idx] };
    if (file) next.resumeFile = file;
    else delete next.resumeFile;
    s.interns[idx] = next;
    persist();
    return next;
  }
  async deleteIntern(internId: string): Promise<void> {
    const s = hydrate();
    const before = s.interns.length;
    s.interns = s.interns.filter((i) => i.id !== internId);
    if (s.interns.length === before) return; // idempotent — silent on missing IDs
    // Cascade: every record keyed off this intern goes too. Skill tags
    // are shared and stay; everything else is per-intern.
    delete s.internSkills[internId];
    s.scheduleBlocks = s.scheduleBlocks.filter((b) => b.internId !== internId);
    s.deliverables = s.deliverables.filter((d) => d.internId !== internId);
    s.learningGoals = s.learningGoals.filter((g) => g.internId !== internId);
    s.feedback = s.feedback.filter((f) => f.internId !== internId);
    s.kudos = s.kudos.filter((k) => k.internId !== internId);
    s.returnOffers = s.returnOffers.filter((r) => r.internId !== internId);
    s.shadowDays = s.shadowDays.filter((r) => r.internId !== internId);
    s.coffeeChats = s.coffeeChats.filter((r) => r.internId !== internId);
    persist();
  }

  // -------- Skills --------
  async listSkillTags(): Promise<SkillTag[]> {
    return [...hydrate().skillTags].sort((a, b) => {
      if (a.approved !== b.approved) return a.approved ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }
  async requestNewSkillTag(label: string, group: SkillGroup): Promise<SkillTag> {
    const s = hydrate();
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Skill label required");
    const dupe = s.skillTags.find((t) => t.label.toLowerCase() === trimmed.toLowerCase());
    if (dupe) return dupe;
    const tag: SkillTag = { id: `tag-${nanoid(6)}`, label: trimmed, group, approved: false };
    s.skillTags.push(tag);
    persist();
    return tag;
  }
  async setInternSkills(internId: string, skills: SkillEntry[]): Promise<SkillEntry[]> {
    const s = hydrate();
    s.internSkills[internId] = skills.map((sk) => ({ ...sk, id: sk.id || nanoid(8) }));
    persist();
    return s.internSkills[internId];
  }
  async getInternSkills(internId: string): Promise<SkillEntry[]> {
    return [...(hydrate().internSkills[internId] ?? [])];
  }

  // -------- People --------
  async listFullTimers(): Promise<FullTimer[]> {
    return [...hydrate().fullTimers].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getFullTimer(id: string): Promise<FullTimer | null> {
    return hydrate().fullTimers.find((f) => f.id === id) ?? null;
  }

  // -------- Scheduler --------
  async listScheduleBlocks(internId: string, range?: DateRange): Promise<ScheduleBlock[]> {
    return hydrate().scheduleBlocks
      .filter((b) => b.internId === internId)
      .filter((b) => !range || (b.date >= range.from && b.date <= range.to))
      .sort((a, b) => (a.date === b.date ? (a.half === "AM" ? -1 : 1) : a.date.localeCompare(b.date)));
  }
  async upsertScheduleBlock(block: ScheduleBlock): Promise<ScheduleBlock> {
    const s = hydrate();
    const next: ScheduleBlock = { ...block, id: block.id || nanoid(8) };
    const idx = s.scheduleBlocks.findIndex((b) => b.id === next.id);
    if (idx === -1) s.scheduleBlocks.push(next);
    else s.scheduleBlocks[idx] = next;
    persist();
    return next;
  }
  async deleteScheduleBlock(id: string): Promise<void> {
    const s = hydrate();
    s.scheduleBlocks = s.scheduleBlocks.filter((b) => b.id !== id);
    persist();
  }
  async proposeScheduleChange(
    fromBlockId: string,
    proposed: Omit<ScheduleBlock, "id" | "status" | "proposedBy">,
  ): Promise<ScheduleBlock> {
    const s = hydrate();
    const original = s.scheduleBlocks.find((b) => b.id === fromBlockId);
    if (!original) throw new Error(`Block not found: ${fromBlockId}`);
    const next: ScheduleBlock = { ...proposed, id: nanoid(8), status: "proposed", proposedBy: "intern" };
    s.scheduleBlocks.push(next);
    persist();
    return next;
  }

  // -------- Deliverables --------
  async listDeliverables(internId: string): Promise<Deliverable[]> {
    return hydrate().deliverables
      .filter((d) => d.internId === internId)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf) || a.title.localeCompare(b.title));
  }
  async upsertDeliverable(d: Deliverable): Promise<Deliverable> {
    const s = hydrate();
    const next: Deliverable = { ...d, id: d.id || nanoid(8) };
    const idx = s.deliverables.findIndex((x) => x.id === next.id);
    if (idx === -1) s.deliverables.push(next);
    else s.deliverables[idx] = next;
    persist();
    return next;
  }
  async deleteDeliverable(id: string): Promise<void> {
    const s = hydrate();
    s.deliverables = s.deliverables.filter((d) => d.id !== id);
    persist();
  }

  // -------- Learning goals --------
  async listLearningGoals(internId: string): Promise<LearningGoal[]> {
    return hydrate().learningGoals
      .filter((g) => g.internId === internId)
      .map((g) => ({ ...g, checkIns: [...g.checkIns].sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => bucket(a.status) - bucket(b.status));
  }
  async upsertLearningGoal(g: LearningGoal): Promise<LearningGoal> {
    const s = hydrate();
    const next: LearningGoal = { ...g, id: g.id || nanoid(8) };
    const idx = s.learningGoals.findIndex((x) => x.id === next.id);
    if (idx === -1) s.learningGoals.push(next);
    else s.learningGoals[idx] = next;
    persist();
    return next;
  }
  async deleteLearningGoal(id: string): Promise<void> {
    const s = hydrate();
    s.learningGoals = s.learningGoals.filter((g) => g.id !== id);
    persist();
  }
  async addGoalCheckIn(
    goalId: string,
    checkIn: { id?: string; date: string; note: string; author: string },
  ): Promise<LearningGoal> {
    const s = hydrate();
    const idx = s.learningGoals.findIndex((g) => g.id === goalId);
    if (idx === -1) throw new Error(`Goal not found: ${goalId}`);
    const ci = { id: checkIn.id || nanoid(8), date: checkIn.date, note: checkIn.note, author: checkIn.author };
    s.learningGoals[idx] = { ...s.learningGoals[idx], checkIns: [...s.learningGoals[idx].checkIns, ci] };
    persist();
    return s.learningGoals[idx];
  }

  // -------- Manager feedback --------
  async listManagerFeedback(internId: string): Promise<ManagerFeedback[]> {
    return hydrate().feedback
      .filter((f) => f.internId === internId)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  }
  async upsertManagerFeedback(f: ManagerFeedback): Promise<ManagerFeedback> {
    const s = hydrate();
    const next: ManagerFeedback = { ...f, id: f.id || nanoid(8) };
    const idx = s.feedback.findIndex((x) => x.id === next.id);
    if (idx === -1) s.feedback.push(next);
    else s.feedback[idx] = next;
    persist();
    return next;
  }
  async deleteManagerFeedback(id: string): Promise<void> {
    const s = hydrate();
    s.feedback = s.feedback.filter((f) => f.id !== id);
    persist();
  }

  // -------- FullTimer (Phase 3) --------
  async updateFullTimer(id: string, patch: Partial<FullTimer>): Promise<FullTimer> {
    const s = hydrate();
    const idx = s.fullTimers.findIndex((f) => f.id === id);
    if (idx === -1) throw new Error(`Full-timer not found: ${id}`);
    s.fullTimers[idx] = { ...s.fullTimers[idx], ...patch, id };
    persist();
    return s.fullTimers[idx];
  }

  // -------- Shadow days --------
  async listShadowDayRequests(internId: string): Promise<ShadowDayRequest[]> {
    return hydrate().shadowDays
      .filter((r) => r.internId === internId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async upsertShadowDayRequest(r: ShadowDayRequest): Promise<ShadowDayRequest> {
    const s = hydrate();
    const next: ShadowDayRequest = { ...r, id: r.id || nanoid(8) };
    const idx = s.shadowDays.findIndex((x) => x.id === next.id);
    if (idx === -1) s.shadowDays.push(next);
    else s.shadowDays[idx] = next;
    persist();
    return next;
  }
  async deleteShadowDayRequest(id: string): Promise<void> {
    const s = hydrate();
    s.shadowDays = s.shadowDays.filter((r) => r.id !== id);
    persist();
  }

  // -------- Coffee chat requests --------
  async listCoffeeChatRequests(
    filter?: { internId?: string; fullTimerId?: string },
  ): Promise<CoffeeChatRequest[]> {
    return hydrate().coffeeChats
      .filter((r) => !filter?.internId || r.internId === filter.internId)
      .filter((r) => !filter?.fullTimerId || r.fullTimerId === filter.fullTimerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async upsertCoffeeChatRequest(r: CoffeeChatRequest): Promise<CoffeeChatRequest> {
    const s = hydrate();
    const next: CoffeeChatRequest = { ...r, id: r.id || nanoid(8) };
    const idx = s.coffeeChats.findIndex((x) => x.id === next.id);
    if (idx === -1) s.coffeeChats.push(next);
    else s.coffeeChats[idx] = next;
    persist();
    return next;
  }
  async deleteCoffeeChatRequest(id: string): Promise<void> {
    const s = hydrate();
    s.coffeeChats = s.coffeeChats.filter((r) => r.id !== id);
    persist();
  }

  // -------- Kudos --------
  async listKudos(internId: string): Promise<Kudos[]> {
    return hydrate().kudos
      .filter((k) => k.internId === internId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async upsertKudos(k: Kudos): Promise<Kudos> {
    const s = hydrate();
    const next: Kudos = { ...k, id: k.id || nanoid(8) };
    const idx = s.kudos.findIndex((x) => x.id === next.id);
    if (idx === -1) s.kudos.push(next);
    else s.kudos[idx] = next;
    persist();
    return next;
  }
  async deleteKudos(id: string): Promise<void> {
    const s = hydrate();
    s.kudos = s.kudos.filter((k) => k.id !== id);
    persist();
  }

  // -------- Return offers --------
  async listReturnOffers(internId: string): Promise<ReturnOfferEntry[]> {
    return hydrate().returnOffers
      .filter((r) => r.internId === internId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async upsertReturnOffer(r: ReturnOfferEntry): Promise<ReturnOfferEntry> {
    const s = hydrate();
    const next: ReturnOfferEntry = { ...r, id: r.id || nanoid(8) };
    const idx = s.returnOffers.findIndex((x) => x.id === next.id);
    if (idx === -1) s.returnOffers.push(next);
    else s.returnOffers[idx] = next;
    persist();
    return next;
  }
  async deleteReturnOffer(id: string): Promise<void> {
    const s = hydrate();
    s.returnOffers = s.returnOffers.filter((r) => r.id !== id);
    persist();
  }
}

function bucket(status: LearningGoal["status"]): number {
  return status === "at-risk" ? 0 : status === "on-track" ? 1 : 2;
}

let SINGLETON: MemoryStore | null = null;
export function memoryStore(): MemoryStore {
  if (!SINGLETON) SINGLETON = new MemoryStore();
  return SINGLETON;
}
