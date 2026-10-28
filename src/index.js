import { NEXUS_AGENT_INSTRUCTIONS } from "./prompt.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "nexus-whatsapp-agent" });
    }

    if (request.method === "GET" && url.pathname === "/webhook") {
      return verifyWebhook(url, env);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const rawBody = await request.text();

      if (env.META_APP_SECRET) {
        const signature = request.headers.get("x-hub-signature-256");
        const valid = await verifyMetaSignature(rawBody, signature, env.META_APP_SECRET);
        if (!valid) {
          return new Response("Invalid signature", { status: 401 });
        }
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      ctx.waitUntil(handleWebhook(payload, env));
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

function verifyWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === env.VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

async function handleWebhook(payload, env) {
  const messages = extractIncomingMessages(payload);
  if (!messages.length) return;

  for (const message of messages) {
    try {
      await markMessageRead(message.id, env);

      if (message.type !== "text" || !message.text) {
        await sendWhatsAppText(
          message.from,
          "Recebi sua mensagem. Para eu te ajudar melhor por aqui, pode me mandar em texto? Se preferir, encaminho para o time da Nexus.",
          env,
        );
        continue;
      }

      const reply = await generateReply(message.text, env);
      await sendWhatsAppText(message.from, reply, env);
    } catch (error) {
      console.error("Failed to process WhatsApp message", {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function extractIncomingMessages(payload) {
  const result = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const message of value?.messages ?? []) {
        result.push({
          id: message.id,
          from: message.from,
          type: message.type,
          text: message?.text?.body?.trim() ?? "",
        });
      }
    }
  }

  return result;
}

async function generateReply(userText, env) {
  assertEnv(env, ["OPENAI_API_KEY"]);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-6-luna",
      reasoning: { effort: "none" },
      instructions: NEXUS_AGENT_INSTRUCTIONS,
      input: userText,
      max_output_tokens: 220,
      text: { verbosity: "low" },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${details.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = collectResponseText(data);

  if (!text) {
    throw new Error("OpenAI returned no text output");
  }

  return text;
}

function collectResponseText(data) {
  const parts = [];
  for (const item of data?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && content?.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function sendWhatsAppText(to, body, env) {
  assertEnv(env, ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID"]);

  const version = env.META_GRAPH_VERSION || "v26.0";
  const endpoint = `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: body.slice(0, 4096),
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Meta messages API ${response.status}: ${details.slice(0, 500)}`);
  }
}

async function markMessageRead(messageId, env) {
  if (!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID || !messageId) return;

  const version = env.META_GRAPH_VERSION || "v26.0";
  const endpoint = `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });

  if (!response.ok) {
    console.warn("Could not mark WhatsApp message as read", response.status);
  }
}

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const suppliedHex = signatureHeader.slice("sha256=".length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(suppliedHex)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expectedHex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeHexEqual(suppliedHex, expectedHex);
}

function timingSafeHexEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function assertEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
