/**
 * server.js
 *
 * Express HTTP server — the bridge between n8n and the ChatGPT browser bot.
 *
 * Endpoints:
 *   GET  /health    → status check (is server alive? is it busy?)
 *   POST /generate  → accepts { prompt } → returns image/png binary
 *   GET  /lastimage → returns the most recently generated image
 *
 * Concurrency:
 *   Handles only 1 request at a time. If a request arrives while working,
 *   it immediately returns 429 Too Many Requests (busy).
 *
 * Usage:
 *   npm start
 *   -- or --
 *   node server.js
 */

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { closeBrowser } = require("./scripts/sessionManager");
const generateImage = require("./scripts/generateImage");
const queue = require("./scripts/queue");

const app = express();
const PORT = parseInt(process.env.PORT || "3000");
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "180000");
const DOWNLOADS_PATH = path.resolve(process.env.DOWNLOADS_PATH || "./downloads");

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// Basic request logger
app.use((req, res, next) => {
  console.log(`[Server] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// Used by n8n (or monitoring tools) to check if the service is up & available.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: queue.isBusy ? "busy" : "ok",
    service: "chatgpt-image-service",
    busy: queue.isBusy,
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /generate
// n8n sends: { "prompt": "your image description here" }
// Returns:   image binary (Content-Type: image/png)
// Rejects:   429 if another generation is already in progress
// ─────────────────────────────────────────────────────────────────────────────
app.post("/generate", async (req, res) => {
  // ── Concurrency check: Reject if already processing a request ──
  if (queue.isBusy) {
    console.warn("[Server] /generate rejected: service is currently busy with another request.");
    return res.status(429).json({
      error: "Service is busy processing another request. Please try again later.",
      status: "busy",
    });
  }

  const { prompt } = req.body;

  // ── Validation ──
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return res.status(400).json({
      error: "Missing or empty 'prompt' field in request body.",
      example: { prompt: "A serene mountain lake at sunrise, photorealistic" },
    });
  }

  if (prompt.length > 4000) {
    return res.status(400).json({
      error: "Prompt too long. Maximum 4000 characters.",
    });
  }

  const trimmedPrompt = prompt.trim();
  console.log("[Server] /generate request accepted.");
  console.log(`[Server] Prompt (${trimmedPrompt.length} chars):`, trimmedPrompt.substring(0, 100) + (trimmedPrompt.length > 100 ? "..." : ""));

  // ── Execute task ──
  try {
    const imageBuffer = await queue.enqueue(
      () => generateImage(trimmedPrompt),
      REQUEST_TIMEOUT_MS + 30000
    );

    // Return image binary directly
    res.set({
      "Content-Type": "image/png",
      "Content-Length": imageBuffer.length,
      "X-Generated-By": "chatgpt-image-service",
      "Cache-Control": "no-store",
    });

    console.log(`[Server] Sending image response: ${imageBuffer.length} bytes.`);
    return res.send(imageBuffer);

  } catch (err) {
    console.error("[Server] /generate failed:", err.message);

    if (err.message === "SERVICE_BUSY" || err.code === "SERVICE_BUSY") {
      return res.status(429).json({
        error: "Service is busy processing another request. Please try again later.",
        status: "busy",
      });
    }

    // Determine if it's a client error or server error
    if (err.message.includes("Not logged in")) {
      return res.status(503).json({
        error: "Service not authenticated. Please run: npm run login",
        details: err.message,
      });
    }

    if (err.message.includes("timed out")) {
      return res.status(504).json({
        error: "Image generation timed out. ChatGPT may be slow or busy. Try again.",
        details: err.message,
      });
    }

    return res.status(500).json({
      error: "Image generation failed.",
      details: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lastimage
// Returns the most recently generated image from the downloads folder.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/lastimage", (req, res) => {
  try {
    // Ensure downloads folder exists
    if (!fs.existsSync(DOWNLOADS_PATH)) {
      return res.status(404).json({ error: "No images have been generated yet." });
    }

    // Find all .png files sorted by most recent modification time
    const files = fs
      .readdirSync(DOWNLOADS_PATH)
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(DOWNLOADS_PATH, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    if (files.length === 0) {
      return res.status(404).json({ error: "No images have been generated yet." });
    }

    const latestFile = path.join(DOWNLOADS_PATH, files[0].name);
    const imageBuffer = fs.readFileSync(latestFile);

    console.log(`[Server] /lastimage → serving: ${files[0].name} (${imageBuffer.length} bytes)`);

    res.set({
      "Content-Type": "image/png",
      "Content-Length": imageBuffer.length,
      "Content-Disposition": `inline; filename="${files[0].name}"`,
      "X-Image-Filename": files[0].name,
      "Cache-Control": "no-store",
    });

    return res.send(imageBuffer);
  } catch (err) {
    console.error("[Server] /lastimage failed:", err.message);
    return res.status(500).json({ error: "Failed to retrieve last image.", details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found.",
    availableRoutes: ["GET /health", "GET /lastimage", "POST /generate"],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("  ChatGPT Image Service — Running");
  console.log("=".repeat(60));
  console.log(`  URL:        http://localhost:${PORT}`);
  console.log(`  Health:     http://localhost:${PORT}/health`);
  console.log(`  Generate:   POST http://localhost:${PORT}/generate`);
  console.log(`  Last image: GET http://localhost:${PORT}/lastimage`);
  console.log("=".repeat(60));
  console.log();
  console.log("  Waiting for requests from n8n (Single-request mode)...");
  console.log("  Press Ctrl+C to stop.");
  console.log();
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

  server.close(async () => {
    await closeBrowser();
    console.log("[Server] Shutdown complete.");
    process.exit(0);
  });

  // Force exit after 15 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout.");
    process.exit(1);
  }, 15000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));