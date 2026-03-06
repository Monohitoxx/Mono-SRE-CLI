# Mono AI

AI-powered DevOps & Infrastructure CLI assistant with a React/Ink terminal UI, multi-provider LLM support, and SSH-based remote execution.

## Features

- **Multi-Provider LLM** — supports OpenAI, Anthropic, and vLLM/OpenAI-compatible endpoints
- **SSH Remote Execution** — execute commands, read/write configs, control services, run health checks on remote hosts
- **Host Inventory** — manage hosts with tags, roles, and services; target by name, tag, or multi-host parallel execution
- **Plan Mode** — structured execution plans for complex infrastructure tasks with user approval
- **Skill System** — loadable domain-specific workflows (k8s-debug, ssh-troubleshoot, log-analysis, root-admin)
- **Audit Logging** — append-only JSONL audit trail with automatic secret redaction
- **Multi-Layer Security** — command allow/deny lists, risk classification, sudo policy enforcement, confirmation prompts
- **Persistent Memory** — save facts and preferences across sessions
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
| `npm test` | Run unit and integration tests |
| `npm run test:e2e` | Run end-to-end tests |

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

Optional file to override the default system prompt.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation history |
| `/root` | Toggle root mode (enable sudo) |
| `/plan` | Enter plan mode |
| `/init` | Initialize configuration |
| `/help` | Show available commands |
| `/exit` | Exit the application |

## Tools

### Remote (SSH)

| Tool | Description |
|------|-------------|
| `execute_command` | Run shell commands on remote hosts (supports multi-host parallel) |
| `read_config` | Read configuration files from remote hosts |
| `write_config` | Write config files with automatic backup |
| `service_control` | Manage systemd services (start/stop/restart/status/enable/disable) |
| `run_healthcheck` | Health checks: ping, port, http, service, disk, memory, cpu |

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

### Other

| Tool | Description |
|------|-------------|
| `ask_user` | Ask the user a question |
| `activate_skill` | Load a domain-specific skill |
| `save_memory` | Save facts to persistent memory |

## Architecture

```
src/
├── cli.tsx                  # Entry point (meow flags, ink render)
├── app.tsx                  # Top-level React component (UI state)
├── core/
│   ├── agent.ts             # Agent loop with 4-layer safety gates
│   ├── conversation.ts      # Message history
│   ├── risk-classifier.ts   # Tool risk classification
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
│   ├── PlanTool/            # Plan creation & progress
│   ├── InventoryTool/       # Host inventory management
│   ├── FileReadTool/        # Local file reading
│   ├── FileWriteTool/       # Remote file writing
│   ├── GrepTool/            # Content search
│   ├── ShellTool/           # Local shell execution
│   ├── WebSearchTool/       # Web search
│   ├── WebFetchTool/        # URL fetching
│   ├── MemoryTool/          # Persistent memory
│   ├── AskUserTool/         # User interaction
│   └── ActivateSkillTool/   # Skill loading
├── config/
│   ├── env.ts               # Environment loading
│   ├── settings.ts          # Settings & command policy
│   ├── inventory.ts         # Inventory loading
│   └── prompt.ts            # System prompt construction
├── utils/
│   ├── ssh-manager.ts       # SSH connection pool & sudo guard
│   └── audit.ts             # JSONL audit logger
├── skills/                  # Skill manager
├── commands/                # Slash command handlers
└── ui/                      # Ink React components
    ├── ChatView.tsx          # Message display & markdown
    ├── InputBar.tsx          # User input
    ├── ConfirmBar.tsx        # Tool approval prompts
    ├── SudoGuardBar.tsx      # Sudo confirmation
    ├── StatusBar.tsx         # Connection status
    ├── PlanProgress.tsx      # Plan execution tracker
    └── Spinner.tsx           # Loading indicator

.mono/                     # Runtime config directory
├── .env                     # Environment variables
├── settings.json            # Command allow/deny, SSH defaults
├── inventory.json           # Host definitions
├── audit.jsonl              # Audit log (auto-redacts secrets)
├── reason                   # Optional system prompt override
├── memory.md                # Persistent AI memory
└── skills/                  # Custom skill definitions
```

### Agent Loop

The agent runs up to 20 iterations (60 in plan mode) with a **4-layer gate** on every tool call:

1. **Argument validation** — JSON schema checks
2. **Risk classification** — read-only / low-risk / plan-required
3. **Confirmation prompt** — user approval for risky operations
4. **Execution** — tool runs with result capture

### Sudo Policy

Enforced at agent, SSH, and UI layers:

- Never use `sudo` on first attempt
- Only escalate after a permission error
- User confirmation required before sudo execution
- Policy denials are not retried

## Security

- **Audit trail** — all tool calls, approvals, and denials logged to `.mono/audit.jsonl`
- **Secret redaction** — passwords, tokens, API keys automatically scrubbed from logs
- **Command policy** — configurable allow/deny lists in `settings.json`
- **Risk classification** — dangerous commands require plan approval
- **Sudo guard** — multi-layer enforcement prevents unauthorized privilege escalation
- **Confirmation prompts** — destructive operations require explicit user approval

## License

Private
