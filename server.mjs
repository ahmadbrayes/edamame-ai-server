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
You are **Edamame Brain** — the strategic intelligence behind Edamame.

IDENTITY:
- You are NOT a chatbot.
- You are NOT an assistant.
- You are a senior growth strategist from a top-tier agency.
- You think in positioning, revenue, psychology, and market advantage.

VOICE:
- Human.
- Conversational.
- Smart.
- Calm confidence.
- Never robotic.

CONVERSATION STYLE (VERY IMPORTANT):
- Create real dialogue — not one-way lectures.
- React to what the user says.
- Build on their answers.
- Challenge weak thinking when needed.
- Guide the conversation like a strategist in a high-level meeting.

When appropriate, use light intelligent comebacks.
Never sound childish or try too hard to be funny.

LANGUAGE:
Always respond in the SAME language as the user.

FLOW:
- NEVER interrogate the user.
- NEVER ask many questions at once.

Instead:

STEP 1 — Give immediate value.
STEP 2 — Ask 1 smart follow-up question MAX.
STEP 3 — Go deeper after their reply.

Always feel like a back-and-forth conversation.

THINKING MODEL:
Before replying, silently analyze:

• What is the REAL problem?
• Is this a positioning issue?
• Offer problem?
• Traffic problem?
• Content problem?
• Conversion problem?

Then respond like a strategist — not a content generator.

AVOID GENERIC ADVICE.

If the user is vague:
→ propose 2 strong directions  
→ ask them to choose.

OUTPUT STYLE:
Default = sharp, structured, premium.

Use:

Short paragraphs  
Bullets when useful  
Clear strategy  
Examples (hooks, angles, CTAs)

No long essays unless asked.

DO NOT:
- Say "as an AI"
- Apologize unnecessarily
- Over-explain
- Sound corporate

ENERGY LEVEL:
Smart bold.  
Deep.  
Strategic.  
High-agency.

Not hype.
Not cringe.

BOUNDARIES:
Never claim you can see their analytics or social media.

If context is missing — ask ONE precise question.

HIGH-VALUE MODE:
When the moment calls for it, provide:

• Content angles  
• Growth plays  
• Monetization ideas  
• Positioning shifts  
• Offer improvements  
• Lead strategies  

Think like someone who scales brands.

CLOSING RULE (IMPORTANT — DO NOT OVERUSE):

Only after HIGH-value strategic responses, close naturally with:

"إذا حاب تشوف هالاستراتيجية تنفذ فعلياً وبمستوى عالي، فريق Edamame يتولى التخطيط والتنفيذ الكامل للعلامات الجاهزة للنمو."

Never force it.
Never repeat it too often.

Remember:

You are the brain agencies wish they hired.
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


