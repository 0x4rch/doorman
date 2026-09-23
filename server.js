// Doorman server. No dependencies.
//   GET  /                 the demo UI (public/)
//   GET  /api/health       { mode, model }
//   GET  /api/submissions  the invented sample set
//   POST /api/judge        { form:"demo", email, message, signals } or a checkout -> decision
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { loadEnv, config } from "./src/env.js";
import { judge } from "./src/doorman.js";

loadEnv();
const cfg = config();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/health") return json(res, 200, { mode: cfg.mode, model: cfg.mode === "live" ? cfg.model : "mock", thresholds: { deliver: 0.8, drop: 0.2 } });
    if (url.pathname === "/api/submissions") {
      const data = await readFile("data/submissions.json", "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(data);
    }
    if (url.pathname === "/api/judge") {
      if (req.method !== "POST") return json(res, 405, { error: "POST a submission." });
      const body = await readBody(req);
      let sub;
      try { sub = JSON.parse(body); } catch { return json(res, 400, { error: "Body must be JSON." }); }
      if (sub.form !== "demo" && sub.form !== "checkout") return json(res, 422, { error: 'form must be "demo" or "checkout".' });
      const out = await judge(sub, cfg);
      return json(res, 200, out);
    }
    // static
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    path = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const file = join("public", path);
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      json(res, 404, { error: "Not found." });
    }
  } catch (err) {
    console.error(err);
    json(res, err.status === 401 ? 401 : 502, { error: err.message, status: err.status });
  }
});

server.listen(cfg.port, () => {
  console.log(`Doorman on http://localhost:${cfg.port}  mode=${cfg.mode}${cfg.mode === "live" ? ` model=${cfg.model}` : " (set TYPESAFE_API_KEY in .env to go live)"}`);
});

function json(res, status, obj) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve, reject) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on("end", () => resolve(b)); req.on("error", reject); }); }
