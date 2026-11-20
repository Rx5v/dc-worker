// Debug: panggil provider LLM langsung, tampilkan bentuk respons (tanpa bocorkan key).
// Jalankan: node scripts/debug-llm.js
import { readFileSync } from "node:fs";

function parseDevVars(path) {
  const raw = readFileSync(path, "utf8");
  const env = {};
  // Support KEY="multiline..." dan KEY=value biasa
  const re = /^([A-Z_][A-Z0-9_]*)=(("(?:[^"\\]|\\.)*")|<<EOF\n([\s\S]*?)\nEOF|([^\n]*))/gm;
  let m;
  while ((m = re.exec(raw))) {
    const k = m[1];
    if (m[3] !== undefined && m[3] !== "") env[k] = JSON.parse(`"${m[3]}"`);
    else if (m[4] !== undefined) env[k] = m[4];
    else env[k] = (m[5] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = parseDevVars(".dev.vars");
const baseUrl = (env.OPENAI_BASE_URL || "").replace(/\/$/, "");
console.log("baseUrl:", baseUrl);
console.log("model:", env.OPENAI_MODEL);
console.log("key set:", Boolean(env.OPENAI_API_KEY), "| len:", (env.OPENAI_API_KEY || "").length);
console.log("system len:", (env.SYSTEM_PROMPT || "").length);

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  body: JSON.stringify({
    model: env.OPENAI_MODEL,
    messages: [{ role: "user", content: "Balas dengan kata: halo" }],
    max_tokens: 50,
  }),
});
console.log("HTTP:", res.status);
const text = await res.text();
console.log("body chars:", text.length);
try {
  const data = JSON.parse(text);
  console.log("top keys:", Object.keys(data));
  console.log(JSON.stringify(data, null, 2).slice(0, 2000));
} catch {
  console.log("BUKAN JSON:", text.slice(0, 1000));
}
