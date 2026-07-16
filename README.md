# Starlight Bridge

Bridge any ACP-compatible agent to the OpenAI API, with dynamic MCP tool registration.

Any app that speaks OpenAI can talk to Hermes, Claude Code, or any other ACP agent through Starlight. Client-provided tools are registered as MCP tools in the agent session automatically.

## Quick Start (with your AI agent)

Send this prompt to your AI agent (Claude Code, Hermes, Codex, etc.):

---

I want to install and set up Starlight Bridge. Here's what to do:

1. Clone and install:
   ```bash
   git clone https://github.com/AidanTheBandit/Starlight-Bridge.git
   cd Starlight-Bridge
   npm install
   npm run build
   ```

2. Create the config file from the template:
   ```bash
   cp starlight.yml.example starlight.yml
   ```

3. Read `starlight.yml` and fill it in:
   - Under `tokens`: add an auth token for each app that will connect
   - Under `acp_clients`: add an entry for each agent you want to bridge
   - The `model_prefix` is what apps put before the model name (e.g. "hermes" → "hermes-glm-5.2")

4. Ask me:
   - What ACP-compatible agents do you have installed? (hermes, claude code, etc.)
   - What apps will connect to the bridge?
   - Do you need TLS?

5. Start the bridge:
   ```bash
   npm start
   ```

6. Test it:
   ```bash
   curl http://localhost:7878/v1/chat/completions \
     -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" \
     -d '{"model":"hermes-glm-5.2","messages":[{"role":"user","content":"hello"}]}'
   ```

---

## How It Works

```
Client ──POST /v1/chat/completions──▶ Starlight Bridge ──ACP JSON-RPC──▶ Agent
         Authorization: Bearer <token>     │
         { model: "hermes-glm-5.2",        │
           messages: [...],                │
           tools: [...] }                  │
                                           ├── auth (token → allowed models)
                                           ├── route (model prefix → ACP client)
                                           ├── register tools as MCP in session
                                           └── stream response back as OpenAI SSE
```

1. Client sends a standard OpenAI `/v1/chat/completions` request
2. Bridge authenticates the token and resolves the ACP backend from the model name
3. Client-provided `tools` are registered as MCP tools in the agent session
4. The prompt is forwarded to the ACP agent (full agent loop with all native tools)
5. Response streams back as standard OpenAI SSE

The agent gets client tools + its own native tools. The client gets a standard OpenAI API.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    STARLIGHT BRIDGE                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ HTTP Server  │  │ ACP Manager  │  │ Config Loader  │   │
│  │ (Hono)       │  │              │  │ (YAML + zod)   │   │
│  │              │  │ Spawns/reuses│  │                │   │
│  │ POST /v1/    │  │ ACP processes│  │ - server (port,│   │
│  │ chat/comp    │  │ via stdio    │  │   TLS, host)   │   │
│  │              │  │              │  │ - tokens (auth,│   │
│  │ GET /v1/     │  │ JSON-RPC     │  │   model perms) │   │
│  │ models       │  │ protocol     │  │ - acp_clients  │   │
│  │              │  │              │  │   (prefix →    │   │
│  │ GET /health  │  │ Session mgmt │  │   command)     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────────────┘   │
│         │                 │                               │
│         └────────┬────────┘                               │
│                  │                                        │
│         ┌────────▼─────────┐                              │
│         │ Model Router     │                              │
│         │                  │                              │
│         │ "hermes-glm-5.2" │                              │
│         │  → prefix: hermes│                              │
│         │  → strip to:     │                              │
│         │    glm-5.2       │                              │
│         └──────────────────┘                              │
└──────────────────────────────────────────────────────────┘
                  │
                  │ ACP JSON-RPC (stdio)
                  ▼
┌──────────────────────────────────────────────────────────┐
│              ACP AGENT (hermes, claude, etc)              │
│                                                          │
│  Full agent loop: SOUL.md, skills, memory, native tools  │
│  + MCP tools registered by Starlight                     │
└──────────────────────────────────────────────────────────┘
```

### Request Flow

**Normal query (no client tools):**

```
1. Client: POST /v1/chat/completions { model: "hermes-glm-5.2", messages: [...] }
2. Bridge: validate token → check model permission
3. Bridge: resolve ACP client from model prefix ("hermes" → hermes acp)
4. Bridge: create ACP session, forward prompt
5. Agent: runs full loop (web, terminal, memory, skills...)
6. Bridge: stream response back as OpenAI SSE
7. Cleanup: dispose session if configured
```

**Query with client tools (MCP registration):**

```
1. Client: POST /v1/chat/completions { model: "hermes-glm-5.2", messages: [...], tools: [...] }
2. Bridge: validate, route, create session
3. Bridge: register tools[] as MCP server in ACP session
   - sends mcp_servers config to ACP on session/new
   - agent sees tools immediately (MCP tools/list_changed notification)
4. Agent: runs loop, may call client-provided tools + native tools
5. Bridge: stream response back
6. Cleanup: deregister tools, dispose session
```

### Dynamic MCP Tool Lifecycle

Starlight uses the MCP `notifications/tools/list_changed` mechanism for real-time tool registration:

```
Request arrives with tools []
  │
  ▼
Bridge creates ACP session with mcp_servers
  │
  ▼
ACP session registers tools → MCP list_changed notification
  │
  ▼
Agent tool surface updated (atomic, thread-safe)
  │
  ▼
Agent calls tools during its loop → results flow back
  │
  ▼
Response complete → session disposed → tools deregistered
```

Tools can be added and removed in real time. The ACP agent picks up changes immediately via the MCP notification protocol.

## Config

Copy `starlight.yml.example` to `starlight.yml`:

```yaml
server:
  host: "0.0.0.0"
  port: 7878

tokens:
  - token: "my-secret-token"
    name: "My App"
    allowed_models:
      - "hermes-*"       # glob patterns

acp_clients:
  - model_prefix: "hermes"
    command: "hermes"
    args: ["acp"]
```

Set `STARLIGHT_CONFIG` env var to point at a custom config path.

### Full Config Reference

| Section | Field | Default | Description |
|---------|-------|---------|-------------|
| `server.host` | string | `0.0.0.0` | Bind address |
| `server.port` | number | `7878` | Listen port |
| `server.tls.enabled` | boolean | `false` | Enable HTTPS |
| `server.tls.cert` | path | — | TLS certificate |
| `server.tls.key` | path | — | TLS private key |
| `tokens[].token` | string | required | Auth token for this app |
| `tokens[].name` | string | — | Human-readable label |
| `tokens[].allowed_models` | string[] | `["*"]` | Glob patterns for allowed models |
| `acp_clients[].model_prefix` | string | required | Prefix that routes to this agent |
| `acp_clients[].command` | string | required | Command to launch ACP agent |
| `acp_clients[].args` | string[] | `[]` | Arguments for the command |
| `acp_clients[].env` | map | `{}` | Extra environment variables |
| `acp_clients[].cwd` | path | null | Working directory |
| `sessions.persist` | boolean | `true` | Reuse sessions across requests |
| `sessions.idle_timeout` | number | `300` | Close idle sessions after N seconds |
| `sessions.max_sessions` | number | `10` | Maximum concurrent sessions |
| `mcp.server_name` | string | `starlight-bridge` | MCP server identity |
| `mcp.cleanup_after_request` | boolean | `true` | Deregister tools after response |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions (streaming + non-streaming) |
| `GET` | `/v1/models` | List available model prefixes |
| `GET` | `/health` | Bridge status, connected ACP clients, uptime |

## Development

```bash
npm install
npm run dev      # hot reload with tsx watch
npm test         # run vitest
npm run build    # compile to dist/
npm start        # run production build
```

## License

Apache-2.0
