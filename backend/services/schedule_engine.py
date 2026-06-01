"""Schedule engine — turns wizard inputs into a list of tasks with dates.

Skeleton pass: deterministic, full-renovation only. Construction duration is a
naive heuristic (scope-count + phased-rollout adders); the AI duration engine
and blackout-aware reflow land in the next pass.

Output shape mirrors the reference file `RCCP - Draft ID Schedule - 04.13.26.xlsx`:
  - Phase header rows (PRE-DESIGN, CONCEPT DESIGN, …)
  - Task rows under each phase with type=Independent | Dependent
  - Milestone rows (zero-duration anchors like "GC Selected", "Final Completion")
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import date, timedelta
from typing import Literal, Optional

TaskType = Literal["independent", "dependent", "phase_header", "milestone"]


@dataclass
class Task:
    name: str
    phase: str
    type: TaskType
    start: date
    end: date
    weeks: float
    override_date: Optional[date] = None
    notes: Optional[str] = None
    indent: int = 0  # 0 = phase header, 1 = task, 2 = sub-task


@dataclass
class Milestone:
    name: str
    start: date
    end: date
    duration: str  # e.g. "12 weeks" or "—" for zero-duration


@dataclass
class Schedule:
    project_name: str
    project_type: str
    unit: str  # "weeks" | "days"
    tasks: list[Task] = field(default_factory=list)
    milestones: list[Milestone] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_jsonable(self) -> dict:
        def conv(d):
            if isinstance(d, date):
                return d.isoformat()
            return d
        return {
            "project_name": self.project_name,
            "project_type": self.project_type,
            "unit": self.unit,
            "warnings": list(self.warnings),
            "tasks": [
                {**asdict(t), "start": t.start.isoformat(), "end": t.end.isoformat(),
                 "override_date": t.override_date.isoformat() if t.override_date else None}
                for t in self.tasks
            ],
            "milestones": [
                {**asdict(m), "start": m.start.isoformat(), "end": m.end.isoformat()}
                for m in self.milestones
            ],
        }


# ── helpers ───────────────────────────────────────────────────────────────

def _add_weeks(d: date, w: float) -> date:
    return d + timedelta(days=int(round(w * 7)))


def _next_monday(d: date) -> date:
    # Snap to next Monday so phase boundaries land on a weekly grid line —
    # matches how the reference file lays out task starts.
    delta = (7 - d.weekday()) % 7
    return d + timedelta(days=delta or 0)


def _parse_date(s: str | None) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


# ── engine ────────────────────────────────────────────────────────────────

def build_full_renovation(state: dict) -> Schedule:
    """Construct the full-renovation pane sequence.

    Phases mirror the reference schedule. Durations for design phases come from
    state["designTimeline"]; pre-design and contractor-selection use a fixed
    task list with industry-standard durations; construction is a simple
    scope-count + phased-rollout heuristic until the AI engine lands.
    """
    project_name = (state.get("property") or {}).get("name") or "Untitled Project"
    unit = state.get("unit") or "weeks"
    start = _parse_date(state.get("startDate")) or date.today()
    start = _next_monday(start)

    sched = Schedule(project_name=project_name, project_type=state.get("projectType") or "full_renovation", unit=unit)
    add = sched.tasks.append

    # Design phase durations (fall back to industry midpoints if blank).
    dt = state.get("designTimeline") or {}
    concept_w = float(dt.get("concept") or 6)
    sd_w      = float(dt.get("sd") or 10)
    dd_w      = float(dt.get("dd") or 12)
    cd_w      = float(dt.get("cd") or 12)

    # ─── PRE-DESIGN ──────────────────────────────────────────────────────
    # Standard task block — runs in parallel streams for ID firm + PM
    # selection, with site walk and conditions survey landing late in the
    # phase. Total chain ≈ 16 weeks.
    pd_start = start
    pd_tasks: list[Task] = []

    rom = Task("ROM Budget Reconciliation", "PRE-DESIGN", "independent",
               pd_start, _add_weeks(pd_start, 3), 3, override_date=pd_start, indent=1)
    pd_tasks.append(rom)

    rfp_id = Task("Issue RFP — Interior Design Firm", "PRE-DESIGN", "independent",
                  pd_start, _add_weeks(pd_start, 5), 5, override_date=pd_start, indent=1)
    pd_tasks.append(rfp_id)

    id_props = Task("ID Firm Proposals & Schematic Concepts", "PRE-DESIGN", "independent",
                    rfp_id.end, _add_weeks(rfp_id.end, 5), 5, override_date=rfp_id.end, indent=1)
    pd_tasks.append(id_props)

    id_select = Task("ID Firm Interviews & Selection", "PRE-DESIGN", "dependent",
                     id_props.end, _add_weeks(id_props.end, 3), 3, indent=1)
    pd_tasks.append(id_select)

    rfp_pm = Task("Issue RFP — Project Manager", "PRE-DESIGN", "dependent",
                  pd_start, _add_weeks(pd_start, 3), 3, indent=1)
    pd_tasks.append(rfp_pm)

    pm_select_start = _add_weeks(pd_start, 6)
    pm_select = Task("PM Interviews & Selection", "PRE-DESIGN", "independent",
                     pm_select_start, _add_weeks(pm_select_start, 4), 4,
                     override_date=pm_select_start, indent=1)
    pd_tasks.append(pm_select)

    walk_start = _add_weeks(pd_start, 13)
    site_walk = Task("Site Walk — ID Firm", "PRE-DESIGN", "independent",
                     walk_start, _add_weeks(walk_start, 0.5), 0.5,
                     override_date=walk_start, indent=1)
    pd_tasks.append(site_walk)

    survey = Task("Existing Conditions Survey", "PRE-DESIGN", "dependent",
                  site_walk.start, _add_weeks(site_walk.start, 3), 3, indent=1)
    pd_tasks.append(survey)

    programming = Task("Programming & Brand Standards", "PRE-DESIGN", "dependent",
                       site_walk.start, _add_weeks(site_walk.start, 3), 3, indent=1)
    pd_tasks.append(programming)

    pd_end = max(t.end for t in pd_tasks)
    add(Task("PRE-DESIGN", "PRE-DESIGN", "phase_header", pd_start, pd_end,
             round((pd_end - pd_start).days / 7, 1), indent=0))
    for t in pd_tasks:
        add(t)
    sched.milestones.append(Milestone("Pre-Design", pd_start, pd_end,
                                       f"{round((pd_end - pd_start).days / 7, 1)} weeks"))
    sched.milestones.append(Milestone("Property Walk", site_walk.start, site_walk.end, "0.5 weeks"))

    # ─── DESIGN PHASES ───────────────────────────────────────────────────
    def _design_phase(name: str, start_d: date, weeks: float) -> tuple[date, list[Task]]:
        rows: list[Task] = []
        end_d = _add_weeks(start_d, weeks)
        rows.append(Task(name, name, "phase_header", start_d, end_d, weeks, indent=0))
        # The phase header captures the design body; owner review tail follows.
        review_end = _add_weeks(end_d, 1)
        rows.append(Task("Owner Review", name, "dependent", end_d, review_end, 1, indent=1))
        return review_end, rows

    concept_end, rows = _design_phase("CONCEPT DESIGN", pd_end, concept_w)
    for r in rows: add(r)
    sched.milestones.append(Milestone("Concept Design", pd_end, concept_end, f"{concept_w} weeks"))

    sd_end, rows = _design_phase("SCHEMATIC DESIGN", concept_end, sd_w)
    for r in rows: add(r)
    sched.milestones.append(Milestone("Schematic Design", concept_end, sd_end, f"{sd_w} weeks"))

    dd_end, rows = _design_phase("DESIGN DEVELOPMENT", sd_end, dd_w)
    for r in rows: add(r)
    sched.milestones.append(Milestone("Design Development", sd_end, dd_end, f"{dd_w} weeks"))

    cd_start = dd_end
    cd_end = _add_weeks(cd_start, cd_w)
    add(Task("CD / FF&E SPECIFICATIONS", "CD / FF&E", "phase_header", cd_start, cd_end, cd_w, indent=0))
    sched.milestones.append(Milestone("CD / FF&E Specifications", cd_start, cd_end, f"{cd_w} weeks"))

    # Model room review — fires near the end of CD when enabled.
    dp = state.get("designProcess") or {}
    if dp.get("mockup"):
        mr_start = _add_weeks(cd_end, -2)
        mr_end = cd_end
        add(Task("Model Room Review", "CD / FF&E", "dependent", mr_start, mr_end, 2, indent=1))
        sched.milestones.append(Milestone("Model Room Review", mr_start, mr_end, "2 weeks"))

    # ─── CONTRACTOR SELECTION + PERMIT ──────────────────────────────────
    cs_start = _add_weeks(cd_end, 4)  # GC RFP issued ~4 wks after CD substantial.
    pc = state.get("preConstruction") or {}
    permit_w = float(pc.get("permitWeeks") or 9.5)

    rfp_gc = Task("Issue RFP — General Contractor", "CONTRACTOR SELECTION", "dependent",
                  cs_start, _add_weeks(cs_start, 2), 2, indent=1)
    bid = Task("GC Bid Period", "CONTRACTOR SELECTION", "dependent",
               rfp_gc.end, _add_weeks(rfp_gc.end, 2.5), 2.5, indent=1)
    interviews = Task("GC Interviews & Letting", "CONTRACTOR SELECTION", "dependent",
                      bid.end, _add_weeks(bid.end, 5), 5, indent=1)
    gc_milestone = Task("GC Selected & LOI Issued", "CONTRACTOR SELECTION", "milestone",
                        interviews.end, interviews.end, 0, indent=1)
    precon = Task("Pre-Construction & Mobilization", "CONTRACTOR SELECTION", "dependent",
                  _add_weeks(interviews.end, 1), _add_weeks(interviews.end, 2), 1, indent=1)
    permit = Task(f"Permit Filing ({pc.get('permitJurisdiction') or 'TBD'})",
                  "CONTRACTOR SELECTION", "dependent",
                  interviews.end, _add_weeks(interviews.end, permit_w), permit_w, indent=1)

    cs_end = max(precon.end, permit.end)
    add(Task("CONTRACTOR SELECTION", "CONTRACTOR SELECTION", "phase_header",
             cs_start, cs_end, round((cs_end - cs_start).days / 7, 1), indent=0))
    for t in (rfp_gc, bid, interviews, gc_milestone, precon, permit):
        add(t)
    sched.milestones.append(Milestone("Permit Filing", interviews.end, permit.end, f"{permit_w} weeks"))

    # ─── PROCUREMENT ────────────────────────────────────────────────────
    # Long-lead FF&E POs issued shortly after CD; runs in parallel with
    # contractor selection and into construction. End date floats with
    # construction completion below; for now anchor a reasonable block.
    proc_start = cd_end
    proc_end = _add_weeks(proc_start, 53.5)  # placeholder until AI engine lands
    add(Task("PROCUREMENT", "PROCUREMENT", "phase_header", proc_start, proc_end,
             round((proc_end - proc_start).days / 7, 1), indent=0))
    add(Task("FF&E Procurement / Long-Lead POs", "PROCUREMENT", "dependent",
             proc_start, proc_end, round((proc_end - proc_start).days / 7, 1), indent=1))
    sched.milestones.append(Milestone("FF&E Purchase Orders", proc_start, proc_start, "—"))

    # ─── CONSTRUCTION ───────────────────────────────────────────────────
    scope = state.get("scope") or {}
    selected_count = sum(1 for v in scope.values() if v)
    construction_w = max(12.0, min(32.0, 12.0 + selected_count * 1.5))
    construction_obj = state.get("construction") or {}
    if construction_obj.get("phased"):
        try:
            phases = int(construction_obj.get("phaseCount") or 0)
            if phases > 1:
                construction_w += (phases - 1) * 4
        except (TypeError, ValueError):
            pass

    con_start = _add_weeks(cs_end, 2)  # mobilization tail before active build
    con_end = _add_weeks(con_start, construction_w)
    add(Task("CONSTRUCTION", "CONSTRUCTION", "phase_header", con_start, con_end,
             construction_w, indent=0))
    add(Task("Construction", "CONSTRUCTION", "dependent",
             con_start, con_end, construction_w, indent=1))
    sched.milestones.append(Milestone("Construction", con_start, con_end, f"{construction_w} weeks"))

    # ─── CLOSEOUT ───────────────────────────────────────────────────────
    co = state.get("closeout") or {}
    punch_w = float(co.get("punchListWeeks") or 4)
    co_start = con_end
    co_end = _add_weeks(co_start, punch_w)
    add(Task("CLOSEOUT", "CLOSEOUT", "phase_header", co_start, co_end, punch_w, indent=0))
    add(Task("Punch List", "CLOSEOUT", "dependent", co_start, co_end, punch_w, indent=1))
    if co.get("softOpening"):
        so = _add_weeks(co_end, -1)
        add(Task("Soft Opening", "CLOSEOUT", "milestone", so, so, 0, indent=1))
        sched.milestones.append(Milestone("Soft Opening", so, so, "—"))
    add(Task("Final Completion", "CLOSEOUT", "milestone", co_end, co_end, 0, indent=1))
    sched.milestones.append(Milestone("Final Completion", co_end, co_end, "—"))

    return sched


# ── alternative project-type builders ────────────────────────────────────

def build_recertification(state: dict) -> Schedule:
    """25/40/50-year recert. Investigation → engineering → permit → repair →
    recert filing → closeout. Skips ID-firm-driven design phases entirely.

    Durations are driven by the recert_questions pane:
      - investigationType controls survey depth
      - occupancy scales repair-construction duration (fully-occupied work is
        slower because it has to coordinate with guests)
      - filings add weeks to the recert filing phase per TR document
    """
    project_name = (state.get("property") or {}).get("name") or "Untitled Project"
    unit = state.get("unit") or "weeks"
    start = _next_monday(_parse_date(state.get("startDate")) or date.today())
    sched = Schedule(project_name=project_name, project_type="recertification", unit=unit)

    recert = state.get("recert") or {}
    inv_type = recert.get("investigationType") or "visual_gpr"
    occupancy = recert.get("occupancy") or "phased"
    filings = recert.get("filings") or {}

    # INVESTIGATION — visual+GPR is the baseline, full structural adds time.
    inv_w_total = {"visual_gpr": 8.0, "full_structural": 14.0, "phased": 12.0}.get(inv_type, 10.0)
    survey_w = round(inv_w_total * 0.6, 1)  # field work
    report_w = round(inv_w_total - survey_w, 1)
    inv_end = _add_weeks(start, inv_w_total)
    sched.tasks.append(Task("INVESTIGATION", "INVESTIGATION", "phase_header", start, inv_end, inv_w_total, indent=0))
    survey_label = {
        "visual_gpr": "Visual Survey & GPR Scan",
        "full_structural": "Full Structural Assessment (visual + core sampling + testing)",
        "phased": "Phased Investigation (visual + targeted follow-up)",
    }.get(inv_type, "Engineering Survey & GPR Scan")
    sched.tasks.append(Task(survey_label, "INVESTIGATION", "independent",
                            start, _add_weeks(start, survey_w), survey_w, override_date=start, indent=1))
    sched.tasks.append(Task("Structural Assessment Report", "INVESTIGATION", "dependent",
                            _add_weeks(start, survey_w), inv_end, report_w, indent=1))
    sched.milestones.append(Milestone("Investigation", start, inv_end, f"{inv_w_total} weeks"))

    # ENGINEERING
    eng_w = 12.0
    eng_end = _add_weeks(inv_end, eng_w)
    sched.tasks.append(Task("ENGINEERING DESIGN", "ENGINEERING", "phase_header", inv_end, eng_end, eng_w, indent=0))
    sched.tasks.append(Task("Repair Drawings & Specifications", "ENGINEERING", "dependent",
                            inv_end, eng_end, eng_w, indent=1))
    sched.milestones.append(Milestone("Engineering Design", inv_end, eng_end, f"{eng_w} weeks"))

    # PERMITTING
    pc = state.get("preConstruction") or {}
    permit_w = float(pc.get("permitWeeks") or 8)
    permit_end = _add_weeks(eng_end, permit_w)
    sched.tasks.append(Task("PERMITTING", "PERMITTING", "phase_header", eng_end, permit_end, permit_w, indent=0))
    sched.tasks.append(Task(f"Permit Filing ({pc.get('permitJurisdiction') or 'TBD'})",
                            "PERMITTING", "dependent", eng_end, permit_end, permit_w, indent=1))
    sched.milestones.append(Milestone("Permit Filing", eng_end, permit_end, f"{permit_w} weeks"))

    # REPAIR CONSTRUCTION — scope drives base, occupancy multiplier scales it.
    scope = state.get("scope") or {}
    sel = sum(1 for v in scope.values() if v)
    repair_focus = recert.get("repairFocus") or {}
    focus_count = sum(1 for v in repair_focus.values() if v)
    base_repair = max(16.0, min(40.0, 14.0 + max(sel, focus_count) * 2))
    occ_mult = {"fully_occupied": 1.30, "phased": 1.15, "vacated": 1.0}.get(occupancy, 1.15)
    repair_w = round(base_repair * occ_mult, 1)
    rep_end = _add_weeks(permit_end, repair_w)
    rep_phase_label = {
        "fully_occupied": "REPAIR CONSTRUCTION (Occupied)",
        "phased": "REPAIR CONSTRUCTION (Phased)",
        "vacated": "REPAIR CONSTRUCTION (Vacated)",
    }.get(occupancy, "REPAIR CONSTRUCTION")
    sched.tasks.append(Task(rep_phase_label, "CONSTRUCTION", "phase_header",
                            permit_end, rep_end, repair_w, indent=0))
    sched.tasks.append(Task("Repair Construction", "CONSTRUCTION", "dependent",
                            permit_end, rep_end, repair_w, indent=1))
    sched.milestones.append(Milestone("Repair Construction", permit_end, rep_end, f"{repair_w} weeks"))

    # RECERT FILING — base 6 weeks + 1 week per TR document required.
    tr_count = sum(1 for k in ("tr1", "tr4", "tr8", "other") if filings.get(k))
    file_w = 6.0 + tr_count
    file_end = _add_weeks(rep_end, file_w)
    sched.tasks.append(Task("RECERT FILING", "FILING", "phase_header", rep_end, file_end, file_w, indent=0))
    sched.tasks.append(Task("Final Inspection & Recert Filing", "FILING", "dependent",
                            rep_end, file_end, file_w, indent=1))
    if filings.get("tr1"):
        sched.tasks.append(Task("TR1 Technical Statement Filing", "FILING", "dependent",
                                rep_end, file_end, 1, indent=2))
    if filings.get("tr4"):
        sched.tasks.append(Task("TR4 Energy Compliance Filing", "FILING", "dependent",
                                rep_end, file_end, 1, indent=2))
    if filings.get("tr8"):
        sched.tasks.append(Task("TR8 Energy Code Progress Filing", "FILING", "dependent",
                                rep_end, file_end, 1, indent=2))
    sched.milestones.append(Milestone("Recert Filing", rep_end, file_end, f"{file_w} weeks"))

    # CLOSEOUT
    co = state.get("closeout") or {}
    punch_w = float(co.get("punchListWeeks") or 4)
    co_end = _add_weeks(file_end, punch_w)
    sched.tasks.append(Task("CLOSEOUT", "CLOSEOUT", "phase_header", file_end, co_end, punch_w, indent=0))
    sched.tasks.append(Task("Punch List", "CLOSEOUT", "dependent", file_end, co_end, punch_w, indent=1))
    sched.tasks.append(Task("Final Completion", "CLOSEOUT", "milestone", co_end, co_end, 0, indent=1))
    sched.milestones.append(Milestone("Final Completion", co_end, co_end, "—"))
    return sched


def build_soft_goods(state: dict) -> Schedule:
    """Soft-goods refresh. Single design phase (6–8 weeks), heavy procurement,
    fast install. Output unit can be days for short projects (handled by Excel
    writer; the engine still uses week math)."""
    project_name = (state.get("property") or {}).get("name") or "Untitled Project"
    unit = state.get("unit") or "weeks"
    start = _next_monday(_parse_date(state.get("startDate")) or date.today())
    sched = Schedule(project_name=project_name, project_type="soft_goods", unit=unit)

    # DESIGN (single combined phase — concept + spec)
    dt = state.get("designTimeline") or {}
    design_w = float(dt.get("concept") or dt.get("sd") or 7)
    d_end = _add_weeks(start, design_w)
    sched.tasks.append(Task("DESIGN", "DESIGN", "phase_header", start, d_end, design_w, indent=0))
    sched.tasks.append(Task("Concept + FF&E Specification", "DESIGN", "dependent",
                            start, d_end, design_w, indent=1))
    sched.tasks.append(Task("Owner Review", "DESIGN", "dependent",
                            d_end, _add_weeks(d_end, 1), 1, indent=1))
    d_end = _add_weeks(d_end, 1)
    sched.milestones.append(Milestone("Design", start, d_end, f"{design_w + 1} weeks"))

    # PROCUREMENT — overlaps installation
    proc_w = 16.0
    proc_end = _add_weeks(d_end, proc_w)
    sched.tasks.append(Task("PROCUREMENT", "PROCUREMENT", "phase_header", d_end, proc_end, proc_w, indent=0))
    sched.tasks.append(Task("FF&E Purchase Orders & Production", "PROCUREMENT", "dependent",
                            d_end, proc_end, proc_w, indent=1))
    sched.milestones.append(Milestone("FF&E Purchase Orders", d_end, d_end, "—"))

    # INSTALLATION — keys-driven duration
    keys = (state.get("property") or {}).get("keys") or 100
    try:
        keys = int(keys)
    except (TypeError, ValueError):
        keys = 100
    install_w = max(2.0, min(12.0, keys / 50))
    inst_end = _add_weeks(proc_end, install_w)
    sched.tasks.append(Task("INSTALLATION", "INSTALLATION", "phase_header",
                            proc_end, inst_end, install_w, indent=0))
    sched.tasks.append(Task("FF&E Install + Touch-Up", "INSTALLATION", "dependent",
                            proc_end, inst_end, install_w, indent=1))
    sched.milestones.append(Milestone("Installation", proc_end, inst_end, f"{install_w} weeks"))

    # CLOSEOUT
    co = state.get("closeout") or {}
    punch_w = float(co.get("punchListWeeks") or 2)
    co_end = _add_weeks(inst_end, punch_w)
    sched.tasks.append(Task("CLOSEOUT", "CLOSEOUT", "phase_header", inst_end, co_end, punch_w, indent=0))
    sched.tasks.append(Task("Punch List", "CLOSEOUT", "dependent", inst_end, co_end, punch_w, indent=1))
    sched.tasks.append(Task("Final Completion", "CLOSEOUT", "milestone", co_end, co_end, 0, indent=1))
    sched.milestones.append(Milestone("Final Completion", co_end, co_end, "—"))
    return sched


def build_mep_modernization(state: dict) -> Schedule:
    """MEP / vertical transportation. Equipment lead times dominate."""
    project_name = (state.get("property") or {}).get("name") or "Untitled Project"
    unit = state.get("unit") or "weeks"
    start = _next_monday(_parse_date(state.get("startDate")) or date.today())
    sched = Schedule(project_name=project_name, project_type="mep_modernization", unit=unit)

    # ASSESSMENT
    a_w = 6.0
    a_end = _add_weeks(start, a_w)
    sched.tasks.append(Task("ASSESSMENT", "ASSESSMENT", "phase_header", start, a_end, a_w, indent=0))
    sched.tasks.append(Task("Existing Equipment Survey", "ASSESSMENT", "independent",
                            start, a_end, a_w, override_date=start, indent=1))
    sched.milestones.append(Milestone("Assessment", start, a_end, f"{a_w} weeks"))

    # ENGINEERING DESIGN
    e_w = 12.0
    e_end = _add_weeks(a_end, e_w)
    sched.tasks.append(Task("ENGINEERING DESIGN", "ENGINEERING", "phase_header", a_end, e_end, e_w, indent=0))
    sched.tasks.append(Task("MEP / VT Design Documents", "ENGINEERING", "dependent",
                            a_end, e_end, e_w, indent=1))
    sched.milestones.append(Milestone("Engineering Design", a_end, e_end, f"{e_w} weeks"))

    # EQUIPMENT PROCUREMENT — elevator equipment is typically 26–52 weeks
    proc_w = 36.0
    proc_end = _add_weeks(e_end, proc_w)
    sched.tasks.append(Task("EQUIPMENT PROCUREMENT", "PROCUREMENT", "phase_header",
                            e_end, proc_end, proc_w, indent=0))
    sched.tasks.append(Task("Equipment Order & Manufacturing", "PROCUREMENT", "dependent",
                            e_end, proc_end, proc_w, indent=1))
    sched.milestones.append(Milestone("Equipment Delivery", proc_end, proc_end, "—"))

    # INSTALLATION
    inst_w = 18.0
    inst_end = _add_weeks(proc_end, inst_w)
    sched.tasks.append(Task("INSTALLATION", "INSTALLATION", "phase_header", proc_end, inst_end, inst_w, indent=0))
    sched.tasks.append(Task("Equipment Installation", "INSTALLATION", "dependent",
                            proc_end, inst_end, inst_w, indent=1))
    sched.milestones.append(Milestone("Installation", proc_end, inst_end, f"{inst_w} weeks"))

    # COMMISSIONING
    com_w = 6.0
    com_end = _add_weeks(inst_end, com_w)
    sched.tasks.append(Task("COMMISSIONING", "COMMISSIONING", "phase_header", inst_end, com_end, com_w, indent=0))
    sched.tasks.append(Task("Test, Balance, Commission", "COMMISSIONING", "dependent",
                            inst_end, com_end, com_w, indent=1))
    sched.tasks.append(Task("Final Acceptance", "COMMISSIONING", "milestone", com_end, com_end, 0, indent=1))
    sched.milestones.append(Milestone("Final Acceptance", com_end, com_end, "—"))
    return sched


def build_structural(state: dict) -> Schedule:
    """Structural repair driven by GPR / engineering investigation."""
    project_name = (state.get("property") or {}).get("name") or "Untitled Project"
    unit = state.get("unit") or "weeks"
    start = _next_monday(_parse_date(state.get("startDate")) or date.today())
    sched = Schedule(project_name=project_name, project_type="structural", unit=unit)

    # INVESTIGATION
    i_w = 8.0
    i_end = _add_weeks(start, i_w)
    sched.tasks.append(Task("INVESTIGATION", "INVESTIGATION", "phase_header", start, i_end, i_w, indent=0))
    sched.tasks.append(Task("GPR / Engineering Survey", "INVESTIGATION", "independent",
                            start, i_end, i_w, override_date=start, indent=1))
    sched.milestones.append(Milestone("Investigation", start, i_end, f"{i_w} weeks"))

    # DESIGN
    d_w = 10.0
    d_end = _add_weeks(i_end, d_w)
    sched.tasks.append(Task("DESIGN", "DESIGN", "phase_header", i_end, d_end, d_w, indent=0))
    sched.tasks.append(Task("Structural Repair Drawings", "DESIGN", "dependent",
                            i_end, d_end, d_w, indent=1))
    sched.milestones.append(Milestone("Design", i_end, d_end, f"{d_w} weeks"))

    # PERMIT
    pc = state.get("preConstruction") or {}
    permit_w = float(pc.get("permitWeeks") or 8)
    permit_end = _add_weeks(d_end, permit_w)
    sched.tasks.append(Task("PERMITTING", "PERMITTING", "phase_header", d_end, permit_end, permit_w, indent=0))
    sched.tasks.append(Task(f"Permit Filing ({pc.get('permitJurisdiction') or 'TBD'})",
                            "PERMITTING", "dependent", d_end, permit_end, permit_w, indent=1))
    sched.milestones.append(Milestone("Permit Filing", d_end, permit_end, f"{permit_w} weeks"))

    # CONSTRUCTION
    scope = state.get("scope") or {}
    sel = sum(1 for v in scope.values() if v)
    con_w = max(12.0, min(36.0, 12.0 + sel * 2))
    con_end = _add_weeks(permit_end, con_w)
    sched.tasks.append(Task("REPAIR CONSTRUCTION", "CONSTRUCTION", "phase_header",
                            permit_end, con_end, con_w, indent=0))
    sched.tasks.append(Task("Structural Repair Construction", "CONSTRUCTION", "dependent",
                            permit_end, con_end, con_w, indent=1))
    sched.milestones.append(Milestone("Construction", permit_end, con_end, f"{con_w} weeks"))

    # CLOSEOUT
    co = state.get("closeout") or {}
    punch_w = float(co.get("punchListWeeks") or 4)
    co_end = _add_weeks(con_end, punch_w)
    sched.tasks.append(Task("CLOSEOUT", "CLOSEOUT", "phase_header", con_end, co_end, punch_w, indent=0))
    sched.tasks.append(Task("Punch List", "CLOSEOUT", "dependent", con_end, co_end, punch_w, indent=1))
    sched.tasks.append(Task("Final Completion", "CLOSEOUT", "milestone", co_end, co_end, 0, indent=1))
    sched.milestones.append(Milestone("Final Completion", co_end, co_end, "—"))
    return sched


# ── post-processing: blackouts + hard-target compression ─────────────────

def _ranges(state_key_value) -> list[tuple[date, date]]:
    out = []
    for r in state_key_value or []:
        f = _parse_date(r.get("from"))
        t = _parse_date(r.get("to"))
        if f and t and t >= f:
            out.append((f, t))
    return out


def apply_blackouts(sched: Schedule, state: dict) -> Schedule:
    """Push CONSTRUCTION-phase tasks past blackout windows.

    Design and procurement work continues through blackouts (it doesn't impact
    the property), but on-site construction has to land outside them. For each
    blackout window, any construction task whose date range overlaps is shifted
    forward to start the day after the blackout ends. Closeout tasks cascade
    automatically because they're listed after construction.
    """
    blackouts = _ranges(state.get("blackouts"))
    heavy = _ranges(state.get("heavyOccupancy"))
    if not blackouts and not heavy:
        return sched

    if blackouts:
        for t in sched.tasks:
            # Construction-class phases include CONSTRUCTION, INSTALLATION,
            # REPAIR CONSTRUCTION, and the equipment-install phase under MEP.
            # Skip phase headers — _resync_phase_headers below will recompute
            # their dates from the (possibly shifted) child tasks, so emitting
            # a separate warning for the header would double-log every shift.
            if t.phase not in ("CONSTRUCTION", "INSTALLATION") or t.type == "phase_header":
                continue
            for (bo_from, bo_to) in blackouts:
                if t.start <= bo_to and t.end >= bo_from:
                    delta = (bo_to - t.start).days + 1
                    if delta > 0:
                        t.start = t.start + timedelta(days=delta)
                        t.end = t.end + timedelta(days=delta)
                        sched.warnings.append(
                            f"Shifted '{t.name}' past blackout {bo_from.isoformat()}–{bo_to.isoformat()}"
                        )

    if heavy:
        for t in sched.tasks:
            if t.phase not in ("CONSTRUCTION", "INSTALLATION") or t.type == "phase_header":
                continue
            for (h_from, h_to) in heavy:
                if t.start <= h_to and t.end >= h_from:
                    sched.warnings.append(
                        f"'{t.name}' overlaps heavy-occupancy window "
                        f"{h_from.isoformat()}–{h_to.isoformat()} — confirm with operations."
                    )
                    break  # one warning per task is enough

    # Refresh phase-header rows so their start/end mirror the (possibly shifted)
    # task rows below them. Without this, the Excel banner shows stale dates.
    _resync_phase_headers(sched)
    return sched


def _resync_phase_headers(sched: Schedule) -> None:
    """For each phase_header task, recompute start/end/weeks from the child
    tasks in that phase. Run after any post-engine reflow."""
    by_phase: dict[str, list[Task]] = {}
    for t in sched.tasks:
        if t.type == "phase_header":
            continue
        by_phase.setdefault(t.phase, []).append(t)
    for t in sched.tasks:
        if t.type != "phase_header":
            continue
        children = by_phase.get(t.phase) or []
        if not children:
            continue
        t.start = min(c.start for c in children)
        t.end = max(c.end for c in children)
        t.weeks = round((t.end - t.start).days / 7, 1)


def apply_target_compression(sched: Schedule, state: dict) -> Schedule:
    """If hard target completion is before the engine's completion, shrink the
    design phases proportionally and re-run downstream tasks from there.

    We only compress design phases — construction, procurement, and permit
    durations are physically constrained and shouldn't be silently shortened.
    If even fully-compressed design doesn't fit, surface a warning so the user
    knows the schedule is unrealistic.
    """
    target = _parse_date(state.get("targetCompletion"))
    if not target or state.get("completionType") != "hard":
        return sched
    if not sched.tasks:
        return sched

    final_end = max(t.end for t in sched.tasks)
    if final_end <= target:
        return sched  # already fits

    # Only the full_renovation / amenity engines have all four design phases,
    # so compression is a no-op for the simpler types — return with a warning.
    if sched.project_type not in ("full_renovation", "amenity"):
        slip = round((final_end - target).days / 7, 1)
        sched.warnings.append(
            f"Schedule completes {final_end.isoformat()} — {slip} weeks past hard target "
            f"({target.isoformat()}). Compression is only supported for full-renovation / amenity types."
        )
        return sched

    # Compute total slack we need to recover, and the design block we have to
    # work with. We compress design phases by a single ratio so the user can
    # eyeball the trade-off.
    overshoot_days = (final_end - target).days
    design_phases = ("CONCEPT DESIGN", "SCHEMATIC DESIGN", "DESIGN DEVELOPMENT", "CD / FF&E")
    design_tasks = [t for t in sched.tasks if t.phase in design_phases and t.type != "phase_header"]
    design_total_days = sum((t.end - t.start).days for t in design_tasks)
    if design_total_days <= 0:
        return sched

    # Don't compress design below 50% — past that, the schedule isn't real.
    max_recoverable = int(design_total_days * 0.5)
    actual_recover = min(overshoot_days, max_recoverable)
    ratio = 1.0 - (actual_recover / design_total_days)

    # Re-walk the schedule applying the ratio to design durations only, then
    # cascade. The original engines built sequential dates so we can rebuild
    # by walking tasks in order and adjusting start dates from a running cursor.
    new_state = dict(state)
    dt = dict(state.get("designTimeline") or {})
    for k in ("concept", "sd", "dd", "cd"):
        v = dt.get(k)
        if v in (None, ""):
            v = {"concept": 6, "sd": 10, "dd": 12, "cd": 12}[k]
        dt[k] = round(float(v) * ratio, 1)
    new_state["designTimeline"] = dt

    rebuilt = build_full_renovation(new_state)
    rebuilt.warnings = list(sched.warnings)
    pct = round((1 - ratio) * 100, 1)
    rebuilt.warnings.append(
        f"Hard-target compression applied: design phases shrunk {pct}% to fit {target.isoformat()}."
    )
    final_end_after = max(t.end for t in rebuilt.tasks)
    if final_end_after > target:
        slip = round((final_end_after - target).days / 7, 1)
        rebuilt.warnings.append(
            f"Even with maximum design compression, schedule completes {slip} weeks past target. "
            f"Construction or procurement durations are the binding constraint."
        )
    return rebuilt


# ── dispatch ──────────────────────────────────────────────────────────────

_BUILDERS = {
    "full_renovation": build_full_renovation,
    "amenity": build_full_renovation,  # similar phase set; smaller scope drives shorter construction
    "recertification": build_recertification,
    "soft_goods": build_soft_goods,
    "mep_modernization": build_mep_modernization,
    "structural": build_structural,
}


def build_schedule(state: dict) -> Schedule:
    """Dispatch to the right per-type engine, then run blackout reflow and
    hard-target compression as post-processing passes."""
    ptype = state.get("projectType") or "full_renovation"
    builder = _BUILDERS.get(ptype, build_full_renovation)
    sched = builder(state)
    sched = apply_blackouts(sched, state)
    sched = apply_target_compression(sched, state)
    return sched
