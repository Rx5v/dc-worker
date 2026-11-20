// Daftarkan slash command /ask dan /ping ke Discord.
// Jalankan sekali (atau tiap update command):
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.js
// Bisa juga baca dari .env (tanpa lib tambahan).

import { readFileSync, existsSync } from "node:fs";

for (const f of [".env", "bot.env"]) {
  if (existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!APP_ID || !TOKEN) {
  console.error("Set DISCORD_APP_ID dan DISCORD_BOT_TOKEN dulu.");
  process.exit(1);
}

const commands = [
  {
    name: "ask",
    description: "Tanya AI",
    options: [
      { name: "pertanyaan", description: "Pertanyaanmu", type: 3, required: true },
    ],
  },
  { name: "ping", description: "Cek bot online" },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: "PUT",
  headers: { "content-type": "application/json", Authorization: `Bot ${TOKEN}` },
  body: JSON.stringify(commands),
});
console.log("Status:", res.status);
console.log(await res.text());
