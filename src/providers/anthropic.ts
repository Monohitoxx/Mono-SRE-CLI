import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ChatOptions } from "./base.js";
import type {
  Message,
  StreamEvent,
  ToolDefinition,
  ToolCall,
  EnvConfig,
} from "../core/types.js";

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;
  private config: EnvConfig;

  constructor(config: EnvConfig) {
    this.model = config.MODEL;
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.APIKEY,
      baseURL: config.API_BASE_URL || undefined,
    });
  }

  supportsTools(): boolean {
    return true;
  }

  async *chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<StreamEvent> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => this.toAnthropicMessage(m));

    const anthropicTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: options?.maxTokensOverride ?? this.config.MAX_TOKENS ?? 8192,
      system: systemMsg?.content || "",
      messages: nonSystemMessages,
      tools: anthropicTools?.length ? anthropicTools : undefined,
      ...(this.config.TEMPERATURE !== undefined && {
        temperature: this.config.TEMPERATURE,
      }),
      ...(this.config.TOP_P !== undefined && { top_p: this.config.TOP_P }),
    });

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let lastOutputTokens = 0;
    let currentToolUse: {
      id: string;
      name: string;
      inputJson: string;
    } | null = null;

    for await (const event of stream) {
      if (event.type === "message_start" && event.message?.usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: event.message.usage.input_tokens ?? 0,
            outputTokens: 0,
          },
        };
      } else if (
        event.type === "message_delta" &&
        (event as unknown as Record<string, unknown>).usage
      ) {
        const u = (event as unknown as Record<string, { output_tokens?: number }>).usage;
        const cumulative = u.output_tokens ?? 0;
        const delta = Math.max(0, cumulative - lastOutputTokens);
        lastOutputTokens = cumulative;
        yield {
          type: "usage",
          usage: {
            inputTokens: 0,
            outputTokens: delta,
          },
        };
      } else if (
        event.type === "content_block_start" &&
        event.content_block.type === "text"
      ) {
        // text block started
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          fullText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          if (currentToolUse) {
            currentToolUse.inputJson += event.delta.partial_json;
            yield {
              type: "tool_call_delta",
              toolCallId: currentToolUse.id,
              arguments: event.delta.partial_json,
            };
          }
        }
      } else if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        currentToolUse = {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: "",
        };
      } else if (event.type === "content_block_stop") {
        if (currentToolUse) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(currentToolUse.inputJson || "{}");
          } catch {
            // keep empty
          }
          const tc: ToolCall = {
            id: currentToolUse.id,
            name: currentToolUse.name,
            arguments: args,
          };
          toolCalls.push(tc);
          yield { type: "tool_call_end", toolCall: tc };
          currentToolUse = null;
        }
      }
    }

    yield {
      type: "done",
      message: {
        role: "assistant",
        content: fullText,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
    };
  }

  private toAnthropicMessage(
    msg: Message,
  ): Anthropic.MessageParam {
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments as Record<string, unknown>,
        });
      }
      return { role: "assistant", content };
    }

    if (msg.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId || "",
            content: msg.content,
          },
        ],
      };
    }

    return {
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    };
  }
}
