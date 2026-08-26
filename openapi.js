const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ChatGPT Image Service API",
    version: "1.0.0",
    description: "A browser automation microservice that generates images using ChatGPT's web UI (GPT-Image-2) and returns the result as binary PNG.",
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
  tags: [
    {
      name: "Status",
      description: "Service health and availability",
    },
    {
      name: "Generation",
      description: "Image generation and retrieval",
    },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Status"],
        summary: "Check service health & availability",
        description: "Returns current status and indicates whether a generation task is in progress.",
        responses: {
          "200": {
            description: "Service status information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    service: { type: "string", example: "chatgpt-image-service" },
                    busy: { type: "boolean", example: false },
                    timestamp: { type: "string", format: "date-time", example: "2026-08-26T12:00:00.000Z" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/generate": {
      post: {
        tags: ["Generation"],
        summary: "Generate an image via ChatGPT",
        description: "Submits a prompt to ChatGPT web UI via Playwright browser automation and streams back the generated PNG binary.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompt"],
                properties: {
                  prompt: {
                    type: "string",
                    maxLength: 4000,
                    description: "Image generation prompt / description",
                    example: "A serene mountain lake at sunset, photorealistic, wide angle",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Binary PNG image generated successfully",
            headers: {
              "Content-Type": {
                schema: { type: "string", example: "image/png" },
              },
              "Content-Length": {
                schema: { type: "integer", example: 2048500 },
              },
              "X-Generated-By": {
                schema: { type: "string", example: "chatgpt-image-service" },
              },
            },
            content: {
              "image/png": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          "400": {
            description: "Missing or invalid prompt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Missing or empty 'prompt' field in request body." },
                    example: {
                      type: "object",
                      properties: {
                        prompt: { type: "string", example: "A serene mountain lake at sunrise, photorealistic" },
                      },
                    },
                  },
                },
              },
            },
          },
          "429": {
            description: "Service is currently busy generating another image",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Service is busy processing another request. Please try again later." },
                    status: { type: "string", example: "busy" },
                  },
                },
              },
            },
          },
          "503": {
            description: "Not logged into ChatGPT",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Service not authenticated. Please run: npm run login" },
                    details: { type: "string" },
                  },
                },
              },
            },
          },
          "504": {
            description: "Image generation timed out",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Image generation timed out. ChatGPT may be slow or busy. Try again." },
                    details: { type: "string" },
                  },
                },
              },
            },
          },
          "500": {
            description: "Internal generation failure",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Image generation failed." },
                    details: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/lastimage": {
      get: {
        tags: ["Generation"],
        summary: "Retrieve most recently generated image",
        description: "Returns the latest generated PNG image saved in the downloads directory without triggering a new generation.",
        responses: {
          "200": {
            description: "Latest generated PNG binary",
            headers: {
              "Content-Type": {
                schema: { type: "string", example: "image/png" },
              },
              "Content-Length": {
                schema: { type: "integer" },
              },
              "X-Image-Filename": {
                schema: { type: "string", example: "2026-08-11_16-09-29.png" },
              },
            },
            content: {
              "image/png": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          "404": {
            description: "No images generated yet",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "No images have been generated yet." },
                  },
                },
              },
            },
          },
          "500": {
            description: "Failed to read image from disk",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to retrieve last image." },
                    details: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/docs/openapi.json": {
      get: {
        tags: ["Status"],
        summary: "Get OpenAPI JSON Specification",
        description: "Returns the raw OpenAPI 3.0 JSON schema specification for this API.",
        responses: {
          "200": {
            description: "OpenAPI specification JSON",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = openApiSpec;