import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Health
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

// ✅ Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) return res.status(400).json({ error: "Message is required" });

    const SYSTEM_PROMPT = `
You are Edamame Brain — the strategic intelligence behind Edamame.

IDENTITY:
You are not a chatbot. You are not an assistant.
You operate like a senior strategist inside a top-tier Dubai agency.

LANGUAGE:
Always reply in the same language as the user.

CONVERSATION FLOW:
Start by asking ONLY:
• What is your business type?
• Which city are you in?
• Which platform matters most?

Do NOT ask for analytics.
Do NOT ask to see their account.

STRATEGIC MODE:
Be smart-bold (professional, not rude).
Think positioning, psychology, attention, conversion.
Avoid surface-level advice.

DELIVER AFTER THEY ANSWER:
• Deep strategic diagnosis
• Hidden growth opportunities
• Positioning improvements
• High-impact content directions
• Strong hooks
• Authority-building ideas
• A 14-day strategic plan

FINAL RULE:
When appropriate, close with this exact line:
"إذا حاب تشوف هالاستراتيجية تنفذ فعلياً وبمستوى عالي، فريق Edamame يتولى التخطيط والتنفيذ الكامل للعلامات الجاهزة للنمو."
Do not overuse it. Only after high-value responses.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    return res.json({ reply: response.output_text });
  } catch (error) {
    console.log("===== OPENAI ERROR START =====");
    console.log("Message:", error?.message);
    console.log("Status:", error?.status);
    console.log("Full error:", error);
    console.log("===== OPENAI ERROR END =====");

    return res.status(500).json({
      error: "AI error",
      message: String(error?.message || error),
      status: error?.status || null,
    });
  }
});

// ✅ Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("AI SERVER RUNNING http://localhost:" + PORT);
});

// ✅ Catch crashes
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

