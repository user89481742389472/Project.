import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Determines if an error or finish reason is related to safety/policy refusal
function isRefusalOrSafety(errOrText: any): boolean {
  if (!errOrText) return false;
  const raw = String(errOrText.message || errOrText).toLowerCase();
  return (
    raw.includes("safety") ||
    raw.includes("blocked") ||
    raw.includes("prohibited") ||
    raw.includes("policy") ||
    raw.includes("harm") ||
    raw.includes("content_filter") ||
    raw.includes("finish_reason") ||
    raw.includes("refusal") ||
    raw.includes("cannot assist") ||
    raw.includes("unable to assist") ||
    raw.includes("i cannot") ||
    raw.includes("not allowed") ||
    raw.includes("inappropriate")
  );
}

// Clean error message parser
function parseErrorMessage(err: any): string {
  if (!err) return "An unknown error occurred.";
  const raw = String(err.message || err);

  if (isRefusalOrSafety(err)) {
    return "I am sorry, but I cannot assist with that request.";
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed?.error?.message) {
        try {
          const inner = JSON.parse(parsed.error.message);
          if (inner?.error?.message) {
            const innerMsg = inner.error.message;
            if (isRefusalOrSafety(innerMsg)) {
              return "I am sorry, but I cannot assist with that request.";
            }
            return innerMsg;
          }
        } catch {
          // ignore nested parse failure
        }
        if (isRefusalOrSafety(parsed.error.message)) {
          return "I am sorry, but I cannot assist with that request.";
        }
        return parsed.error.message;
      }
    }
  } catch {
    // ignore parse error
  }

  if (raw.includes("503") || raw.includes("high demand") || raw.includes("UNAVAILABLE")) {
    return "The AI service is experiencing high demand right now. Please try again in a moment.";
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED") || raw.includes("quota")) {
    return "Rate limit reached. Please wait a brief moment before sending another message.";
  }
  if (raw.includes("API_KEY") || raw.includes("403") || raw.includes("PERMISSION_DENIED")) {
    return "Invalid or unconfigured API key. Please check your settings.";
  }

  return raw;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Chat API
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, model: requestedModel } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Missing or invalid messages array" });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is not configured on the server. Please add your key in Settings > Secrets.",
        });
      }

      const ai = getAI();

      // Format messages into Gemini contents format
      const rawContents: { role: "user" | "model"; parts: any[] }[] = [];

      for (const m of messages) {
        const role = m.role === "assistant" || m.role === "model" ? "model" : "user";
        const parts: any[] = [];

        if (m.images && Array.isArray(m.images) && m.images.length > 0) {
          for (const img of m.images) {
            if (img && img.data) {
              const base64Data = img.data.includes("base64,")
                ? img.data.split("base64,")[1]
                : img.data;
              if (base64Data) {
                parts.push({
                  inlineData: {
                    mimeType: img.mimeType || "image/jpeg",
                    data: base64Data,
                  },
                });
              }
            }
          }
        }

        const textContent = (m.content || "").trim();
        if (textContent || parts.length === 0) {
          parts.push({ text: textContent || (parts.length > 0 ? "Analyze this image" : " ") });
        }

        if (parts.length > 0) {
          rawContents.push({ role, parts });
        }
      }

      // Ensure contents starts with a 'user' role
      while (rawContents.length > 0 && rawContents[0].role !== "user") {
        rawContents.shift();
      }

      if (rawContents.length === 0) {
        return res.status(400).json({ error: "No user messages provided" });
      }

      // Merge consecutive identical roles for strict turn alternation
      const formattedContents: { role: "user" | "model"; parts: any[] }[] = [];
      for (const item of rawContents) {
        if (formattedContents.length > 0 && formattedContents[formattedContents.length - 1].role === item.role) {
          formattedContents[formattedContents.length - 1].parts.push(...item.parts);
        } else {
          formattedContents.push(item);
        }
      }

      // Set headers for Server-Sent Events
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      let streamSuccess = false;
      let totalTextSent = 0;
      let modelUsed = requestedModel || "gemini-3.7-flash";

      // Priority list based on user's chosen model
      const preferredModel = (typeof requestedModel === "string" && requestedModel.trim()) || "gemini-3.7-flash";
      const candidateModels = [
        preferredModel,
        "gemini-3.7-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
      ].filter((m, idx, arr) => arr.indexOf(m) === idx);

      for (const model of candidateModels) {
        try {
          const responseStream = await ai.models.generateContentStream({
            model,
            contents: formattedContents,
          });

          for await (const chunk of responseStream) {
            const candidate = chunk.candidates?.[0];
            const finishReason = candidate?.finishReason;

            if (finishReason && finishReason !== "STOP" && isRefusalOrSafety(finishReason)) {
              const refusal = totalTextSent === 0 ? "I am sorry, but I cannot assist with that request." : "\n\n[Response stopped by safety filter]";
              res.write(`data: ${JSON.stringify({ text: refusal, model })} \n\n`);
              (res as any).flush?.();
              totalTextSent += refusal.length;
              streamSuccess = true;
              modelUsed = model;
              break;
            }

            const text = chunk.text || "";
            if (text) {
              res.write(`data: ${JSON.stringify({ text, model })}\n\n`);
              (res as any).flush?.();
              totalTextSent += text.length;
              streamSuccess = true;
              modelUsed = model;
            }
          }

          if (streamSuccess || totalTextSent > 0) {
            break; // Finished successfully with this model
          }
        } catch (modelErr: any) {
          console.warn(`Model ${model} stream error:`, modelErr?.message || modelErr);
          if (isRefusalOrSafety(modelErr)) {
            const refusalMsg = "I am sorry, but I cannot assist with that request.";
            res.write(`data: ${JSON.stringify({ text: refusalMsg, model })}\n\n`);
            (res as any).flush?.();
            totalTextSent += refusalMsg.length;
            streamSuccess = true;
            modelUsed = model;
            break;
          }
          // If already sent some text, don't try next model to avoid duplicate response starts
          if (totalTextSent > 0) {
            break;
          }
        }
      }

      // If streaming produced no text, try a non-streaming fallback
      if (totalTextSent === 0) {
        try {
          const directResponse = await ai.models.generateContent({
            model: preferredModel,
            contents: formattedContents,
          });

          const directText = directResponse.text || "";
          if (directText) {
            res.write(`data: ${JSON.stringify({ text: directText, model: preferredModel })}\n\n`);
            (res as any).flush?.();
            totalTextSent += directText.length;
          } else {
            const fallbackRefusal = "I am sorry, but I cannot assist with that request.";
            res.write(`data: ${JSON.stringify({ text: fallbackRefusal, model: preferredModel })}\n\n`);
            (res as any).flush?.();
            totalTextSent += fallbackRefusal.length;
          }
        } catch (fallbackErr: any) {
          const isRefusal = isRefusalOrSafety(fallbackErr);
          const cleanMsg = isRefusal
            ? "I am sorry, but I cannot assist with that request."
            : parseErrorMessage(fallbackErr);

          if (isRefusal) {
            res.write(`data: ${JSON.stringify({ text: cleanMsg, model: preferredModel })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
          }
          (res as any).flush?.();
        }
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Chat API top-level error:", error);
      const isRefusal = isRefusalOrSafety(error);
      const cleanMessage = isRefusal
        ? "I am sorry, but I cannot assist with that request."
        : parseErrorMessage(error);

      if (!res.headersSent) {
        if (isRefusal) {
          res.json({ text: cleanMessage });
        } else {
          res.status(500).json({ error: cleanMessage });
        }
      } else {
        if (isRefusal) {
          res.write(`data: ${JSON.stringify({ text: cleanMessage })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ error: cleanMessage })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
