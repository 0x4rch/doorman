// Runs every submission in data/submissions.json through Doorman with 8 workers
// and writes runs/<timestamp>.json: every decision, latency, token usage and cost,
// plus a summary comparing Jev's routes with the generator's labels and with
// the rule list. This is the recorded trace behind the video and the blog post.
//   npm run batch            (mock unless TYPESAFE_API_KEY is set)
//   npm run batch -- --limit 20
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadEnv, config } from "../src/env.js";
import { judgeAll } from "../src/doorman.js";

loadEnv();
const cfg = config();
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const workers = Number(args[args.indexOf("--workers") + 1]) || 8;

const all = JSON.parse(readFileSync("data/submissions.json", "utf8")).submissions;
const subs = all.slice(0, Math.min(limit, all.length));
console.log(`mode=${cfg.mode} model=${cfg.mode === "live" ? cfg.model : "mock"} submissions=${subs.length} workers=${workers}`);

let done = 0;
const t0 = Date.now();
const results = await judgeAll(subs, cfg, {
  workers,
  onResult: (r) => { done++; if (done % 25 === 0 || done === subs.length) process.stdout.write(`  ${done}/${subs.length}\r`); },
});
const wall_ms = Date.now() - t0;
console.log();

const ok = results.filter((r) => !r.error);
const errors = results.filter((r) => r.error);
const lat = ok.map((r) => r.latency_ms).sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
const byRoute = count(ok, (r) => r.route);
const expected = { real: "deliver", pitch: "drop", automated: "drop", fraud: "drop", grey: "hold" };
const agree = ok.filter((r, i) => expected[subs[i].label] === r.route).length;
const wrongSide = ok.filter((r, i) => (subs[i].label === "real" && r.route === "drop") || (subs[i].label !== "real" && subs[i].label !== "grey" && r.route === "deliver"));
const rulesDemo = ok.filter((r) => r.rules);
const rulesLetThrough = rulesDemo.filter((r, i) => r.rules.route !== "drop" && ["pitch", "automated"].includes(subs[results.indexOf(r)].label)).length;
const rulesFlaggedReal = rulesDemo.filter((r) => r.rules.route !== "deliver" && subs[results.indexOf(r)].label === "real").length;

const summary = {
  mode: cfg.mode, model: ok[0]?.model || null, submissions: subs.length, workers, wall_ms,
  throughput_per_s: +(ok.length / (wall_ms / 1000)).toFixed(1),
  latency_ms: { median: q(0.5), p95: q(0.95), max: lat[lat.length - 1] },
  input_tokens: ok.reduce((a, r) => a + (r.usage?.input_tokens || 0), 0),
  cost_usd: +ok.reduce((a, r) => a + (r.cost_usd || 0), 0).toFixed(6),
  routes: byRoute,
  agreement_with_labels: `${agree}/${ok.length}`,
  wrong_side: wrongSide.length,
  word_list_on_demo_form: { scored: rulesDemo.length, pitches_or_bots_let_through: rulesLetThrough, real_flagged_or_dropped: rulesFlaggedReal },
  errors: errors.length,
};
mkdirSync("runs", { recursive: true });
const file = `runs/${new Date().toISOString().replace(/[:.]/g, "-")}-${cfg.mode}.json`;
writeFileSync(file, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 2));
if (wrongSide.length) {
  console.log("\nWrong side of the line (label vs route):");
  for (const r of wrongSide.slice(0, 15)) console.log(`  #${r.id} ${subs[results.indexOf(r)].label} -> ${r.route} p=${r.p_real} "${r.evidence?.text?.slice(0, 80)}"`);
}
if (errors.length) console.log(`\n${errors.length} errors, first: ${errors[0].error}`);
console.log(`\nwrote ${file}`);

function count(arr, f) { return arr.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {}); }
