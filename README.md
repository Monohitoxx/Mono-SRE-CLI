# Mono

AI-powered DevOps & Infrastructure CLI assistant with a React/Ink terminal UI, multi-provider LLM support, and SSH-based remote execution.

## Features

- **Multi-Provider LLM** — supports OpenAI, Anthropic, and vLLM/OpenAI-compatible endpoints
- **SSH Remote Execution** — execute commands, read/write configs, control services, run health checks on remote hosts
- **Host Inventory** — manage hosts with tags, roles, and services; target by name, tag, or multi-host parallel execution
- **Plan Mode** — structured execution plans for complex infrastructure tasks with user approval
- **Skill System** — loadable domain-specific workflows (k8s-debug, ssh-troubleshoot, log-analysis, root-admin)
- **Audit Logging** — append-only JSONL audit trail with automatic secret redaction
- **Multi-Layer Security** — 4-gate agent loop, command allow/deny lists, risk classification, sudo policy enforcement, confirmation prompts
- **Three-Layer Memory** — persistent facts (Layer 1), automatic user habit tracking (Layer 2), infrastructure snapshots & baselines (Layer 3)
- **Subagent Delegation** — delegate subtasks to isolated subagents with filtered tool access and context isolation
- **Auto-Compaction** — automatic conversation compaction when approaching context limits
- **Session Persistence** — save and resume conversation sessions
- **Interactive Terminal UI** — React/Ink components with streaming, markdown rendering, plan progress tracking

## Requirements

- **Node.js** >= 20
- **SSH keys** or password credentials for remote hosts
- **API key** for your chosen LLM provider

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .mono/.env
# Edit .mono/.env with your provider, model, and API key

# Build
npm run build

# Run
npm run start
# or
node dist/cli.js
```

## Build Guide

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript with tsup to `dist/` |
| `npm run dev` | Watch mode (auto-rebuild on changes) |
| `npm run start` | Run the compiled CLI (`dist/cli.js`) |
| `npm run typecheck` | Type check without emitting (`tsc --noEmit`) |

### Build from Source

```bash
git clone <repo-url>
cd srecli
npm install
npm run build
```

The build produces a single ESM bundle at `dist/cli.js` with a Node.js shebang, ready to execute directly.

### Development Workflow

```bash
# Terminal 1: watch mode (auto-rebuild)
npm run dev

# Terminal 2: run the CLI
npm run start
```

### Global Install (optional)

```bash
npm run build
npm link
# Now available as: mono-ai
```

## Configuration

All configuration lives in the `.mono/` directory.

### Environment (`.mono/.env`)

```bash
# Provider: openai | anthropic
PROVIDER=openai
MODEL=gpt-4o
APIKEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Optional: custom API endpoint (vLLM, local models)
API_BASE_URL=http://localhost:8000/v1

# Optional: generation parameters
TEMPERATURE=0.7
TOP_P=0.8
MAX_TOKENS=4096

# Optional: context window limit (for auto-compaction)
CONTEXT_LIMIT=131072
```

See `.env.example` for all supported parameters.

### CLI Flags

```bash
mono-ai --provider openai --model gpt-4o
mono-ai -p anthropic -m claude-sonnet-4-20250514
```

### Host Inventory (`.mono/inventory.json`)

```json
{
  "hosts": {
    "prod-web01": {
      "ip": "10.0.1.10",
      "port": 22,
      "username": "ubuntu",
      "role": "web",
      "services": ["nginx", "docker"],
      "tags": ["prod", "hk"]
    }
  }
}
```

### Settings (`.mono/settings.json`)

Command allow/deny lists and SSH defaults.

### System Prompt Override (`.mono/reason`)

Optional file to override the default system prompt. System-enforced rules (sudo policy, transparency, command execution rules, research-before-answering) are always appended regardless of override.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation history |
| `/compact` | Manually compact conversation to save context |
| `/root` | Toggle root mode (enable sudo) |
| `/plan` | Toggle plan mode (require plans for all operations) |
| `/resume` | Resume a previous session |
| `/init` | Initialize configuration |
| `/help` | Show available commands |
| `/exit` | Exit the application |

## Tools

### Remote (SSH)

| Tool | Description |
|------|-------------|
| `execute_command` | Run shell commands on remote hosts (one command per call, multi-host parallel) |
| `read_config` | Read configuration files from remote hosts |
| `write_config` | Write config files with automatic backup |
| `service_control` | Manage systemd services (start/stop/restart/status/enable/disable) |
| `run_healthcheck` | Health checks: ping, port, http, service, disk, memory, cpu |

### Infrastructure

| Tool | Description |
|------|-------------|
| `get_service_status` | Get detailed service status |
| `restart_service` | Restart a service (plan-required) |
| `get_system_metrics` | Get CPU, memory, disk metrics |
| `check_port` | Check if a port is open |
| `get_logs` | Retrieve service/system logs |
| `manage_firewall_rule` | Manage firewall rules (plan-required for mutations) |
| `check_disk_usage` | Check disk usage details |

### Monitoring

| Tool | Description |
|------|-------------|
| `get_alerts` | Get active alerts |
| `silence_alert` | Silence an alert (plan-required) |
| `query_metrics` | Query time-series metrics |
| `check_uptime` | Check host uptime |
| `get_incident_timeline` | Get incident event timeline |

### Inventory

| Tool | Description |
|------|-------------|
| `inventory_lookup` | Search hosts by name, IP, tag, role, or service |
| `inventory_add` | Add a host to inventory |
| `inventory_remove` | Remove a host from inventory |

### Planning

| Tool | Description |
|------|-------------|
| `plan` | Create structured execution plans (requires user approval) |
| `plan_progress` | Update plan execution progress |

### Local

| Tool | Description |
|------|-------------|
| `shell` | Run commands on the local machine |
| `read_file` | Read local files (supports line ranges) |
| `read_many_files` | Read multiple files by paths or glob pattern |
| `grep_search` | Regex search across files |

### Web

| Tool | Description |
|------|-------------|
| `web_search` | Search the web (DuckDuckGo) |
| `web_fetch` | Fetch content from URLs |

### Memory

| Tool | Description |
|------|-------------|
| `save_memory` | Save facts to persistent memory (Layer 1) |
| `collect_infra_snapshot` | Collect infrastructure state from hosts (Layer 3) |
| `query_user_habits` | Query learned user behavior patterns (Layer 2) |
| `query_infra_state` | Query stored infrastructure state & baselines (Layer 3) |

### Subagent

| Tool | Description |
|------|-------------|
| `delegate_task` | Delegate a subtask to an isolated subagent with filtered tool access |

### Interaction

| Tool | Description |
|------|-------------|
| `ask_user` | Ask the user a question |
| `activate_skill` | Load a domain-specific skill |

## Architecture

```
src/
├── cli.tsx                  # Entry point (meow flags, ink render)
├── app.tsx                  # Top-level React component (UI state)
├── core/
│   ├── agent.ts             # Agent loop with 4-layer safety gates
│   ├── conversation.ts      # Message history management
│   ├── compactor.ts         # Conversation auto-compaction
│   ├── risk-classifier.ts   # Tool call risk classification engine
│   ├── command-policy-utils.ts  # Sudo detection, binary extraction
│   ├── policy-block-circuit.ts  # Circuit breaker for repeated policy blocks
│   └── types.ts             # Core type definitions
├── providers/
│   ├── base.ts              # AIProvider interface
│   ├── openai.ts            # OpenAI / vLLM implementation
│   ├── anthropic.ts         # Anthropic implementation
│   └── index.ts             # Provider factory
├── tools/
│   ├── base.ts              # BaseTool abstract class
│   ├── registry.ts          # Tool registry
│   ├── RemoteTools/         # SSH-based remote tools
│   ├── InfraTools/          # Infrastructure management tools
│   ├── MonitorTools/        # Monitoring & alerting tools
│   ├── PlanTool/            # Plan creation & progress
│   ├── InventoryTool/       # Host inventory management
│   ├── FileReadTool/        # Local file reading
│   ├── FileWriteTool/       # Remote file writing
│   ├── ReadManyFilesTool/   # Batch file reading
│   ├── GrepTool/            # Content search
│   ├── ShellTool/           # Local shell execution
│   ├── WebSearchTool/       # Web search
│   ├── WebFetchTool/        # URL fetching
│   ├── MemoryTool/          # Persistent memory (Layer 1)
│   ├── MemoryTools/         # Infrastructure & habit memory (Layer 2/3)
│   ├── SubagentTool/        # Subagent delegation
│   ├── AskUserTool/         # User interaction
│   └── ActivateSkillTool/   # Skill loading
├── memory/
│   ├── db.ts                # SQLite database for memory layers
│   ├── layer2-collector.ts  # Automatic user action tracking
│   ├── layer2-analyzer.ts   # Workflow & preference analysis
│   ├── layer3-collector.ts  # Infrastructure snapshot collection
│   ├── layer3-baseline.ts   # Baseline computation & anomaly detection
│   ├── context-builder.ts   # Memory context injection into prompts
│   └── types.ts             # Memory type definitions
├── subagent/
│   ├── runner.ts            # Subagent execution with context isolation
│   ├── tool-filter.ts       # Tool registry filtering (readonly/full/none)
│   └── types.ts             # Subagent type definitions
├── config/
│   ├── env.ts               # Environment loading
│   ├── settings.ts          # Settings & command policy
│   ├── inventory.ts         # Inventory loading & queries
│   └── prompt.ts            # System prompt construction & enforced rules
├── skills/
│   ├── manager.ts           # Skill lifecycle management
│   └── loader.ts            # Skill file loader
├── utils/
│   ├── ssh-manager.ts       # SSH connection pool & sudo guard
│   ├── audit.ts             # JSONL audit logger with secret redaction
│   ├── session-manager.ts   # Session save/load/resume
│   ├── logger.ts            # Application logger
│   └── stream-debug.ts      # Stream event debugging
├── commands/                # Slash command handlers
│   ├── clear.ts             # /clear
│   ├── compact.ts           # /compact
│   ├── root.ts              # /root
│   ├── plan.ts              # /plan
│   ├── resume.ts            # /resume
│   ├── init.ts              # /init
│   ├── help.ts              # /help
│   └── exit.ts              # /exit
└── ui/                      # Ink React components
    ├── ChatView.tsx          # Message display & markdown
    ├── InputBar.tsx          # User input
    ├── ConfirmBar.tsx        # Tool approval prompts
    ├── SudoGuardBar.tsx      # Sudo confirmation
    ├── StatusBar.tsx         # Connection status
    ├── Header.tsx            # Application header
    ├── PlanProgress.tsx      # Plan execution tracker
    ├── SessionPicker.tsx     # Session resume picker
    ├── Spinner.tsx           # Loading indicator
    ├── Tips.tsx              # Usage tips
    ├── AsciiArt.ts           # ASCII art banner
    └── Gradient.tsx          # Text gradient effects

.mono/                     # Runtime config directory
├── .env                     # Environment variables
├── settings.json            # Command allow/deny, SSH defaults
├── inventory.json           # Host definitions
├── audit.jsonl              # Audit log (auto-redacts secrets)
├── reason                   # System prompt override
├── memory.md                # Persistent AI memory (Layer 1)
├── memory.db                # SQLite database (Layer 2/3)
└── skills/                  # Custom skill definitions
    ├── k8s-debug/
    ├── log-analysis/
    ├── ssh-troubleshoot/
    └── root-admin/
```

### Agent Loop

The agent runs up to 20 iterations (60 after plan approval) with a **4-layer gate** on every tool call:

1. **Argument validation** — JSON schema checks against tool registry
2. **Risk classification** — read-only / low-risk / plan-required (with regex pattern matching)
3. **Sudo-first rejection** — blocks `sudo` on first attempt; auto-escalates on permission error retry
4. **User confirmation** — approval prompt for risky operations

Additional safeguards:
- **Policy block circuit breaker** — stops the agent after repeated policy violations
- **Plan nudge system** — nudges the model to continue tool execution (up to 3 times) before asking user
- **Auto-compaction** — compresses conversation history when approaching 70% of context limit
- **Duplicate plan prevention** — blocks creating a new plan while one is already active

### Sudo Policy

Enforced at agent, SSH, and UI layers:

- Never use `sudo` on first attempt — commands are always tried without sudo first
- Auto-escalation on retry — when a command fails with a permission error, the system automatically adds sudo on the next attempt of the same binary
- User confirmation required before sudo execution (main agent only; subagents inherit the policy gates except user confirmation)
- Policy denials (allowlist blocks) are never retried

### Three-Layer Memory System

| Layer | Type | Description |
|-------|------|-------------|
| **Layer 1** | Persistent facts | User-saved memories via `save_memory` (stored in `memory.md`) |
| **Layer 2** | User habits | Automatic tracking of tool usage, workflows, time patterns, preferences (SQLite) |
| **Layer 3** | Infra state | Infrastructure snapshots, resource trends, computed baselines, anomaly detection (SQLite) |

Memory context is automatically injected into the system prompt each turn, providing the AI with relevant user patterns and infrastructure state.

### Subagent System

Subtasks can be delegated to isolated subagents via `delegate_task`:

- **Context isolation** — each subagent has its own conversation history
- **Tool filtering** — `readonly` (default, safe), `full` (write access), `none` (all tools)
- **No recursion** — subagents cannot spawn further subagents
- **Safety gates** — agent gates 1–3 (validation, risk classification, sudo rejection) still apply; gate 4 (user confirmation) is auto-approved for subagents

### Prompt Architecture

The system prompt is assembled dynamically each turn:

```
┌─────────────────────────────────┐
│  Base prompt                    │  ← .mono/reason (override) OR default prompt
├─────────────────────────────────┤
│  ENFORCED_RULES                 │  ← Always appended (sudo, transparency, ask-before-guess,
│                                 │     command execution, research-before-answering)
├─────────────────────────────────┤
│  Inventory hint                 │  ← Host count, tags, services (if hosts configured)
├─────────────────────────────────┤
│  PLAN_MODE_RULES (if active)    │  ← Overrides Task Execution Policy when plan mode is on
├─────────────────────────────────┤
│  Skill catalog                  │  ← Available skill names + descriptions
├─────────────────────────────────┤
│  Saved memories                 │  ← Layer 1 persistent facts
├─────────────────────────────────┤
│  Memory context                 │  ← Layer 2/3 user habits + infra state summary
└─────────────────────────────────┘
```

## Security

- **Audit trail** — all tool calls, approvals, and denials logged to `.mono/audit.jsonl`
- **Secret redaction** — passwords, tokens, API keys automatically scrubbed from logs
- **Command policy** — configurable allow/deny lists in `settings.json`
- **Risk classification** — regex-based engine classifies commands into read-only, low-risk, or plan-required
- **Sudo guard** — multi-layer enforcement prevents unauthorized privilege escalation
- **Confirmation prompts** — destructive operations require explicit user approval
- **Policy block circuit breaker** — auto-terminates agent loop after repeated policy violations

## License

Private
