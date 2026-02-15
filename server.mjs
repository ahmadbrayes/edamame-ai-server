import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));
app.get("/", (req, res) => {
  res.redirect("/brain.html");
});


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
You are Edamame Brain.

LANGUAGE:
English only.

NON-NEGOTIABLE RULES:
1) ALWAYS give a useful answer first. Never respond with only questions.
2) Ask at most ONE follow-up question per reply.
3) If info is missing, make reasonable assumptions and label them as "Assumptions".
4) Keep it practical: examples > theory.

STYLE:
- Human, direct, premium.
- No cringe, no lectures, no generic advice.

RESPONSE TEMPLATE (use this almost always):
A) Quick answer (what to do right now) — 3 to 7 bullets
B) Examples (hooks / captions / angles) — 5 to 10 items
C) One question (ONLY if needed) — 1 line

STRATEGY QUALITY:
Diagnose the real bottleneck (positioning / offer / content / distribution / conversion) and give concrete next steps.

BOUNDARY:
Never claim you can view their social accounts or analytics.

SOFT CTA (only after strong value, occasionally):
"If you want this executed at a high level, Edamame can handle strategy and full execution for brands ready to grow."

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





