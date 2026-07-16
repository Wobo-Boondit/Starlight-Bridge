import type { Config, ACPClient } from "./config.js";

/**
 * Resolve which ACP client should handle a given model.
 * Uses longest-prefix match: "hermes-glm-5.2" → prefix "hermes".
 */
export function resolveACPClient(config: Config, model: string): ACPClient | null {
  const sorted = [...config.acp_clients].sort(
    (a: ACPClient, b: ACPClient) => b.model_prefix.length - a.model_prefix.length
  );
  for (const client of sorted) {
    if (model.startsWith(client.model_prefix)) {
      return client;
    }
  }
  return null;
}

/**
 * Strip the model prefix to get the model name the ACP agent expects.
 * "hermes-glm-5.2" with prefix "hermes" → "glm-5.2"
 */
export function stripPrefix(model: string, prefix: string): string {
  if (model.startsWith(prefix + "-")) {
    return model.slice(prefix.length + 1);
  }
  return model;
}
