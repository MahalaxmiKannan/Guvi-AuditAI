/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  FileText,
  CheckCircle2,
  XCircle,
  BarChart3,
  MessageSquare,
  Languages,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ChevronRight,
  CreditCard,
  Tag,
  Smile,
  Frown,
  Meh,
  History,
  Trash2,
  Clock,
  ChevronLeft,
  Download,
  FileDown,
  FileSpreadsheet,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Types based on the user's required JSON structure
interface SopValidation {
  greeting: boolean;
  identification: boolean;
  problemStatement: boolean;
  solutionOffering: boolean;
  closing: boolean;
  complianceScore: number;
  adherenceStatus: "FOLLOWED" | "NOT_FOLLOWED";
  explanation: string;
}

interface Analytics {
  paymentPreference:
    | "EMI"
    | "FULL_PAYMENT"
    | "PARTIAL_PAYMENT"
    | "DOWN_PAYMENT";
  rejectionReason:
    | "HIGH_INTEREST"
    | "BUDGET_CONSTRAINTS"
    | "ALREADY_PAID"
    | "NOT_INTERESTED"
    | "NONE";
  sentiment: string;
}

interface AnalysisResult {
  status: string;
  language: string;
  transcript: string;
  summary: string;
  sop_validation: SopValidation;
  analytics: Analytics;
  keywords: string[];
}

interface HistoryItem {
  id: string;
  timestamp: number;
  result: AnalysisResult;
}

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
]);

const getAudioMimeType = (file: File) => {
  if (file.type && SUPPORTED_AUDIO_MIME_TYPES.has(file.type)) {
    return file.type;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "webm":
      return "audio/webm";
    case "ogg":
      return "audio/ogg";
    default:
      return file.type || null;
  }
};

const getAnalysisErrorMessage = (err: unknown) => {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    if (message.includes("api key") || message.includes("permission")) {
      return "Gemini rejected the request. Check that VITE_GEMINI_API_KEY is valid and enabled for the Gemini API.";
    }

    if (message.includes("model") || message.includes("not found")) {
      return "Gemini model access failed. The selected model may be unavailable for your API key.";
    }

    if (message.includes("audio") || message.includes("mime")) {
      return "Gemini could not read the audio file. Try MP3 or WAV, or re-export the file with a standard codec.";
    }

    return err.message;
  }

  return "Failed to analyze due to an unexpected error.";
};

export default function App() {
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("Tamil (Tanglish)");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [inputType, setInputType] = useState<"text" | "audio">("text");
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem("audit_history");
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    localStorage.setItem("audit_history", JSON.stringify(history));
  }, [history]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const analyzeTranscript = async () => {
    if (inputType === "text" && !transcript.trim()) return;
    if (inputType === "audio" && !audioFile) return;

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      setError(
        "Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local and restart the dev server.",
      );
      return;
    }

    if (inputType === "audio" && audioFile) {
      const mimeType = getAudioMimeType(audioFile);
      if (!mimeType || !SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
        setError(
          "Unsupported audio format. Please upload an MP3, WAV, M4A, AAC, OGG, or WebM file.",
        );
        return;
      }
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-2.5-flash";

      let contents: any;

      if (inputType === "audio" && audioFile) {
        const base64Audio = await fileToBase64(audioFile);
        const mimeType = getAudioMimeType(audioFile);
        contents = {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || audioFile.type,
                data: base64Audio,
              },
            },
            {
              text: `
                You are a professional Call Center Quality Auditor and Business Intelligence Analyst.
                First, extract the full transcript from this audio file. The language is likely ${language}.
                Then, analyze the transcript between agents from "Guvi Institution" and customers.

                ANALYSIS TASK:
                1. Summarize the core conversation and outcome.
                2. Validate the 5 SOP stages: Greeting, Identification, Problem Statement, Solution Offering, and Closing.
                3. Categorize the customer's payment intent and rejection reason if applicable.
                4. Detect sentiment and 10 relevant business keywords related to upskilling, courses (like Mechanical CAD, Python, Data Science), or the institution.

                MANDATORY RULES:
                - Return the full extracted transcript in the "transcript" field of the JSON.
                - complianceScore must be a float between 0.0 and 1.0 (calculate as 0.2 for each 'true' SOP step).
                - adherenceStatus must be "FOLLOWED" if the score is 1.0, otherwise "NOT_FOLLOWED".
                - paymentPreference MUST be one of: [EMI, FULL_PAYMENT, PARTIAL_PAYMENT, DOWN_PAYMENT].
                - rejectionReason MUST be one of: [HIGH_INTEREST, BUDGET_CONSTRAINTS, ALREADY_PAID, NOT_INTERESTED, NONE].
                - Extract exactly 10 keywords.
              `,
            },
          ],
        };
      } else {
        contents = `
          You are a professional Call Center Quality Auditor and Business Intelligence Analyst.
          Your task is to analyze transcripts of calls (often in Hinglish or Tanglish) between agents from "Guvi Institution" and customers.

          INPUT DATA:
          Language: ${language}
          Transcript: "${transcript}"

          ANALYSIS TASK:
          1. Summarize the core conversation and outcome.
          2. Validate the 5 SOP stages: Greeting, Identification, Problem Statement, Solution Offering, and Closing.
          3. Categorize the customer's payment intent and rejection reason if applicable.
          4. Detect sentiment and 10 relevant business keywords related to upskilling, courses (like Mechanical CAD, Python, Data Science), or the institution.

          MANDATORY RULES:
          - complianceScore must be a float between 0.0 and 1.0 (calculate as 0.2 for each 'true' SOP step).
          - adherenceStatus must be "FOLLOWED" if the score is 1.0, otherwise "NOT_FOLLOWED".
          - paymentPreference MUST be one of: [EMI, FULL_PAYMENT, PARTIAL_PAYMENT, DOWN_PAYMENT].
          - rejectionReason MUST be one of: [HIGH_INTEREST, BUDGET_CONSTRAINTS, ALREADY_PAID, NOT_INTERESTED, NONE].
          - Extract exactly 10 keywords.
        `;
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING },
              language: { type: Type.STRING },
              transcript: { type: Type.STRING },
              summary: { type: Type.STRING },
              sop_validation: {
                type: Type.OBJECT,
                properties: {
                  greeting: { type: Type.BOOLEAN },
                  identification: { type: Type.BOOLEAN },
                  problemStatement: { type: Type.BOOLEAN },
                  solutionOffering: { type: Type.BOOLEAN },
                  closing: { type: Type.BOOLEAN },
                  complianceScore: { type: Type.NUMBER },
                  adherenceStatus: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: [
                  "greeting",
                  "identification",
                  "problemStatement",
                  "solutionOffering",
                  "closing",
                  "complianceScore",
                  "adherenceStatus",
                  "explanation",
                ],
              },
              analytics: {
                type: Type.OBJECT,
                properties: {
                  paymentPreference: { type: Type.STRING },
                  rejectionReason: { type: Type.STRING },
                  sentiment: { type: Type.STRING },
                },
                required: ["paymentPreference", "rejectionReason", "sentiment"],
              },
              keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              "status",
              "language",
              "transcript",
              "summary",
              "sop_validation",
              "analytics",
              "keywords",
            ],
          },
        },
      });

      const data = JSON.parse(response.text || "{}") as AnalysisResult;
      setResult(data);

      // Add to history
      const newHistoryItem: HistoryItem = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        result: data,
      };
      setHistory((prev) => [newHistoryItem, ...prev]);

      if (inputType === "audio") {
        setTranscript(data.transcript);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      setError(getAnalysisErrorMessage(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getSentimentIcon = (sentiment: string) => {
    const s = sentiment.toLowerCase();
    if (s.includes("positive") || s.includes("happy"))
      return <Smile className="w-5 h-5 text-green-500" />;
    if (
      s.includes("negative") ||
      s.includes("angry") ||
      s.includes("frustrated")
    )
      return <Frown className="w-5 h-5 text-red-500" />;
    return <Meh className="w-5 h-5 text-yellow-500" />;
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const selectHistoryItem = (item: HistoryItem) => {
    setResult(item.result);
    setTranscript(item.result.transcript);
    setLanguage(item.result.language);
    setShowHistory(false);
  };

  const exportToCSV = () => {
    if (!result) return;

    const headers = [
      "Language",
      "Compliance Score",
      "Adherence Status",
      "Greeting",
      "Identification",
      "Problem Statement",
      "Solution Offering",
      "Closing",
      "Payment Preference",
      "Rejection Reason",
      "Sentiment",
      "Summary",
    ];

    const row = [
      result.language,
      result.sop_validation.complianceScore,
      result.sop_validation.adherenceStatus,
      result.sop_validation.greeting,
      result.sop_validation.identification,
      result.sop_validation.problemStatement,
      result.sop_validation.solutionOffering,
      result.sop_validation.closing,
      result.analytics.paymentPreference,
      result.analytics.rejectionReason,
      result.analytics.sentiment,
      `"${result.summary.replace(/"/g, '""')}"`,
    ];

    const csvContent = [headers.join(","), row.join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `guvi_audit_${Date.now()}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToPDF = () => {
    if (!result) return;

    const doc = new jsPDF();
    const timestamp = new Date().toLocaleString();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(37, 99, 235); // Blue-600
    doc.text("Guvi AuditAI Report", 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(`Generated on: ${timestamp}`, 14, 28);
    doc.text(`Language: ${result.language}`, 14, 33);

    // Summary Section
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text("Executive Summary", 14, 45);

    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105); // Slate-600
    const splitSummary = doc.splitTextToSize(result.summary, 180);
    doc.text(splitSummary, 14, 52);

    // SOP Validation Table
    const sopData = [
      ["Greeting", result.sop_validation.greeting ? "PASSED" : "FAILED"],
      [
        "Identification",
        result.sop_validation.identification ? "PASSED" : "FAILED",
      ],
      [
        "Problem Statement",
        result.sop_validation.problemStatement ? "PASSED" : "FAILED",
      ],
      [
        "Solution Offering",
        result.sop_validation.solutionOffering ? "PASSED" : "FAILED",
      ],
      ["Closing", result.sop_validation.closing ? "PASSED" : "FAILED"],
      [
        "Compliance Score",
        `${(result.sop_validation.complianceScore * 100).toFixed(0)}%`,
      ],
      ["Adherence Status", result.sop_validation.adherenceStatus],
    ];

    autoTable(doc, {
      startY: 70,
      head: [["SOP Step", "Status"]],
      body: sopData,
      theme: "striped",
      headStyles: { fillColor: [37, 99, 235] },
    });

    // Business Intelligence Table
    const biData = [
      ["Payment Preference", result.analytics.paymentPreference],
      ["Rejection Reason", result.analytics.rejectionReason],
      ["Sentiment", result.analytics.sentiment],
    ];

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [["Metric", "Value"]],
      body: biData,
      theme: "grid",
      headStyles: { fillColor: [71, 85, 105] },
    });

    // Keywords
    const keywordsY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text("Keywords Detected", 14, keywordsY);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(result.keywords.join(", "), 14, keywordsY + 7);

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(
        `Guvi Institution - Confidential Quality Audit Report - Page ${i}`,
        14,
        285,
      );
    }

    doc.save(`guvi_audit_${Date.now()}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">
              Guvi <span className="text-blue-600">AuditAI</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${showHistory ? "bg-blue-50 text-blue-600" : "hover:bg-slate-50 text-slate-600"}`}
            >
              <History className="w-4 h-4" />
              <span className="font-medium">History ({history.length})</span>
            </button>
            <span className="h-4 w-px bg-slate-200"></span>
            <span className="flex items-center gap-1">
              <Languages className="w-4 h-4" /> Multi-lingual Support
            </span>
            <span className="h-4 w-px bg-slate-200"></span>
            <span className="flex items-center gap-1 font-medium text-slate-700">
              v1.0.4
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* History Sidebar (Conditional) */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, width: 0, x: -20 }}
                animate={{ opacity: 1, width: "auto", x: 0 }}
                exit={{ opacity: 0, width: 0, x: -20 }}
                className="lg:col-span-3 overflow-hidden"
              >
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 h-[calc(100vh-160px)] flex flex-col">
                  <div className="flex items-center justify-between mb-4 px-2">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-600" /> Audit History
                    </h3>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                    {history.length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        <p className="text-xs">No previous audits</p>
                      </div>
                    ) : (
                      history.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => selectHistoryItem(item)}
                          className="group p-3 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-200 hover:shadow-md transition-all cursor-pointer relative"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                              {new Date(item.timestamp).toLocaleDateString()}
                            </span>
                            <button
                              onClick={(e) => deleteHistoryItem(item.id, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs font-semibold text-slate-700 line-clamp-2 mb-2">
                            {item.result.summary}
                          </p>
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                                item.result.sop_validation.complianceScore >=
                                0.8
                                  ? "bg-green-100 text-green-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {(
                                item.result.sop_validation.complianceScore * 100
                              ).toFixed(0)}
                              %
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(item.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Section */}
          <div
            className={`${showHistory ? "lg:col-span-4" : "lg:col-span-5"} space-y-6 transition-all duration-300`}
          >
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <h2 className="font-semibold text-lg">Call Input</h2>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button
                    onClick={() => setInputType("text")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${inputType === "text" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setInputType("audio")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${inputType === "audio" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    Audio
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Select Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  >
                    <option>Tamil (Tanglish)</option>
                    <option>Hindi (Hinglish)</option>
                    <option>English</option>
                    <option>Telugu</option>
                    <option>Kannada</option>
                  </select>
                </div>

                {inputType === "text" ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      Paste Whisper Transcript
                    </label>
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      placeholder="Agent: Hello, Guvi Institution la irunthu pesuren...
Customer: Hi, Python course pathi therinjukanum..."
                      className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none font-mono"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      Upload Audio File
                    </label>
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative">
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setAudioFile(e.target.files?.[0] || null)
                        }
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <div className="bg-blue-100 p-3 rounded-full">
                        <Loader2
                          className={`w-6 h-6 text-blue-600 ${isAnalyzing ? "animate-spin" : ""}`}
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-slate-700">
                          {audioFile
                            ? audioFile.name
                            : "Click or drag audio file here"}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          MP3, WAV, M4A up to 20MB
                        </p>
                      </div>
                    </div>
                    {audioFile && (
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-600" />
                          <span className="text-xs font-medium text-blue-800 truncate max-w-[200px]">
                            {audioFile.name}
                          </span>
                        </div>
                        <button
                          onClick={() => setAudioFile(null)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={analyzeTranscript}
                  disabled={
                    isAnalyzing ||
                    (inputType === "text" ? !transcript.trim() : !audioFile)
                  }
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {inputType === "audio"
                        ? "Transcribing & Auditing..."
                        : "Analyzing Compliance..."}
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      Run Quality Audit
                    </>
                  )}
                </button>
              </div>
            </section>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Results Section */}
          <div
            className={`${showHistory ? "lg:col-span-5" : "lg:col-span-7"} transition-all duration-300`}
          >
            <AnimatePresence mode="wait">
              {!result && !isAnalyzing ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center p-12 bg-white rounded-2xl border border-dashed border-slate-300"
                >
                  <div className="bg-slate-100 p-4 rounded-full mb-4">
                    <BarChart3 className="w-12 h-12 text-slate-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-700">
                    No Analysis Yet
                  </h3>
                  <p className="text-slate-500 max-w-xs mt-2">
                    Paste a call transcript on the left to generate a
                    professional quality audit report.
                  </p>
                </motion.div>
              ) : isAnalyzing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center p-12 bg-white rounded-2xl border border-slate-200"
                >
                  <div className="relative">
                    <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ShieldCheck className="w-6 h-6 text-blue-400" />
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-slate-700 mt-6">
                    Auditing in Progress
                  </h3>
                  <p className="text-slate-500 max-w-xs mt-2">
                    Our AI is evaluating SOP compliance, sentiment, and business
                    metrics...
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  {/* Summary Card */}
                  <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-blue-600" />
                        <h2 className="font-semibold text-lg">
                          Executive Summary
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex bg-slate-100 p-1 rounded-lg mr-2">
                          <button
                            onClick={exportToCSV}
                            title="Export to CSV"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded-md transition-all"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </button>
                          <button
                            onClick={exportToPDF}
                            title="Export to PDF"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded-md transition-all"
                          >
                            <FileDown className="w-4 h-4" />
                          </button>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                            result.sop_validation.adherenceStatus === "FOLLOWED"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {result.sop_validation.adherenceStatus}
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-600 leading-relaxed italic border-l-4 border-blue-100 pl-4">
                      "{result.summary}"
                    </p>
                  </section>

                  {/* SOP Validation Grid */}
                  <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                        <h2 className="font-semibold text-lg">
                          SOP Compliance
                        </h2>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-2xl font-bold text-slate-800">
                          {(
                            result.sop_validation.complianceScore * 100
                          ).toFixed(0)}
                          %
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase font-bold">
                          Score
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[
                        {
                          label: "Greeting",
                          status: result.sop_validation.greeting,
                        },
                        {
                          label: "Identification",
                          status: result.sop_validation.identification,
                        },
                        {
                          label: "Problem Statement",
                          status: result.sop_validation.problemStatement,
                        },
                        {
                          label: "Solution Offering",
                          status: result.sop_validation.solutionOffering,
                        },
                        {
                          label: "Closing",
                          status: result.sop_validation.closing,
                        },
                      ].map((step) => (
                        <div
                          key={step.label}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100"
                        >
                          <span className="text-sm font-medium text-slate-700">
                            {step.label}
                          </span>
                          {step.status ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <XCircle className="w-5 h-5 text-slate-300" />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <h4 className="text-xs font-bold text-blue-700 uppercase mb-1">
                        Auditor's Explanation
                      </h4>
                      <p className="text-sm text-blue-800">
                        {result.sop_validation.explanation}
                      </p>
                    </div>
                  </section>

                  {/* Analytics & Keywords */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                      <div className="flex items-center gap-2 mb-6">
                        <BarChart3 className="w-5 h-5 text-blue-600" />
                        <h2 className="font-semibold text-lg">
                          Business Intelligence
                        </h2>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <CreditCard className="w-4 h-4" /> Payment
                            Preference
                          </div>
                          <span className="text-sm font-bold text-slate-700">
                            {result.analytics.paymentPreference}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <AlertCircle className="w-4 h-4" /> Rejection Reason
                          </div>
                          <span className="text-sm font-bold text-slate-700">
                            {result.analytics.rejectionReason}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Smile className="w-4 h-4" /> Sentiment
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-700">
                              {result.analytics.sentiment}
                            </span>
                            {getSentimentIcon(result.analytics.sentiment)}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                      <div className="flex items-center gap-2 mb-6">
                        <Tag className="w-5 h-5 text-blue-600" />
                        <h2 className="font-semibold text-lg">
                          Keywords Detected
                        </h2>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {result.keywords.map((kw, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full border border-slate-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors cursor-default"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </section>
                  </div>

                  {/* Raw Data Toggle (Optional) */}
                  <div className="flex justify-center pb-8">
                    <button
                      onClick={() => console.log(result)}
                      className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    >
                      View Raw JSON in Console{" "}
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
