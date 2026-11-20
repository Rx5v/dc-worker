# Discord AI Bot — Cloudflare Worker + Gateway Mention

Arsitektur (karena Worker tidak bisa dengar event mention langsung):

```
Discord --(mention event, websocket)--> bot.js --(POST /chat + secret)--> Worker --> OpenAI (custom URL)
Discord --(slash /ask, HTTP)-----------> Worker (/interactions) --------> OpenAI (custom URL)
```

## 1. Discord Developer Portal

1. Buat Application di https://discord.com/developers/applications
2. Catat **Application ID** dan **Public Key** (General Information).
3. Bot → **Reset Token** → catat token. Nyalakan **Message Content Intent**.
4. OAuth2 → URL Generator: centang `bot` + `applications.commands`, permission `Send Messages`, `Read Messages/View Channels`. Buka URL-nya untuk invite bot.

## 2. Worker (otak AI)

```bash
npm install
cp .dev.vars.example .dev.vars   # isi token + URL OpenAI custom kamu
npm run dev                      # test lokal

# Deploy + set secret produksi:
npm run deploy
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put OPENAI_BASE_URL      # contoh: https://api.openai.com/v1 atau URL custom kamu
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put WEBHOOK_SECRET       # string acak, samakan dengan .env gateway
```

## 3. Interactions Endpoint URL (untuk /ask)

Di Developer Portal → General Information → **Interactions Endpoint URL**, isi:

```
https://dc-bot-ai-worker.<username-kamu>.workers.dev/interactions
```

Klik Save — Discord akan kirim PING, Worker membalas PONG otomatis.

## 4. Daftarkan slash command

```bash
DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npm run register
```

## 5. Gateway mention (bot.js)

Jalankan di laptop/VPS/Railway (tidak bisa di Worker):

```bash
cp .env.example .env   # isi token, WORKER_URL, WEBHOOK_SECRET
node bot.js
```

Bot akan menjawab setiap pesan yang me-mention dia. Contoh: `@bot siapa presiden pertama RI?`

## Test cepat

```bash
# Otak AI langsung (tanpa Discord):
curl -X POST http://localhost:8787/chat \
  -H 'content-type: application/json' -H 'x-webhook-secret: isi-secret' \
  -d '{"message":"halo, siapa kamu?","username":"tester"}'
```
