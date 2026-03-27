import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "12mb" }));
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
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const DAILY_IMAGE_LIMIT = 2;

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const OPENAI_SIZE_MAP = {
  auto: "auto",
  "1:1": "1024x1024",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
};

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

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (!match) return null;

  const mime = match[1];
  const b64 = match[2];

  if (!ALLOWED_IMAGE_MIMES.has(mime)) return null;

  try {
    const buffer = Buffer.from(b64, "base64");
    if (!buffer.length) return null;
    return { mime, buffer, b64 };
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

function normalizeAspect(value) {
  const aspect = String(value || "").trim();
  return OPENAI_SIZE_MAP[aspect] ? aspect : "auto";
}

function buildEditPrompt(userPrompt, aspect) {
  return `
You are editing a real product image.

CRITICAL RULES:
- Keep the product EXACTLY the same.
- Do NOT redesign the product.
- Do NOT recreate the product.
- Do NOT change the logo.
- Do NOT change any text.
- Do NOT change spelling, typography, or label layout.
- Do NOT alter brand identity in any way.
- The logo and text must remain perfectly readable and identical.

EDIT SCOPE:
- Improve the background and environment.
- Enhance lighting in a natural and realistic way.
- You may enhance overall scene lighting, but DO NOT relight or repaint the product surface.
- Keep changes subtle and premium.
- Avoid over-stylization.
- Avoid dramatic transformations.

STYLE:
- Clean
- Premium
- Commercial
- Ad-ready
- Realistic

IMPORTANT:
- This must look like the SAME original product placed in a better environment.
- The product must NOT look AI-generated.

OUTPUT:
- Respect aspect ratio (${aspect})
- Keep the product centered and dominant

USER REQUEST:
${userPrompt}
`;
}

function inferLightDirection(userPrompt) {
  const text = String(userPrompt || "").toLowerCase();

  if (
    text.includes("left") ||
    text.includes("من اليسار") ||
    text.includes("يسار")
  ) {
    return "left";
  }

  if (
    text.includes("right") ||
    text.includes("من اليمين") ||
    text.includes("يمين")
  ) {
    return "right";
  }

  if (
    text.includes("backlight") ||
    text.includes("خلف") ||
    text.includes("خلفية ضوء")
  ) {
    return "back";
  }

  return "right";
}

/* =========================
   Cleanup
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
   Upload Product
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

    const parsed = parseDataUrl(dataUrl);
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
   Chat
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
   Generate Background Only
========================= */
app.post("/api/background", async (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    const userPrompt = String(req.body?.prompt || "").trim();
    const aspect = normalizeAspect(req.body?.aspect);

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

    const size = OPENAI_SIZE_MAP[aspect];
    const prompt = buildEditPrompt(userPrompt, requestedAspect);

const result = await client.images.edit({
  model: "gpt-image-1.5",
  image: file,
  prompt,
  size,
  output_format: "png",
});

    const b64 = result?.data?.[0]?.b64_json;

    if (!b64) {
      return res.status(500).json({
        error: "NO_IMAGE_RETURNED",
        message: "No background returned from the model.",
      });
    }

    usage.count += 1;

    return res.json({
      b64,
      aspect,
      size,
      lightDirection: inferLightDirection(userPrompt),
      remainingToday: Math.max(0, DAILY_IMAGE_LIMIT - usage.count),
    });
  } catch (error) {
    console.error("BACKGROUND ERROR:", error);
    return res.status(500).json({
      error: "BACKGROUND_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   Reset
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
