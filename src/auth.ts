import type { Config, Token } from "./config.js";

/**
 * Validate a bearer token against configured tokens.
 * Returns the matching Token config, or null if not found.
 */
export function validateToken(config: Config, token: string): Token | null {
  return config.tokens.find((t: Token) => t.token === token) ?? null;
}

/**
 * Check whether a token is allowed to access a given model.
 * Supports glob patterns: "hermes-*" matches "hermes-glm-5.2".
 */
export function isModelAllowed(token: Token, model: string): boolean {
  return token.allowed_models.some((pattern: string) => {
    if (pattern === "*") return true;
    const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return regex.test(model);
  });
}
