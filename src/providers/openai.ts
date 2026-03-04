import OpenAI from "openai";
import type { AIProvider } from "./base.js";
import type {
  Message,
  StreamEvent,
  ToolDefinition,
  ToolCall,
  EnvConfig,
} from "../core/types.js";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;
  private config: EnvConfig;

  constructor(config: EnvConfig) {
    this.model = config.MODEL;
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.APIKEY || "no-key-required",
      baseURL: config.API_BASE_URL || undefined,
    });
  }

  supportsTools(): boolean {
    return true;
  }

  async *chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): AsyncIterable<StreamEvent> {
    const openaiMessages = messages.map((m) => this.toOpenAIMessage(m));

    const openaiTools = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const extraBody: Record<string, unknown> = {};
    if (this.config.REPETITION_PENALTY !== undefined) {
      extraBody.repetition_penalty = this.config.REPETITION_PENALTY;
    }
    if (this.config.TOP_K !== undefined) {
      extraBody.top_k = this.config.TOP_K;
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools?.length ? openaiTools : undefined,
      stream: true,
      stream_options: { include_usage: true },
      ...(this.config.TEMPERATURE !== undefined && {
        temperature: this.config.TEMPERATURE,
      }),
      ...(this.config.TOP_P !== undefined && { top_p: this.config.TOP_P }),
      ...(this.config.MAX_TOKENS !== undefined && {
        max_tokens: this.config.MAX_TOKENS,
      }),
      ...(this.config.FREQUENCY_PENALTY !== undefined && {
        frequency_penalty: this.config.FREQUENCY_PENALTY,
      }),
      ...(this.config.PRESENCE_PENALTY !== undefined && {
        presence_penalty: this.config.PRESENCE_PENALTY,
      }),
      ...(this.config.SEED !== undefined && { seed: this.config.SEED }),
      ...(Object.keys(extraBody).length > 0 && {
        extra_body: extraBody,
      }),
    });

    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let fullText = "";

    for await (const chunk of stream) {
      if (chunk.usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullText += delta.content;
        yield { type: "text_delta", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;

          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              arguments: "",
            });
          }

          const existing = toolCalls.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
            yield {
              type: "tool_call_delta",
              toolCallId: existing.id,
              arguments: tc.function.arguments,
            };
          }
        }
      }
    }

    const resultToolCalls: ToolCall[] = [];
    for (const [, tc] of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        // keep empty args
      }
      const toolCall: ToolCall = { id: tc.id, name: tc.name, arguments: args };
      yield { type: "tool_call_end", toolCall };
      resultToolCalls.push(toolCall);
    }

    yield {
      type: "done",
      message: {
        role: "assistant",
        content: fullText,
        toolCalls: resultToolCalls.length ? resultToolCalls : undefined,
      },
    };
  }

  private toOpenAIMessage(
    msg: Message,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId || "",
      };
    }

    if (msg.role === "assistant" && msg.toolCalls?.length) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }

    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  }
}
