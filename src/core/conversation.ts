import type { Message } from "./types.js";
import type { PromptComplexity } from "../config/prompt.js";

export class Conversation {
  private messages: Message[] = [];
  private getSystemPrompt: (complexity?: PromptComplexity) => string;

  constructor(systemPrompt: string | ((complexity?: PromptComplexity) => string)) {
    this.getSystemPrompt =
      typeof systemPrompt === "function" ? systemPrompt : () => systemPrompt;
  }

  addUser(content: string) {
    this.messages.push({ role: "user", content });
  }

  addAssistant(message: Message) {
    this.messages.push(message);
  }

  addToolResult(toolCallId: string, content: string, isError?: boolean) {
    this.messages.push({
      role: "tool",
      content: isError ? `Error: ${content}` : content,
      toolCallId,
    });
  }

  getMessages(complexity?: PromptComplexity): Message[] {
    return [
      { role: "system", content: this.getSystemPrompt(complexity) },
      ...this.messages,
    ];
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  loadHistory(messages: Message[]) {
    this.messages = [...messages];
  }

  compact(summary: string) {
    this.messages = [{ role: "user", content: summary }];
  }

  clear() {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
