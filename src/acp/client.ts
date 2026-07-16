import type { ChildProcess } from "node:child_process";

// ─── JSON-RPC Types ──────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string; // for notifications
  params?: unknown;
}

// ─── ACP Client ──────────────────────────────────────────────────────

export class ACPClientWrapper {
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = "";
  private notificationHandlers = new Map<string, ((params: unknown) => void)[]>();

  constructor(
    private proc: ChildProcess,
    private label: string,
  ) {
    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[ACP ${label}]`, chunk.toString().trim());
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (msg.id !== undefined && msg.id !== null) {
          // Response to a request
          const entry = this.pending.get(msg.id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`));
            } else {
              entry.resolve(msg.result);
            }
          }
        } else if (msg.method) {
          // Notification (no id)
          const handlers = this.notificationHandlers.get(msg.method) ?? [];
          for (const handler of handlers) {
            handler(msg.params);
          }
        }
      } catch {
        // malformed line — skip
      }
    }
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    const existing = this.notificationHandlers.get(method) ?? [];
    existing.push(handler);
    this.notificationHandlers.set(method, existing);
  }

  async rpc<T = unknown>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP RPC timeout after ${timeoutMs}ms: ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.proc.stdin?.write(JSON.stringify(req) + "\n");
    });
  }

  get isAlive(): boolean {
    return this.proc.exitCode === null && this.proc.killed === false;
  }

  kill(): void {
    this.proc.kill();
  }
}
