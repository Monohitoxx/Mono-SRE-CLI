import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { loadSettings, checkCommand } from "./config/settings.js";
import { loadSystemPrompt } from "./config/prompt.js";
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
import { PlanProgressTool } from "./tools/PlanTool/progress.js";
import { SkillManager } from "./skills/manager.js";
import type { SkillDefinition } from "./core/types.js";

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
    (envConfig as Record<string, string>).PROVIDER = cli.flags.provider;
  }
  if (cli.flags.model) {
    (envConfig as Record<string, string>).MODEL = cli.flags.model;
  }

  const cmdCheck = (cmd: string): string | null => {
    const result = checkCommand(cmd, settings);
    return result.allowed ? null : (result.reason ?? "Command not allowed");
  };

  const provider = createProvider(envConfig);
  const toolRegistry = createDefaultRegistry(cmdCheck);

  const audit = new AuditLogger();
  const startTime = Date.now();

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
  toolRegistry.register(new PlanProgressTool());

  const skillManager = new SkillManager();
  await skillManager.loadAll();
  const skillsPrompt = formatSkillsPrompt(skillManager.listSkills());

  const agent = new Agent(provider, toolRegistry, () => {
    const base = loadSystemPrompt();
    return skillsPrompt ? `${base}\n\n${skillsPrompt}` : base;
  });
  agent.setAuditLogger(audit);

  audit.log("session_start", { provider: envConfig.PROVIDER, model: envConfig.MODEL });

  const { waitUntilExit } = render(
    <App
      agent={agent}
      toolRegistry={toolRegistry}
      provider={envConfig.PROVIDER}
      model={envConfig.MODEL}
      sshManager={sshManager}
      audit={audit}
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

function formatSkillsPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "## Installed Skills",
    "Use these skills when the user request matches their domain.",
  ];

  for (const skill of skills) {
    lines.push("");
    lines.push(`### ${skill.name}`);
    lines.push(skill.description);
    if (skill.body.trim()) {
      lines.push(skill.body.trim());
    }
  }

  return lines.join("\n");
}
