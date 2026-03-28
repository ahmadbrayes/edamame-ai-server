import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
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

/* =========================
   Config
========================= */
const PORT = process.env.PORT || 3000;

const ALLOWED_ASPECTS = new Set([
  "1:1",
  "4:5",
  "9:16",
  "16:9",
]);

function normalizeAspect(value) {
  const aspect = String(value || "").trim();
  return ALLOWED_ASPECTS.has(aspect) ? aspect : "4:5";
}

/* =========================
   Chat
========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    if (!conversations[sessionId]) {
      conversations[sessionId] = [
        {
          role: "system",
          content: `
You are Edamame Brain.

- Give sharp content strategies
- Create content calendars
- Give ideas that drive revenue
- No fluff
`,
        },
      ];
    }

    conversations[sessionId].push({
      role: "user",
      content: message,
    });

    const response = await openaiClient.responses.create({
      model: "gpt-4.1-mini",
      input: conversations[sessionId],
      temperature: 0.7,
    });

    const reply = response.output_text || "No reply";

    conversations[sessionId].push({
      role: "assistant",
      content: reply,
    });

    return res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "CHAT_ERROR" });
  }
});

/* =========================
   Upload Product
========================= */
app.post("/api/product", (req, res) => {
  try {
    const { sessionId, imageDataUrl } = req.body;

    if (!imageDataUrl?.startsWith("data:image/")) {
      return res.status(400).json({ error: "Invalid image" });
    }

    productImageBySession[sessionId] = imageDataUrl;

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "UPLOAD_ERROR" });
  }
});

/* =========================
   Gemini Image
========================= */
app.post("/api/image", async (req, res) => {
  try {
    const { sessionId, prompt, aspect } = req.body;

    const product = productImageBySession[sessionId];
    if (!product) {
      return res.status(400).json({
        error: "Upload product first",
      });
    }

    const requestedAspect = normalizeAspect(aspect);

    const base64 = product.split(",")[1];

    const fullPrompt = `
Edit this real product image.

RULES:
- Keep product identical
- Do NOT change logo
- Do NOT change text
- Do NOT redesign product

DO:
- Improve background
- Improve lighting subtly
- Keep it realistic and premium

User request:
${prompt}
`;

    const response = await googleClient.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { text: fullPrompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: base64,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: {
          aspectRatio: requestedAspect,
        },
      },
    });

    let image = null;

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        image = part.inlineData.data;
      }
    }

    res.json({ b64: image });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "IMAGE_ERROR" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
