import type { Message } from "./types.js";

export class Conversation {
  private messages: Message[] = [];
  private systemPrompt: string;

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
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
      { role: "system", content: this.systemPrompt },
      ...this.messages,
    ];
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
