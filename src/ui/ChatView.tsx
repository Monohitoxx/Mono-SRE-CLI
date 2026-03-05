import React from "react";
import { Box, Text, Static } from "ink";
import { Spinner } from "./Spinner.js";

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  isError?: boolean;
  isStreaming?: boolean;
  summary?: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  startTime: number;
  tokens: number;
  showFlow: boolean;
}

// ─── Inline Markdown ─────────────────────────────────────────────────────
// Order matters: *** before **, ** before *, etc.
// Lookbehind/lookahead on italic prevents matching inside bold markers.
const INLINE_RE =
  /`([^`\n]+)`|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|~~(.+?)~~|\[([^\]\n]+)\]\(([^)\n]+)\)/g;

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let k = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index!;
    if (idx > lastIndex) {
      parts.push(<Text key={k++}>{text.slice(lastIndex, idx)}</Text>);
    }

    if (m[1] !== undefined) {
      // `inline code`
      parts.push(
        <Text key={k++} color="yellow">
          {m[1]}
        </Text>,
      );
    } else if (m[2] !== undefined) {
      // ***bold italic***
      parts.push(
        <Text key={k++} bold italic color="white">
          {m[2]}
        </Text>,
      );
    } else if (m[3] !== undefined) {
      // **bold**
      parts.push(
        <Text key={k++} bold color="white">
          {m[3]}
        </Text>,
      );
    } else if (m[4] !== undefined) {
      // *italic*
      parts.push(
        <Text key={k++} italic>
          {m[4]}
        </Text>,
      );
    } else if (m[5] !== undefined) {
      // ~~strikethrough~~
      parts.push(
        <Text key={k++} strikethrough dimColor>
          {m[5]}
        </Text>,
      );
    } else if (m[6] !== undefined && m[7] !== undefined) {
      // [text](url)
      parts.push(
        <Text key={k++}>
          <Text underline color="blue">
            {m[6]}
          </Text>
          <Text dimColor>
            {" "}
            ({m[7]})
          </Text>
        </Text>,
      );
    }

    lastIndex = idx + m[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Text key={k++}>{text.slice(lastIndex)}</Text>);
  }

  if (parts.length === 0) {
    parts.push(<Text key={0}>{text}</Text>);
  }

  return parts;
}

function InlineMarkdown({ text, color }: { text: string; color?: string }) {
  return <Text color={color}>{renderInline(text)}</Text>;
}

// ─── Block-Level Markdown Parser ─────────────────────────────────────────

type AssistantBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "bullet"; text: string; indent: number }
  | { kind: "numbered"; text: string; index: number }
  | { kind: "task"; text: string; checked: boolean }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "hr" }
  | { kind: "table"; headers: string[]; rows: string[][] };

function parseTableCells(line: string): string[] {
  // Support both | (U+007C) and │ (U+2502 box-drawing)
  const cells = line.split(/[|│]/).map((s) => s.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// Separator: dashes (- or ─) with optional : alignment, split by | or │ or ┼
const TABLE_SEP_RE =
  /^[|│]?[\s:]*[-─]{2,}[\s:]*([|│┼][\s:]*[-─]{2,}[\s:]*)+[|│]?$/;

function parseAssistantBlocks(content: string): AssistantBlock[] {
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: AssistantBlock[] = [];
  const paragraphLines: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphLines.length = 0;
  };

  while (i < rawLines.length) {
    const raw = rawLines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // ── Code fence ──
    const fence = trimmed.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const lang = fence[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length) {
        if (/^\s*```\s*$/.test(rawLines[i].trimEnd())) {
          i++;
          break;
        }
        codeLines.push(rawLines[i]);
        i++;
      }
      blocks.push({ kind: "code", lang, code: codeLines.join("\n").trimEnd() });
      continue;
    }

    // ── Empty line ──
    if (!trimmed) {
      flushParagraph();
      i++;
      continue;
    }

    // ── Horizontal rule (---, ***, ___, ───) ──
    if (
      (/^(?:[-*_]\s*){3,}$/.test(trimmed) || /^[─━═]{3,}$/.test(trimmed)) &&
      !/^[-*+]\s+/.test(trimmed)
    ) {
      flushParagraph();
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // ── Heading ──
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    // ── Table (header + separator + rows) ──
    const hasPipe = trimmed.includes("|") || trimmed.includes("│");
    if (
      hasPipe &&
      i + 1 < rawLines.length &&
      TABLE_SEP_RE.test(rawLines[i + 1].trim())
    ) {
      flushParagraph();
      const headers = parseTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < rawLines.length) {
        const rowTrimmed = rawLines[i].trim();
        if (!rowTrimmed) break;
        const rowHasPipe =
          rowTrimmed.includes("|") || rowTrimmed.includes("│");
        if (!rowHasPipe) break;
        if (TABLE_SEP_RE.test(rowTrimmed)) {
          i++;
          continue;
        }
        rows.push(parseTableCells(rowTrimmed));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // ── Task list: - [ ] or - [x] ──
    const task = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      flushParagraph();
      blocks.push({
        kind: "task",
        checked: task[1] !== " ",
        text: task[2].trim(),
      });
      i++;
      continue;
    }

    // ── Bullet list with indent ──
    // Support -, *, +, • (U+2022), ◦ (U+25E6), ▪ (U+25AA), ▸ (U+25B8)
    const bulletMatch = raw.match(/^(\s*)([-*+•◦▪▸‣])\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      const indent = Math.floor(bulletMatch[1].length / 2);
      blocks.push({ kind: "bullet", text: bulletMatch[3].trim(), indent });
      i++;
      continue;
    }

    // ── Numbered list ──
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({
        kind: "numbered",
        index: Number(numbered[1]),
        text: numbered[2].trim(),
      });
      i++;
      continue;
    }

    // ── Block quote ──
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: "quote", text: quote[1].trim() });
      i++;
      continue;
    }

    // ── Paragraph line ──
    paragraphLines.push(trimmed);
    i++;
  }

  flushParagraph();
  return blocks;
}

// ─── Block Renderers ─────────────────────────────────────────────────────

// Strip inline markdown markers for width calculation
function stripInlineMarkers(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function TableBlock({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  const colCount = headers.length;
  const widths = headers.map((h, ci) => {
    let max = stripInlineMarkers(h).length;
    for (const row of rows) {
      const cell = row[ci] || "";
      const visible = stripInlineMarkers(cell).length;
      if (visible > max) max = visible;
    }
    return Math.min(max, 40);
  });

  const padStr = (s: string, w: number) => {
    const visible = stripInlineMarkers(s);
    const t = visible.length > w ? visible.slice(0, w - 1) + "…" : visible;
    return t + " ".repeat(Math.max(0, w - t.length));
  };

  const sepLine = widths.map((w) => "─".repeat(w)).join("─┼─");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="white" bold>
        {"  "}
        {headers.map((h, ci) => padStr(h, widths[ci] || 0)).join(" │ ")}
      </Text>
      <Text dimColor>
        {"  "}
        {sepLine}
      </Text>
      {rows.map((row, r) => (
        <Text key={r} color="cyan">
          {"  "}
          {renderInline(
            Array.from({ length: colCount }, (_, ci) => {
              const cell = row[ci] || "";
              const visible = stripInlineMarkers(cell);
              const w = widths[ci] || 0;
              const t =
                visible.length > w ? visible.slice(0, w - 1) + "…" : visible;
              const padded = t + " ".repeat(Math.max(0, w - t.length));
              return padded;
            }).join(" │ "),
          )}
        </Text>
      ))}
    </Box>
  );
}

function HrBlock() {
  const cols = Math.max(10, (process.stdout.columns || 80) - 6);
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text dimColor>{"  "}{"─".repeat(cols)}</Text>
    </Box>
  );
}

function AssistantFormatted({ content }: { content: string }) {
  const blocks = parseAssistantBlocks(content);
  if (blocks.length === 0) {
    return <InlineMarkdown text={content} color="cyan" />;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "heading": {
            const marker = block.level <= 2 ? "▣" : "▪";
            return (
              <Box key={idx} marginTop={idx === 0 ? 0 : 1}>
                <Text bold color="yellow">
                  {marker}{" "}
                  {renderInline(block.text)}
                </Text>
              </Box>
            );
          }

          case "bullet": {
            const indent = "  ".repeat(block.indent);
            const markers = ["•", "◦", "▪", "‣"];
            const marker = markers[Math.min(block.indent, markers.length - 1)];
            return (
              <Text key={idx} color="cyan">
                {indent}
                {"  "}
                {marker}{" "}
                {renderInline(block.text)}
              </Text>
            );
          }

          case "numbered":
            return (
              <Text key={idx} color="cyan">
                {"  "}
                {block.index}.{" "}
                {renderInline(block.text)}
              </Text>
            );

          case "task":
            return (
              <Text
                key={idx}
                color={block.checked ? "green" : "cyan"}
                dimColor={block.checked}
              >
                {"  "}
                {block.checked ? "☑" : "☐"}{" "}
                {block.checked ? (
                  <Text strikethrough>{block.text}</Text>
                ) : (
                  renderInline(block.text)
                )}
              </Text>
            );

          case "quote":
            return (
              <Text key={idx} color="gray" dimColor italic>
                {"  │ "}
                {renderInline(block.text)}
              </Text>
            );

          case "hr":
            return <HrBlock key={idx} />;

          case "table":
            return (
              <TableBlock
                key={idx}
                headers={block.headers}
                rows={block.rows}
              />
            );

          case "code":
            return (
              <Box
                key={idx}
                flexDirection="column"
                marginTop={1}
                borderStyle="round"
                borderColor="blue"
                paddingX={1}
              >
                {block.lang ? (
                  <Text color="blue" dimColor>
                    {block.lang}
                  </Text>
                ) : null}
                <Text color="white">
                  {block.code || "(empty code block)"}
                </Text>
              </Box>
            );

          case "paragraph":
            return (
              <InlineMarkdown key={idx} text={block.text} color="cyan" />
            );
        }
      })}
    </Box>
  );
}

// ─── Collapsed Tool Summary ─────────────────────────────────────────────

function CollapsedToolMessage({ message }: { message: ChatMessage }) {
  const icon = message.isError ? "✗" : "▸";
  const color = message.isError ? "red" : "gray";
  return (
    <Box paddingX={1}>
      <Text color={color} dimColor={!message.isError}>
        {icon} {message.summary}
      </Text>
    </Box>
  );
}

// Tools that are always shown in full, never collapsed
const NEVER_COLLAPSE = new Set(["plan", "ask_user", "activate_skill"]);

// ─── Message Components ──────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({
  message,
  showFlow,
}: {
  message: ChatMessage;
  showFlow: boolean;
}) {
  // Collapsed mode: tool messages with summary render as one-liner
  if (
    !showFlow &&
    message.role === "tool" &&
    message.summary &&
    !NEVER_COLLAPSE.has(message.toolName || "")
  ) {
    return <CollapsedToolMessage message={message} />;
  }

  switch (message.role) {
    case "user":
      return (
        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="round" borderColor="green" paddingX={1}>
            <Text bold color="green">
              {"YOU "}
              <Text color="white">{message.content}</Text>
            </Text>
          </Box>
        </Box>
      );

    case "assistant":
      return (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">
            AI RESPONSE
          </Text>
          <AssistantFormatted content={message.content} />
        </Box>
      );

    case "tool":
      if (message.toolName === "model_think") {
        return (
          <Box marginTop={1} flexDirection="column" paddingX={1}>
            <Text bold color="magenta" dimColor>{">> thinking"}</Text>
            <Text color="magenta" dimColor>
              {message.content.length > 800
                ? message.content.slice(0, 800) + "\n..."
                : message.content}
            </Text>
          </Box>
        );
      }

      if (message.toolName === "plan") {
        return (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
          >
            <Text color="cyan" bold>
              {">>> "}Execution Plan
            </Text>
            <Text color="white">{message.content}</Text>
          </Box>
        );
      }

      if (message.toolName === "ask_user") {
        return (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
          >
            <Text color="yellow" bold>
              {"? "}
            </Text>
            <Text color="white">{message.content}</Text>
          </Box>
        );
      }

      if (message.toolName === "activate_skill") {
        const skillMatch = message.content.match(/name="([^"]+)"/);
        const skillName = skillMatch ? skillMatch[1] : "unknown";
        const isError = message.isError;
        return (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor={isError ? "red" : "magenta"}
            paddingX={1}
          >
            <Text color={isError ? "red" : "magenta"} bold>
              {isError ? "✗ " : "⚡ "}Skill: {skillName}
            </Text>
            {!isError && (
              <Text color="gray" dimColor>
                Instructions loaded into context
              </Text>
            )}
            {isError && <Text color="red">{message.content}</Text>}
          </Box>
        );
      }

      return (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={message.isError ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor bold>
            [{message.toolName || "tool"}]
          </Text>
          <Text color={message.isError ? "red" : "white"} wrap="wrap">
            {message.content.length > 1200
              ? message.content.slice(0, 1200) + "\n... (truncated)"
              : message.content}
          </Text>
        </Box>
      );

    case "system":
      return (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Text color="gray">{message.content}</Text>
        </Box>
      );

    default:
      return null;
  }
});

// ─── Chat View ───────────────────────────────────────────────────────────

const KEEP_VISIBLE = 0;

export const ChatView = React.memo(function ChatView({
  messages,
  streamingText,
  isLoading,
  startTime,
  tokens,
  showFlow,
}: ChatViewProps) {
  const splitIdx = Math.max(0, messages.length - KEEP_VISIBLE);
  const frozenMessages = messages.slice(0, splitIdx);
  const recentMessages = messages.slice(splitIdx);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {frozenMessages.length > 0 && (
        <Static items={frozenMessages}>
          {(msg, i) => <MessageBubble key={i} message={msg} showFlow={showFlow} />}
        </Static>
      )}
      {recentMessages.map((msg, i) => (
        <MessageBubble key={`r-${splitIdx + i}`} message={msg} showFlow={showFlow} />
      ))}
      {streamingText && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">
            AI TYPING
          </Text>
          {(() => {
            const MAX_STREAMING_LINES = 15;
            const lines = streamingText.split('\n');
            const displayText = lines.length > MAX_STREAMING_LINES
              ? '...\n' + lines.slice(-MAX_STREAMING_LINES).join('\n')
              : streamingText;
            return <AssistantFormatted content={displayText} />;
          })()}
        </Box>
      )}
      {isLoading && !streamingText && (
        <Box marginTop={1}>
          <Spinner label="thinking" startTime={startTime} tokens={tokens} />
        </Box>
      )}
    </Box>
  );
});
