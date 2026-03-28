import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => res.redirect("/brain.html"));

/* =========================
   Clients
========================= */
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const googleClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================
   Memory
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

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_ASPECTS = new Set([
  "1:1",
  "4:5",
  "9:16",
  "16:9",
]);

const SYSTEM_PROMPT = `
You are Edamame Brain — the content operator for serious brands.

VOICE
- Smart. Bold. Deep. Strategic.
- Short, high-signal answers. No fluff.

ROLE
Help users create high-performing content that drives attention, authority, inbound demand, and revenue.

CAPABILITIES
- Content strategy
- Campaign ideas
- Social media planning
- Content calendars
- Creative directions
- Marketing visuals

RULES
1) Answer immediately.
2) Ask ONE sharp question only if critical.
3) No generic advice.
4) English only.
5) Never mention being an AI.
6) When the user asks for strategy, planning, or calendars, respond as a high-level operator, not a generic assistant.
7) When the user asks for visuals, think like a premium ad creative director.

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

function normalizeAspect(value) {
  const aspect = String(value || "").trim();
  return ALLOWED_ASPECTS.has(aspect) ? aspect : "4:5";
}

function buildGeminiEditPrompt(userPrompt, aspect) {
  return `
Edit this real product image carefully.

CRITICAL RULES:
- Keep the product exactly the same.
- Do NOT redesign or recreate the product.
- Do NOT change the logo.
- Do NOT change any text.
- Do NOT change spelling, typography, label layout, or branding.
- Keep all logo and text as close to the original as possible.
- Do NOT alter product shape, colors, proportions, or packaging structure.
- Do NOT over-stylize the product.
- Do NOT make it look fake or obviously AI-generated.

EDIT SCOPE:
- Improve the background and surrounding environment.
- Improve the image in a subtle, premium, commercially clean way.
- Keep the product visually dominant.
- Maintain realism.
- Avoid dramatic transformations unless the user explicitly asks.
- Preserve brand integrity.

STYLE GOAL:
- Premium
- Clean
- Commercial
- Ad-ready
- Realistic

ASPECT RATIO:
${aspect}

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
   Chat / Strategy / Calendar
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

    const response = await openaiClient.responses.create({
      model: "gpt-4.1-mini",
      input: conversations[sessionId],
      temperature: 0.7,
      max_output_tokens: 900,
    });

    const reply =
      String(response?.output_text || "").trim() ||
      "Rephrase that in one clear sentence.";

    conversations[sessionId].push({
      role: "assistant",
      content: reply,
    });

    conversations[sessionId] = trimConversation(conversations[sessionId]);

    return res.json({ reply });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({
      error: "CHAT_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   Gemini Image Edit Only
========================= */
app.post("/api/image", async (req, res) => {
  try {
    const sessionId = getSessionId(req, res);
    if (!sessionId) return;

    const userPrompt = String(req.body?.prompt || "").trim();
    const requestedAspect = normalizeAspect(req.body?.aspect);

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

    const prompt = buildGeminiEditPrompt(userPrompt, requestedAspect);

    const response = await googleClient.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: parsed.mime,
                data: parsed.buffer.toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: {
          aspectRatio: requestedAspect,
          imageSize: "1K",
        },
      },
    });

    let imageBase64 = null;

    for (const part of response?.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }

    if (!imageBase64) {
      return res.status(500).json({
        error: "NO_IMAGE_RETURNED",
        message: "No image returned from Gemini.",
      });
    }

    usage.count += 1;

    return res.json({
      b64: imageBase64,
      aspect: requestedAspect,
      remainingToday: Math.max(0, DAILY_IMAGE_LIMIT - usage.count),
      provider: "gemini",
      model: "gemini-3-pro-image-preview",
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
