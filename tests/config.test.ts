import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  it("loads a valid config", () => {
    const path = join(tmpdir(), `starlight-test-${Date.now()}.yml`);
    writeFileSync(path, `
server:
  host: "127.0.0.1"
  port: 9999
tokens:
  - token: "test-token"
    name: "Test"
    allowed_models:
      - "hermes-*"
acp_clients:
  - model_prefix: "hermes"
    command: "hermes"
    args: ["acp"]
`);
    try {
      const config = loadConfig(path);
      expect(config.server.host).toBe("127.0.0.1");
      expect(config.server.port).toBe(9999);
      expect(config.tokens).toHaveLength(1);
      expect(config.tokens[0].token).toBe("test-token");
      expect(config.acp_clients).toHaveLength(1);
      expect(config.acp_clients[0].model_prefix).toBe("hermes");
      // defaults
      expect(config.sessions.persist).toBe(true);
      expect(config.mcp.server_name).toBe("starlight-bridge");
    } finally {
      unlinkSync(path);
    }
  });

  it("throws on missing file", () => {
    expect(() => loadConfig("/nonexistent/path.yml")).toThrow("Failed to load config");
  });

  it("throws on invalid config (missing tokens)", () => {
    const path = join(tmpdir(), `starlight-test-bad-${Date.now()}.yml`);
    writeFileSync(path, `
server:
  port: 7878
acp_clients: []
`);
    try {
      expect(() => loadConfig(path)).toThrow();
    } finally {
      unlinkSync(path);
    }
  });
});
