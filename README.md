# Doorman

Bot and pitch detection for risky forms, with one request to [Jev](https://typesafe.ai).

A request-a-demo form, a checkout, a "contact sales" form: they all get the same traffic. Real customers, agencies pitching, scripts that fill in the honeypot, card testers, and a few submissions nobody could call. Doorman sends each one to Jev as `state`, asks a handful of typed questions, and routes on the answer in code:

| P(real) | Route | What happens |
|---|---|---|
| ≥ 0.80 | **deliver** | reaches a person |
| < 0.20 | **drop** | the visitor still sees "thanks", nobody is paged |
| between | **hold** | delivered with a flag, a human decides |

Every drop comes with the line that gave it away, chosen by Jev from the submission's own sentences.

The sample data is a fictional small invoicing SaaS with a request-a-demo form and a checkout. Everything in `data/submissions.json` is invented: the company, the product, every person, email and order.

## Run it

Node 18 or newer. No dependencies.

```sh
cp .env.example .env      # put TYPESAFE_API_KEY in it when you have one
npm start                 # http://localhost:3000
```

Without a key it runs in **mock mode**: the same request is built, the same response shape comes back, but the probabilities come from a word list and the badge in the UI says so. With a key in `.env` it goes live automatically. `jev-latest` is the default; set `JEV_MODEL=jev-1.13.0` to pin a version (see `.env.example`).

```sh
npm run judge -- "I run a bakery. We use spreadsheets and chasing late invoices eats a day a week. Demo this week?"
npm run judge -- "We help SaaS founders fill their pipeline with done-for-you outreach. 15 min chat?"
npm run judge -- --form checkout --items "6× Prepaid credit \$250" --card US --ip VN --attempts 4
npm run judge -- --raw "how much"        # prints the exact request and response JSON
npm run batch                            # all 312 through 8 workers, writes runs/<timestamp>.json
npm run bench:youtube                    # the public benchmark below (~$0.05)
npm run generate                         # regenerate data/submissions.json from the fixed seed
npm test
```

## Latest live run

23 September 2026, `jev-1.13.0`, 312 invented submissions, 8 workers. Full trace in `data/runs/2026-09-23-live.json`.

| | |
|---|---|
| wall time | 9.3 s (34 per second) |
| latency | median 226 ms, p95 332 ms |
| cost | $0.0106 |
| routes | 185 delivered, 109 dropped, 18 held |
| wrong side of the line | 0: no real submission dropped, no pitch, script or card tester delivered |
| the word list on the same 183 demo requests | 32 pitches or scripts let through, 14 real requests flagged |

Reproduce it with `npm run batch`. The summary prints the same table; the file lands in `runs/`.

## Benchmark on real, human-labelled data

The invented set carries the argument; this carries the credibility. `npm run bench:youtube` runs the same machinery, with the site context changed to a comment section, over the [UCI YouTube Spam Collection](https://archive.ics.uci.edu/dataset/380/youtube+spam+collection) (CC BY 4.0): 1,956 real comments from five music videos, hand-labelled spam or ham by the dataset's authors. "drop" is the spam prediction. Jev is not trained on this data; the questions were written once and not tuned. Trace in `data/runs/2026-09-23-youtube-live.json`.

| 23 September 2026, `jev-1.13.0` | |
|---|---|
| comments | 1,956 (1,005 spam) |
| decided (deliver or drop) | 1,783 |
| precision / recall on decided | 0.992 / 0.980 |
| held for a human | 173 (8.8%), of which 95 spam, 78 ham |
| forced yes/no at 0.5, no hold lane | 96.0% accuracy, precision 0.981, recall 0.940 |
| latency | median 203 ms, p95 281 ms |
| cost | $0.053 |

What the misses look like: most of the 18 spam comments delivered are talk about view counts and subscriber numbers ("if eminem gets 1 penny per view he would have 600 million dollars"), which the dataset labels spam and which read as ordinary comments. The 7 ham comments dropped are bare video links and "like me". The hold lane is doing what it should: "Check me out!" at 0.24, emoji walls, view-count chatter around 0.6.

The word list from the demo form caught nothing here, which is the point of a word list: it knows one site's vocabulary.

## How the questions are built

`src/questions.js`. One request per submission, several questions in it (the docs call this speculative fan-out: Jev reads the state once and answers all of them in parallel).

- `real` (noul): is this a genuine request from a person who wants what the form offers? This one routes. The criteria spell out what counts as a pitch or a script, because Jev reads literally.
- `pitch`, `automated` (demo form) or `fraud` (checkout) (nouls): the reason, shown on a drop.
- `evidence` (choice): which sentence of the message, or which fact about the order, most shows it is not genuine. Jev does not generate text, so the options are the submission's own sentences keyed `s0..sN`, and code maps the pick back.

Three form types share this shape: `demo` and `checkout` for the sample data, and `comment` for the YouTube benchmark, which differs only in the site context and the wording of `real`.

Thresholds live in code (`THRESHOLDS`), not in the model, as the docs recommend. Nouls have no separate confidence, so the hold lane is simply the middle of the probability range.

## What's here

```
server.js                      static UI + POST /api/judge + GET /api/submissions
cli.js                         judge one submission from the terminal
src/jev.js                     the HTTP client, written to the public API reference
src/questions.js               state + questions + routing, for demo, checkout and comment
src/env.js                     .env loader and mode selection (live when a key is set, else mock)
src/mock.js                    same response shape without a key
src/rules.js                   a typical honeypot / timer / word-list scorer, for comparison
src/doorman.js                 judge() and judgeAll() with N workers
scripts/generate-submissions.js the invented data set, from a fixed seed
scripts/run-batch.js           the recorded run
scripts/bench-youtube.js       the UCI YouTube Spam Collection benchmark
public/index.html              the 16:9 demo frame
examples/cloudflare-pages-function.js   Doorman in front of a Pages Function webhook
test/                          node --test
```

## Honesty notes

- Labels in the data set (`real`, `pitch`, `automated`, `grey`, `fraud`) are the generator's intent, not human ground truth. "Agreement with labels" in the batch summary means agreement with what the generator meant.
- Mock-mode numbers are not Jev. Don't quote them.
- Latency in the UI is the server-measured API round trip. Cost is `usage.input_tokens` at the published $0.042 per million.

MIT.
