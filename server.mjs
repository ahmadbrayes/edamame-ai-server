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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const conversations = {};
const productImageBySession = {};

// daily limit: 2 per sessionId per day
const dailyUsage = {}; // { [sessionId]: { date: "YYYY-MM-DD", count: number } }

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

app.get("/health", (req, res) => res.json({ ok: true }));

function todayKey() {
  // daily reset based on server UTC day
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDailyUsage(sessionId) {
  const d = todayKey();
  if (!dailyUsage[sessionId] || dailyUsage[sessionId].date !== d) {
    dailyUsage[sessionId] = { date: d, count: 0 };
  }
  return dailyUsage[sessionId];
}

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  const buf = Buffer.from(b64, "base64");
  return { mime, buf };
}

/* =========================
   1) Upload Product Image
========================= */
app.post("/api/product", (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "default");
    const dataUrl = String(req.body?.imageDataUrl || "").trim();

    if (!dataUrl.startsWith("data:image/")) {
      return res.status(400).json({
        error: "INVALID_IMAGE",
        message: "Send valid base64 image.",
      });
    }

    productImageBySession[sessionId] = dataUrl;

    // ✅ لا تعمل reset للـ limit هون (عشان مش لكل upload)
    ensureDailyUsage(sessionId);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      error: "UPLOAD_ERROR",
      message: String(e?.message || e),
    });
  }
});

/* =========================
   2) Chat
========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    const sessionId = String(req.body?.sessionId || "default");

    if (!conversations[sessionId]) {
      conversations[sessionId] = [{ role: "system", content: SYSTEM_PROMPT }];
    }

    conversations[sessionId].push({ role: "user", content: userMessage });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: conversations[sessionId],
      temperature: 0.7,
      max_output_tokens: 500,
    });

    const aiReply =
      (response.output_text || "").trim() ||
      "Rephrase that in one clear sentence.";

    conversations[sessionId].push({ role: "assistant", content: aiReply });

    return res.json({ reply: aiReply });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({
      error: "AI_ERROR",
      message: String(error?.message || error),
    });
  }
});

/* =========================
   3) Image Generation (Images API) + aspect ratio + daily limit
========================= */
app.post("/api/image", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "default");
    const userPrompt = String(req.body?.prompt || "").trim();

    if (!userPrompt) {
      return res.status(400).json({ error: "PROMPT_REQUIRED" });
    }

    const productDataUrl = productImageBySession[sessionId];
    if (!productDataUrl) {
      return res.status(400).json({
        error: "NO_PRODUCT_IMAGE",
        message: "Upload product image first.",
      });
    }

    // ✅ daily limit 2 per session
    const usage = ensureDailyUsage(sessionId);
    if (usage.count >= 2) {
      return res.status(403).json({
        error: "LIMIT_REACHED",
        message: "Your daily limit of 2 photos has been reached",
      });
    }

    const aspect = req.body?.aspect === "9:16" ? "9:16" : "16:9";
    const size = aspect === "9:16" ? "1024x1792" : "1792x1024";

    const strictPrompt = `
You are performing a PRODUCT-LOCKED EDIT.

ABSOLUTE RULES:
- Use the EXACT product in the provided image.
- Do NOT replace the product.
- Do NOT change shape, color, logo, or proportions.
- Only modify environment, background, lighting, styling.
- Maintain realism and correct perspective.
- This is an image edit, not new product generation.

User request:
${userPrompt}

Output framing:
- Match aspect ratio exactly: ${aspect}
`.trim();

    const parsed = dataUrlToBuffer(productDataUrl);
    if (!parsed) {
      return res.status(400).json({
        error: "INVALID_IMAGE",
        message: "Invalid product image format.",
      });
    }

    const productFile = await toFile(parsed.buf, "product.png", {
      type: parsed.mime,
    });

    // ✅ Images API (supports size)
    const img = await client.images.edit({
  model: "dall-e-2",
      image: productFile,
      prompt: strictPrompt,
      size,
      response_format: "b64_json",
    });

    const b64 = img?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: "NO_IMAGE_RETURNED" });
    }

    // ✅ increment only after success
    usage.count += 1;

    return res.json({ b64, aspect, size });
  } catch (error) {
    console.error("IMAGE ERROR:", error);
    return res.status(500).json({
      error: "IMAGE_ERROR",
      message: String(error?.message || error),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI SERVER RUNNING http://localhost:" + PORT));