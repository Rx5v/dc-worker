// Gateway Discord: dengarkan mention, teruskan ke Worker (/chat), balas ke channel.
// Jalankan di laptop/VPS/Railway:  node bot.js
// Butuh: DISCORD_BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET  (lihat .env.example)
//
// Kenapa gateway ini tetap dibutuhkan?
// Cloudflare Worker hanya bisa menerima "Interactions Endpoint" (slash command),
// TIDAK bisa menerima event "pesan di-mention" (MESSAGE_CREATE). Event itu hanya
// dikirim lewat Discord Gateway (websocket). Jadi arsitekturnya:
//   Discord --(mention event)--> bot.js --(POST /chat)--> Worker --> OpenAI kamu

import { Client, GatewayIntentBits } from "discord.js";

const { DISCORD_BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET } = process.env;
if (!DISCORD_BOT_TOKEN || !WORKER_URL || !WEBHOOK_SECRET) {
  console.error("Set DISCORD_BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET dulu (lihat .env.example).");
  process.exit(1);
}

const workerChatUrl = WORKER_URL.replace(/\/$/, "") + "/chat";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // aktifkan juga di Developer Portal → Privileged Intents
  ],
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag} — mention bot untuk bertanya.`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!client.user) return;

  // Hanya respon kalau bot di-mention
  if (!msg.mentions.has(client.user)) return;

  const prompt = msg.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  if (!prompt) {
    await msg.reply("Halo! Tag aku + tulis pertanyaanmu, contoh: `@bot siapa presiden pertama RI?`");
    return;
  }

  await msg.channel.sendTyping().catch(() => {});

  try {
    const res = await fetch(workerChatUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ message: prompt, username: msg.author.username }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Worker ${res.status}`);
    // Discord max 2000 char per pesan → potong/chunk
    for (const chunk of chunkText(data.reply, 1900)) {
      await msg.reply(chunk);
    }
  } catch (e) {
    console.error("chat error:", e);
    await msg.reply(`Maaf, AI lagi error: ${e.message}`.slice(0, 1900));
  }
});

function chunkText(text, size) {
  const out = [];
  let s = String(text);
  while (s.length > size) {
    let i = s.lastIndexOf("\n", size);
    if (i < 50) i = size;
    out.push(s.slice(0, i));
    s = s.slice(i).trimStart();
  }
  out.push(s);
  return out;
}

client.login(DISCORD_BOT_TOKEN);
