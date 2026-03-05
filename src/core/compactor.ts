import type { AIProvider } from "../providers/base.js";
import type { Message } from "./types.js";

const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer for an SRE CLI assistant.
Summarize the following conversation concisely, preserving:
- All server/host names, IPs, ports, and connection details
- Commands executed and their key outcomes (success/failure/errors)
- Current task status and any pending actions
- Important decisions made and user preferences
- Error messages encountered and their resolutions

Output ONLY the summary. No preamble, no "Here is the summary" header.`;

const MAX_CONTENT_LEN = 500;

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const prefix = m.role.toUpperCase();
      const toolInfo = m.toolCallId ? ` (tool_result)` : "";
      const content =
        m.content.length > MAX_CONTENT_LEN
          ? m.content.slice(0, MAX_CONTENT_LEN) + "...(truncated)"
          : m.content;
      return `[${prefix}${toolInfo}] ${content}`;
    })
    .join("\n\n");
}

export async function generateCompactSummary(
  provider: AIProvider,
  messages: Message[],
): Promise<string> {
  const formatted = formatMessagesForSummary(messages);

  const summaryMessages: Message[] = [
    { role: "system", content: COMPACT_SYSTEM_PROMPT },
    { role: "user", content: `Summarize this conversation:\n\n${formatted}` },
  ];

  let summary = "";
  for await (const event of provider.chat(summaryMessages)) {
    if (event.type === "text_delta") {
      summary += event.text;
    }
  }

  return summary || "(empty conversation)";
}

export function shouldAutoCompact(
  lastInputTokens: number,
  contextLimit: number,
): boolean {
  return lastInputTokens > contextLimit * 0.7;
}
