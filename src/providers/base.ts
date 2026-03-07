import type {
  Message,
  StreamEvent,
  ToolDefinition,
  EnvConfig,
} from "../core/types.js";

export interface ChatOptions {
  /** Override max_tokens for this request (e.g. lower for simple queries) */
  maxTokensOverride?: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<StreamEvent>;

  supportsTools(): boolean;
}

export interface AIProviderConstructor {
  new (config: EnvConfig): AIProvider;
}
