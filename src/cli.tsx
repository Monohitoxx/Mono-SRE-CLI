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
import { initStreamDebug } from "./utils/stream-debug.js";
import { saveSession, pruneOldSessions, generateSessionId } from "./utils/session-manager.js";
import type { Message } from "./core/types.js";
import type { ChatMessage } from "./ui/ChatView.js";

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
  initStreamDebug(envConfig.DEBUG_STREAM);
  const settings = loadSettings();

  if (cli.flags.provider) {
    (envConfig as unknown as Record<string, unknown>).PROVIDER = cli.flags.provider;
  }
  if (cli.flags.model) {
    (envConfig as unknown as Record<string, unknown>).MODEL = cli.flags.model;
  }

  const sessionAllowedBinaries = new Set<string>();
  const cmdCheck = (cmd: string): string | null => {
    const result = checkCommand(cmd, settings, sessionAllowedBinaries);
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
  }, envConfig.CONTEXT_LIMIT);
  agent.setAuditLogger(audit);

  audit.log("session_start", { provider: envConfig.PROVIDER, model: envConfig.MODEL });

  const sessionId = generateSessionId();
  const pendingSave: { conv: Message[]; chat: ChatMessage[] } = { conv: [], chat: [] };

  const handleSaveAndExit = (conv: Message[], chat: ChatMessage[]) => {
    pendingSave.conv = conv;
    pendingSave.chat = chat;
  };

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
      settings={settings}
      sessionAllowedBinaries={sessionAllowedBinaries}
      onSaveAndExit={handleSaveAndExit}
    />,
    { patchConsole: false },
  );

  await waitUntilExit();

  // Save session after Ink exits
  if (pendingSave.conv.length > 0) {
    saveSession(sessionId, pendingSave.conv, pendingSave.chat);
    pruneOldSessions(20);
  }

  audit.log("session_end", { durationMs: Date.now() - startTime });
  sshManager.disconnectAll();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

