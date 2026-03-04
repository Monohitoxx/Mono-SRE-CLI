import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { loadSettings, checkCommand } from "./config/settings.js";
import { loadSystemPrompt, PLAN_MODE_RULES } from "./config/prompt.js";
import { createProvider } from "./providers/index.js";
import { createDefaultRegistry } from "./tools/registry.js";
import { Agent } from "./core/agent.js";
import { SSHManager } from "./utils/ssh-manager.js";
import { AuditLogger } from "./utils/audit.js";
import {
  ExecuteCommandTool,
  ReadConfigTool,
  WriteConfigTool,
  ServiceControlTool,
  RunHealthcheckTool,
} from "./tools/RemoteTools/index.js";
import { InventoryLookupTool } from "./tools/InventoryTool/index.js";
import { InventoryAddTool, InventoryRemoveTool } from "./tools/InventoryTool/manage.js";
import { PlanProgressTool } from "./tools/PlanTool/progress.js";
import { SkillManager } from "./skills/manager.js";
import { ActivateSkillTool } from "./tools/ActivateSkillTool/index.js";
import { loadMemories } from "./tools/MemoryTool/index.js";

const cli = meow(
  `
  Usage
    $ sre-ai

  Options
    --provider, -p  AI provider (openai/anthropic)
    --model, -m     Model name
    --help          Show help

  Commands
    /clear   Clear conversation history
    /root    Toggle root mode (enable sudo)
    /exit    Exit the application
    /help    Show available commands
`,
  {
    importMeta: import.meta,
    flags: {
      provider: { type: "string", shortFlag: "p" },
      model: { type: "string", shortFlag: "m" },
    },
  },
);

async function main() {
  const envConfig = loadEnvConfig();
  const settings = loadSettings();

  if (cli.flags.provider) {
    (envConfig as unknown as Record<string, unknown>).PROVIDER = cli.flags.provider;
  }
  if (cli.flags.model) {
    (envConfig as unknown as Record<string, unknown>).MODEL = cli.flags.model;
  }

  const cmdCheck = (cmd: string): string | null => {
    const result = checkCommand(cmd, settings);
    return result.allowed ? null : (result.reason ?? "Command not allowed");
  };

  const provider = createProvider(envConfig);
  const toolRegistry = createDefaultRegistry(cmdCheck);

  const audit = new AuditLogger();
  const startTime = Date.now();

  const planModeRef = { current: false };

  const sshManager = new SSHManager();
  sshManager.setAuditLogger(audit);
  toolRegistry.register(
    new ExecuteCommandTool(sshManager, cmdCheck),
  );
  toolRegistry.register(new ReadConfigTool(sshManager));
  toolRegistry.register(new WriteConfigTool(sshManager));
  toolRegistry.register(new ServiceControlTool(sshManager));
  toolRegistry.register(new RunHealthcheckTool(sshManager));
  toolRegistry.register(new InventoryLookupTool());
  toolRegistry.register(new InventoryAddTool());
  toolRegistry.register(new InventoryRemoveTool());
  toolRegistry.register(new PlanProgressTool());

  const skillManager = new SkillManager();
  await skillManager.loadAll();
  toolRegistry.register(new ActivateSkillTool(skillManager));

  const memories = await loadMemories();

  const agent = new Agent(provider, toolRegistry, () => {
    const base = loadSystemPrompt(envConfig.MODEL);
    const parts = [base];
    if (planModeRef.current) parts.push(PLAN_MODE_RULES);
    const skillCatalog = skillManager.getSkillCatalogPrompt();
    if (skillCatalog) parts.push(skillCatalog);
    if (memories) parts.push(`## Saved Memories\n${memories}`);
    return parts.join("\n\n");
  });
  agent.setAuditLogger(audit);

  audit.log("session_start", { provider: envConfig.PROVIDER, model: envConfig.MODEL });

  // DEC 2026 Synchronized Output: wraps each Ink render in atomic start/end markers.
  // The terminal buffers the erase+redraw and presents them together, eliminating flicker.
  // Supported by: iTerm2, Kitty, WezTerm, Windows Terminal, modern xterm.
  if (process.stdout.isTTY) {
    const SYNC_START = "\x1b[?2026h";
    const SYNC_END = "\x1b[?2026l";
    const _originalWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = function (chunk: any, enc?: any, cb?: any): boolean {
      if (typeof chunk === "string" && chunk.includes("\x1b[")) {
        return _originalWrite(SYNC_START + chunk + SYNC_END, enc, cb);
      }
      return _originalWrite(chunk, enc, cb);
    };
  }

  const { waitUntilExit } = render(
    <App
      agent={agent}
      toolRegistry={toolRegistry}
      provider={envConfig.PROVIDER}
      model={envConfig.MODEL}
      sshManager={sshManager}
      audit={audit}
      initialShowFlow={envConfig.SHOW_FLOW}
      planModeRef={planModeRef}
    />,
    { patchConsole: false },
  );

  await waitUntilExit();
  audit.log("session_end", { durationMs: Date.now() - startTime });
  sshManager.disconnectAll();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

