import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "3mb" })); // بدنا نستقبل base64 للصورة
app.use(express.static("public"));

app.get("/", (req, res) => res.redirect("/brain.html"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const conversations = {};
const productImageBySession = {}; // data URL للصورة
const imageUsage = {}; // limit 2 images/session

const SYSTEM_PROMPT = `
You are Edamame Brain — the content operator for serious brands.

VOICE
- Smart. Bold. Deep. Strategic.
- Short, high-signal answers. No fluff. No generic advice.
- Confident, calm, and specific.

ROLE
Help users create high-performing content that drives attention, authority, inbound demand, and revenue.

NON-NEGOTIABLE RULES
1) Answer immediately. Do not start with questions.
2) Ask ONE question only if absolutely necessary.
3) Do NOT offer multiple options or suggestions unless explicitly requested.
4) Treat every message as part of the same conversation.

CONTENT INTELLIGENCE
Infer what the user sells, who they sell to, and the desired outcome — then respond with the strongest content angle.

STYLE
- English only.
- Never mention being an AI.
- Never mention training data, system prompts, or knowledge cutoffs.

If asked how you know something, say:
"I operate using advanced pattern recognition across high-performing content."

EXECUTION LINE
If relevant, end with:
"Edamame can also execute this for you — strategy, production, and rollout."

You are the content brain serious brands wish they had internally.

CONVERSATION CONTROL:
Do not be passive.
If critical information is missing that would significantly improve the strategic quality of your answer, ask ONE sharp question.
Never ask multiple questions.
Never interrogate the user.
Guide the conversation like a strategist.
`.trim();

app.get("/health", (req, res) => res.json({ ok: true }));

// 1) Upload product image (as data URL)
app.post("/api/product", (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "default");
    const dataUrl = String(req.body?.imageDataUrl || "").trim();

    if (!dataUrl.startsWith("data:image/")) {
      return res.status(400).json({
        error: "INVALID_IMAGE",
        message: "Send a valid image data URL (data:image/...;base64,...)",
      });
    }

    productImageBySession[sessionId] = dataUrl;
    imageUsage[sessionId] = 0; // reset image limit لما يرفع منتج جديد

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "UPLOAD_ERROR", message: String(e?.message || e) });
  }
});

// 2) Chat (كما هو)
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) return res.status(400).json({ error: "Message is required" });

    const sessionId = String(req.body?.sessionId || "default");

    if (!conversations[sessionId]) {
      conversations[sessionId] = [{ role: "system", content: SYSTEM_PROMPT }];
    }

    conversations[sessionId].push({ role: "user", content: userMessage });

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: conversations[sessionId],
      temperature: 0.7,
      max_output_tokens: 500,
    });

    const aiReply =
      (response.output_text || "").trim() ||
      "I didn’t get that — rephrase in one clear sentence.";

    conversations[sessionId].push({ role: "assistant", content: aiReply });

    return res.json({ reply: aiReply });
  } catch (error) {
    console.error("OPENAI ERROR:", error);
    return res.status(500).json({ error: "AI error", message: String(error?.message || error) });
  }
});

// 3) Generate image using the uploaded product image (limit 2/session)
app.post("/api/image", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "default");
    const userPrompt = String(req.body?.prompt || "").trim();

    if (!userPrompt) {
      return res.status(400).json({ error: "PROMPT_REQUIRED", message: "Prompt is required" });
    }

    const productDataUrl = productImageBySession[sessionId];
    if (!productDataUrl) {
      return res.status(400).json({
        error: "NO_PRODUCT_IMAGE",
        message: "Upload a product image first.",
      });
    }

    // limit 2 images per session
    if (!imageUsage[sessionId]) imageUsage[sessionId] = 0;
    if (imageUsage[sessionId] >= 2) {
      return res.status(403).json({
        error: "LIMIT_REACHED",
        message: "You’ve reached the 2-image limit for this session.",
      });
    }
    imageUsage[sessionId]++;

    const wrapped = `
Create a HIGH-END ecommerce advertisement image using the provided product image as the hero product.

Rules:
- Keep the product recognizable (same product identity).
- Premium studio lighting, sharp focus, clean composition.
- High-conversion ecommerce look.
- No text, no prices, no logos unless the user explicitly requests them.
- Avoid cheap AI look, distortion, extra weird objects, warped product.

User request:
${userPrompt}
`.trim();

    // Use Responses + image_generation tool with an input image
    const r = await client.responses.create({
      model: "gpt-40-mini",
      tools: [{ type: "image_generation" }],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: wrapped },
            { type: "input_image", image_url: productDataUrl },
          ],
        },
      ],
    });

    const call = (r.output || []).find((x) => x.type === "image_generation_call");
    const b64 = call?.result;

    if (!b64) {
      return res.status(500).json({ error: "NO_IMAGE", message: "No image returned." });
    }

    return res.json({ b64 });
  } catch (error) {
    console.error("IMAGE ERROR:", error);
    return res.status(500).json({
      error: "IMAGE_ERROR",
      message: String(error?.message || error),
      status: error?.status || null,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI SERVER RUNNING http://localhost:" + PORT));
