# ChatGPT Image Service 🤖🎨

A browser automation microservice that generates images using **ChatGPT's web UI (GPT-Image-2)** and returns the result as binary PNG to **n8n** — no official OpenAI API required.

---

## How It Works

```
n8n  →  POST /generate { prompt }  →  Playwright automates ChatGPT  →  PNG binary returned to n8n
                                                                       →  PNG also saved to ./downloads/
```

1. n8n sends a prompt to this service via HTTP
2. Playwright opens ChatGPT in a dedicated automation Chrome browser
3. The bot clicks the `+` icon → selects **"Create image"** from the dropdown
4. The prompt is typed and submitted → ChatGPT generates the image
5. The image is returned as `image/png` binary to the caller
6. A permanent copy is saved to the `./downloads/` folder, named by date and time

---

## Prerequisites

- **Node.js** v18+ installed
- **Google Chrome** installed (not just Chromium)
- A **ChatGPT account** (free tier gives 5 GPT-Image-2 images/day)
- **n8n** running locally or on a server

---

## Setup (First Time)

### 1. Install dependencies

```bash
npm install
npx playwright install chrome
```

### 2. Create your `.env` file

```bash
copy .env.example .env
```

The default settings work for most cases:

```env
PORT=3000

# Dedicated automation profile (separate from your real Chrome)
PROFILE_PATH=./profiles/chatgpt-automation

# Folder where generated images are permanently saved
DOWNLOADS_PATH=./downloads

HEADLESS=false
REQUEST_TIMEOUT_MS=180000
MAX_RETRIES=3
```

### 3. Start the service

```bash
npm start
```

> ✅ **DEDICATED PROFILE**: The bot runs in its own Chrome instance inside `./profiles/chatgpt-automation/`. Your regular Chrome and all your other profiles are **never touched or closed**.

You'll see:
```
============================================================
  ChatGPT Image Service — Running
============================================================
  URL:        http://localhost:3000
  Docs:       http://localhost:3000/docs
  Health:     http://localhost:3000/health
  Generate:   POST http://localhost:3000/generate
  Last image: GET  http://localhost:3000/lastimage
============================================================
```

### 4. First-time login (one time only)

The very first time you run `npm start` and send a request, a Chrome window will open and land on the ChatGPT login page. **Log in manually** — the session is saved permanently to the automation profile. You will never need to log in again.

---

## API Reference & Interactive Docs

Interactive Swagger UI documentation is available at:
👉 **`http://localhost:3000/docs`**

Raw OpenAPI 3.0 specification:
👉 **`http://localhost:3000/docs/openapi.json`**

---

### `GET /health`

Returns service status.

**Response:**
```json
{
  "status": "ok",
  "service": "chatgpt-image-service",
  "busy": false,
  "timestamp": "2026-08-26T12:00:00.000Z"
}
```

---

### `POST /generate`

Generates an image from a text prompt.

**Request:**
```json
{
  "prompt": "A serene mountain lake at sunset, photorealistic, wide angle"
}
```

> 💡 **Include size/aspect ratio in your prompt** — e.g., _"landscape 16:9 format"_ or _"portrait orientation"_

**Response:**
- `Content-Type: image/png`
- Body: raw PNG binary bytes

A permanent copy of every generated image is also saved to `./downloads/` with a filename like `2026-08-11_16-09-29.png`.

**Error responses:**
| Status | Meaning |
|--------|---------|
| `400` | Missing or invalid prompt |
| `429` | Server is busy generating another image (request rejected) |
| `500` | Generation failed (see `details` field) |
| `503` | Not logged in — log in manually in the browser window |
| `504` | Timed out — ChatGPT was too slow, retry |

---

### `GET /lastimage`

Returns the most recently generated image from the `./downloads/` folder as binary PNG.

Useful if you want to retrieve the last result without triggering a new generation.

**Response:**
- `Content-Type: image/png`
- Body: raw PNG binary bytes
- Header `X-Image-Filename`: filename of the image (e.g. `2026-08-11_16-09-29.png`)

**Error response:**
| Status | Meaning |
|--------|---------|
| `404` | No images have been generated yet |
| `500` | Failed to read image from disk |

---

## n8n Integration

### HTTP Request Node Setup — Generate Image

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `http://localhost:3000/generate` |
| **Body Content Type** | `JSON` |
| **Body** | `{ "prompt": "{{$json.prompt}}" }` |
| **Response Format** | `File` |

### HTTP Request Node Setup — Get Last Image

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `http://localhost:3000/lastimage` |
| **Response Format** | `File` |

The returned binary data flows directly into downstream n8n nodes (Write Binary File, Send Email, etc.)

---

## Reliability Features

| Feature | Detail |
|---------|--------|
| **Single-request mode** | Only 1 generation runs at a time. Concurrent calls are immediately rejected (HTTP 429) rather than queued. |
| **Auto-retry** | Up to 3 retry attempts per request on failure (configurable via `MAX_RETRIES`) |
| **Two download strategies** | First tries the UI download button; falls back to fetching the image src directly |
| **Persistent login** | Dedicated automation profile saves cookies — no re-login needed between requests |
| **Permanent image archive** | Every image is saved to `./downloads/` with a `YYYY-MM-DD_HH-MM-SS.png` filename |
| **Last image endpoint** | `GET /lastimage` retrieves the most recently saved image without re-generating |
| **Timeout handling** | Each request has a hard timeout (`REQUEST_TIMEOUT_MS`) with clear error messages |
| **Graceful shutdown** | Ctrl+C properly closes Chrome before exiting |
| **Non-destructive** | Your personal Chrome and all other profiles are never closed or modified |

---

## Directory Structure

```
ChatGPT-Image-Genration-Browser-Automation/
├── server.js                   # Express HTTP server (entry point)
├── openapi.js                  # OpenAPI 3.0 specification definition
├── package.json
├── .env.example                # Configuration template
├── .env                        # Your local config (not in git)
├── scripts/
│   ├── generateImage.js        # Playwright ChatGPT automation
│   ├── sessionManager.js       # Singleton browser context manager
│   └── queue.js                # Single-task lock / busy rejection
├── profiles/
│   └── chatgpt-automation/     # Dedicated Chrome session (login cookies saved here)
└── downloads/                  # Permanent image archive (YYYY-MM-DD_HH-MM-SS.png)
```