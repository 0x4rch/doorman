// Generates data/submissions.json: 312 invented submissions to a request-a-demo
// form on a small invoicing SaaS, and to its checkout, from a fixed seed. Every name, email, app and order is made
// up. Each row carries `label`, the generator's intent (real, pitch,
// automated, grey, fraud), which the batch runner uses to compare Jev and the
// rule list against. That label is the generator's, not a human's.
import { writeFileSync, mkdirSync } from "node:fs";

let seed = 20260922;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.round(between(a, b));
const junk = () => Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, "x");

const first = ["jess","tom","maya","ravi","lena","omar","priya","sam","ines","kofi","hana","luis","nora","dev","ada","theo","mei","jonas","zara","eli","ana","rui","ivy","max"];
const companies = ["Brightline Dental","Oakfield Plumbing","Northway Tutoring","Kestrel Design Co","Harbor Yoga","Fernway Landscaping","Redbrick Bakery","Lumen Photography","Tidewater Charters","Pinecrest Vet","Sable Interiors","Quill Legal","Meadow Florists","Ironhill Fitness","Copperpot Catering","Bluebird Daycare","Slate Architecture","Juniper Cleaning","Anchor Accounting","Marigold Events"];
const tools = ["QuickBooks","Xero","FreshBooks","Wave","spreadsheets","Stripe invoices","paper and email"];
const needs = ["We send about 200 invoices a month and chasing late ones eats a day a week.","Two of us do the books and we keep double-paying suppliers.","We need recurring invoices and a client portal, our current tool has neither.","Our accountant wants everything in one place before year end.","We just hired a fifth person and the spreadsheet is falling apart.","Clients keep asking to pay by card and we can't take it.","We want to move off our current tool before the renewal in November.","Can it handle two currencies? Half our clients are in the UK."];
const asks = ["Can we get a demo this week?","Want to see how the reminders work before we commit.","Happy to do a call, mornings are best.","What does onboarding look like for a team of six?","Looking for a walkthrough of the reporting.","Does it import from what we use now?"];
const domains = ["gmail.com","proton.me","hey.com","icloud.com","outlook.com"];
const countries = ["US","US","US","GB","DE","CA","AU","NL","IE","FR"];

const agency = [
  ["Hello https://example.com/, I came across your website and noticed it is not ranking on Google. Our agency offers SEO and backlinks at affordable prices. Full proposal attached.", false],
  ["Hi, we are a leading app development company with 150+ developers. We can build your next mobile app at 40% lower cost. Can we schedule a call?", false],
  ["Hi there, I noticed your site could use a fresh design. Our team specializes in web design and digital marketing for SaaS companies. Let me know a good time.", false],
  ["Hi there, love what you are building. I run a small studio that helps SaaS founders fill their pipeline with done-for-you outreach. We got an invoicing startup in Austin 14 booked demos last month. Open to a 15 minute chat?", true],
  ["Quick one. We place sponsored articles on DA 50+ sites. Fintech niche is available this month. Reply for rates.", true],
  ["We help companies like yours white label their product for accountants and resell at 3x. Happy to send the deck. What is the best email for the founder?", true],
  ["Hey, saw your launch. We run paid ads for B2B software and can guarantee 20 qualified demos a month or you don't pay. Worth a chat?", true],
  ["Greetings, I represent a venture fund interested in investing in fintech startups. Kindly share your pitch deck and bank details for verification.", true],
  ["Are you accepting guest posts? I have a well researched article on small business cash flow that fits your audience. Link building is a bonus for both of us.", false],
  ["Hi, I'm reaching out from a lead generation company. We can deliver a list of 5,000 small business owners with verified emails for $99. Interested?", false],
];
const bots = [
  ["Hello https://example.com/, Get 1000 free visitors to your website today! Click here: http://bit.ly/tr4ff1c", true, true],
  ["asdkjh qwe poiu 12981 http://xn--80ak6aa92e.com http://cheap-meds.example http://win-now.example", true, true],
  ["Dear example.com owner, your domain is about to expire. Renew now to avoid loss of service: http://renew-domain.example", false, true],
  ["I make $4,500 a week from home with this one crypto signal group. DM me \"signal\"", true, true],
  ["Hello, Are you the owner of example.com? We can help you recover your hacked Instagram account within 24 hours. Contact on WhatsApp.", true, false],
  ["test test test", true, true],
];
const grey = [
  "need a demo asap can you call",
  "how much",
  "is this legit?",
  "my friend runs a shop and wants invoicing software, not sure what to ask for, he doesn't speak english well",
  "Hola, tengo una tienda y necesito facturar a mis clientes. ¿Hablan español?",
  "can we resell this to our bookkeeping clients? we are an agency with about 30 small businesses",
  "We are a university group and want to interview you about SaaS pricing for a class project.",
];
const items = [["Annual plan", 950], ["Pro plan", 290], ["Team plan", 590], ["Starter plan", 99], ["Prepaid credit $100", 100], ["Prepaid credit $250", 250], ["Add-on seat", 49]];
const fraud = [
  { items: "6× Prepaid credit $250", total: 1500, card: "US", ip: "VN", attempts: 4, device: 1, age: 0, secs: 3 },
  { items: "1× Annual plan", total: 950, card: "CA", ip: "NG", attempts: 1, device: 0, age: 0, secs: 40, name_match: false },
  { items: "10× Prepaid credit $100", total: 1000, card: "US", ip: "US", attempts: 1, device: 9, age: 0, secs: 12 },
  { items: "1× Pro plan", total: 290, card: "GB", ip: "BR", attempts: 3, device: 2, age: 1, secs: 2 },
  { items: "2× Team plan", total: 1180, card: "US", ip: "RU", attempts: 1, device: 0, age: 0, secs: 30, shipping: "freight forwarder, Delaware" },
];
const orderGrey = [
  { items: "1× Annual plan", total: 950, card: "DE", ip: "TR", attempts: 1, device: 0, age: 400, secs: 70 },
  { items: "3× Prepaid credit $100", total: 300, card: "US", ip: "US", attempts: 1, device: 1, age: 20, secs: 40 },
  { items: "1× Starter plan", total: 99, card: "FR", ip: "FR", attempts: 1, device: 0, age: 0, secs: 25, card_type: "prepaid" },
];

const demo = (email, message, signals, label) => ({ form: "demo", email, phone: "", message, signals, label });
const checkout = (email, o, label) => ({
  form: "checkout", email, order: { items: o.items, total_usd: o.total },
  signals: { card_country: o.card, ip_country: o.ip, attempts: o.attempts, device_orders_last_hour: o.device, account_age_days: o.age, seconds_on_page: o.secs, name_match: o.name_match !== false, card_type: o.card_type || "standard", shipping: o.shipping || "none, digital" },
  label,
});

function buyer() {
  const n = pick(first), co = pick(companies), slug = co.split(" ")[0].toLowerCase();
  const urls = rnd() < 0.12, lg = rnd() < 0.06;
  let m = `${rnd() < 0.5 ? "Hi, " : ""}I run ${co}${lg ? ", a lead generation shop for realtors" : ""}. We use ${pick(tools)} today. ${pick(needs)} ${pick(asks)}`;
  if (urls) m += ` Site: https://${slug}.example  Reviews: https://maps.example/${slug}  Current invoices: https://drive.example/${slug}`;
  return demo(`${n}@${rnd() < 0.6 ? slug + ".example" : pick(domains)}`, m, { seconds_on_page: int(45, 420), javascript_ran: true, honeypot_filled: false, country: pick(countries) }, "real");
}
function pitch() {
  const [m] = pick(agency);
  return demo(`${pick(["growth","hello","partnerships","outreach","sales","team"])}@${pick(["rankboost-digital.co","studiofolk.agency","apexdev.io","brightpixel.co","scaleleads.co","mediareach.example"])}`, m, { seconds_on_page: int(8, 60), javascript_ran: true, honeypot_filled: false, country: pick(["IN","US","PK","GB","PH"]) }, "pitch");
}
function bot() {
  const [m, hp, fast] = pick(bots);
  return demo(`${junk()}@${pick(["mail.ru","qq.com","yopmail.com","gmail.com"])}`, m, { seconds_on_page: fast ? int(1, 3) : int(5, 30), javascript_ran: rnd() < 0.7, honeypot_filled: hp, country: pick(["RU","CN","US","BR"]) }, "automated");
}
function greyOne() {
  const nojs = rnd() < 0.4;
  return demo(`${pick(first)}${int(2, 99)}@${pick(domains)}`, pick(grey), { seconds_on_page: nojs ? null : int(6, 90), javascript_ran: !nojs, honeypot_filled: false, country: pick(countries) }, "grey");
}
function order() {
  const c = pick(countries), [name, price] = pick(items), q = rnd() < 0.15 ? 2 : 1;
  return checkout(`${pick(first)}@${pick(domains)}`, { items: `${q}× ${name}`, total: q * price, card: c, ip: c, attempts: 1, device: 0, age: rnd() < 0.3 ? 0 : int(1, 900), secs: int(40, 300) }, "real");
}
const fraudOne = () => checkout(`${junk()}@${pick(["gmail.com","outlook.com","proton.me"])}`, pick(fraud), "fraud");
const orderGreyOne = () => checkout(`${pick(first)}@${pick(domains)}`, pick(orderGrey), "grey");

const N = 312;
const rows = [];
for (let i = 0; i < N; i++) {
  const r = rnd();
  rows.push(r < 0.36 ? buyer() : r < 0.47 ? pitch() : r < 0.55 ? bot() : r < 0.6 ? greyOne() : r < 0.84 ? order() : r < 0.95 ? fraudOne() : orderGreyOne());
}
// hand-placed opening frames so the first seconds of a run tell the story
rows[0] = buyer();
rows[1] = demo("maya@studiofolk.agency", agency[3][0], { seconds_on_page: 38, javascript_ran: true, honeypot_filled: false, country: "US" }, "pitch");
rows[2] = fraudOne();
rows[3] = greyOne();
rows.forEach((r, i) => (r.id = i + 1));

mkdirSync("data", { recursive: true });
writeFileSync("data/submissions.json", JSON.stringify({ note: "Every submission is invented and generated by scripts/generate-submissions.js from a fixed seed.", generated: new Date().toISOString().slice(0, 10), count: rows.length, submissions: rows }, null, 1));
const counts = rows.reduce((a, r) => ((a[r.label] = (a[r.label] || 0) + 1), a), {});
console.log(`wrote data/submissions.json: ${rows.length} submissions`, counts);
