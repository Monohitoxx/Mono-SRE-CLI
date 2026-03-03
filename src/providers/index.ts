import type { EnvConfig } from "../core/types.js";
import type { AIProvider } from "./base.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export type { AIProvider } from "./base.js";

export function createProvider(config: EnvConfig): AIProvider {
  switch (config.PROVIDER) {
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    default:
      throw new Error(`Unsupported provider: ${config.PROVIDER}`);
  }
}
