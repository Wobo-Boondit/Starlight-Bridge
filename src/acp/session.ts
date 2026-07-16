import type { ACPClientWrapper } from "./client.js";

/**
 * An ACP session — a conversation context within an ACP agent process.
 * Handles prompt sending, model selection, and MCP server registration.
 */
export class ACPSession {
  private disposed = false;

  constructor(
    public readonly sessionId: string,
    private client: ACPClientWrapper,
  ) {}

  /**
   * Send a prompt and wait for the full response.
   * If onChunk is provided, intermediate text chunks are streamed via callback.
   */
  async prompt(
    text: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    if (this.disposed) {
      throw new Error("Session has been disposed");
    }

    // Collect streamed text from session/update notifications
    let streamedText = "";
    const handler = (params: unknown) => {
      const p = params as {
        session_id?: string;
        update?: {
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
      };
      if (p.session_id !== this.sessionId) return;
      if (p.update?.type === "agent_message_chunk" || p.update?.type === "agent_message") {
        for (const block of p.update.content ?? []) {
          if (block.type === "text" && block.text) {
            streamedText += block.text;
            onChunk?.(block.text);
          }
        }
      }
    };

    this.client.onNotification("session/update", handler);

    try {
      const result = await this.client.rpc<{
        response?: string | Array<{ type: string; text?: string }>;
        stop_reason?: string;
      }>("session/prompt", {
        session_id: this.sessionId,
        prompt: [{ type: "text", text }],
      });

      // Prefer the final response field if present
      if (result.response) {
        if (typeof result.response === "string") {
          return result.response;
        }
        // Array of content blocks
        return result.response
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text)
          .join("");
      }

      // Fall back to whatever was streamed
      return streamedText;
    } finally {
      // Note: we can't easily remove the notification handler without
      // changing the client API. For now, the session ID check filters them.
    }
  }

  /**
   * Set the model for this session.
   */
  async setModel(model: string): Promise<void> {
    await this.client.rpc("session/model", {
      session_id: this.sessionId,
      model,
    });
  }

  /**
   * Register MCP servers for this session (dynamic tool injection).
   */
  async setMcpServers(servers: unknown[]): Promise<void> {
    await this.client.rpc("session/mcpServers", {
      session_id: this.sessionId,
      mcp_servers: servers,
    });
  }

  /**
   * Dispose of this session, freeing resources on the ACP agent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.client.rpc("session/dispose", {
        session_id: this.sessionId,
      });
    } catch {
      // Session may already be gone — ignore
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
