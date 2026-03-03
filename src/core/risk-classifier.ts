/**
 * Risk classification engine for tool calls.
 *
 * Hard policy layer — enforced by the agent orchestrator, NOT by prompt.
 * Determines whether a tool call requires an approved plan before execution.
 */

export type RiskLevel = "read-only" | "low" | "plan-required";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  matchedPatterns: string[];
}

// ─── Plan-Required Patterns ───────────────────────────────────────────────
// Any command matching these MUST have an approved plan before execution.

const PKG_MODIFY: RegExp[] = [
  /\b(dnf|yum|apt-get|apt|zypper|pacman|brew)\s+(install|remove|erase|purge|upgrade|update|downgrade|autoremove)\b/,
  /\b(pip|pip3)\s+install\b/,
  /\bnpm\s+(install\s+-g|uninstall\s+-g)\b/,
  /\bgem\s+install\b/,
  /\b(rpm\s+-[iUe]|dpkg\s+-[ir])\b/,
];

const SVC_MODIFY: RegExp[] = [
  /\bsystemctl\s+(restart|stop|start|enable|disable|reload|mask|unmask|daemon-reload|edit)\b/,
  /\bservice\s+\S+\s+(restart|stop|start|reload)\b/,
];

const CONFIG_WRITE: RegExp[] = [
  /\b(tee|cat|echo|printf)\b.*>\s*\/etc\//,
  /\bsed\s+-i\b.*\/etc\//,
  /\b(cp|mv|ln)\b.*\/etc\//,
  /\b(vi|vim|nano|emacs)\s+\/etc\//,
  /\bchmod\b.*\/etc\//,
  /\bchown\b.*\/etc\//,
];

const FIREWALL: RegExp[] = [
  /\biptables\b/,
  /\bip6tables\b/,
  /\bfirewall-cmd\b/,
  /\bufw\s+(allow|deny|enable|disable|delete|reset)\b/,
  /\bnft\b/,
];

const DOCKER_MODIFY: RegExp[] = [
  /\bdocker\s+(run|rm|stop|kill|pull|build|push|tag|network\s+create|volume\s+rm)\b/,
  /\bdocker[\s-]compose\s+(up|down|rm|pull|build|restart|stop)\b/,
];

const K8S_MODIFY: RegExp[] = [
  /\bkubectl\s+(apply|delete|scale|rollout|patch|edit|replace|set|taint|drain|cordon|uncordon)\b/,
  /\bhelm\s+(install|upgrade|uninstall|rollback)\b/,
];

const NETWORK_MODIFY: RegExp[] = [
  /\bnmcli\s+(con|connection)\s+(add|modify|delete|up|down)\b/,
  /\bip\s+(addr|route|link)\s+(add|del|set)\b/,
  /\bifconfig\s+\S+\s+(up|down)\b/,
];

const USER_MODIFY: RegExp[] = [
  /\b(useradd|userdel|usermod|groupadd|groupdel|groupmod)\b/,
  /\b(passwd|chpasswd)\b/,
  /\bvisudo\b/,
];

const REPO_MODIFY: RegExp[] = [
  /\bdnf\s+config-manager\s+--add-repo\b/,
  /\badd-apt-repository\b/,
  /\brpm\s+--import\b/,
  /\bwget\b.*\.repo\b/,
  /\bcurl\b.*\.repo\b/,
];

const CRON_MODIFY: RegExp[] = [/\bcrontab\s+-[er]\b/, /\bat\b\s+/];

const DISK_MODIFY: RegExp[] = [
  /\b(mkfs|fdisk|parted|lvm|pvcreate|vgcreate|lvcreate)\b/,
  /\bmount\b/,
  /\bumount\b/,
  /\bdd\s+if=/,
];

const PLAN_REQUIRED_GROUPS: { name: string; patterns: RegExp[] }[] = [
  { name: "package-management", patterns: PKG_MODIFY },
  { name: "service-lifecycle", patterns: SVC_MODIFY },
  { name: "config-write", patterns: CONFIG_WRITE },
  { name: "firewall", patterns: FIREWALL },
  { name: "docker", patterns: DOCKER_MODIFY },
  { name: "kubernetes", patterns: K8S_MODIFY },
  { name: "network-config", patterns: NETWORK_MODIFY },
  { name: "user-management", patterns: USER_MODIFY },
  { name: "repo-management", patterns: REPO_MODIFY },
  { name: "cron", patterns: CRON_MODIFY },
  { name: "disk-storage", patterns: DISK_MODIFY },
];

// ─── Read-Only Patterns ───────────────────────────────────────────────────
// These are always safe to execute directly (still need normal confirmation).

const READ_ONLY_PATTERNS: RegExp[] = [
  /\bsystemctl\s+(status|is-active|is-enabled|is-failed|show|list-units|list-unit-files)\b/,
  /\bservice\s+\S+\s+status\b/,
  /\b(journalctl|dmesg)\b/,
  /\b(tail|head|cat|less|more|grep|awk|sort|wc|uniq|cut|tr)\b/,
  /\b(df|free|top|htop|uptime|w|who|last|lastlog|nproc|lscpu|lsmem|lsblk)\b/,
  /\b(ps|pgrep|pidof|lsof|fuser)\b/,
  /\b(netstat|ss|ip\s+(addr|route|link)\s+show)\b/,
  /\b(hostname|uname|id|whoami|groups|getent)\b/,
  /\bcat\s+\/etc\/(os-release|redhat-release|hostname|hosts|resolv\.conf)\b/,
  /\b(dnf|yum|apt|apt-cache)\s+(list|search|info|show|repolist|check-update)\b/,
  /\b(rpm\s+-q|dpkg\s+-[lLs])\b/,
  /\b(docker|podman)\s+(ps|images|logs|inspect|stats|port|top|version|info)\b/,
  /\bkubectl\s+(get|describe|logs|top|version|cluster-info|config\s+view)\b/,
  /\bhelm\s+(list|status|get|show|search|repo\s+list)\b/,
  /\b(curl|wget)\s+.*localhost\b/,
  /\b(ping|dig|nslookup|traceroute|tracepath|mtr|host)\b/,
  /\b(ls|find|which|whereis|type|file|stat|du)\b/,
  /\benv\b/,
  /\bprintenv\b/,
  /\becho\s+\$/,
];

// ─── Tools exempt from risk classification ────────────────────────────────
const EXEMPT_TOOLS = new Set([
  "think",
  "plan",
  "read_file",
  "write_file",
  "ssh_connect",
  "ssh_disconnect",
]);

// ─── Public API ───────────────────────────────────────────────────────────

export function classifyToolCallRisk(
  toolName: string,
  args: Record<string, unknown>,
): RiskAssessment {
  if (EXEMPT_TOOLS.has(toolName)) {
    return { level: "read-only", reason: "exempt tool", matchedPatterns: [] };
  }

  const command =
    typeof args.command === "string" ? args.command.trim() : null;

  if (!command) {
    return { level: "low", reason: "no command argument", matchedPatterns: [] };
  }

  // Check read-only first — if it matches, it's safe
  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "read-only",
        reason: "read-only operation",
        matchedPatterns: [pattern.source],
      };
    }
  }

  // Check plan-required patterns
  const matched: string[] = [];
  for (const group of PLAN_REQUIRED_GROUPS) {
    for (const pattern of group.patterns) {
      if (pattern.test(command)) {
        matched.push(group.name);
        break;
      }
    }
  }

  if (matched.length > 0) {
    return {
      level: "plan-required",
      reason: `modifying operation: ${matched.join(", ")}`,
      matchedPatterns: matched,
    };
  }

  // Commands with sudo that didn't match read-only → treat as plan-required
  if (/^\s*sudo\s/.test(command) || /\|\s*sudo\s/.test(command)) {
    return {
      level: "plan-required",
      reason: "unclassified sudo command (conservative policy)",
      matchedPatterns: ["sudo"],
    };
  }

  // Default: low risk — allow with normal confirmation
  return { level: "low", reason: "general command", matchedPatterns: [] };
}
