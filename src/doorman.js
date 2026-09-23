// Doorman: one submission in, one routed decision out.
import { ask } from "./jev.js";
import { askMock } from "./mock.js";
import { build, route, THRESHOLDS } from "./questions.js";
import { scoreWithRules } from "./rules.js";

/**
 * @param {object} sub  a demo request or checkout order (see questions.js)
 * @param {object} cfg  { mode: "live"|"mock", apiKey, model, fetchImpl? }
 */
export async function judge(sub, cfg) {
  const { state, questions, evidenceMap } = build(sub);
  const res =
    cfg.mode === "live"
      ? await ask({ apiKey: cfg.apiKey, state, questions, model: cfg.model, fetchImpl: cfg.fetchImpl })
      : await askMock({ state, questions, model: cfg.model });
  const r = route(res.answers);
  const ev = res.answers.evidence;
  return {
    id: sub.id ?? null,
    form: sub.form,
    email: sub.email,
    route: r.route,
    p_real: r.p_real,
    reason: r.reason,
    reasons: r.reasons,
    evidence: ev ? { text: evidenceMap[ev.choice] ?? ev.choice, key: ev.choice, confidence: ev.confidence } : null,
    rules: scoreWithRules(sub),
    model: res.model,
    latency_ms: res.latency_ms,
    usage: res.usage,
    cost_usd: res.cost_usd,
    thresholds: THRESHOLDS,
    answers: res.answers,
  };
}

/** Run many submissions with a fixed number of concurrent workers. */
export async function judgeAll(subs, cfg, { workers = 8, onResult, minIntervalMs = 0 } = {}) {
  const results = new Array(subs.length);
  let next = 0;
  let slot = 0; // global pacing so N workers stay under the requests-per-minute limit
  async function worker() {
    while (next < subs.length) {
      const i = next++;
      if (minIntervalMs) {
        const at = Math.max(slot, Date.now());
        slot = at + minIntervalMs;
        const wait = at - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try {
        results[i] = await judge(subs[i], cfg);
      } catch (err) {
        results[i] = { id: subs[i].id ?? i, form: subs[i].form, email: subs[i].email, error: err.message, status: err.status };
      }
      onResult?.(results[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, subs.length) }, worker));
  return results;
}
