/**
 * generateImage.js
 *
 * Core Playwright automation:
 *   1. Opens ChatGPT in the browser
 *   2. Detects if logged out → pauses and waits for manual login
 *   3. Submits the image prompt
 *   4. Waits for the generated image
 *   5. Downloads and returns the image as a Buffer
 *
 * SESSION RECOVERY:
 *   If ChatGPT signs the user out (session expired), the bot will
 *   pause and print a message to the server console asking for
 *   manual login in the browser window. Once the user logs in,
 *   the bot automatically continues. The session is saved in the
 *   persistent profile, so future runs won't need login again.
 *
 * RETRY LOGIC:
 *   Up to MAX_RETRIES attempts per request, with a 5-second pause
 *   between attempts.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { getBrowserContext } = require("./sessionManager");

const DOWNLOADS_PATH = path.resolve(
  process.env.DOWNLOADS_PATH || "./downloads"
);
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "180000");
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3");

// Max time to wait for user to manually log in (5 minutes)
const LOGIN_WAIT_MS = 5 * 60 * 1000;

if (!fs.existsSync(DOWNLOADS_PATH)) {
  fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates an image via ChatGPT web UI.
 * @param {string} prompt - The image generation prompt
 * @returns {Promise<Buffer>} - PNG image as a binary Buffer
 */
async function generateImage(prompt) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[generateImage] Attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      const imageBuffer = await _attemptGeneration(prompt);
      console.log(`[generateImage] Success on attempt ${attempt}.`);
      return imageBuffer;
    } catch (err) {
      lastError = err;
      console.error(`[generateImage] Attempt ${attempt} failed:`, err.message);

      if (attempt < MAX_RETRIES) {
        console.log("[generateImage] Retrying in 5 seconds...");
        await sleep(5000);
      }
    }
  }

  throw new Error(
    `Image generation failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Core automation (single attempt)
// ─────────────────────────────────────────────────────────────────────────────

async function _attemptGeneration(prompt) {
  const context = await getBrowserContext();
  const page = await context.newPage();

  try {
    // ── Step 1: Navigate to ChatGPT ─────────────────────────────────────────
    console.log("[generateImage] Step 1: Navigating to chatgpt.com...");
    await page.goto("https://chatgpt.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("[generateImage] Current URL:", page.url());

    // ── Step 2: Handle Login If Needed ──────────────────────────────────────
    await _ensureLoggedIn(page, context);

    // ── Step 3: Start a fresh chat ──────────────────────────────────────────
    console.log("[generateImage] Step 3: Starting a new chat...");

    try {
      // Look for the "New chat" button/link
      const newChatBtn = page.locator('a[href="/"], nav a[href="/"]').first();
      await newChatBtn.waitFor({ state: "visible", timeout: 8000 });
      await newChatBtn.click();
      await page.waitForTimeout(1500);
    } catch {
      console.log("[generateImage] Already on a fresh chat, continuing...");
    }

    // ── Step 4: Find and focus the prompt input ─────────────────────────────
    console.log("[generateImage] Step 4: Waiting for prompt input...");

    const promptInput = page
      .locator("#prompt-textarea, div[contenteditable='true'][data-lexical-editor]")
      .first();

    await promptInput.waitFor({ state: "visible", timeout: 30000 });
    console.log("[generateImage] Step 4: Prompt input found.");

    // ── Step 4a: Clear any existing text in the prompt bar FIRST ────────────
    console.log("[generateImage] Step 4a: Clearing any existing prompt text...");
    await promptInput.click({ force: true });
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);

    // ── Step 4b: Select "Create image" from the + menu ──────────────────────
    console.log("[generateImage] Step 4b: Selecting 'Create image' from + menu...");
    try {
      // Look for the Attach/plus button on the left of the prompt bar
      const attachBtn = page.locator('button[aria-label*="Attach"], button[aria-label*="Upload"]').first();

      if (await attachBtn.isVisible({ timeout: 2000 })) {
        await attachBtn.click();
      } else {
        // Fallback: click the first button in the input area (the + button)
        await page.locator('form button, main button').first().click({ force: true });
      }

      // Wait for dropdown to open
      await page.waitForTimeout(1000);

      // Click "Create image" in the dropdown menu
      const createImgOption = page.locator('text="Create image"').last();
      await createImgOption.waitFor({ state: "visible", timeout: 3000 });
      await createImgOption.click();

      console.log("[generateImage] Step 4b: Successfully selected 'Create image'.");
      // Wait for the UI chip/token to appear in the prompt bar
      await page.waitForTimeout(800);
    } catch (err) {
      console.log("[generateImage] Warning: Could not select 'Create image' option. Continuing... (Error: " + err.message + ")");
    }

    // ── Step 5: Type the prompt (prefixed with a space so it follows the chip) ──
    console.log("[generateImage] Step 5: Typing prompt...");
    await promptInput.click({ force: true });
    await page.waitForTimeout(300);
    // Type a space first to place cursor after the "Create image" chip, then the prompt
    await page.keyboard.press("End");
    await page.keyboard.type(" " + prompt, { delay: 15 });
    await page.waitForTimeout(400);

    console.log(
      "[generateImage] Step 5: Prompt typed:",
      prompt.substring(0, 80) + (prompt.length > 80 ? "..." : "")
    );

    // ── Step 6: Submit ──────────────────────────────────────────────────────
    console.log("[generateImage] Step 6: Submitting prompt...");

    const sendButton = page
      .locator('button[data-testid="send-button"], button[aria-label="Send prompt"]')
      .first();

    try {
      await sendButton.waitFor({ state: "visible", timeout: 5000 });
      await sendButton.click();
    } catch {
      await page.keyboard.press("Enter");
    }

    console.log("[generateImage] Step 6: Prompt submitted.");

    // ── Step 7: Wait for the generated image ────────────────────────────────
    console.log("[generateImage] Step 7: Waiting for image to generate...");
    console.log("[generateImage] This can take 30–90 seconds — please wait...");

    const generatedImage = page
      .locator(
        [
          'img[alt*="Generated image"]',
          'img[alt*="generated image"]',
          '.group img[src*="oaiusercontent"]',
          '.group img[src*="files.oaiusercontent"]',
          '[data-message-author-role="assistant"] img',
        ].join(", ")
      )
      .last();

    await generatedImage.waitFor({
      state: "visible",
      timeout: REQUEST_TIMEOUT_MS,
    });

    console.log("[generateImage] Step 7: Image element detected!");
    await page.waitForTimeout(1500);

    // ── Step 8: Download the image ──────────────────────────────────────────
    console.log("[generateImage] Step 8: Downloading image...");

    let imageBuffer = null;

    // Strategy A: Click the download button (appears on hover)
    try {
      imageBuffer = await _downloadViaButton(page, context);
      console.log("[generateImage] Step 8: Downloaded via download button.");
    } catch (btnErr) {
      console.warn("[generateImage] Download button not found:", btnErr.message);

      // Strategy B: Fetch image src directly
      try {
        imageBuffer = await _downloadViaImageSrc(page, context, generatedImage);
        console.log("[generateImage] Step 8: Downloaded via image src.");
      } catch (srcErr) {
        throw new Error(
          "All download strategies failed. Button: " +
            btnErr.message +
            " | Src: " +
            srcErr.message
        );
      }
    }

    console.log(
      `[generateImage] Step 8: Image captured, size: ${imageBuffer.length} bytes.`
    );

    // ── Step 9: Save a permanent copy to the downloads folder ───────────────
    const savedPath = _saveImageWithTimestamp(imageBuffer);
    console.log(`[generateImage] Step 9: Image saved permanently → ${savedPath}`);

    return imageBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Login detection & recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if ChatGPT is signed in. If not, pauses and waits for the user
 * to log in manually in the browser window. Once logged in, continues
 * automatically. The session is saved in the persistent profile so
 * future runs won't require login.
 */
async function _ensureLoggedIn(page, context) {
  const url = page.url();

  const isLoggedOut =
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("accounts.google.com") ||
    url.includes("auth0.com") ||
    url.includes("openai.com/account") ||
    (await _hasLoginButton(page));

  if (!isLoggedOut) {
    console.log("[generateImage] Step 2: Already logged in. ✓");
    return;
  }

  // ── User is NOT logged in — pause and wait for manual login ──────────────
  console.log();
  console.log("═".repeat(60));
  console.log("  ⚠  CHATGPT IS NOT LOGGED IN");
  console.log("═".repeat(60));
  console.log();
  console.log("  Please log into ChatGPT in the browser window.");
  console.log("  The automation will resume automatically once you are in.");
  console.log();
  console.log(`  Waiting up to ${LOGIN_WAIT_MS / 60000} minutes...`);
  console.log("═".repeat(60));
  console.log();

  // Wait until we land on the main ChatGPT chat page
  await page.waitForURL(
    (url) =>
      url.toString().startsWith("https://chatgpt.com") &&
      !url.toString().includes("/auth") &&
      !url.toString().includes("/login"),
    { timeout: LOGIN_WAIT_MS }
  );

  // Extra wait for the page to settle after login
  await page.waitForTimeout(2000);

  console.log();
  console.log("  ✓ Login detected! Session saved to profile.");
  console.log("  ✓ Automation resuming...");
  console.log();

  // The persistent profile automatically saves the new session cookies —
  // no extra steps needed. Future runs will start logged in.
}

/**
 * Checks if the page has a visible login/sign-in button,
 * which indicates the user is logged out.
 */
async function _hasLoginButton(page) {
  try {
    const loginBtn = page.locator(
      'button:has-text("Log in"), a:has-text("Log in"), button:has-text("Sign in"), a:has-text("Sign in")'
    );
    return await loginBtn.isVisible({ timeout: 3000 });
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Download strategies
// ─────────────────────────────────────────────────────────────────────────────

async function _downloadViaButton(page, context) {
  const tempFileName = `${uuidv4()}.png`;
  const tempFilePath = path.join(DOWNLOADS_PATH, tempFileName);

  const lastImg = page
    .locator('[data-message-author-role="assistant"] img, img[alt*="Generated"]')
    .last();

  await lastImg.hover({ timeout: 10000 });
  await page.waitForTimeout(800);

  const downloadButton = page
    .locator(
      [
        'button[aria-label*="Download"]',
        'button[aria-label*="download"]',
        'button[title*="Download"]',
        'button[title*="download"]',
        '[data-testid*="download"]',
      ].join(", ")
    )
    .last();

  await downloadButton.waitFor({ state: "visible", timeout: 10000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    downloadButton.click(),
  ]);

  await download.saveAs(tempFilePath);
  const buffer = fs.readFileSync(tempFilePath);
  fs.unlinkSync(tempFilePath);
  return buffer;
}

async function _downloadViaImageSrc(page, context, imageLocator) {
  const src = await imageLocator.getAttribute("src");
  if (!src) throw new Error("Image has no src attribute");

  if (src.startsWith("blob:")) {
    const arrayBuffer = await page.evaluate(async (blobUrl) => {
      const resp = await fetch(blobUrl);
      const buf = await resp.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    }, src);
    return Buffer.from(arrayBuffer);
  } else {
    const imageUrl = src.startsWith("http") ? src : `https://chatgpt.com${src}`;
    const response = await context.request.get(imageUrl);
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} fetching image`);
    }
    return Buffer.from(await response.body());
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Saves an image buffer to the downloads folder with a date-time filename.
 * Format: YYYY-MM-DD_HH-MM-SS.png  (e.g. 2026-08-11_16-09-29.png)
 * @param {Buffer} buffer
 * @returns {string} absolute path of the saved file
 */
function _saveImageWithTimestamp(buffer) {
  const now = new Date();

  const pad = (n) => String(n).padStart(2, "0");

  const year  = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day   = pad(now.getDate());
  const hours = pad(now.getHours());
  const mins  = pad(now.getMinutes());
  const secs  = pad(now.getSeconds());

  const filename = `${year}-${month}-${day}_${hours}-${mins}-${secs}.png`;
  const savePath = path.join(DOWNLOADS_PATH, filename);

  fs.writeFileSync(savePath, buffer);
  return savePath;
}

module.exports = generateImage;
