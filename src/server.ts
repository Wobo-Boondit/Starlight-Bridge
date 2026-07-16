import { Hono } from "hono";
import type { Config } from "./config.js";
import { handleChatCompletions } from "./openai/handler.js";
import { getStatus } from "./acp/manager.js";
import type { OpenAIModelList } from "./openai/types.js";

/**
 * Create the Hono app with all routes.
 */
export function createApp(config: Config): Hono {
  const app = new Hono();

  // ── Health ────────────────────────────────────────────────────────
  app.get("/health", (c) => {
    const acpStatus = getStatus();
    return c.json({
      status: "ok",
      acp_clients: acpStatus,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  // ── Models ────────────────────────────────────────────────────────
  app.get("/v1/models", (c) => {
    // Auth is optional for models list (some clients probe without auth)
    const models = config.acp_clients.map((client) => ({
      id: `${client.model_prefix}-default`,
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: "starlight-bridge",
    }));

    const response: OpenAIModelList = {
      object: "list",
      data: models,
    };
    return c.json(response);
  });

  // ── Chat Completions ──────────────────────────────────────────────
  app.post("/v1/chat/completions", (c) => handleChatCompletions(c, config));

  // ── Catch-all ─────────────────────────────────────────────────────
  app.all("*", (c) => {
    return c.json({
      error: {
        message: `Unknown endpoint: ${c.req.method} ${c.req.path}`,
        type: "not_found",
      },
    }, 404);
  });

  return app;
}
