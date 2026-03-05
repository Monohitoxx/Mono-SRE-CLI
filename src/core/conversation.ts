import type { Message } from "./types.js";

export class Conversation {
  private messages: Message[] = [];
  private getSystemPrompt: () => string;

  constructor(systemPrompt: string | (() => string)) {
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

  getMessages(): Message[] {
    return [
      { role: "system", content: this.getSystemPrompt() },
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
