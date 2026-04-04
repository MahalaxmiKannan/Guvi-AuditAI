import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 8080);
const ENDPOINT_API_KEY = process.env.ENDPOINT_API_KEY || process.env.X_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

function fail(res, code, message) {
  return res.status(code).json({ error: message });
}

function resolveMimeType(candidateMimeType, fileName = "") {
  const lowered = String(candidateMimeType || "").toLowerCase();
  if (lowered.startsWith("audio/")) {
    return lowered;
  }

  const ext = String(fileName).split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "ogg":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
    default:
      return lowered || "audio/mpeg";
  }
}

function normalizeAnalysis(payload) {
  const sop = payload?.sop_validation || {};
  const analytics = payload?.analytics || {};
  const transcript = String(payload?.transcript || "").trim();
  const summary = String(payload?.summary || "").trim();

  const normalized = {
    transcript,
    summary,
    sop_validation: {
      greeting: Boolean(sop.greeting),
      identification: Boolean(sop.identification),
      problemStatement: Boolean(sop.problemStatement),
      solutionOffering: Boolean(sop.solutionOffering),
      closing: Boolean(sop.closing),
      complianceScore: Number.isFinite(Number(sop.complianceScore)) ? Number(sop.complianceScore) : 0,
      adherenceStatus: sop.adherenceStatus === "FOLLOWED" ? "FOLLOWED" : "NOT_FOLLOWED",
      explanation: String(sop.explanation || "SOP validation completed."),
    },
    analytics: {
      paymentPreference: ["EMI", "FULL_PAYMENT", "PARTIAL_PAYMENT", "DOWN_PAYMENT"].includes(analytics.paymentPreference)
        ? analytics.paymentPreference
        : "PARTIAL_PAYMENT",
      rejectionReason: ["HIGH_INTEREST", "BUDGET_CONSTRAINTS", "ALREADY_PAID", "NOT_INTERESTED", "NONE"].includes(
        analytics.rejectionReason,
      )
        ? analytics.rejectionReason
        : "NONE",
      sentiment: String(analytics.sentiment || "Neutral"),
    },
    keywords: Array.isArray(payload?.keywords)
      ? payload.keywords.map((k) => String(k)).filter(Boolean).slice(0, 10)
      : [],
  };

  while (normalized.keywords.length < 10) {
    normalized.keywords.push(`keyword_${normalized.keywords.length + 1}`);
  }

  return normalized;
}

function pickAudioFromRequest(req) {
  if (Array.isArray(req.files) && req.files.length > 0) {
    const found = req.files.find((f) => f.mimetype?.startsWith("audio/")) || req.files[0];
    if (found?.buffer?.length) {
      return {
        mimeType: resolveMimeType(found.mimetype, found.originalname),
        base64: found.buffer.toString("base64"),
      };
    }
  }

  const body = req.body || {};
  const candidates = [
    body.audio,
    body.audioBase64,
    body.audio_base64,
    body.base64,
    body.voice,
    body.voiceInput,
    body.voice_input,
    body.file,
    body?.input?.audio,
    body?.data?.audio,
  ];

  for (const item of candidates) {
    if (!item) continue;
    if (typeof item === "string") {
      const dataUrlMatch = item.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (dataUrlMatch) {
        return { mimeType: dataUrlMatch[1], base64: dataUrlMatch[2] };
      }
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(item)) {
        return {
          mimeType: resolveMimeType(body.mimeType || body.mime_type || body.fileName || body.filename, body.fileName || body.filename),
          base64: item.replace(/\s/g, ""),
        };
      }
    }
  }

  return null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/call-compliance", upload.any(), async (req, res) => {
  const apiKey = req.header("x-api-key");
  if (!ENDPOINT_API_KEY) {
    return fail(res, 500, "Server missing ENDPOINT_API_KEY configuration");
  }
  if (!apiKey || apiKey !== ENDPOINT_API_KEY) {
    return fail(res, 401, "Invalid x-api-key");
  }
  if (!GEMINI_API_KEY) {
    return fail(res, 500, "Server missing GEMINI_API_KEY configuration");
  }

  try {
    const audio = pickAudioFromRequest(req);
    if (!audio) {
      return fail(res, 400, "No audio input found in request");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const prompt = `You are a call center quality auditor.
Return only JSON with these top-level fields exactly:
transcript, summary, sop_validation, analytics, keywords.

Rules:
- sop_validation must include greeting, identification, problemStatement, solutionOffering, closing, complianceScore, adherenceStatus, explanation.
- complianceScore is from 0.0 to 1.0.
- adherenceStatus is FOLLOWED only when complianceScore is 1.0 else NOT_FOLLOWED.
- analytics.paymentPreference must be one of EMI, FULL_PAYMENT, PARTIAL_PAYMENT, DOWN_PAYMENT.
- analytics.rejectionReason must be one of HIGH_INTEREST, BUDGET_CONSTRAINTS, ALREADY_PAID, NOT_INTERESTED, NONE.
- keywords must contain exactly 10 short strings.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.base64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    const normalized = normalizeAnalysis(parsed);

    return res.status(200).json(normalized);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown server error";
    return fail(res, 500, msg);
  }
});

const distPath = path.join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
