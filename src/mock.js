// Mock of the System One endpoint for running without a key.
// Returns exactly the response shape documented at https://docs.typesafe.ai/api,
// with probabilities from cheap heuristics plus deterministic jitter, so the
// UI, the batch runner and the tests behave the same way they will tomorrow.
// The `model` field says "mock" so nobody mistakes a mock run for a real one.

import { USD_PER_INPUT_TOKEN } from "./jev.js";

const PITCH =
  /\b(seo|backlinks?|web ?design|digital marketing|website traffic|rank(ing)? on google|guest posts?|link building|lead generation|social media marketing|app development (company|agency|services)|our (agency|company|team|studio)|full proposal|sponsored|white label|resell|paid ads|qualified leads|booked calls|done-for-you|outreach|pitch deck|venture fund|bank details|proposal|partnership)\b/i;
const AUTOMATED = /https?:\/\/\S*example\.com|^\s*(hi|hello|dear|greetings)\b[^\n]{0,20}https?:\/\/|\btest test\b|free visitors|domain is about to expire|crypto|whatsapp|\$[\d,]+ a week/i;
const OWN_NEED = /\b(we use|our (team|books|clients|accountant|invoices|current tool)|we send|we need|we want|we just hired|can it|does it|demo|walkthrough|onboarding)\b/i;

export async function askMock({ state, questions, model = "mock" }) {
  const t0 = Date.now();
  const inputTokens = Math.ceil(JSON.stringify({ state, questions }).length / 4);
  const answers = {};
  const seed = hash(JSON.stringify(state));
  const jitter = (k) => ((hash(seed + k) % 1000) / 1000 - 0.5) * 0.08;

  const isCheckout = state.form === "checkout";
  let pReal, pPitch = 0.02, pAuto = 0.02, pFraud = 0.02, evidenceKey = null;

  if (!isCheckout) {
    const m = state.submission?.message || "";
    const s = state.signals || {};
    pReal = 0.9;
    const pitch = PITCH.test(m);
    const auto = AUTOMATED.test(m) || s.hidden_honeypot_fields_filled || (s.seconds_on_page != null && s.seconds_on_page < 4);
    const ownNeed = OWN_NEED.test(m);
    if (pitch && ownNeed) { pPitch = 0.3; pReal = 0.72; } // "I run a lead generation shop": the word list's blind spot, mocked kindly
    else if (pitch) { pPitch = 0.9; pReal = 0.06; }
    if (auto) { pAuto = 0.93; pReal = Math.min(pReal, 0.03); }
    if (!pitch && !auto) {
      if (m.trim().length < 30) pReal = 0.5;
      else if (!OWN_NEED.test(m)) pReal = 0.55;
      if (s.javascript_ran === false && pReal > 0.5) pReal = 0.62;
    }
    if (/resell this|interview you|class project/i.test(m)) pReal = 0.45;
    if (/[¿¡]|\b(tengo|necesito|hablan)\b/i.test(m)) pReal = 0.5;
    // evidence: first sentence that trips a list, else the one that states the need
    const keys = Object.keys(questions.evidence?.criteria || {});
    const crit = questions.evidence?.criteria || {};
    evidenceKey =
      keys.find((k) => PITCH.test(crit[k]) || AUTOMATED.test(crit[k])) ||
      keys.find((k) => OWN_NEED.test(crit[k])) ||
      keys[0];
  } else {
    const s = state.signals || {};
    const items = String(state.order?.items || "");
    let risk = 0;
    const hits = [];
    if (s.card_country && s.ip_country && s.card_country !== s.ip_country) { risk += 0.35; hits.push("f1"); }
    if ((s.payment_attempts_before_success ?? 1) >= 3) { risk += 0.4; hits.push("f2"); }
    if ((s.orders_from_this_device_last_hour ?? 0) >= 4) { risk += 0.5; hits.push("f3"); }
    if (s.account_age_days === 0) { risk += 0.15; hits.push("f4"); }
    if (!s.billing_name_matches_card) { risk += 0.4; hits.push("f6"); }
    if (/^\s*([5-9]|\d{2,})×.*(gift|credit)/i.test(items)) { risk += 0.3; hits.push("f0"); }
    if (/prepaid/i.test(s.card_type || "")) { risk += 0.25; hits.push("f7"); }
    if (/forwarder/i.test(s.shipping || "")) { risk += 0.45; hits.push("f8"); }
    if ((s.seconds_on_page ?? 60) < 5) { risk += 0.2; hits.push("f5"); }
    pFraud = clamp(risk);
    pReal = clamp(1 - risk);
    evidenceKey = hits[0] || "f1";
  }

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      const base = { real: pReal, pitch: pPitch, automated: pAuto, fraud: pFraud }[id] ?? 0.5;
      answers[id] = { type: "noul", noul: round(clamp(base + jitter(id))) };
    } else if (q.type === "choice") {
      const keys = Object.keys(q.criteria || {});
      const chosen = keys.includes(evidenceKey) ? evidenceKey : keys[0];
      const probabilities = {};
      const top = keys.length === 1 ? 1 : 0.7 + Math.abs(jitter("ev")) * 3;
      for (const k of keys) probabilities[k] = k === chosen ? round(top) : round((1 - top) / Math.max(1, keys.length - 1));
      answers[id] = { type: "choice", choice: chosen, probabilities, confidence: round(top) };
    } else if (q.type === "score") {
      const n = (q.criteria || []).length || 2;
      const legend = {}, probabilities = {};
      for (let i = 0; i < n; i++) { legend[String(i)] = String(q.criteria[i]); probabilities[String(i)] = i === 0 ? 1 : 0; }
      answers[id] = { type: "score", score: 0, legend, probabilities, confidence: 1 };
    }
  }

  // simulate the published latency range (70-500 ms), mostly at the low end
  const latency = 80 + (hash(seed + "lat") % 130) + (hash(seed + "tail") % 20 === 0 ? 150 + (hash(seed + "t2") % 200) : 0);
  await new Promise((r) => setTimeout(r, latency));
  return {
    model: model === "mock" ? "mock" : `mock(${model})`,
    answers,
    usage: { input_tokens: inputTokens, output_tokens: 8 * Object.keys(questions).length },
    latency_ms: Date.now() - t0,
    cost_usd: inputTokens * USD_PER_INPUT_TOKEN,
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const clamp = (x) => Math.min(0.995, Math.max(0.005, x));
const round = (x) => Math.round(x * 100) / 100;
