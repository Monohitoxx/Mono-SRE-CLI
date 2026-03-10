/**
 * Classifies user queries as "simple" or "complex" to optimize token usage.
 * Simple queries get a condensed system prompt and lower max_tokens.
 */

// Patterns that indicate a simple, conversational query
const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|yo|嗨|你好|哈囉|早安|晚安|早上好|晚上好)\s*[!？?。.]*$/i,
  /^(thanks|thank you|thx|多謝|謝謝|感謝|辛苦了)\s*[!？?。.]*$/i,
  /^(ok|okay|好|好的|收到|明白|了解|得)\s*[!？?。.]*$/i,
  /^(bye|goodbye|再見|拜拜)\s*[!？?。.]*$/i,
  /^(yes|no|係|唔係|是|否)\s*[!？?。.]*$/i,
];

// Patterns that indicate an operation / complex query needing full context
const COMPLEX_INDICATORS = [
  // Remote operations
  /ssh|server|host|deploy|restart|service|systemctl|docker|k8s|kubernetes|connect|login|登入|連線|連接|連到/i,
  // Infrastructure
  /nginx|apache|mysql|postgres|redis|mongo|firewall|iptables|ufw/i,
  // File/config operations
  /config|conf|edit|write|modify|update|install|remove|delete/i,
  // Troubleshooting
  /error|fail|crash|down|issue|debug|troubleshoot|log|check|diagnos/i,
  // Planning
  /plan|execute|run|setup|migrate|backup|restore|upgrade/i,
  // Inventory
  /inventory|host|machine|server|node/i,
  // Skill/memory
  /skill|memory|snapshot|baseline/i,
];

export type QueryComplexity = "simple" | "complex";

export function classifyQuery(message: string): QueryComplexity {
  const trimmed = message.trim();

  // Very short messages without complex indicators are likely simple
  if (trimmed.length <= 20) {
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(trimmed)) return "simple";
    }
  }

  // Check for complex indicators
  for (const pattern of COMPLEX_INDICATORS) {
    if (pattern.test(trimmed)) return "complex";
  }

  // Short messages (< 30 chars) without complex indicators are likely simple
  if (trimmed.length < 30 && !trimmed.includes("\n")) {
    return "simple";
  }

  return "complex";
}
