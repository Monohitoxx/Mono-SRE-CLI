import type {
  Message,
  StreamEvent,
  ToolDefinition,
  EnvConfig,
} from "../core/types.js";

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): AsyncIterable<StreamEvent>;

  supportsTools(): boolean;
}

export interface AIProviderConstructor {
  new (config: EnvConfig): AIProvider;
}
