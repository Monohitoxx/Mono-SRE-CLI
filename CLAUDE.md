# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
When encountering AI model problems(like qwen3.5 issues), first search for official documentation online. 

## Language

Always reply in Traditional Chinese (繁體中文).

## Commands

```bash
# Build
npm run build       # Compile TypeScript with tsup → dist/

# Development
npm run dev         # Watch mode (tsup --watch)

# Run the CLI
npm run start       # Execute compiled dist/cli.js

# Type checking
npm run typecheck   # tsc --noEmit
```

There is no test framework or lint config configured in this project.

## Architecture Overview

**Mono CLI** is an AI-powered DevOps assistant with a React/Ink terminal UI, multi-provider LLM support, and SSH-based remote execution.

### Entry & Rendering

- `src/cli.tsx` — CLI entry point (meow flags). Creates the AI provider, registers all tools, loads config/inventory/memories, then renders the Ink `<App>` component.
- `src/app.tsx` — Top-level React component. Manages all UI state (messages, streaming, confirmations, plan progress, SSH host, root mode) and wires event callbacks from the Agent into UI updates.

### Agent Loop (`src/core/agent.ts`)

The agent runs a loop (max 20 iterations, extended to 60 after plan approval) with a **4-layer gate** on every tool call:

1. **Argument validation** — schema checks against tool registry
2. **Risk classification** — `src/core/risk-classifier.ts` classifies commands as read-only, low-risk, or plan-required; plan-required commands cannot execute without an approved plan
3. **Sudo-first rejection** — `execute_command` is blocked if the command uses `sudo` on the first attempt; permission errors from SSH trigger auto-escalation on retry

### AI Providers (`src/providers/`)

`createProvider(config)` factory returns either the Anthropic or OpenAI implementation, both conforming to the `AIProvider` interface. Provider/model are set via `.env` or `--provider`/`--model` CLI flags.

### Tools (`src/tools/`)

All tools extend `BaseTool` and define `name`, `description`, `parameters` (JSON schema), `validateArgs`, and `execute`. Key groups:

| Group | Tools |
|---|---|
| Remote | `execute_command`, `read_config`, `write_config`, `service_control`, `run_healthcheck` — all use SSHManager |
| Inventory | `inventory_lookup`, `inventory_add`, `inventory_remove` |
| Planning | `plan`, `plan_progress` |
| Interaction | `ask_user`, `activate_skill` |
| Local | `shell`, `file_read`, `file_write`, `grep`, `read_many_files` |
| Web | `web_fetch`, `web_search` |
| Memory | `memory` |

### Configuration & Runtime Data (`.mono/`)

The `.mono/` directory is the project config dir:
- `settings.json` — command allow/deny lists, SSH defaults
- `inventory.json` — host definitions (IP, port, credentials, tags)
- `audit.jsonl` — append-only JSONL audit log (auto-redacts secrets)
- `reason` — optional system prompt override
- `skills/` — custom skill definitions

### SSH & Sudo Policy

- `src/utils/ssh-manager.ts` — pools SSH connections; has a sudo-guard callback layer that can prompt the user before escalating
- **Sudo policy** (enforced in `src/config/prompt.ts`): never use `sudo` on first attempt; only escalate after a permission error; policy denials must not be retried
- `/root` slash command toggles root mode in the UI

### UI Components (`src/ui/`)

React/Ink components rendered in the terminal: `ChatView`, `InputBar`, `ConfirmBar` (tool approval), `SudoGuardBar`, `StatusBar`, `PlanProgress`, `Spinner`.

### Audit Logging (`src/utils/audit.ts`)

Appends JSONL events to `.mono/audit.jsonl`. Events include `session_start/end`, `tool_call/result`, `tool_approved/denied`, `sudo_approved/denied`, `plan_approved`, `auto_sudo_upgrade`. Passwords and tokens are redacted.

## Key Conventions

- Path alias `@/*` maps to `src/*` (configured in `tsconfig.json`).
- ESM only — `tsup` builds a single ESM bundle with a `#!/usr/bin/env node` shebang.
- When encountering AI model or SDK issues, search official documentation first.
