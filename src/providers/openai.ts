import OpenAI from "openai";
import type { AIProvider } from "./base.js";
import type {
  Message,
  StreamEvent,
  ToolDefinition,
  ToolCall,
  EnvConfig,
} from "../core/types.js";

// ─── <think>/<thinking> tag interceptor helpers ───────────────────────────
// Qwen models emit reasoning in <think>...</think> or <thinking>...</thinking>
// blocks inside the content stream. We intercept these and re-route them to
// reasoning_delta events so the UI can handle them separately.

const OPEN_TAGS = ["<thinking>", "<think>"];
const CLOSE_TAGS = ["</thinking>", "</think>"];

function longestPartialMatch(text: string, tags: string[]): number {
  let max = 0;
  for (const tag of tags) {
    for (let len = Math.min(tag.length - 1, text.length); len >= 1; len--) {
      if (text.endsWith(tag.slice(0, len))) {
        if (len > max) max = len;
        break;
      }
    }
  }
  return max;
}

function stripThinkWrappers(text: string): string {
  return text
    .replace(/^<think(?:ing)?>\n?/, "")
    .replace(/\n?<\/think(?:ing)?>$/, "");
}

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
    // Enable native thinking mode (opt-in via ENABLE_THINKING env var)
    if (this.config.ENABLE_THINKING) {
      extraBody.enable_thinking = true;
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

    // State machine for intercepting <think>/<thinking> blocks in content stream
    let inThinkBlock = false;
    let chunkBuf = "";

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

      // reasoning_content: explicit thinking field (direct API or some providers)
      const reasoningText =
        (delta as Record<string, unknown>).reasoning_content as string | undefined ??
        (delta as Record<string, unknown>).reasoning as string | undefined;
      if (reasoningText) {
        const cleaned = stripThinkWrappers(reasoningText);
        if (cleaned) yield { type: "reasoning_delta", text: cleaned };
      }

      // content stream: intercept <think>/<thinking> blocks
      if (delta.content) {
        let txt = chunkBuf + delta.content;
        chunkBuf = "";

        while (txt.length > 0) {
          if (!inThinkBlock) {
            // Check for orphan </think> appearing without a preceding <think>.
            // This happens when: (a) model starts thinking without <think> tag,
            // or (b) </think> leaks from reasoning_content into content stream.
            const closeMatch = txt.match(/<\/think(?:ing)?>/);
            const openMatch = txt.match(/<think(?:ing)?>/);

            if (closeMatch && (!openMatch || closeMatch.index! < openMatch.index!)) {
              // Orphan </think>: content before close tag was emitted as text_delta
              // in prior chunks. Emit any remaining pre-tag content as text_delta
              // (consistent with prior chunks), then signal thinking_boundary so the
              // app layer can retroactively move all accumulated text to thinking.
              if (closeMatch.index! > 0) {
                const before = txt.slice(0, closeMatch.index);
                fullText += before;
                yield { type: "text_delta", text: before };
              }
              yield { type: "thinking_boundary" };
              fullText = "";  // reset — prior text was thinking, not response
              txt = txt.slice(closeMatch.index! + closeMatch[0].length);
              if (txt[0] === "\n") txt = txt.slice(1);
              continue;
            }

            if (!openMatch) {
              // No opening tag — hold back potential partial tag at end
              const hold = longestPartialMatch(txt, [...OPEN_TAGS, ...CLOSE_TAGS]);
              const safe = txt.slice(0, txt.length - hold);
              if (safe) { fullText += safe; yield { type: "text_delta", text: safe }; }
              chunkBuf = txt.slice(txt.length - hold);
              break;
            }
            // Emit text before the opening tag
            if (openMatch.index! > 0) {
              const before = txt.slice(0, openMatch.index);
              fullText += before;
              yield { type: "text_delta", text: before };
            }
            txt = txt.slice(openMatch.index! + openMatch[0].length);
            if (txt[0] === "\n") txt = txt.slice(1);
            inThinkBlock = true;
          } else {
            const closeMatch = txt.match(/<\/think(?:ing)?>/);
            if (!closeMatch) {
              // No closing tag yet — hold back potential partial close tag
              const hold = longestPartialMatch(txt, CLOSE_TAGS);
              const safe = txt.slice(0, txt.length - hold);
              if (safe) yield { type: "reasoning_delta", text: safe };
              chunkBuf = txt.slice(txt.length - hold);
              break;
            }
            if (closeMatch.index! > 0) {
              yield { type: "reasoning_delta", text: txt.slice(0, closeMatch.index) };
            }
            txt = txt.slice(closeMatch.index! + closeMatch[0].length);
            if (txt[0] === "\n") txt = txt.slice(1);
            inThinkBlock = false;
          }
        }
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

    // Flush any buffered content (shouldn't normally have incomplete tags)
    if (chunkBuf) {
      if (inThinkBlock) {
        yield { type: "reasoning_delta", text: chunkBuf };
      } else {
        fullText += chunkBuf;
        yield { type: "text_delta", text: chunkBuf };
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
