// The questions Doorman asks, and the state it builds for them.
//
// Design notes, all from the public docs:
// - One request per submission; several questions in it (speculative fan-out).
//   Jev reads the state once and answers every question in parallel, so extra
//   questions cost tokens, not round trips.
// - Nouls are absolute yes/no probabilities. `real` is the one that routes.
//   The companions (`pitch`, `automated`, `fraud`) explain a drop.
// - Jev does not generate text, so "the line that gave it away" is a Choice
//   over the submission's own sentences (or a checkout's own signals), keyed
//   s0..sN. Code maps the chosen key back to the text. Same pattern as the
//   line-by-line search cookbook.
// - Literal reading: the instructions say exactly what "real" means, and the
//   criteria carry the boundary cases, because Jev reads literally.

export const THRESHOLDS = { deliver: 0.8, drop: 0.2 }; // on P(real)

export const SITE_CONTEXT = {
  comment:
    "A public comment section under a popular music video. A genuine comment is a viewer reacting to the video, the song, " +
    "the artist, or other commenters, in any language and however briefly.",
  demo:
    "A small software company that sells invoicing software to small businesses. The form requests a product demo. " +
    "A genuine submission is written by a person describing their own business or need and asking to see the product.",
  checkout:
    "The same company's online checkout for software plans and prepaid credit. A genuine order is placed by a person " +
    "buying for their own business with their own card.",
};

/** Split a message into candidate sentences for the evidence Choice. */
export function sentences(text, max = 40) {
  const parts = String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return parts.slice(0, max);
}

/**
 * Build the state and questions for a submission.
 * A demo request: { form:"demo", email, phone, message, signals:{...} }
 * A checkout submission: { form:"checkout", email, order:{...}, signals:{...} }
 */
export function build(sub) {
  if (sub.form === "checkout") return buildCheckout(sub);
  if (sub.form === "comment") return buildComment(sub);
  return buildDemo(sub);
}

// A public comment (used by the YouTube Spam Collection benchmark). Same shape
// as a demo request: one noul routes, one labels, one choice cites.
function buildComment(sub) {
  const lines = sentences(sub.message);
  const criteria = {};
  lines.forEach((s, i) => (criteria[`s${i}`] = s));
  if (!lines.length) criteria.s0 = sub.message || "(empty)";
  const state = {
    site: SITE_CONTEXT.comment,
    form: "comment",
    submission: { author: sub.author || "", comment: sub.message || "" },
  };
  const questions = {
    real: {
      type: "noul",
      instructions: "Is `submission.comment` a genuine comment from a viewer about the video, the song, the artist or the discussion, rather than promotion of something else?",
      criteria: {
        true: "A reaction, opinion, joke, question, lyric, or reply about the video, song, artist, or other viewers. Short, misspelled, or in another language still counts.",
        false:
          "Promoting a channel, video, website, app, product, giveaway, phone number or link; asking viewers to subscribe to, like, vote for or visit something unrelated; " +
          "copy-paste chain messages; money-making offers.",
      },
    },
    pitch: {
      type: "noul",
      instructions: "Is `submission.comment` advertising or promoting something to other viewers?",
    },
    automated: {
      type: "noul",
      instructions: "Does `submission.comment` look like a template, chain message or script rather than something a viewer typed for this video?",
    },
    evidence: {
      type: "choice",
      instructions: "Which sentence of `submission.comment` most strongly shows that it is NOT a genuine viewer comment? If it is genuine, pick the sentence that best shows that.",
      criteria,
    },
  };
  return { state, questions, evidenceMap: criteria };
}

function buildDemo(sub) {
  const lines = sentences(sub.message);
  const criteria = {};
  lines.forEach((s, i) => (criteria[`s${i}`] = s));
  if (!lines.length) criteria.s0 = sub.message || "(empty)";

  const state = {
    site: SITE_CONTEXT.demo,
    form: "demo",
    submission: {
      email: sub.email || "",
      phone: sub.phone || "",
      message: sub.message || "",
    },
    signals: {
      seconds_on_page: sub.signals?.seconds_on_page ?? null,
      javascript_ran: sub.signals?.javascript_ran ?? null,
      hidden_honeypot_fields_filled: sub.signals?.honeypot_filled ?? false,
      links_in_message: (String(sub.message || "").match(/https?:\/\/\S+/gi) || []).length,
      country: sub.signals?.country || null,
    },
  };

  const questions = {
    real: {
      type: "noul",
      instructions:
        "Is `submission` a genuine request from a person who wants the product described in `site`, written about their own business or need?",
      criteria: {
        true: "A person describes their own business, team, current tools or question and asks to see the product. Short or badly written is still genuine.",
        false:
          "Selling something to the site owner (SEO, design, development, leads, ads, sponsorships, partnerships, investment), " +
          "a template or script (greets the site by its URL, gibberish, test text, filled hidden fields), or unrelated to the product.",
      },
    },
    pitch: {
      type: "noul",
      instructions: "Is `submission` trying to sell a product or service to the site owner rather than buy one?",
    },
    automated: {
      type: "noul",
      instructions:
        "Does `submission` look produced by a script or template rather than typed by a person for this site? Consider `signals` as well as the text.",
      criteria: {
        true: "Gibberish, placeholder text, a greeting that uses the site's own URL, hidden fields filled in, submitted within a few seconds of page load.",
        false: "Reads like one person writing to another, even if brief.",
      },
    },
    evidence: {
      type: "choice",
      instructions:
        "Which sentence of `submission.message` most strongly shows that it is NOT a genuine request for a demo? If it is genuine, pick the sentence that best shows that.",
      criteria,
    },
  };
  return { state, questions, evidenceMap: criteria };
}

function buildCheckout(sub) {
  const o = sub.order || {};
  const sig = sub.signals || {};
  const facts = {
    f0: `Items: ${o.items || ""}`,
    f1: `Card country ${sig.card_country || "?"}, IP country ${sig.ip_country || "?"}`,
    f2: `Payment attempts before success: ${sig.attempts ?? 1}`,
    f3: `Orders from this device in the last hour: ${sig.device_orders_last_hour ?? 0}`,
    f4: `Account age in days: ${sig.account_age_days ?? "unknown"}`,
    f5: `Seconds on page before paying: ${sig.seconds_on_page ?? "unknown"}`,
    f6: `Billing name matches card name: ${sig.name_match === false ? "no" : "yes"}`,
    f7: `Card type: ${sig.card_type || "standard"}`,
    f8: `Shipping: ${sig.shipping || "none, digital"}`,
  };
  const state = {
    site: SITE_CONTEXT.checkout,
    form: "checkout",
    order: { email: sub.email || "", items: o.items || "", total_usd: o.total_usd ?? null },
    signals: {
      card_country: sig.card_country || null,
      ip_country: sig.ip_country || null,
      payment_attempts_before_success: sig.attempts ?? 1,
      orders_from_this_device_last_hour: sig.device_orders_last_hour ?? 0,
      account_age_days: sig.account_age_days ?? null,
      seconds_on_page: sig.seconds_on_page ?? null,
      billing_name_matches_card: sig.name_match !== false,
      card_type: sig.card_type || "standard",
      shipping: sig.shipping || "none, digital",
    },
  };
  const questions = {
    real: {
      type: "noul",
      instructions: "Is `order` a genuine purchase by a person using their own card, given `signals`?",
      criteria: {
        true: "One ordinary order, consistent countries, one payment attempt, an account with some history or a plausible new customer.",
        false:
          "Card testing (several attempts, several cards, many orders from one device), stolen-card patterns (country mismatch, name mismatch, brand-new account buying lots of prepaid credit), reshipping.",
      },
    },
    fraud: {
      type: "noul",
      instructions: "Do `signals` show a card-testing or stolen-card pattern?",
    },
    evidence: {
      type: "choice",
      instructions: "Which fact most strongly shows that `order` is NOT genuine? If it is genuine, pick the fact that best shows that.",
      criteria: facts,
    },
  };
  return { state, questions, evidenceMap: facts };
}

/** Turn answers into a route. Thresholds live in code, not in the model. */
export function route(answers) {
  const p = answers.real?.noul;
  if (typeof p !== "number") throw new Error("Answer for `real` missing or not a noul.");
  const routeName = p >= THRESHOLDS.deliver ? "deliver" : p < THRESHOLDS.drop ? "drop" : "hold";
  const reasons = ["pitch", "automated", "fraud"]
    .filter((k) => typeof answers[k]?.noul === "number")
    .map((k) => ({ kind: k, p: answers[k].noul }))
    .sort((a, b) => b.p - a.p);
  return { route: routeName, p_real: p, reason: reasons[0]?.p >= 0.5 ? reasons[0].kind : null, reasons };
}
