// Benchmark Doorman on the UCI YouTube Spam Collection (CC BY 4.0):
// 1,956 real comments from five music videos, hand-labelled spam (1) or ham (0).
// Alberto, Lochter & Almeida, "TubeSpam: Comment Spam Filtering on YouTube", ICMLA 2015.
// https://archive.ics.uci.edu/dataset/380/youtube+spam+collection
//
// Same machinery as the demo form: one noul routes (deliver / drop / hold),
// one labels, one choice cites the sentence. "drop" is the spam prediction.
//   npm run bench:youtube              (live; ~$0.05, about a minute)
//   npm run bench:youtube -- --limit 40
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadEnv, config } from "../src/env.js";
import { judgeAll } from "../src/doorman.js";
import { scoreWithRules } from "../src/rules.js";

loadEnv();
const cfg = config();
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const DIR = "bench/youtube";
const URL = "https://archive.ics.uci.edu/static/public/380/youtube+spam+collection.zip";

// fetch + unzip once
if (!existsSync(DIR) || !readdirSync(DIR).some((f) => f.endsWith(".csv"))) {
  mkdirSync(DIR, { recursive: true });
  console.log("downloading", URL);
  const buf = Buffer.from(await (await fetch(URL)).arrayBuffer());
  writeFileSync(`${DIR}/youtube-spam-collection.zip`, buf);
  execFileSync("unzip", ["-o", "-q", `${DIR}/youtube-spam-collection.zip`, "-d", DIR, "-x", "__MACOSX/*"]);
}

// tiny CSV parser: quoted fields, doubled quotes, newlines inside quotes
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const clean = (s) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/﻿/g, "").replace(/\s+/g, " ").trim();

const subs = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".csv")).sort()) {
  const [header, ...rows] = parseCSV(readFileSync(`${DIR}/${f}`, "utf8"));
  const ix = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const video = f.replace(/^Youtube\d+-/, "").replace(/\.csv$/, "");
  for (const r of rows) {
    if (r.length < 5) continue;
    subs.push({ id: r[ix.COMMENT_ID], form: "comment", video, author: r[ix.AUTHOR], message: clean(r[ix.CONTENT]), label: r[ix.CLASS].trim() === "1" ? "spam" : "ham" });
  }
}
const all = subs.length;
const sample = subs.slice(0, Math.min(limit, all));
console.log(`youtube spam collection: ${all} comments (${subs.filter((s) => s.label === "spam").length} spam), running ${sample.length}; mode=${cfg.mode}`);

let done = 0;
const t0 = Date.now();
const results = await judgeAll(sample, cfg, {
  workers: 6,
  minIntervalMs: 60, // ≈1,000 requests/min, under the published 1,200
  onResult: () => { done++; if (done % 100 === 0 || done === sample.length) process.stdout.write(`  ${done}/${sample.length}\r`); },
});
const wall_ms = Date.now() - t0;
console.log();

const ok = results.filter((r) => !r.error);
const errors = results.filter((r) => r.error);
const withLabel = ok.map((r, i) => ({ r, s: sample[results.indexOf(r)] }));

// Doorman's routes: drop = spam, deliver = ham, hold = abstain
const decided = withLabel.filter(({ r }) => r.route !== "hold");
const held = withLabel.filter(({ r }) => r.route === "hold");
const tp = decided.filter(({ r, s }) => r.route === "drop" && s.label === "spam").length;
const fp = decided.filter(({ r, s }) => r.route === "drop" && s.label === "ham").length;
const fn = decided.filter(({ r, s }) => r.route === "deliver" && s.label === "spam").length;
const tn = decided.filter(({ r, s }) => r.route === "deliver" && s.label === "ham").length;
const pr = (a, b) => (b ? +(a / b).toFixed(4) : null);
const precision = pr(tp, tp + fp), recall = pr(tp, tp + fn);
const f1 = precision && recall ? +((2 * precision * recall) / (precision + recall)).toFixed(4) : null;

// forced binary at 0.5, no hold lane, for comparison with the literature
const fTP = withLabel.filter(({ r, s }) => r.p_real < 0.5 && s.label === "spam").length;
const fFP = withLabel.filter(({ r, s }) => r.p_real < 0.5 && s.label === "ham").length;
const fFN = withLabel.filter(({ r, s }) => r.p_real >= 0.5 && s.label === "spam").length;
const fAcc = pr(withLabel.length - fFP - fFN, withLabel.length);

// the word list, text only (no honeypot or timer here)
const rules = withLabel.map(({ r, s }) => ({ s, x: scoreWithRules({ form: "demo", message: s.message, signals: { seconds_on_page: 60, javascript_ran: true, honeypot_filled: false } }) }));
const rTP = rules.filter(({ s, x }) => x.route === "drop" && s.label === "spam").length;
const rFP = rules.filter(({ s, x }) => x.route === "drop" && s.label === "ham").length;

const perVideo = {};
for (const { r, s } of withLabel) {
  const v = (perVideo[s.video] ||= { n: 0, spam: 0, caught: 0, falseDrop: 0, held: 0 });
  v.n++; if (s.label === "spam") v.spam++;
  if (r.route === "drop" && s.label === "spam") v.caught++;
  if (r.route === "drop" && s.label === "ham") v.falseDrop++;
  if (r.route === "hold") v.held++;
}
const lat = ok.map((r) => r.latency_ms).sort((a, b) => a - b);
const summary = {
  dataset: "UCI YouTube Spam Collection (CC BY 4.0)", mode: cfg.mode, model: ok[0]?.model || null,
  comments: withLabel.length, spam: withLabel.filter(({ s }) => s.label === "spam").length, errors: errors.length,
  wall_ms, latency_ms: { median: lat[lat.length >> 1], p95: lat[Math.floor(lat.length * 0.95)] },
  input_tokens: ok.reduce((a, r) => a + (r.usage?.input_tokens || 0), 0),
  cost_usd: +ok.reduce((a, r) => a + (r.cost_usd || 0), 0).toFixed(4),
  doorman: { thresholds: "deliver ≥ .80 · drop < .20 · hold between", decided: decided.length, held: held.length,
    held_share: pr(held.length, withLabel.length), held_that_are_spam: held.filter(({ s }) => s.label === "spam").length,
    tp, fp, fn, tn, precision, recall, f1, accuracy_on_decided: pr(tp + tn, decided.length) },
  forced_at_0_5: { tp: fTP, fp: fFP, fn: fFN, precision: pr(fTP, fTP + fFP), recall: pr(fTP, fTP + fFN), accuracy: fAcc },
  word_list_text_only: { caught: rTP, false_drops: rFP, recall: pr(rTP, withLabel.filter(({ s }) => s.label === "spam").length) },
  per_video: perVideo,
};
mkdirSync("data/runs", { recursive: true });
const out = `data/runs/${new Date().toISOString().slice(0, 10)}-youtube-${cfg.mode}${sample.length < all ? `-${sample.length}` : ""}.json`;
writeFileSync(out, JSON.stringify({ summary, results: withLabel.map(({ r, s }) => ({ id: s.id, video: s.video, label: s.label, route: r.route, p_real: r.p_real, reason: r.reason, evidence: r.evidence?.text, latency_ms: r.latency_ms })) }, null, 1));
console.log(JSON.stringify(summary, null, 2));
console.log("\nfalse drops (ham routed drop):");
for (const { r, s } of decided.filter(({ r, s }) => r.route === "drop" && s.label === "ham").slice(0, 12)) console.log(`  p=${r.p_real} [${s.video}] ${s.message.slice(0, 100)}`);
console.log("\nmissed spam (spam routed deliver):");
for (const { r, s } of decided.filter(({ r, s }) => r.route === "deliver" && s.label === "spam").slice(0, 12)) console.log(`  p=${r.p_real} [${s.video}] ${s.message.slice(0, 100)}`);
console.log(`\nwrote ${out}`);
