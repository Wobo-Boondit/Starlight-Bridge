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

## Development

```bash
npm install
npm run dev      # hot reload with tsx watch
npm test         # run vitest
npm run build    # compile to dist/
npm start        # run production build
```

## License

MIT
