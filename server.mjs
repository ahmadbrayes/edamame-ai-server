import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => res.redirect("/brain.html"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const conversations = {};
const productImageBySession = {};
const imageUsage = {}; // ✅ limit per session (does NOT reset on upload)

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

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

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

    // ✅ DO NOT reset imageUsage here anymore
    if (typeof imageUsage[sessionId] !== "number") imageUsage[sessionId] = 0;

    return res.json({
      ok: true,
      used: imageUsage[sessionId],
      remaining: Math.max(0, 2 - imageUsage[sessionId]),
    });
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
   3) Image Generation (16:9 / 9:16)
========================= */
app.post("/api/image", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "default");
    const userPrompt = String(req.body?.prompt || "").trim();

    // ✅ aspect from frontend (default 16:9)
    const aspect = req.body?.aspect === "9:16" ? "9:16" : "16:9";
    const size = aspect === "9:16" ? "1024x1792" : "1792x1024";

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

    if (typeof imageUsage[sessionId] !== "number") imageUsage[sessionId] = 0;

    // ✅ limit 2 per session total (not reset on upload)
    if (imageUsage[sessionId] >= 2) {
      return res.status(403).json({
        error: "LIMIT_REACHED",
        message: "your daily limit of 2 photos has been reached",
        used: imageUsage[sessionId],
        remaining: 0,
      });
    }

    const strictPrompt = `
You are performing a PRODUCT-LOCKED EDIT.

ABSOLUTE RULES:
- Use the EXACT product in the provided image.
- Do NOT replace the product.
- Do NOT change shape, color, logo, or proportions.
- Only modify environment, background, lighting, styling.
- Maintain realism and correct perspective.
- This is an image edit, not new product generation.

OUTPUT REQUIREMENT:
- Aspect ratio MUST be ${aspect}.

User request:
${userPrompt}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "image_generation" }],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: strictPrompt },
            { type: "input_image", image_url: productDataUrl },
          ],
        },
      ],
      // ✅ enforce size (if supported by your SDK; if not, the prompt still pushes aspect)
      size,
    });

    const imageCall = (response.output || []).find(
      (x) => x.type === "image_generation_call"
    );

    const b64 = imageCall?.result;

    if (!b64) {
      return res.status(500).json({ error: "NO_IMAGE_RETURNED" });
    }

    // ✅ increment only after success
    imageUsage[sessionId]++;

    return res.json({
      b64,
      used: imageUsage[sessionId],
      remaining: Math.max(0, 2 - imageUsage[sessionId]),
      aspect,
      size,
    });
  } catch (error) {
    console.error("IMAGE ERROR:", error);
    return res.status(500).json({
      error: "IMAGE_ERROR",
      message: String(error?.message || error),
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("AI SERVER RUNNING http://localhost:" + PORT);
});