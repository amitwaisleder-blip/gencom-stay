// InternStore — the single interface UI code sees. Swap layers by
// implementing this interface and changing the `getStore()` export in
// data/index.ts to point at the new implementation. A future Prisma
// + SQLite backend is one new file (`prisma-store.ts`) and one
// one-line change away.

import type {
  CoffeeChatRequest, DateRange, Deliverable, FullTimer, Intern, Kudos,
  LearningGoal, ManagerFeedback, ReturnOfferEntry, ScheduleBlock, ShadowDayRequest,
  SkillEntry, SkillTag, SkillGroup,
} from "./types";

export interface InternStore {
  // -------- Interns --------
  listInterns(): Promise<Intern[]>;
  getIntern(id: string): Promise<Intern | null>;
  /** Patch top-level intern fields (bio, school, dates, photo, mentor).
   *  Resume + skills have their own setters so atomicity is explicit. */
  /** Create a new intern with sensible empty defaults — empty resume,
   *  empty skills, no schedule blocks. The id is generated for you. */
  addIntern(input: {
    name: string;
    school: string;
    programStart: string;
    programEnd: string;
    bio?: string;
    status?: Intern["status"];
  }): Promise<Intern>;
  updateIntern(id: string, patch: Partial<Omit<Intern, "id" | "resume">>): Promise<Intern>;
  setResume(internId: string, resume: Intern["resume"]): Promise<Intern>;
  /** Attach (or clear) the uploaded resume file for an intern. Pass null
   *  to remove. */
  setResumeFile(internId: string, file: Intern["resumeFile"] | null): Promise<Intern>;
  /** Permanently remove an intern + every linked record. */
  deleteIntern(internId: string): Promise<void>;

  // -------- Skills --------
  listSkillTags(): Promise<SkillTag[]>;
  /** Append-only — request a brand-new tag. Returns the unapproved
   *  SkillTag so the UI can immediately reference it as a SkillEntry. */
  requestNewSkillTag(label: string, group: SkillGroup): Promise<SkillTag>;
  setInternSkills(internId: string, skills: SkillEntry[]): Promise<SkillEntry[]>;
  getInternSkills(internId: string): Promise<SkillEntry[]>;

  // -------- People --------
  listFullTimers(): Promise<FullTimer[]>;
  getFullTimer(id: string): Promise<FullTimer | null>;

  // -------- Scheduler --------
  listScheduleBlocks(internId: string, range?: DateRange): Promise<ScheduleBlock[]>;
  upsertScheduleBlock(block: ScheduleBlock): Promise<ScheduleBlock>;
  deleteScheduleBlock(id: string): Promise<void>;
  /** Intern can't directly mutate confirmed blocks — they propose a
   *  change which the manager later confirms. The block lands as a
   *  separate "proposed" record; the original stays put. */
  proposeScheduleChange(
    fromBlockId: string,
    proposed: Omit<ScheduleBlock, "id" | "status" | "proposedBy">,
  ): Promise<ScheduleBlock>;

  // -------- Deliverables (Phase 2) --------
  listDeliverables(internId: string): Promise<Deliverable[]>;
  upsertDeliverable(d: Deliverable): Promise<Deliverable>;
  deleteDeliverable(id: string): Promise<void>;

  // -------- Learning goals (Phase 2) --------
  listLearningGoals(internId: string): Promise<LearningGoal[]>;
  upsertLearningGoal(g: LearningGoal): Promise<LearningGoal>;
  deleteLearningGoal(id: string): Promise<void>;
  /** Append a check-in to a goal. Authored by the actor — intern note
   *  or manager comment use the same shape. */
  addGoalCheckIn(
    goalId: string,
    checkIn: { id?: string; date: string; note: string; author: string },
  ): Promise<LearningGoal>;

  // -------- Manager feedback (Phase 2) --------
  listManagerFeedback(internId: string): Promise<ManagerFeedback[]>;
  upsertManagerFeedback(f: ManagerFeedback): Promise<ManagerFeedback>;
  deleteManagerFeedback(id: string): Promise<void>;

  // -------- Phase 3 — Connection & exposure --------
  /** HR can edit any full-timer's coffee-chat fields; the full-timer
   *  themselves can edit their own. The store doesn't enforce identity
   *  — visibility.ts is the gate. */
  updateFullTimer(id: string, patch: Partial<FullTimer>): Promise<FullTimer>;

  listShadowDayRequests(internId: string): Promise<ShadowDayRequest[]>;
  upsertShadowDayRequest(r: ShadowDayRequest): Promise<ShadowDayRequest>;
  deleteShadowDayRequest(id: string): Promise<void>;

  listCoffeeChatRequests(filter?: { internId?: string; fullTimerId?: string }): Promise<CoffeeChatRequest[]>;
  upsertCoffeeChatRequest(r: CoffeeChatRequest): Promise<CoffeeChatRequest>;
  deleteCoffeeChatRequest(id: string): Promise<void>;

  // -------- Phase 4 — Closing the loop --------
  listKudos(internId: string): Promise<Kudos[]>;
  upsertKudos(k: Kudos): Promise<Kudos>;
  deleteKudos(id: string): Promise<void>;

  listReturnOffers(internId: string): Promise<ReturnOfferEntry[]>;
  upsertReturnOffer(r: ReturnOfferEntry): Promise<ReturnOfferEntry>;
  deleteReturnOffer(id: string): Promise<void>;
}
