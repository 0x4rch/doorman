// Tiny .env loader so the repo needs no dependencies.
// Reads KEY=value lines from .env in the working directory; real environment wins.
import { readFileSync } from "node:fs";

export function loadEnv(path = ".env") {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function config() {
  const key = process.env.TYPESAFE_API_KEY || "";
  const forced = (process.env.DOORMAN_MODE || "auto").toLowerCase();
  const mode = forced === "live" || forced === "mock" ? forced : key ? "live" : "mock";
  if (mode === "live" && !key) {
    throw new Error("DOORMAN_MODE=live but TYPESAFE_API_KEY is empty. Put the key in .env or the environment.");
  }
  return {
    apiKey: key,
    model: process.env.JEV_MODEL || "jev-latest",
    mode,
    port: Number(process.env.PORT || 3000),
  };
}
