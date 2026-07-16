import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────────────

const TLSSchema = z.object({
  enabled: z.boolean().default(false),
  cert: z.string().optional(),
  key: z.string().optional(),
});

const TokenSchema = z.object({
  token: z.string(),
  name: z.string().optional(),
  allowed_models: z.array(z.string()).default(["*"]),
});

const ACPClientSchema = z.object({
  model_prefix: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  cwd: z.string().nullable().default(null),
});

const SessionsSchema = z.object({
  persist: z.boolean().default(true),
  idle_timeout: z.number().default(300),
  max_sessions: z.number().default(10),
});

const MCPSchema = z.object({
  server_name: z.string().default("starlight-bridge"),
  cleanup_after_request: z.boolean().default(true),
});

const ConfigSchema = z.object({
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.number().default(7878),
    tls: TLSSchema.default({ enabled: false }),
  }),
  tokens: z.array(TokenSchema),
  acp_clients: z.array(ACPClientSchema),
  sessions: SessionsSchema.default({ persist: true, idle_timeout: 300, max_sessions: 10 }),
  mcp: MCPSchema.default({ server_name: "starlight-bridge", cleanup_after_request: true }),
});

// ─── Types ───────────────────────────────────────────────────────────

export type Config = z.infer<typeof ConfigSchema>;
export type ACPClient = z.infer<typeof ACPClientSchema>;
export type Token = z.infer<typeof TokenSchema>;

// ─── Loader ──────────────────────────────────────────────────────────

export function loadConfig(path?: string): Config {
  const configPath = path
    ?? process.env.STARLIGHT_CONFIG
    ?? "./starlight.yml";

  const resolved = resolve(configPath);
  let raw: string;

  try {
    raw = readFileSync(resolved, "utf-8");
  } catch (e) {
    throw new Error(
      `Failed to load config from ${resolved}: ${(e as Error).message}\n` +
      `Set STARLIGHT_CONFIG or create starlight.yml (see starlight.yml.example)`
    );
  }

  const parsed = parse(raw);
  return ConfigSchema.parse(parsed);
}
