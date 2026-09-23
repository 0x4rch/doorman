// Drop-in for a Cloudflare Pages Function that already receives a contact or demo form.
// Shows how to put Doorman in front of the webhook: deliver, drop, or deliver
// with a hold flag. Copy src/jev.js and src/questions.js next to this file
// (they only use fetch, so they run in Workers unchanged) and set
// TYPESAFE_API_KEY as a secret:  npx wrangler pages secret put TYPESAFE_API_KEY
import { ask } from "./jev.js";
import { build, route } from "./questions.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const sub = {
    form: "demo",
    email: String(form.get("email") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    message: String(form.get("message") || "").trim(),
    signals: {
      seconds_on_page: form.get("t") ? Math.round((Date.now() - Number(form.get("t"))) / 1000) : null,
      javascript_ran: Boolean(form.get("t")),
      honeypot_filled: Boolean(form.get("company") || form.get("website")),
      country: request.cf?.country || null,
    },
  };

  let decision = { route: "hold", p_real: null, reason: "jev-unavailable" };
  try {
    const { state, questions, evidenceMap } = build(sub);
    const res = await ask({ apiKey: env.TYPESAFE_API_KEY, state, questions, model: env.JEV_MODEL || "jev-latest", retries: 2, timeoutMs: 4000 });
    const r = route(res.answers);
    decision = { ...r, evidence: evidenceMap[res.answers.evidence?.choice] || null, model: res.model, latency_ms: res.latency_ms };
  } catch (err) {
    // Fail open into the hold lane: a human still sees it, with the reason.
    decision.error = err.message;
  }

  if (decision.route === "drop") {
    // Same "thanks" the visitor would see, so a bot learns nothing.
    // Send to a muted channel if you keep one, else just log.
    console.log("dropped", decision.p_real, decision.reason, sub.email);
    return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
  }

  const lines = [
    decision.route === "hold" ? `Lead (HOLD, P(real)=${decision.p_real ?? "?"}) from ${sub.email}` : `New lead from ${sub.email}`,
    sub.message,
    decision.evidence ? `Evidence: ${decision.evidence}` : "",
    decision.reason ? `Reason: ${decision.reason}` : "",
    decision.error ? `Doorman error: ${decision.error}` : "",
  ].filter(Boolean);
  await fetch(env.LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines.join("\n") }) });
  return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
}
