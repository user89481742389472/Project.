import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

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

  if (raw.includes("API_KEY_INVALID") || raw.includes("API key not valid") || raw.includes("400") && raw.includes("API_KEY")) {
    return "API key is not valid. Please check your key from Google AI Studio and ensure there are no extra spaces.";
  }
  if (raw.includes("503") || raw.includes("high demand") || raw.includes("UNAVAILABLE")) {
    return "The AI service is experiencing high demand right now. Please try again in a moment.";
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED") || raw.includes("quota")) {
    return "Rate limit or quota exhausted on this API key. Please check your Google AI Studio account.";
  }
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED")) {
    return "Permission denied for this API key. Make sure the Generative Language API is enabled on your project.";
  }

  return raw;
}

// List of fallback chains to ensure compatibility across all Google AI Studio account tiers
const MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  "gemini-3.7-flash": ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
  "gemini-3.5-flash": ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
  "gemini-3.1-flash-lite": ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.7-flash"],
  "gemini-flash-latest": ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.7-flash", "gemini-3.5-flash"],
};

const DEFAULT_FALLBACK_LIST = [
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Key Validation API Endpoint
  app.post("/api/validate-key", async (req, res) => {
    try {
      const authHeader = (req.headers["x-gemini-api-key"] as string) || "";
      const bodyKey = req.body?.apiKey || "";
      const rawKey = (authHeader || bodyKey || process.env.GEMINI_API_KEY || "").trim();

      if (!rawKey) {
        return res.status(400).json({
          valid: false,
          error: "No API key provided. Please enter a valid Gemini API key.",
        });
      }

      // Quick sanity check on format
      if (rawKey.length < 20) {
        return res.status(400).json({
          valid: false,
          error: "API key format appears invalid (too short).",
        });
      }

      // Initialize client with user key
      const ai = new GoogleGenAI({ apiKey: rawKey });

      // Test against the fastest lightweight models in parallel with a fast abort race
      const fastModelsToTest = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.7-flash"];

      // Check models with Promise.any so the first successful response validates immediately
      const validatePromises = fastModelsToTest.map(async (model) => {
        try {
          const testResp = await ai.models.generateContent({
            model,
            contents: "hi",
          });
          if (testResp) {
            return { valid: true, model };
          }
          throw new Error("Empty response");
        } catch (err: any) {
          const parsed = parseErrorMessage(err);
          // If the model responded with safety/policy/refusal or even 429 quota reached, the key is authentic!
          if (
            isRefusalOrSafety(err) ||
            parsed.includes("cannot assist") ||
            parsed.includes("Rate limit or quota exhausted") ||
            parsed.includes("high demand")
          ) {
            return { valid: true, model };
          }
          throw err;
        }
      });

      // Wrap in a 5-second total timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Verification timed out. Check your connection or API key.")), 5000)
      );

      try {
        await Promise.race([
          Promise.any(validatePromises),
          timeoutPromise,
        ]);

        return res.json({ valid: true, message: "API key successfully verified." });
      } catch (raceErr: any) {
        // Collect errors if all failed
        let errMessage = "Could not verify API key with Google AI Studio.";
        if (raceErr?.errors && Array.isArray(raceErr.errors) && raceErr.errors.length > 0) {
          errMessage = parseErrorMessage(raceErr.errors[0]);
        } else if (raceErr?.message) {
          errMessage = parseErrorMessage(raceErr.message);
        }
        return res.status(400).json({
          valid: false,
          error: errMessage,
        });
      }
    } catch (error: any) {
      console.error("Key validation error:", error);
      return res.status(400).json({
        valid: false,
        error: parseErrorMessage(error),
      });
    }
  });

  // Chat API
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, model: requestedModel, useGoogleSearch } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Missing or invalid messages array" });
      }

      const authHeader = (req.headers["x-gemini-api-key"] as string) || "";
      const bodyKey = req.body?.apiKey || "";
      const rawKey = (authHeader || bodyKey || process.env.GEMINI_API_KEY || "").trim();

      if (!rawKey) {
        return res.status(401).json({
          error: "Gemini API key required. Please enter your personal Google Gemini API key.",
        });
      }

      const ai = new GoogleGenAI({ apiKey: rawKey });

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
      let lastStreamError: any = null;

      // Candidate models to iterate through if a specific one is unavailable
      const preferredModel = (typeof requestedModel === "string" && requestedModel.trim()) || "gemini-3.1-flash-lite";
      const modelChain = MODEL_FALLBACK_CHAINS[preferredModel] || [preferredModel];
      const candidateModels = Array.from(new Set([...modelChain, ...DEFAULT_FALLBACK_LIST]));

      for (const model of candidateModels) {
        try {
          lastStreamError = null;
          
          const requestConfig: any = {
            model,
            contents: formattedContents,
          };

          if (useGoogleSearch) {
            requestConfig.config = {
              tools: [{ googleSearch: {} }],
              systemInstruction: `The current date and time is ${new Date().toLocaleString()}. You must use the Google Search tool to browse the internet and find up-to-date, real-world information before answering the user's question, especially for tech releases. Never rely solely on your training data when asked about recent events.`,
            };
          }

          const responseStream = await ai.models.generateContentStream(requestConfig);

          for await (const chunk of responseStream) {
            const candidate = chunk.candidates?.[0];
            const finishReason = candidate?.finishReason;

            if (finishReason && finishReason !== "STOP" && isRefusalOrSafety(finishReason)) {
              const refusal = totalTextSent === 0 ? "I am sorry, but I cannot assist with that request." : "\n\n[Response stopped by safety filter]";
              res.write(`data: ${JSON.stringify({ text: refusal, model })}\n\n`);
              (res as any).flush?.();
              totalTextSent += refusal.length;
              streamSuccess = true;
              break;
            }

            const text = chunk.text || "";
            let chunkData: any = { text, model };
            
            if (candidate?.groundingMetadata?.groundingChunks) {
              chunkData.groundingSources = candidate.groundingMetadata.groundingChunks
                .map((g: any) => g.web)
                .filter((w: any) => w && w.uri && w.title);
            }

            if (text || chunkData.groundingSources) {
              res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
              (res as any).flush?.();
              totalTextSent += text.length;
              streamSuccess = true;
            }
          }

          if (streamSuccess || totalTextSent > 0) {
            break; // Finished successfully
          }
        } catch (modelErr: any) {
          if (!lastStreamError) {
            lastStreamError = modelErr;
          }
          if (isRefusalOrSafety(modelErr)) {
            const refusalMsg = "I am sorry, but I cannot assist with that request.";
            res.write(`data: ${JSON.stringify({ text: refusalMsg, model })}\n\n`);
            (res as any).flush?.();
            totalTextSent += refusalMsg.length;
            streamSuccess = true;
            break;
          }
          if (totalTextSent > 0) {
            break;
          }
          // Continue to next candidate model
        }
      }

      // If streaming produced no text and had no success, emit the last error
      if (totalTextSent === 0 && !streamSuccess) {
        const isRefusal = isRefusalOrSafety(lastStreamError);
        const cleanMsg = isRefusal
          ? "I am sorry, but I cannot assist with that request."
          : parseErrorMessage(lastStreamError || "All AI models returned empty responses.");

        if (isRefusal) {
          res.write(`data: ${JSON.stringify({ text: cleanMsg, model: preferredModel })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
        }
        (res as any).flush?.();
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
