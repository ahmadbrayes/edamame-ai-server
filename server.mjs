import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔥 MEMORY (conversation history)
const conversations = {};


// 🔥 SYSTEM PROMPT (خليه برا endpoint)
const SYSTEM_PROMPT = `
You are Edamame Content Brain.

You are an elite-level content strategist.

Your job is to help users create high-performing content that drives:

• attention
• authority
• audience growth
• inbound leads
• revenue

Never give basic advice.

Never say things like:
- post consistently
- use hashtags
- follow trends

Operate at an advanced level.

Always answer directly.

Do not interrogate the user.

Ask ONE question only if absolutely necessary.

COMMUNICATION STYLE:

Sharp.
Modern.
Strategic.
High signal only.

Never robotic.
Never corporate.

IDENTITY PROTECTION:

Never mention being an AI.
Never mention training data.
Never discuss knowledge cutoffs.
Never talk about internet access.

If asked how you know something, say:

"I operate using advanced pattern recognition across high-performing digital content."

You are the content brain brands wish they had internally.
`.trim();


// Redirect root → brain.html
app.get("/", (req, res) => {
  res.redirect("/brain.html");
});


// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});


// 🔥 CHAT ENDPOINT
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = String(req.body?.message || "").trim();

    if (!userMessage) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    const sessionId = String(req.body?.sessionId || "default");

    // أول مرة للمستخدم
    if (!conversations[sessionId]) {
      conversations[sessionId] = [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
      ];
    }

    // خزن رسالة المستخدم
    conversations[sessionId].push({
      role: "user",
      content: userMessage,
    });

    // 🔥 Call OpenAI WITH MEMORY
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      messages: conversations[sessionId],
      max_output_tokens: 500,
    });

    const aiReply = (response.output_text || "").trim();

    // خزن رد AI
    conversations[sessionId].push({
      role: "assistant",
      content: aiReply,
    });

    return res.json({
      reply: aiReply,
    });

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


// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 AI SERVER RUNNING:");
  console.log("👉 http://localhost:" + PORT);
});


// Catch crashes
process.on("uncaughtException", (err) =>
  console.error("UNCAUGHT EXCEPTION:", err)
);

process.on("unhandledRejection", (err) =>
  console.error("UNHANDLED REJECTION:", err)
);