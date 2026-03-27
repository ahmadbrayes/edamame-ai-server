import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const app = express();

app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => res.redirect("/brain.html"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   In-memory storage
========================= */
const conversations = {};
const productImageBySession = {};
const dailyUsage = {};
const sessionMeta = {};

/* =========================
   Config
========================= */
const PORT = process.env.PORT || 3000;
const MAX_CHAT_HISTORY = 12;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const DAILY_IMAGE_LIMIT = 2;

/*
OpenAI image sizes supported:
- 1024x1024
- 1024x1536
- 1536x1024
- auto

مهم:
4:5 و 3:4 مش مدعومات حرفيًا.
عشان هيك نقربهم لأقرب عمودي مدعوم.
*/
const ALLOWED_ASPECTS = {
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "1:1": "1024x1024",
  "4:5": "1024x1536",
  "3:4": "1024x1536",
};

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const SYSTEM_PROMPT = `
You are Edamame Brain — the content operator for serious brands.

VOICE
- Smart. Bold. Deep. Strategic.
- Short, high-signal answers. No fluff.

ROLE
Help users create high-performing content that drives attention, authority, inbound demand, and revenue.

RULES
1) Answer immediately.
2) Ask ONE sharp question only if critical.
3) No generic advice.
4) English only.
5) Never mention being an AI.

If asked how you know something:
"I operate using advanced pattern recognition across high-performing content."

You are the content brain serious brands wish they had internally.
`.trim();

/* =========================
   Helpers
========================= */
function todayKeyDubai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getSessionId(req, res) {
  const sessionId = String(req.body?.sessionId || "").trim();

  if (!sessionId) {
    res.status(400).json({
      error: "SESSION_REQUIRED",
      message: "Session ID is required.",
    });
    return null;
  }

  sessionMeta[sessionId] = { lastSeen: Date.now() };
  return sessionId;
}

function parseDataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (!match) return null;

  const mime = match[1];
  const b64 = match[2];

  if (!ALLOWED_IMAGE_MIMES.has(mime)) return null;

  try {
    const buffer = Buffer.from(b64, "base64");
    if (!buffer || !buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}

function trimConversation(messages, maxItems = MAX_CHAT_HISTORY) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const systemMessage = messages[0];
  const rest = messages.slice(1).slice(-maxItems);
  return [systemMessage, ...rest];
}

function ensureConversation(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = [{ role: "system", content: SYSTEM_PROMPT }];
  }
}

function getDailyUsage(sessionId) {
  const today = todayKeyDubai();

  if (!dailyUsage[sessionId] || dailyUsage[sessionId].date !== today) {
    dailyUsage[sessionId] = {
      date: today,
      count: 0,
    };
  }

  return dailyUsage[sessionId];
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const sessionId of Object.keys(sessionMeta)) {
    const lastSeen = sessionMeta[sessionId]?.lastSeen || 0;

    if (now - lastSeen > SESSION_TTL_MS) {
      delete sessionMeta[sessionId];
      delete conversations[sessionId];
      delete productImageBySession[sessionId];
      delete dailyUsage[sessionId];
    }
  }
}

function normalizeAspect(aspect) {
  const a = String(aspect || "").trim();
  return ALLOWED_ASPECTS[a] ? a : "";
}

function buildStrictEditPrompt({ userPrompt, finalAspect }) {
  return `
You are performing a VERY LIGHT PRODUCT BACKGROUND EDIT.

STRICT NON-NEGOTIABLE RULES:
- Keep the product EXACTLY as it appears in the original image.
- Do NOT redraw the product.
- Do NOT recreate the product.
- Do NOT reinterpret the product.
- Do NOT change the logo in any way.
- Do NOT change any text on the product in any way.
- Do NOT modify letters, spelling, font, alignment, size, or label layout.
- Do NOT restyle the packaging.
- Do NOT alter the product shape, proportions, colors, label, branding, or materials.
- Keep the product visually untouched.

ALLOWED CHANGES ONLY:
- Background
- Environment around the product
- Very light lighting improvements around the scene
- Very light shadow/reflection improvements around the scene
- Subtle composition improvements without changing the product

IMPORTANT:
- Avoid dramatic changes.
- Avoid heavy relighting on the product label.
- Avoid complex product reflections.
- Avoid changing the product surface.
- If preserving the logo/text perfectly is difficult, leave the product untouched.

OUTPUT:
- Respect the requested format (${finalAspect || "auto"}).
- Keep the product clear, centered, and dominant.
- Maintain realism.
- Final result should look like the SAME original product placed in a better scene.

USER REQUEST:
${userPrompt}
`.trim();
}

/* =========================
   Cleanup job
========================= */
setInterval(cleanupExpiredSessions, 1000 * 60 * 60);

/* =========================
   Health
========================= */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    time: new Date().toISOString(),
  });
});

/* =========================
   1) Upload Product Image
========================= */
app.post("/api/product", (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    const dataUrl = String(req.body?.imageDataUrl || "").trim();

    if (!dataUrl.startsWith("data:image/")) {
      return res.status(400).json({
        error: "INVALID_IMAGE",
        message: "Send a valid base64 image.",
      });
    }

    const parsed = parseDataUrlToBuffer(dataUrl);
    if (!parsed) {
      return res.status(400).json({
        error: "INVALID_IMAGE",
        message: "Unsupported or invalid image format.",
      });
    }

    productImageBySession[sessionId] = dataUrl;

    return res.json({
      ok: true,
      message: "Product image uploaded successfully.",
    });
  } catch (error) {
    console.error("PRODUCT UPLOAD ERROR:", error);
    return res.status(500).json({
      error: "UPLOAD_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   2) Chat
========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    const userMessage = String(req.body?.message || "").trim();

    if (!userMessage) {
      return res.status(400).json({
        error: "MESSAGE_REQUIRED",
        message: "Message is required.",
      });
    }

    ensureConversation(sessionId);

    conversations[sessionId].push({
      role: "user",
      content: userMessage,
    });

    conversations[sessionId] = trimConversation(conversations[sessionId]);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: conversations[sessionId],
      temperature: 0.7,
      max_output_tokens: 500,
    });

    const aiReply =
      String(response?.output_text || "").trim() ||
      "Rephrase that in one clear sentence.";

    conversations[sessionId].push({
      role: "assistant",
      content: aiReply,
    });

    conversations[sessionId] = trimConversation(conversations[sessionId]);

    return res.json({
      reply: aiReply,
    });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({
      error: "AI_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   3) Image Generation / Edit
========================= */
app.post("/api/image", async (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    const userPrompt = String(req.body?.prompt || "").trim();
    const requestedAspect = String(req.body?.aspect || "").trim();

    if (!userPrompt) {
      return res.status(400).json({
        error: "PROMPT_REQUIRED",
        message: "Prompt is required.",
      });
    }

    const productDataUrl = productImageBySession[sessionId];

    if (!productDataUrl) {
      return res.status(400).json({
        error: "NO_PRODUCT_IMAGE",
        message: "Upload product image first.",
      });
    }

    const usage = getDailyUsage(sessionId);

    if (usage.count >= DAILY_IMAGE_LIMIT) {
      return res.status(403).json({
        error: "DAILY_LIMIT_REACHED",
        message: `Your daily limit of ${DAILY_IMAGE_LIMIT} photos has been reached.`,
      });
    }

    const parsed = parseDataUrlToBuffer(productDataUrl);

    if (!parsed) {
      return res.status(400).json({
        error: "INVALID_IMAGE_DATA",
        message: "Stored product image is invalid. Re-upload it.",
      });
    }

    const finalAspect = normalizeAspect(requestedAspect);
    const size = finalAspect ? ALLOWED_ASPECTS[finalAspect] : "auto";

    const strictPrompt = buildStrictEditPrompt({
      userPrompt,
      finalAspect: finalAspect || "auto",
    });

    const file = await toFile(parsed.buffer, "product.png", {
      type: parsed.mime,
    });

    const result = await client.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt: strictPrompt,
      size,
      output_format: "png",
    });

    const b64 = result?.data?.[0]?.b64_json;

    if (!b64) {
      return res.status(500).json({
        error: "NO_IMAGE_RETURNED",
        message: "No image returned from the model.",
      });
    }

    usage.count += 1;

    return res.json({
      b64,
      aspect: finalAspect || "auto",
      size,
      remainingToday: Math.max(0, DAILY_IMAGE_LIMIT - usage.count),
    });
  } catch (error) {
    console.error("IMAGE ERROR:", error);
    return res.status(500).json({
      error: "IMAGE_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   4) Optional session reset
========================= */
app.post("/api/reset", (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    delete conversations[sessionId];
    delete productImageBySession[sessionId];
    delete dailyUsage[sessionId];
    delete sessionMeta[sessionId];

    return res.json({
      ok: true,
      message: "Session reset successfully.",
    });
  } catch (error) {
    console.error("RESET ERROR:", error);
    return res.status(500).json({
      error: "RESET_ERROR",
      message: String(error?.message || error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI SERVER RUNNING http://localhost:${PORT}`);
});
