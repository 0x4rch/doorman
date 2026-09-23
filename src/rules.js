// A typical contact-form defence, kept here so the same submissions can be scored
// both ways: honeypot fields, a submit timer, and a word list of agency pitch
// terms. It only knows demo requests; there is no checkout equivalent, which is
// part of the point.

export const SPAM_AT = 3;
export const SITE_DOMAIN = "example.com"; // set to your own domain: templates greet the site by its URL
const FAST_SECONDS = 4;
const PITCH =
  /\b(seo|backlinks?|web ?design|digital marketing|website traffic|rank(ing)? on google|guest posts?|link building|lead generation|social media marketing|app development (company|agency|services)|our (agency|company|team) (offers|provides|specializ)|full proposal|free (audit|consultation|quote) for your website)\b/gi;

/** @returns {{points:number, flags:string[], route:"deliver"|"drop"|"flag"}|null} null for forms the rules don't cover */
export function scoreWithRules(sub) {
  if (sub.form !== "demo") return null;
  const flags = [];
  let points = 0;
  const hit = (n, why) => { points += n; flags.push(why); };
  const s = sub.signals || {};
  if (s.honeypot_filled) hit(3, "honeypot");
  if (s.javascript_ran === false || s.seconds_on_page == null) hit(1, "nojs");
  else if (s.seconds_on_page < FAST_SECONDS) hit(2, `fast:${s.seconds_on_page}s`);
  const m = sub.message || "";
  if (m.toLowerCase().includes(SITE_DOMAIN)) hit(2, "own-url");
  if (/^\s*(hi|hello|dear|greetings)\b[^\n]{0,20}https?:\/\//i.test(m)) hit(2, "hello-url");
  const urls = (m.match(/https?:\/\/\S+/gi) || []).length;
  if (urls >= 3) hit(1, `urls:${urls}`);
  const pitch = new Set((m.match(PITCH) || []).map((w) => w.toLowerCase()));
  if (pitch.size) hit(Math.min(pitch.size, 3), `pitch:${[...pitch].join(",")}`);
  return { points, flags, route: points >= SPAM_AT ? "drop" : points > 0 ? "flag" : "deliver" };
}
