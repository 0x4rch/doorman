// Minimal client for TypeSafe's System One endpoint, written against the public
// API reference (https://docs.typesafe.ai/api) so it is plug and play once a key exists.
//
//   POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <API_KEY>
//   { "state": string | object | array, "model": "jev-latest", "questions": { <id>: Question } }
//
// Response:
//   { "model": "jev-1.13.0", "answers": { <id>: Answer }, "usage": { "input_tokens": n, "output_tokens": n } }
//
// Answer shapes:
//   noul:   { "type": "noul",   "noul": 0..1 }
//   choice: { "type": "choice", "choice": "<option>", "probabilities": { <option>: p }, "confidence": 0..1 }
//   score:  { "type": "score",  "score": n, "legend": {...}, "probabilities": {...}, "confidence": 0..1 }
//
// Errors: 401 bad key, 422 malformed body, 429 rate limit, 529 overloaded (retry with backoff).
// Pricing (Models page): $0.042 per million input tokens, output tokens free.
// Works in Node 18+ and in Cloudflare Workers, since it only uses fetch.

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MODELS_ENDPOINT = "https://api.typesafe.ai/v1/models";
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

const RETRY_STATUSES = new Set([429, 529]);

export class JevError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "JevError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Ask Jev one or more typed questions about a state.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string|object|Array} opts.state
 * @param {Record<string, object>} opts.questions
 * @param {string} [opts.model="jev-latest"]
 * @param {number} [opts.retries=4]
 * @param {number} [opts.timeoutMs=15000]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{model:string, answers:object, usage:{input_tokens:number,output_tokens:number}, latency_ms:number, cost_usd:number}>}
 */
export async function ask({ apiKey, state, questions, model = "jev-latest", retries = 4, timeoutMs = 15000, fetchImpl = fetch }) {
  if (!apiKey) throw new JevError("Missing TYPESAFE_API_KEY.");
  const body = JSON.stringify({ state, model, questions });
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = now();
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await sleep(backoff(attempt++));
        continue;
      }
      throw new JevError(`Network error calling Jev: ${err.message}`);
    }
    clearTimeout(timer);
    const latency_ms = Math.round(now() - t0);

    if (RETRY_STATUSES.has(res.status) && attempt < retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
      attempt++;
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new JevError(`Jev returned ${res.status}: ${describe(json)}`, { status: res.status, body: json });
    }
    if (!json.answers || typeof json.answers !== "object") {
      throw new JevError("Jev response had no answers map.", { status: res.status, body: json });
    }
    const usage = json.usage || { input_tokens: 0, output_tokens: 0 };
    return { model: json.model, answers: json.answers, usage, latency_ms, cost_usd: (usage.input_tokens || 0) * USD_PER_INPUT_TOKEN };
  }
}

/** GET /v1/models: the names this account can send in the model field. */
export async function listModels({ apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
  const json = await res.json();
  if (!res.ok) throw new JevError(`Jev returned ${res.status}: ${describe(json)}`, { status: res.status, body: json });
  return json.models || [];
}

function describe(json) {
  if (!json) return "empty body";
  if (typeof json === "string") return json;
  return json.error?.message || json.message || json.detail || JSON.stringify(json).slice(0, 300);
}
const backoff = (n) => 250 * 2 ** n + Math.random() * 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
