import { test } from "node:test";
import assert from "node:assert/strict";
import { build, route, sentences, THRESHOLDS } from "../src/questions.js";
import { askMock } from "../src/mock.js";
import { ask, USD_PER_INPUT_TOKEN, ENDPOINT } from "../src/jev.js";
import { scoreWithRules } from "../src/rules.js";
import { judge } from "../src/doorman.js";

const buyer = { form: "demo", email: "jess@brightline.example", message: "Hi, I run Brightline Dental. We use QuickBooks today. We send about 200 invoices a month and chasing late ones eats a day a week. Can we get a demo this week?", signals: { seconds_on_page: 220, javascript_ran: true, honeypot_filled: false, country: "US" } };
const pitch = { form: "demo", email: "maya@studiofolk.agency", message: "Hi there, love what you are building. I run a small studio that helps SaaS founders fill their pipeline with done-for-you outreach. Open to a 15 minute chat?", signals: { seconds_on_page: 38, javascript_ran: true, honeypot_filled: false } };
const fraud = { form: "checkout", email: "x9q2k@gmail.com", order: { items: "6× Prepaid credit $250", total_usd: 1500 }, signals: { card_country: "US", ip_country: "VN", attempts: 4, device_orders_last_hour: 1, account_age_days: 0, seconds_on_page: 3 } };

test("build: demo request matches the documented shape", () => {
  const { state, questions } = build(buyer);
  assert.equal(state.form, "demo");
  assert.equal(state.submission.email, buyer.email);
  for (const id of ["real", "pitch", "automated"]) {
    assert.equal(questions[id].type, "noul");
    assert.ok(typeof questions[id].instructions === "string");
  }
  assert.equal(questions.evidence.type, "choice");
  const keys = Object.keys(questions.evidence.criteria);
  assert.ok(keys.length >= 2 && keys.length <= 255);
  assert.ok(keys.every((k) => /^s\d+$/.test(k)));
});

test("build: checkout evidence is a choice over facts", () => {
  const { questions, evidenceMap } = build(fraud);
  assert.equal(questions.fraud.type, "noul");
  assert.ok(Object.keys(questions.evidence.criteria).length === 9);
  assert.match(evidenceMap.f1, /US.*VN/);
});

test("build: comment form for the benchmark uses the same shape", () => {
  const { state, questions, evidenceMap } = build({ form: "comment", author: "x", message: "Check out my channel! Great song." });
  assert.equal(state.form, "comment");
  assert.equal(questions.real.type, "noul");
  assert.equal(questions.evidence.type, "choice");
  assert.equal(evidenceMap.s0, "Check out my channel!");
});

test("sentences: splits and caps", () => {
  assert.deepEqual(sentences("One. Two! Three?"), ["One.", "Two!", "Three?"]);
  assert.equal(sentences(Array(50).fill("A sentence.").join(" ")).length, 40);
});

test("route: thresholds live in code", () => {
  assert.equal(route({ real: { type: "noul", noul: 0.95 } }).route, "deliver");
  assert.equal(route({ real: { type: "noul", noul: 0.05 } }).route, "drop");
  assert.equal(route({ real: { type: "noul", noul: 0.5 } }).route, "hold");
  assert.equal(route({ real: { type: "noul", noul: THRESHOLDS.deliver } }).route, "deliver");
  const r = route({ real: { noul: 0.1 }, pitch: { noul: 0.9 }, automated: { noul: 0.2 } });
  assert.equal(r.reason, "pitch");
  assert.throws(() => route({}), /missing/);
});

test("mock: returns the documented response shape", async () => {
  const { state, questions } = build(buyer);
  const res = await askMock({ state, questions });
  assert.equal(res.model, "mock");
  assert.ok(res.usage.input_tokens > 0);
  assert.equal(res.answers.real.type, "noul");
  assert.ok(res.answers.real.noul >= 0 && res.answers.real.noul <= 1);
  assert.equal(res.answers.evidence.type, "choice");
  assert.ok(res.answers.evidence.choice in questions.evidence.criteria);
  const sum = Object.values(res.answers.evidence.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.05);
});

test("mock: routes the obvious cases the obvious way", async () => {
  const cfg = { mode: "mock", model: "jev-latest" };
  assert.equal((await judge(buyer, cfg)).route, "deliver");
  const p = await judge(pitch, cfg);
  assert.equal(p.route, "drop");
  assert.equal(p.reason, "pitch");
  assert.match(p.evidence.text, /done-for-you outreach/);
  const f = await judge(fraud, cfg);
  assert.equal(f.route, "drop");
  assert.equal(f.reason, "fraud");
});

test("jev client: sends the documented request and parses the documented response", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { real: { type: "noul", noul: 0.93 }, evidence: { type: "choice", choice: "s0", probabilities: { s0: 0.9, s1: 0.1 }, confidence: 0.85 } }, usage: { input_tokens: 296, output_tokens: 20 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { state, questions } = build(buyer);
  const res = await ask({ apiKey: "test-key", state, questions, fetchImpl });
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
  assert.equal(body.model, "jev-latest");
  assert.equal(res.model, "jev-1.13.0");
  assert.equal(res.answers.real.noul, 0.93);
  assert.equal(res.cost_usd, 296 * USD_PER_INPUT_TOKEN);
  assert.ok(res.latency_ms >= 0);
});

test("jev client: retries 429 then succeeds; surfaces 401", async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ model: "jev-1.13.0", answers: { real: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
  const res = await ask({ apiKey: "k", state: "x", questions: { real: { type: "noul", instructions: "?" } }, fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(res.answers.real.noul, 0.5);
  const unauthorized = async () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
  await assert.rejects(ask({ apiKey: "bad", state: "x", questions: {}, fetchImpl: unauthorized }), (e) => e.status === 401 && /invalid api key/.test(e.message));
});

test("rules: the word list scores demo requests only", () => {
  assert.equal(scoreWithRules(buyer).points, 0);
  assert.equal(scoreWithRules(pitch).route, "deliver"); // no trigger words: the polished pitch walks in today
  const bot = { form: "demo", message: "Hello https://example.com/, our agency offers SEO and backlinks", signals: { seconds_on_page: 2, javascript_ran: true, honeypot_filled: true } };
  const r = scoreWithRules(bot);
  assert.equal(r.route, "drop");
  assert.ok(r.points >= 3);
  assert.equal(scoreWithRules(fraud), null);
});
