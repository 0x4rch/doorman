#!/usr/bin/env node
// Judge one submission from the command line.
//   npm run judge -- "I run a bakery, we use spreadsheets, can we get a demo this week?"
//   npm run judge -- --form checkout --items "6× Prepaid credit $250" --card US --ip VN --attempts 4
//   npm run judge -- --raw "..."      prints the full request and response JSON
import { loadEnv, config } from "./src/env.js";
import { judge } from "./src/doorman.js";
import { build } from "./src/questions.js";

loadEnv();
const cfg = config();
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const has = (name) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["raw"].includes(args[i - 1].slice(2))));

let sub;
if (flag("form") === "checkout") {
  sub = {
    form: "checkout", email: flag("email", "buyer@example.com"),
    order: { items: flag("items", "1× Annual plan"), total_usd: Number(flag("total", 950)) },
    signals: { card_country: flag("card", "US"), ip_country: flag("ip", "US"), attempts: Number(flag("attempts", 1)), device_orders_last_hour: Number(flag("device", 0)), account_age_days: Number(flag("age", 30)), seconds_on_page: Number(flag("secs", 90)), name_match: !has("name-mismatch"), card_type: flag("card-type", "standard"), shipping: flag("shipping", "none, digital") },
  };
} else {
  const message = positional.join(" ") || flag("message", "");
  if (!message) { console.error("Give a message, e.g.  npm run judge -- \"I run a bakery and want a demo\""); process.exit(1); }
  sub = { form: "demo", email: flag("email", "someone@example.com"), phone: "", message, signals: { seconds_on_page: Number(flag("secs", 120)), javascript_ran: !has("nojs"), honeypot_filled: has("honeypot"), country: flag("country", "US") } };
}

if (has("raw")) console.log("REQUEST\n" + JSON.stringify({ model: cfg.model, ...build(sub) }, null, 2));
const out = await judge(sub, cfg);
if (has("raw")) { console.log("\nRESPONSE\n" + JSON.stringify(out, null, 2)); process.exit(0); }

const pct = (x) => (x * 100).toFixed(0) + "%";
console.log(`${out.route.toUpperCase()}  P(real)=${out.p_real.toFixed(2)}  ${out.reason ? "reason=" + out.reason + " " : ""}${out.latency_ms} ms  $${out.cost_usd.toFixed(6)}  model=${out.model}`);
if (out.evidence) console.log(`evidence: "${out.evidence.text}" (${pct(out.evidence.confidence)})`);
if (out.rules) console.log(`word list: ${out.rules.route} (${out.rules.points} pts${out.rules.flags.length ? ": " + out.rules.flags.join(" ") : ""})`);
if (cfg.mode === "mock") console.log("(mock mode: probabilities are heuristics, not Jev. Set TYPESAFE_API_KEY to go live.)");
