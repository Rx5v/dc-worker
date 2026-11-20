import { verifyKey } from "discord-interactions";

const JSON_HEADERS = { "content-type": "application/json" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Normalisasi: "/interactions" dan "/interactions/" dianggap sama
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

    if (request.method === "GET" && path === "/") {
      return Response.json(
        { ok: true, service: "dc-bot-ai-worker", endpoints: ["POST /interactions", "POST /chat"] },
        { headers: JSON_HEADERS }
      );
    }

    if (path === "/interactions") {
      if (request.method === "POST") return handleInteractions(request, env, ctx);
      // Bantu debug: GET /interactions harusnya 405, bukan 404
      return Response.json(
        { ok: false, error: "Method not allowed, gunakan POST" },
        { status: 405, headers: JSON_HEADERS }
      );
    }

    if (request.method === "POST" && path === "/chat") {
      return handleChat(request, env);
    }

    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: JSON_HEADERS });
  },
};

// ---------- Discord Interactions Endpoint (slash command) ----------

async function handleInteractions(request, env, ctx) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  if (!env.DISCORD_PUBLIC_KEY) {
    console.error("DISCORD_PUBLIC_KEY belum di-set (wrangler secret).");
    return new Response("Server misconfigured", { status: 500 });
  }
  const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY).catch(
    (e) => {
      console.error("verifyKey error:", e?.message);
      return false;
    }
  );
  if (!isValid) {
    return new Response("Bad request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // PING dari Discord Developer Portal → wajib balas PONG
  if (interaction.type === 1) {
    return Response.json({ type: 1 }, { headers: JSON_HEADERS });
  }

  // Slash command
  if (interaction.type === 2) {
    const name = interaction.data?.name;

    if (name === "ping") {
      return Response.json(
        { type: 4, data: { content: "Pong! Worker online." } },
        { headers: JSON_HEADERS }
      );
    }

    if (name === "ask") {
      const prompt =
        interaction.data.options?.find((o) => o.name === "pertanyaan")?.value ?? "...";
      const username =
        interaction.member?.user?.username ?? interaction.user?.username ?? "user";

      // Balas DEFERRED dulu (biar Discord tidak timeout 3 detik),
      // lalu edit pesan aslinya setelah OpenAI selesai via waitUntil.
      const deferred = Response.json(
        { type: 5, data: { content: `Mikirr... 🤔` } },
        { headers: JSON_HEADERS }
      );

      const ctx = getWaitUntil(ctx);
      const job = (async () => {
        let reply;
        try {
          reply = await callLLM(env, [
            { role: "user", content: `User ${username} bertanya: ${prompt}` },
          ]);
        } catch (e) {
          reply = `Maaf, AI lagi error: ${e.message}`;
        }
        await editOriginalResponse(env, interaction.application_id, interaction.token, {
          content: `**Q:** ${prompt}\n\n${reply}`.slice(0, 1900),
        });
      })();
      if (ctx) ctx.waitUntil(job);
      else await job;

      return deferred;
    }

    return Response.json(
      { type: 4, data: { content: "Command tidak dikenal.", flags: 64 } },
      { headers: JSON_HEADERS }
    );
  }

  return Response.json(
    { type: 4, data: { content: "Tipe interaction tidak didukung.", flags: 64 } },
    { headers: JSON_HEADERS }
  );
}

async function editOriginalResponse(env, applicationId, token, data) {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        // Bot token tidak wajib untuk webhook interaction, tapi aman disertakan
        ...(env.DISCORD_BOT_TOKEN ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}),
      },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) console.error("editOriginal failed:", res.status, await res.text());
}

// ---------- Otak AI: dipanggil gateway bot saat di-mention ----------

async function handleChat(request, env) {
  // Proteksi: gateway bot harus kirim header x-webhook-secret yang sama
  const secret = request.headers.get("x-webhook-secret");
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body harus JSON" }, { status: 400 });
  }

  const message = (body.message ?? body.prompt ?? "").toString().trim();
  if (!message) {
    return Response.json({ ok: false, error: "Field 'message' kosong" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const username = body.username ?? "user";
  const systemOverride =
    body.system_prompt ?? body.personality ?? body.systemPrompt ?? null;

  const messages = [
    ...history.filter((m) => m?.role && m?.content).map((m) => ({ role: m.role, content: String(m.content) })),
    { role: "user", content: `User ${username} berkata: ${message}` },
  ];

  try {
    const reply = await callLLM(env, messages, systemOverride);
    return Response.json({ ok: true, reply }, { headers: JSON_HEADERS });
  } catch (e) {
    console.error("callLLM error:", e);
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}

// ---------- OpenAI / OpenAI-compatible chat completions ----------

async function callLLM(env, messages, systemOverride = null) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY belum di-set (wrangler secret).");
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
  const system = systemOverride || env.SYSTEM_PROMPT || "Kamu asisten Discord yang ramah.";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
      body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        ...messages,
      ],
      max_tokens: 4000,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  // Model reasoning (seperti muse-spark) menghabiskan token untuk berpikir;
  // content bisa berupa string, array parts, atau ada di reasoning_content.
  const msg = data.choices?.[0]?.message ?? {};
  const reply = (
    (typeof msg.content === "string" ? msg.content : extractText(msg.content)) ||
    extractText(msg.reasoning_content) ||
    ""
  ).trim();
  if (!reply) {
    if (data.choices?.[0]?.finish_reason === "length") {
      throw new Error("LLM kehabisan token (coba lagi, max_tokens sudah dinaikkan).");
    }
    throw new Error("LLM mengembalikan respons kosong.");
  }
  return reply;
}

function extractText(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (Array.isArray(part)) {
    return part
      .map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? ""))
      .join("");
  }
  return "";
}

function getWaitUntil(ctx) {
  // ctx.waitUntil = API resmi Cloudflare Workers agar kerja latar
  // (panggil OpenAI + edit pesan) tetap jalan setelah response dikirim.
  return ctx && typeof ctx.waitUntil === "function" ? ctx : null;
}
