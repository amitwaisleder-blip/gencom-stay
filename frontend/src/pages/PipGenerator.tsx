import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BATHROOM_FULL_SCOPE, GUESTROOM_FULL_SCOPE,
  PIP_QUESTIONS, isRequired, isVisible,
  multiSelectArray,
  type Answer, type Answers, type Question,
  type ScopeCatalogSection,
} from "../lib/pipQuestions";
import { api, type PipPropertyLookup, type PipScopeRecommendation } from "../lib/api";

const LS_KEY = "pipbudget.pipGeneratorAnswers";
const AUTO_ADVANCE_MS = 350;

type Mode = "form" | "review";

export default function PipGenerator() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("form");
  const [answers, setAnswers] = useState<Answers>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  });
  const [step, setStep] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Track AI activity per question — keyed by question id so spinners don't
  // bleed between questions.
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({});

  // Scope recommendations + full-scope checklist modals
  const [scopeRecs, setScopeRecs] = useState<PipScopeRecommendation[] | null>(null);
  const [scopeRecsError, setScopeRecsError] = useState<string | null>(null);
  const [fullScopeFor, setFullScopeFor] = useState<{ qid: string; flavor: "guestroom" | "bathroom" } | null>(null);

  // Resolved (visible) question list — re-computed whenever answers change
  // so the stepper respects branch logic in real time.
  const visible = useMemo(
    () => PIP_QUESTIONS.filter((q) => isVisible(q, answers)),
    [answers],
  );

  // Clamp `step` when branching changes the visible list.
  useEffect(() => {
    if (step >= visible.length) setStep(Math.max(0, visible.length - 1));
  }, [visible.length, step]);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(answers)); } catch {}
  }, [answers]);

  const activeQ = visible[step];

  // Auto-advance is only armed by a fresh user selection on the active
  // question — NOT by navigation (Back, left rail, Continue, Skip) or by
  // API-driven patches (property lookup, recommend scope). Without this,
  // going back to an already-answered single-select would immediately
  // jump forward again.
  const autoAdvanceArmed = useRef(false);

  function setAnswer(id: string, value: Answer) {
    if (activeQ && id === activeQ.id) autoAdvanceArmed.current = true;
    setAnswers((a) => {
      const prev = a[id];
      // If the current answer is a dict with sub-answers (from a
      // multi-select with sub_questions) and we're replacing the primary
      // (typically an array), preserve the sub-answers by keeping the dict
      // wrapper and writing the new value under `primary`.
      if (
        prev && typeof prev === "object" && !Array.isArray(prev)
        && Object.keys(prev).some((k) => k !== "primary" && k !== "other")
        && (Array.isArray(value) || typeof value === "string")
      ) {
        return { ...a, [id]: { ...(prev as Record<string, Answer>), primary: value } };
      }
      return { ...a, [id]: value };
    });
  }
  function mergeAnswer(id: string, patch: Record<string, Answer>) {
    setAnswers((a) => {
      const cur = a[id];
      // Wrap existing primitive/array primaries so sub-answers can coexist
      // with them (e.g. multi-select arrays with sub-question detail lists).
      let base: Record<string, Answer>;
      if (cur == null) {
        base = {};
      } else if (Array.isArray(cur)) {
        base = { primary: cur } as Record<string, Answer>;
      } else if (typeof cur === "object") {
        base = cur as Record<string, Answer>;
      } else {
        base = { primary: cur } as Record<string, Answer>;
      }
      return { ...a, [id]: { ...base, ...patch } };
    });
  }
  function setSubAnswer(parentId: string, subId: string, value: Answer) {
    if (activeQ && parentId === activeQ.id) autoAdvanceArmed.current = true;
    mergeAnswer(parentId, { [subId]: value });
  }

  function canAdvance(q: Question | undefined): boolean {
    if (!q) return true;
    if (!isRequired(q, answers)) return true;
    const v = answers[q.id];
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") {
      // Wrapped shape (multi_select + sub_questions). Look at the primary
      // value to judge emptiness.
      if ("primary" in (v as any)) {
        const p = (v as any).primary;
        if (Array.isArray(p)) return p.length > 0;
        if (typeof p === "string") return p.trim().length > 0;
        return !!p;
      }
      // Group type — require at least one non-empty sub-answer.
      return Object.values(v).some((x) => x != null && (typeof x === "string" ? x.trim().length > 0 : true));
    }
    return true;
  }

  function goNext() {
    autoAdvanceArmed.current = false;
    if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    setStep((s) => Math.min(visible.length - 1, s + 1));
  }
  function goBack() {
    autoAdvanceArmed.current = false;
    if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    setStep((s) => Math.max(0, s - 1));
  }
  function jumpTo(idx: number) {
    autoAdvanceArmed.current = false;
    if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    setStep(idx);
  }
  function skip() {
    autoAdvanceArmed.current = false;
    if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    if (step < visible.length - 1) setStep((s) => Math.min(visible.length - 1, s + 1));
    else setMode("review");
  }

  // Auto-advance after single-select selections (when no visible sub-fields
  // are waiting for input). Only runs when the user has just made a fresh
  // selection on the active question — revisiting via Back/left rail is
  // tracked by autoAdvanceArmed.current and stays silent.
  const autoAdvanceTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!autoAdvanceArmed.current) return;
    if (!activeQ) return;
    if (activeQ.type !== "single_select") return;
    const v = answers[activeQ.id];
    if (v == null) return;
    const prim = typeof v === "string"
      ? v
      : (typeof v === "object" && !Array.isArray(v) && "primary" in (v as any) ? (v as any).primary : "");
    if (!prim) return;
    // If any sub-question is visible AND currently empty, don't auto-advance.
    const pendingSub = (activeQ.sub_questions ?? []).some((sq) => {
      if (!isVisible(sq, answers)) return false;
      const parent = (v && typeof v === "object" && !Array.isArray(v)) ? v as Record<string, Answer> : {};
      const subVal = parent[sq.id];
      return isRequired(sq, answers) && (subVal == null || subVal === "");
    });
    if (pendingSub) return;
    // If user picked "Other" with allow_other, wait — the write-in field
    // needs to be filled.
    if (activeQ.allow_other && prim === "Other") {
      const other = (v as any)?.other;
      if (!other || String(other).trim() === "") return;
    }
    if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = window.setTimeout(() => {
      autoAdvanceArmed.current = false;
      setStep((s) => Math.min(visible.length - 1, s + 1));
    }, AUTO_ADVANCE_MS);
    return () => {
      if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    };
  }, [answers, activeQ?.id, activeQ?.type, visible.length]);

  function reset() {
    if (!confirm("Clear all PIP answers and start over?")) return;
    setAnswers({});
    setStep(0);
    setMode("form");
  }

  async function exportWord() {
    setExporting(true);
    try {
      const r = await fetch("/api/pip/export-docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = getPropertyName(answers) || "PIP";
      a.href = url;
      a.download = `${name.replace(/[^\w\s-]/g, "")} — PIP Outline.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  async function importToBudget() {
    setImporting(true);
    try {
      const r = await fetch("/api/pip/import-to-property", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { property_id: string };
      navigate(`/properties/${data.property_id}/setup`);
    } catch (e) {
      alert(`Import failed: ${e}`);
      setImporting(false);
    }
  }

  // ─── AI actions ────────────────────────────────────────────────────
  async function runPropertyLookup() {
    const name = getPropertyName(answers) || "";
    if (!name.trim()) {
      alert("Enter a property name first.");
      return;
    }
    setAiBusy((b) => ({ ...b, q1: true }));
    setAiNotes((n) => ({ ...n, q1: "" }));
    try {
      const r = await api.pipLookupProperty(name);
      applyPropertyLookup(r);
      const note = r.match_found
        ? `Found — confidence: ${r.confidence}.${r.notes ? ` ${r.notes}` : ""}`
        : `No confident match. ${r.notes ?? "Try adding city or brand flag."}`;
      setAiNotes((n) => ({ ...n, q1: note }));
    } catch (e) {
      setAiNotes((n) => ({ ...n, q1: `Lookup failed: ${e}` }));
    } finally {
      setAiBusy((b) => ({ ...b, q1: false }));
    }
  }

  function applyPropertyLookup(r: PipPropertyLookup) {
    // Q1 — brand flag (only if the user didn't already set one)
    if (r.brand_flag) {
      const q1cur = (answers.q1 ?? {}) as Record<string, Answer>;
      const existing = (q1cur.brand_flag as any)?.primary;
      if (!existing) {
        const bf = r.brand_flag === "Other"
          ? { primary: "Other", other: r.brand_flag_other ?? "" }
          : { primary: r.brand_flag };
        mergeAnswer("q1", { brand_flag: bf });
      }
    }
    // Q2 — address (full_address preferred)
    const addr = r.address?.full_address
      || [r.address?.street, r.address?.city, r.address?.state, r.address?.country].filter(Boolean).join(", ");
    if (addr && !(answers.q2 && typeof answers.q2 === "string" && (answers.q2 as string).trim())) {
      setAnswer("q2", addr);
    }
    // Q3 — property type
    if (r.property_type && !answers.q3) {
      setAnswer("q3", r.property_type);
    }
    // Q4 — year built + last reno
    if (r.year_built || r.year_last_renovated) {
      const cur = (answers.q4 ?? {}) as Record<string, Answer>;
      const patch: Record<string, Answer> = {};
      if (r.year_built && !cur.year_built) patch.year_built = r.year_built;
      if (r.year_last_renovated && !cur.year_last_reno) patch.year_last_reno = r.year_last_renovated;
      if (Object.keys(patch).length > 0) mergeAnswer("q4", patch);
    }
    // Q5 — keys + mix
    if (r.total_keys || r.room_mix) {
      const cur = (answers.q5 ?? {}) as Record<string, Answer>;
      const patch: Record<string, Answer> = {};
      if (r.total_keys && !cur.total) patch.total = r.total_keys;
      const mix = r.room_mix ?? {};
      for (const [k, v] of Object.entries(mix)) {
        if (v != null && (cur[k] == null || cur[k] === "")) patch[k] = v as number;
      }
      if (Object.keys(patch).length > 0) mergeAnswer("q5", patch);
    }
  }

  async function runAddressLookup() {
    // Q2 AI helper — ask Claude specifically about the address. Re-uses the
    // property lookup; just writes the address into Q2.
    const name = getPropertyName(answers) || "";
    if (!name.trim()) { alert("Enter a property name in Q1 first."); return; }
    setAiBusy((b) => ({ ...b, q2: true }));
    setAiNotes((n) => ({ ...n, q2: "" }));
    try {
      const r = await api.pipLookupProperty(name);
      const addr = r.address?.full_address
        || [r.address?.street, r.address?.city, r.address?.state, r.address?.country].filter(Boolean).join(", ");
      if (addr) {
        setAnswer("q2", addr);
        setAiNotes((n) => ({ ...n, q2: `Pulled from AI (${r.confidence} confidence).${r.notes ? ` ${r.notes}` : ""}` }));
      } else {
        setAiNotes((n) => ({ ...n, q2: "AI didn't return an address — try Google instead." }));
      }
    } catch (e) {
      setAiNotes((n) => ({ ...n, q2: `Lookup failed: ${e}` }));
    } finally {
      setAiBusy((b) => ({ ...b, q2: false }));
    }
  }

  function googleSearchAddress() {
    const name = getPropertyName(answers) || "";
    if (!name.trim()) { alert("Enter a property name in Q1 first."); return; }
    const query = encodeURIComponent(`${name} hotel address`);
    window.open(`https://www.google.com/search?q=${query}`, "_blank", "noopener,noreferrer");
  }

  async function runKeyMixFill() {
    const name = getPropertyName(answers) || "";
    if (!name.trim()) { alert("Enter a property name in Q1 first."); return; }
    setAiBusy((b) => ({ ...b, q5: true }));
    setAiNotes((n) => ({ ...n, q5: "" }));
    try {
      const r = await api.pipLookupProperty(name);
      applyPropertyLookup(r);
      if (r.total_keys || r.room_mix) {
        setAiNotes((n) => ({ ...n, q5: `Filled from AI (${r.confidence} confidence). Double-check the mix.${r.notes ? ` ${r.notes}` : ""}` }));
      } else {
        setAiNotes((n) => ({ ...n, q5: "AI didn't return key counts — fill manually." }));
      }
    } catch (e) {
      setAiNotes((n) => ({ ...n, q5: `Lookup failed: ${e}` }));
    } finally {
      setAiBusy((b) => ({ ...b, q5: false }));
    }
  }

  async function runScopeRecommend() {
    setAiBusy((b) => ({ ...b, q10: true }));
    setScopeRecs(null);
    setScopeRecsError(null);
    try {
      const r = await api.pipRecommendScope(answers as Record<string, unknown>);
      setScopeRecs(r.recommendations || []);
    } catch (e) {
      setScopeRecsError(String(e));
    } finally {
      setAiBusy((b) => ({ ...b, q10: false }));
    }
  }

  function applyFullScopeSelection(qid: string, selected: string[]) {
    // Q13 / Q14 checklist items land in a dedicated sub-field so the
    // multi_select pills stay untouched. Summary / export reads both.
    mergeAnswer(qid, { full_scope_items: selected });
  }

  const q = visible[step];

  return (
    <div>
      <div className="mb-3 text-sm text-gencom-stone">
        <Link to="/" className="hover:text-gencom-ink">Home</Link>
        {" / "}<span>PIP Generator</span>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">PIP Generator</h1>
          <div className="text-sm text-gencom-stone">
            Answer the intake questions below. We'll generate a PIP outline you can export as
            Word or push into the Full Budget Generator.
          </div>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setMode(mode === "form" ? "review" : "form")}
            className="px-3 py-1.5 border border-gencom-sand rounded-md bg-white hover:bg-gencom-mist"
          >
            {mode === "form" ? "Review answers" : "Back to form"}
          </button>
          <button
            onClick={reset}
            className="px-3 py-1.5 border border-gencom-sand rounded-md bg-white hover:bg-gencom-mist text-gencom-stone"
          >
            ↻ Start over
          </button>
        </div>
      </div>

      {mode === "form" ? (
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          {/* Left rail — numbered step nav */}
          <aside className="md:sticky md:top-4 h-fit">
            <div className="text-xs uppercase tracking-wider text-gencom-stone mb-2">
              Question {step + 1} of {visible.length}
            </div>
            <div className="w-full bg-gencom-sand rounded-full h-1.5 mb-3">
              <div
                className="bg-gencom-gold h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round(((step + 1) / Math.max(1, visible.length)) * 100)}%` }}
              />
            </div>
            <ol className="text-xs space-y-0.5 max-h-[60vh] overflow-y-auto border border-gencom-sand rounded-md bg-white p-2">
              {visible.map((qi, idx) => {
                const answered = answers[qi.id] != null;
                return (
                  <li key={qi.id}>
                    <button
                      onClick={() => jumpTo(idx)}
                      className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 ${
                        idx === step
                          ? "bg-gencom-ink text-gencom-mist"
                          : answered
                            ? "text-gencom-ink hover:bg-gencom-mist/60"
                            : "text-gencom-stone hover:bg-gencom-mist/60"
                      }`}
                    >
                      <span className={`text-[10px] font-mono rounded px-1.5 min-w-[22px] text-center ${
                        idx === step ? "bg-white/20" : "bg-gencom-sand text-gencom-stone"
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="truncate">{qi.short || qi.title}</span>
                      {answered && idx !== step && <span className="ml-auto text-gencom-green">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          {/* Right side — active question */}
          <section className="bg-white border border-gencom-sand rounded-lg p-5 space-y-4">
            {q && (
              <>
                <header>
                  <div className="text-[10px] uppercase tracking-wider text-gencom-stone">
                    Question {step + 1} · {q.short || q.id}
                  </div>
                  <h2 className="font-display text-xl leading-tight">
                    {q.title}
                    {isRequired(q, answers) && <span className="text-red-700 ml-1">*</span>}
                  </h2>
                  {q.help && (
                    <div className="text-xs text-gencom-stone mt-1">{q.help}</div>
                  )}
                </header>

                {/* Per-question AI / helper buttons */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {q.property_lookup && (
                    <button
                      onClick={runPropertyLookup}
                      disabled={!!aiBusy[q.id]}
                      className="px-3 py-1 rounded bg-gencom-gold text-gencom-ink font-semibold border border-gencom-gold hover:bg-gencom-gold/80 disabled:opacity-60"
                    >
                      {aiBusy[q.id] ? "Searching…" : "🔍 Find with AI"}
                    </button>
                  )}
                  {q.id === "q2" && (
                    <>
                      <button
                        onClick={runAddressLookup}
                        disabled={!!aiBusy.q2}
                        className="px-3 py-1 rounded bg-gencom-gold text-gencom-ink font-semibold border border-gencom-gold hover:bg-gencom-gold/80 disabled:opacity-60"
                      >
                        {aiBusy.q2 ? "Asking Claude…" : "🔍 Ask Claude"}
                      </button>
                      <button
                        onClick={googleSearchAddress}
                        className="px-3 py-1 rounded border border-gencom-sand bg-white hover:border-gencom-ink"
                      >
                        🌐 Search Google
                      </button>
                    </>
                  )}
                  {q.ai_fill_room_mix && (
                    <button
                      onClick={runKeyMixFill}
                      disabled={!!aiBusy.q5}
                      className="px-3 py-1 rounded bg-gencom-gold text-gencom-ink font-semibold border border-gencom-gold hover:bg-gencom-gold/80 disabled:opacity-60"
                    >
                      {aiBusy.q5 ? "Filling…" : "🔍 Fill with AI"}
                    </button>
                  )}
                  {q.recommend_scope && (
                    <button
                      onClick={runScopeRecommend}
                      disabled={!!aiBusy.q10}
                      className="px-3 py-1 rounded bg-gencom-green text-white font-semibold hover:bg-gencom-greendark disabled:opacity-60"
                    >
                      {aiBusy.q10 ? "Thinking…" : "💡 Recommend scope"}
                    </button>
                  )}
                  {q.full_scope_checklist && (
                    <button
                      onClick={() => setFullScopeFor({ qid: q.id, flavor: q.full_scope_checklist! })}
                      className="px-3 py-1 rounded border border-gencom-gold bg-gencom-gold/10 text-gencom-ink hover:bg-gencom-gold/20"
                    >
                      📋 Fill out full scope
                    </button>
                  )}
                  {aiNotes[q.id] && (
                    <span className="text-[11px] text-gencom-stone italic flex items-center">
                      {aiNotes[q.id]}
                    </span>
                  )}
                </div>

                <QuestionField
                  q={q}
                  answer={answers[q.id]}
                  answers={answers}
                  onChange={(v) => setAnswer(q.id, v)}
                  onSubChange={(subId, v) => setSubAnswer(q.id, subId, v)}
                />

                {/* Full-scope checklist summary (below the primary input) */}
                {q.full_scope_checklist && (
                  <FullScopeSummary qid={q.id} answers={answers} />
                )}

                {/* Scope recommendations (Q10) */}
                {q.recommend_scope && (
                  <ScopeRecommendations
                    loading={!!aiBusy.q10}
                    recs={scopeRecs}
                    error={scopeRecsError}
                  />
                )}

                <div className="pt-2 flex items-center justify-between border-t border-gencom-sand gap-3 flex-wrap">
                  <button
                    onClick={goBack}
                    disabled={step === 0}
                    className="px-3 py-1.5 text-sm border border-gencom-sand rounded-md bg-white hover:bg-gencom-mist disabled:opacity-40"
                  >
                    ← Back
                  </button>
                  <div className="text-xs text-gencom-stone">
                    {isRequired(q, answers) && !canAdvance(q) && (
                      <span className="text-red-700">Answer required to continue.</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isRequired(q, answers) && step < visible.length - 1 && (
                      <button
                        onClick={skip}
                        className="px-3 py-1.5 text-sm text-gencom-stone hover:text-gencom-ink underline underline-offset-2"
                        title="Skip this question — you can come back to it from the left rail."
                      >
                        Skip
                      </button>
                    )}
                    {step < visible.length - 1 ? (
                      <button
                        onClick={goNext}
                        disabled={!canAdvance(q)}
                        className="px-3 py-1.5 text-sm bg-gencom-ink text-gencom-mist rounded-md hover:bg-gencom-ink/90 disabled:opacity-40"
                      >
                        Continue →
                      </button>
                    ) : (
                      <button
                        onClick={() => setMode("review")}
                        disabled={!canAdvance(q)}
                        className="px-3 py-1.5 text-sm bg-gencom-gold text-gencom-ink font-semibold rounded-md hover:bg-gencom-gold/80 disabled:opacity-40"
                      >
                        Review →
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      ) : (
        // ─── Review mode ───
        <div className="space-y-4">
          <ReviewSummary answers={answers} />
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={exportWord}
              disabled={exporting}
              className="px-4 py-2 bg-blue-700 text-white rounded-md font-semibold uppercase tracking-wider text-sm hover:bg-blue-800 disabled:opacity-60"
            >
              {exporting ? "Generating…" : "📄 Export as Word"}
            </button>
            <button
              onClick={importToBudget}
              disabled={importing}
              className="px-4 py-2 bg-gencom-green text-white rounded-md font-semibold uppercase tracking-wider text-sm hover:bg-gencom-greendark disabled:opacity-60"
            >
              {importing ? "Creating…" : "→ Import into Budget Generator"}
            </button>
            <button
              onClick={() => setMode("form")}
              className="px-4 py-2 border border-gencom-sand bg-white rounded-md text-sm hover:bg-gencom-mist"
            >
              ← Keep editing
            </button>
          </div>
        </div>
      )}

      {fullScopeFor && (
        <FullScopeChecklistModal
          qid={fullScopeFor.qid}
          flavor={fullScopeFor.flavor}
          initial={(((answers[fullScopeFor.qid] as any)?.full_scope_items) as string[]) ?? []}
          onClose={() => setFullScopeFor(null)}
          onApply={(sel) => { applyFullScopeSelection(fullScopeFor.qid, sel); setFullScopeFor(null); }}
        />
      )}
    </div>
  );
}

// ─── QuestionField — renders the right input for each question type ────
function QuestionField({
  q, answer, answers, onChange, onSubChange,
}: {
  q: Question;
  answer: Answer | undefined;
  answers: Answers;
  onChange: (v: Answer) => void;
  onSubChange: (subId: string, v: Answer) => void;
}) {
  return (
    <div className="space-y-3">
      <PrimaryField q={q} answer={answer} onChange={onChange} />

      {q.sub_questions?.filter((sq) => isVisible(sq, answers)).map((sq) => {
        const parent = (answer ?? {}) as Record<string, Answer> | string | undefined;
        const subVal = (parent && typeof parent === "object" && !Array.isArray(parent))
          ? (parent as Record<string, Answer>)[sq.id]
          : undefined;
        return (
          <div key={sq.id} className="pl-3 border-l-2 border-gencom-sand">
            <div className="text-xs font-medium text-gencom-ink mb-1">{sq.title}</div>
            <PrimaryField q={sq} answer={subVal} onChange={(v) => onSubChange(sq.id, v)} />
          </div>
        );
      })}
    </div>
  );
}

function PrimaryField({
  q, answer, onChange,
}: {
  q: Question;
  answer: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  const primary = (() => {
    if (answer == null) return "";
    if (typeof answer === "string") return answer;
    if (typeof answer === "object" && !Array.isArray(answer) && "primary" in (answer as any)) {
      return (answer as { primary?: string }).primary ?? "";
    }
    return "";
  })();

  switch (q.type) {
    case "text":
      return (
        <input
          type="text"
          value={typeof answer === "string" ? answer : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
          className="w-full border border-gencom-sand rounded-md px-3 py-2 text-sm"
        />
      );
    case "long_text":
      return (
        <textarea
          value={typeof answer === "string" ? answer : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
          rows={3}
          className="w-full border border-gencom-sand rounded-md px-3 py-2 text-sm"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof answer === "number" ? answer : (typeof answer === "string" ? answer : "")}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={q.placeholder}
          className="w-full border border-gencom-sand rounded-md px-3 py-2 text-sm"
        />
      );
    case "single_select":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {q.options?.map((opt) => {
              const active = primary === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onChange(q.allow_other
                    ? { primary: opt, other: (answer as any)?.other ?? "" }
                    : opt)}
                  className={`px-3 py-1.5 text-sm rounded-md border transition ${
                    active
                      ? "border-gencom-gold bg-gencom-gold/10 text-gencom-ink shadow-sm"
                      : "border-gencom-sand bg-white hover:border-gencom-ink/40"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
            {q.allow_other && (
              <button
                type="button"
                onClick={() => onChange({ primary: "Other", other: (answer as any)?.other ?? "" })}
                className={`px-3 py-1.5 text-sm rounded-md border transition ${
                  primary === "Other"
                    ? "border-gencom-gold bg-gencom-gold/10 text-gencom-ink"
                    : "border-gencom-sand bg-white hover:border-gencom-ink/40"
                }`}
              >
                Other…
              </button>
            )}
          </div>
          {q.allow_other && primary === "Other" && (
            <input
              type="text"
              placeholder="Describe…"
              value={(answer as any)?.other ?? ""}
              onChange={(e) => onChange({ primary: "Other", other: e.target.value })}
              className="w-full border border-gencom-sand rounded-md px-3 py-2 text-sm"
            />
          )}
        </div>
      );
    case "multi_select": {
      const arr = multiSelectArray(answer);
      const isWrapped = answer != null && typeof answer === "object" && !Array.isArray(answer);
      const toggle = (opt: string) => {
        const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt];
        // If we're already in wrapped shape (sub-answers present), keep them;
        // the parent setAnswer path also handles this but writing through here
        // avoids a transient "no selection" render while state syncs.
        if (isWrapped) {
          onChange({ ...(answer as Record<string, Answer>), primary: next });
        } else {
          onChange(next);
        }
      };
      return (
        <div className="flex flex-wrap gap-2">
          {q.options?.map((opt) => {
            const active = arr.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`px-3 py-1.5 text-sm rounded-md border transition ${
                  active
                    ? "border-gencom-gold bg-gencom-gold/10 text-gencom-ink shadow-sm"
                    : "border-gencom-sand bg-white hover:border-gencom-ink/40"
                }`}
              >
                {active ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      );
    }
    case "ranked_list": {
      const arr = Array.isArray(answer) ? (answer as string[]) : [];
      const others = (q.options ?? []).filter((o) => !arr.includes(o));
      const move = (idx: number, delta: number) => {
        const next = [...arr];
        const target = idx + delta;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target], next[idx]];
        onChange(next);
      };
      return (
        <div className="space-y-2">
          <div className="text-xs text-gencom-stone">Tap to add (in order). Reorder with ↑ / ↓.</div>
          {arr.length > 0 && (
            <ol className="space-y-1 text-sm">
              {arr.map((item, idx) => (
                <li key={item} className="flex items-center gap-2 bg-gencom-mist/40 border border-gencom-sand rounded px-2 py-1">
                  <span className="font-mono text-xs w-5 text-center">{idx + 1}</span>
                  <span className="flex-1">{item}</span>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-xs px-1 disabled:opacity-30">↑</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === arr.length - 1} className="text-xs px-1 disabled:opacity-30">↓</button>
                  <button onClick={() => onChange(arr.filter((_, i) => i !== idx))} className="text-xs text-red-700 px-1">×</button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {others.map((opt) => (
              <button
                key={opt}
                onClick={() => onChange([...arr, opt])}
                className="px-3 py-1 text-xs rounded-md border border-gencom-sand bg-white hover:border-gencom-gold"
              >
                + {opt}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "file_upload":
      return (
        <div className="text-xs text-gencom-stone border border-dashed border-gencom-sand rounded-md p-3 bg-gencom-mist/30">
          File upload lands here once the PIP template is wired in. For now, note it in the next question's text.
        </div>
      );
    case "room_mix":
      return <RoomMixField answer={answer} onChange={onChange} />;
    case "number_pair":
    case "group":
      return null;
  }
}

function RoomMixField({ answer, onChange }: {
  answer: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  const cur = (answer && typeof answer === "object" && !Array.isArray(answer))
    ? (answer as Record<string, Answer>)
    : {};
  const total = num(cur.total);
  const rows: [string, string][] = [
    ["standard", "Standard"],
    ["suite", "Suite"],
    ["presidential", "Presidential"],
    ["ada", "ADA"],
  ];
  const update = (key: string, value: string) =>
    onChange({ ...cur, [key]: value === "" ? "" : Number(value) });
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gencom-stone">Total key count</label>
      <input
        type="number"
        value={total ?? ""}
        onChange={(e) => update("total", e.target.value)}
        className="w-40 border border-gencom-sand rounded-md px-3 py-2 text-sm"
      />
      <div className="text-xs text-gencom-stone mt-2">Room mix breakdown</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rows.map(([k, label]) => (
          <div key={k}>
            <label className="block text-[11px] text-gencom-stone">{label}</label>
            <input
              type="number"
              value={num(cur[k]) ?? ""}
              onChange={(e) => update(k, e.target.value)}
              className="w-full border border-gencom-sand rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Full-scope checklist modal (Q13 / Q14) ───────────────────────────
function FullScopeChecklistModal({
  qid, flavor, initial, onClose, onApply,
}: {
  qid: string;
  flavor: "guestroom" | "bathroom";
  initial: string[];
  onClose: () => void;
  onApply: (selected: string[]) => void;
}) {
  const sections: ScopeCatalogSection[] =
    flavor === "guestroom" ? GUESTROOM_FULL_SCOPE : BATHROOM_FULL_SCOPE;
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    new Set(sections.slice(1).map((s) => s.title)),
  );
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  function toggleItem(item: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(item) ? n.delete(item) : n.add(item);
      return n;
    });
  }
  function toggleSection(title: string) {
    setCollapsed((c) => {
      const n = new Set(c);
      n.has(title) ? n.delete(title) : n.add(title);
      return n;
    });
  }
  function selectAllInSection(items: string[], select: boolean) {
    setSel((s) => {
      const n = new Set(s);
      for (const it of items) select ? n.add(it) : n.delete(it);
      return n;
    });
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gencom-sand">
          <div>
            <div className="font-display text-xl">
              {flavor === "guestroom" ? "Guestroom — Full Scope Checklist" : "Guest Bathroom — Full Scope Checklist"}
            </div>
            <div className="text-xs text-gencom-stone">
              Click items to include. Selected items attach to Question {qid.replace("q", "")} alongside your high-level picks.
            </div>
          </div>
          <button onClick={onClose} className="text-gencom-stone hover:text-gencom-ink text-xl">×</button>
        </div>
        <div className="px-5 py-3 border-b border-gencom-sand flex items-center gap-2 flex-wrap">
          <input
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[240px] border border-gencom-sand rounded px-3 py-1.5 text-sm"
          />
          <span className="text-xs text-gencom-stone">
            {sel.size} selected
          </span>
          <button
            onClick={() => setSel(new Set())}
            className="text-xs text-gencom-stone hover:text-gencom-ink underline underline-offset-2"
          >
            Clear all
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-3">
          {sections.map((section) => {
            const items = section.items.filter((i) =>
              needle ? i.toLowerCase().includes(needle) : true
            );
            if (needle && items.length === 0) return null;
            const isCollapsed = !needle && collapsed.has(section.title);
            const allOn = items.length > 0 && items.every((i) => sel.has(i));
            return (
              <div key={section.title} className="border border-gencom-sand rounded-md overflow-hidden">
                <div className="flex items-center justify-between bg-gencom-mist/60 px-3 py-1.5">
                  <button
                    onClick={() => toggleSection(section.title)}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] font-bold rounded border border-gencom-sand bg-white">
                      {isCollapsed ? "+" : "−"}
                    </span>
                    {section.title}
                    <span className="text-xs text-gencom-stone">({items.length})</span>
                  </button>
                  <button
                    onClick={() => selectAllInSection(items, !allOn)}
                    className="text-xs text-gencom-stone hover:text-gencom-ink underline underline-offset-2"
                  >
                    {allOn ? "Clear section" : "Select all"}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {items.map((item) => {
                      const on = sel.has(item);
                      return (
                        <label
                          key={item}
                          className={`flex items-start gap-2 text-sm rounded px-2 py-1 cursor-pointer border ${
                            on ? "border-gencom-gold bg-gencom-gold/5" : "border-transparent hover:bg-gencom-mist/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleItem(item)}
                            className="mt-0.5"
                          />
                          <span className="leading-snug">{item}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-gencom-sand flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gencom-sand rounded bg-white hover:bg-gencom-mist"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(Array.from(sel))}
            className="px-3 py-1.5 text-sm bg-gencom-ink text-gencom-mist rounded hover:bg-gencom-ink/90"
          >
            Apply {sel.size} item{sel.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function FullScopeSummary({ qid, answers }: { qid: string; answers: Answers }) {
  const parent = (answers[qid] ?? {}) as Record<string, Answer>;
  const items = ((parent as any).full_scope_items as string[] | undefined) ?? [];
  if (items.length === 0) return null;
  return (
    <div className="border border-gencom-sand rounded-md bg-gencom-mist/20 p-3 text-xs">
      <div className="font-medium text-gencom-ink mb-1">
        Full-scope checklist — {items.length} item{items.length !== 1 ? "s" : ""} selected
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 12).map((it) => (
          <span key={it} className="bg-white border border-gencom-sand rounded px-1.5 py-0.5">{it}</span>
        ))}
        {items.length > 12 && (
          <span className="text-gencom-stone">+{items.length - 12} more</span>
        )}
      </div>
    </div>
  );
}

// ─── Scope recommendations (Q10) ──────────────────────────────────────
function ScopeRecommendations({
  loading, recs, error,
}: {
  loading: boolean;
  recs: PipScopeRecommendation[] | null;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="border border-gencom-sand bg-gencom-mist/30 rounded-md p-3 text-sm text-gencom-stone">
        Claude is reviewing your answers for missing scope…
      </div>
    );
  }
  if (error) {
    return (
      <div className="border border-red-300 bg-red-50 rounded-md p-3 text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (!recs || recs.length === 0) return null;
  const PRIORITY: Record<string, string> = {
    required: "bg-red-100 text-red-800 border-red-300",
    recommended: "bg-gencom-gold/20 text-gencom-ink border-gencom-gold/50",
    optional: "bg-blue-100 text-blue-800 border-blue-300",
  };
  return (
    <div className="border border-gencom-sand bg-white rounded-md p-3">
      <div className="text-sm font-medium mb-2">💡 Additional scope to consider</div>
      <ul className="space-y-1.5 text-sm">
        {recs.map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border ${PRIORITY[r.priority] ?? ""}`}>
              {r.priority}
            </span>
            <div className="flex-1">
              <div><b>{r.item}</b> <span className="text-xs text-gencom-stone">· {r.category}</span></div>
              <div className="text-xs text-gencom-stone">{r.reason}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Review: renders every answered question for a quick scan ─────────
function ReviewSummary({ answers }: { answers: Answers }) {
  const visible = PIP_QUESTIONS.filter((q) => isVisible(q, answers));
  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-5 space-y-3">
      <h2 className="font-display text-2xl">PIP Outline — preview</h2>
      <div className="text-xs text-gencom-stone">
        Review your answers below. Use the buttons to export as Word or import into the
        Full Budget Generator.
      </div>
      <dl className="divide-y divide-gencom-sand text-sm">
        {visible.map((q, idx) => (
          <Fragment key={q.id}>
            <div className="py-2">
              <dt className="text-xs uppercase tracking-wide text-gencom-stone">
                <span className="font-mono bg-gencom-sand/60 rounded px-1.5 py-0.5 mr-2 text-gencom-ink">
                  {idx + 1}
                </span>
                {q.short || q.title}
              </dt>
              <dd className="mt-0.5">
                {renderAnswer(q, answers[q.id]) || <span className="text-gencom-stone/60 italic">Not answered</span>}
              </dd>
            </div>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function renderAnswer(q: Question, a: Answer | undefined): React.ReactNode {
  if (a == null || a === "") return null;
  if (typeof a === "string" || typeof a === "number") return String(a);
  if (Array.isArray(a)) return a.length === 0 ? null : a.join(", ");
  if (typeof a === "object") {
    // Wrapped shape: primary is an array/string plus sub-answers. Show the
    // primary on its own line (as "Selected: …") and the sub-answers below.
    const asObj = a as Record<string, Answer>;
    const prim = asObj.primary;
    const lines: React.ReactNode[] = [];
    if (prim != null && prim !== "") {
      if (Array.isArray(prim)) {
        if (prim.length > 0) lines.push(`Selected: ${prim.join(", ")}`);
      } else if (prim === "Other" && "other" in asObj) {
        lines.push(`Other — ${asObj.other ?? ""}`);
      } else {
        lines.push(String(prim));
      }
    }
    for (const [k, v] of Object.entries(asObj)) {
      if (k === "primary" || k === "other") continue;
      if (v == null || v === "") continue;
      const label = findSubLabel(q, k) || k.replace(/_/g, " ");
      if (Array.isArray(v)) {
        if (v.length > 0) lines.push(`${label}: ${v.join(", ")}`);
      } else if (typeof v === "object" && v !== null && "primary" in (v as any)) {
        const p = (v as any).primary;
        const o = (v as any).other;
        lines.push(`${label}: ${p === "Other" ? `Other — ${o ?? ""}` : p ?? ""}`);
      } else {
        lines.push(`${label}: ${v}`);
      }
    }
    return lines.length === 0 ? null : (
      <ul className="list-disc list-inside text-sm">
        {lines.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    );
  }
  return null;
}

function findSubLabel(q: Question, subId: string): string | null {
  for (const sq of q.sub_questions ?? []) {
    if (sq.id === subId) return sq.title;
  }
  return null;
}

function getPropertyName(answers: Answers): string | null {
  const q1 = answers.q1;
  if (!q1) return null;
  if (typeof q1 === "object" && !Array.isArray(q1)) {
    const name = (q1 as any).property_name as string | undefined;
    if (name) return name;
    const primary = (q1 as any).primary as string | undefined;
    return primary ?? null;
  }
  return typeof q1 === "string" ? q1 : null;
}

function num(v: Answer | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
