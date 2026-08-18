/**
 * sessionManager.js
 *
 * Manages a single, long-lived Playwright browser context using a
 * DEDICATED automation profile directory (./profiles/chatgpt-automation).
 *
 * This runs as a SEPARATE Chrome instance alongside your normal Chrome.
 * Your regular Chrome profiles are NEVER touched or closed.
 *
 * FIRST TIME: ChatGPT will show a login page — log in manually.
 *             The session is saved permanently in the automation profile.
 * AFTER THAT: Fully automatic, no login needed.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// ─── Profile Configuration ────────────────────────────────────────────────────
// Uses a dedicated folder SEPARATE from your regular Chrome.
// This means your real Chrome profiles are NEVER closed or touched.
const PROFILE_PATH = path.resolve(
  process.env.PROFILE_PATH || "./profiles/chatgpt-automation"
);

const HEADLESS = process.env.HEADLESS === "true";

let _context = null;
let _isLaunching = false;
let _launchQueue = [];

// ─── Browser Launch ───────────────────────────────────────────────────────────

/**
 * Returns the shared browser context, launching it if needed.
 * Uses a dedicated profile dir so it never conflicts with regular Chrome.
 *
 * @returns {Promise<import("playwright").BrowserContext>}
 */
async function getBrowserContext() {
  if (_context) {
    try {
      await _context.pages();
      return _context;
    } catch {
      console.warn("[SessionManager] Browser context died — relaunching...");
      _context = null;
    }
  }

  if (_isLaunching) {
    return new Promise((resolve, reject) => {
      _launchQueue.push({ resolve, reject });
    });
  }

  _isLaunching = true;

  try {
    // ── Ensure profile directory exists ───────────────────────────────────────
    if (!fs.existsSync(PROFILE_PATH)) {
      fs.mkdirSync(PROFILE_PATH, { recursive: true });
      console.log("[SessionManager] Created automation profile:", PROFILE_PATH);
    }

    console.log("[SessionManager] Launching dedicated automation Chrome...");
    console.log("[SessionManager] Profile path:", PROFILE_PATH);
    console.log("[SessionManager] Note: Your regular Chrome is NOT affected.");

    _context = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless: HEADLESS,
      channel: "chrome",
      viewport: null,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
      ],
      slowMo: 50,
    });

    console.log("[SessionManager] ✓ Automation browser launched successfully.");

    _context.on("close", () => {
      console.warn("[SessionManager] Browser context closed unexpectedly.");
      _context = null;
    });

    _launchQueue.forEach(({ resolve }) => resolve(_context));
    _launchQueue = [];

    return _context;
  } catch (err) {
    _launchQueue.forEach(({ reject }) => reject(err));
    _launchQueue = [];
    throw err;
  } finally {
    _isLaunching = false;
  }
}

/**
 * Gracefully closes the automation browser. Called on process shutdown.
 */
async function closeBrowser() {
  if (_context) {
    console.log("[SessionManager] Closing automation browser...");
    await _context.close().catch(() => {});
    _context = null;
    console.log("[SessionManager] Browser closed.");
  }
}

module.exports = { getBrowserContext, closeBrowser };
