import React from "react";
import { render } from "ink";
import meow from "meow";
import chalk from "chalk";
import { App } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { loadSettings, checkCommand } from "./config/settings.js";
import { loadSystemPrompt, PLAN_MODE_RULES } from "./config/prompt.js";
import { createProvider } from "./providers/index.js";
import { createDefaultRegistry } from "./tools/registry.js";
import { Agent } from "./core/agent.js";
import { SSHManager } from "./utils/ssh-manager.js";
import { AuditLogger } from "./utils/audit.js";
import { pickLogo } from "./ui/AsciiArt.js";
import { MONO_TIPS } from "./ui/Tips.js";
import {
  ExecuteCommandTool,
  ReadConfigTool,
  WriteConfigTool,
  ServiceControlTool,
  RunHealthcheckTool,
} from "./tools/RemoteTools/index.js";
import {
  GetServiceStatusTool,
  RestartServiceTool,
  GetSystemMetricsTool,
  CheckPortTool,
  GetLogsTool,
  ManageFirewallRuleTool,
  CheckDiskUsageTool,
} from "./tools/InfraTools/index.js";
import {
  GetAlertsTool,
  SilenceAlertTool,
  QueryMetricsTool,
  CheckUptimeTool,
  GetIncidentTimelineTool,
} from "./tools/MonitorTools/index.js";
import { InventoryLookupTool } from "./tools/InventoryTool/index.js";
import { InventoryAddTool, InventoryRemoveTool } from "./tools/InventoryTool/manage.js";
import { PlanProgressTool } from "./tools/PlanTool/progress.js";
import { SkillManager } from "./skills/manager.js";
import { ActivateSkillTool } from "./tools/ActivateSkillTool/index.js";
import { loadMemories } from "./tools/MemoryTool/index.js";
import {
  CollectInfraSnapshotTool,
  QueryUserHabitsTool,
  QueryInfraStateTool,
} from "./tools/MemoryTools/index.js";
import { initMemoryDb, closeMemoryDb } from "./memory/db.js";
import { Layer2Collector } from "./memory/layer2-collector.js";
import { Layer2Analyzer } from "./memory/layer2-analyzer.js";
import { Layer3Collector } from "./memory/layer3-collector.js";
import { Layer3Baseline } from "./memory/layer3-baseline.js";
import { MemoryContextBuilder } from "./memory/context-builder.js";
import { SubagentRunner } from "./subagent/runner.js";
import { DelegateTaskTool } from "./tools/SubagentTool/index.js";
import { initStreamDebug } from "./utils/stream-debug.js";
import { saveSession, pruneOldSessions, generateSessionId } from "./utils/session-manager.js";
import type { Message } from "./core/types.js";
import type { ChatMessage } from "./ui/ChatView.js";

const cli = meow(
  `
  Usage
    $ mono-ai

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

function printHeader(provider: string, model: string, version = "0.1.0"): void {
  const columns = process.stdout.columns ?? 80;
  const logo = pickLogo(columns);

  const logoLines = logo
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => " " + chalk.cyan.bold(line))
    .join("\n");
  process.stdout.write("\n" + logoLines + "\n\n");

  const innerWidth = Math.max(20, Math.min(columns - 4, 60));
  const top = " ╭" + "─".repeat(innerWidth) + "╮";
  const bot = " ╰" + "─".repeat(innerWidth) + "╯";
  const infoText = ` │ ${chalk.cyan.bold("Mono")}  ${chalk.dim(`v${version}`)}  ${chalk.dim("|")}  ${chalk.white(provider + "/")}${chalk.white.bold(model)}`;
  process.stdout.write(chalk.cyan(top) + "\n");
  process.stdout.write(infoText + "\n");
  process.stdout.write(chalk.cyan(bot) + "\n");

  const tip = MONO_TIPS[Math.floor(Math.random() * MONO_TIPS.length)];
  process.stdout.write("\n");
  process.stdout.write(chalk.gray("  Tips for getting started:\n"));
  process.stdout.write(chalk.gray("  1. ") + chalk.white("/help") + chalk.gray(" for available commands\n"));
  process.stdout.write(chalk.gray("  2. Ask DevOps questions, manage servers, or troubleshoot issues\n"));
  process.stdout.write(chalk.gray("  3. Be specific for the best results\n"));
  process.stdout.write("\n");
  process.stdout.write(chalk.yellow.dim("  💡 " + tip!) + "\n");
  process.stdout.write("\n");
}

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
  toolRegistry.register(new GetServiceStatusTool(sshManager));
  toolRegistry.register(new RestartServiceTool(sshManager));
  toolRegistry.register(new GetSystemMetricsTool(sshManager));
  toolRegistry.register(new CheckPortTool(sshManager));
  toolRegistry.register(new GetLogsTool(sshManager));
  toolRegistry.register(new ManageFirewallRuleTool(sshManager));
  toolRegistry.register(new CheckDiskUsageTool(sshManager));
  toolRegistry.register(new GetAlertsTool(sshManager));
  toolRegistry.register(new SilenceAlertTool(sshManager));
  toolRegistry.register(new QueryMetricsTool(sshManager));
  toolRegistry.register(new CheckUptimeTool(sshManager));
  toolRegistry.register(new GetIncidentTimelineTool(sshManager));
  toolRegistry.register(new InventoryLookupTool());
  toolRegistry.register(new InventoryAddTool());
  toolRegistry.register(new InventoryRemoveTool());
  toolRegistry.register(new PlanProgressTool());

  // Memory system
  const memoryDb = initMemoryDb();
  const layer2Collector = new Layer2Collector(memoryDb, audit.sessionId);
  layer2Collector.attach(audit);
  const layer3Collector = new Layer3Collector(memoryDb, sshManager);
  const contextBuilder = new MemoryContextBuilder(memoryDb);

  toolRegistry.register(new CollectInfraSnapshotTool(layer3Collector));
  toolRegistry.register(new QueryUserHabitsTool(memoryDb));
  toolRegistry.register(new QueryInfraStateTool(memoryDb));

  // Subagent system
  const subagentRunner = new SubagentRunner(provider, toolRegistry, audit);
  toolRegistry.register(new DelegateTaskTool(subagentRunner));

  const skillManager = new SkillManager();
  await skillManager.loadAll();
  toolRegistry.register(new ActivateSkillTool(skillManager));

  const memories = await loadMemories();

  const agent = new Agent(provider, toolRegistry, (complexity) => {
    const base = loadSystemPrompt(envConfig.MODEL, complexity);
    // Simple queries get minimal prompt — skip extras
    if (complexity === "simple") return base;
    const parts = [base];
    if (planModeRef.current) parts.push(PLAN_MODE_RULES);
    const skillCatalog = skillManager.getSkillCatalogPrompt();
    if (skillCatalog) parts.push(skillCatalog);
    if (memories) parts.push(`## Saved Memories\n${memories}`);
    const memCtx = contextBuilder.buildContext({ currentHour: new Date().getHours() });
    if (memCtx) parts.push(memCtx);
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

  // Print header to stdout BEFORE Ink starts — avoids <Static> resize duplication
  printHeader(envConfig.PROVIDER, envConfig.MODEL);

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
    { patchConsole: false, exitOnCtrlC: false },
  );

  await waitUntilExit();

  // Save session after Ink exits
  if (pendingSave.conv.length > 0) {
    saveSession(sessionId, pendingSave.conv, pendingSave.chat);
    pruneOldSessions(20);
  }

  // Session-end analysis
  try {
    const analyzer = new Layer2Analyzer(memoryDb);
    analyzer.analyzeWorkflows();
    analyzer.updatePreferences();

    // Compute baselines for hosts that were operated on in this session
    const baseline = new Layer3Baseline(memoryDb);
    const operatedHosts = memoryDb.prepare(
      `SELECT DISTINCT target_host FROM user_actions WHERE session_id = ? AND target_host IS NOT NULL AND target_host NOT LIKE 'tags:%'`
    ).all(audit.sessionId) as { target_host: string }[];

    for (const { target_host } of operatedHosts) {
      baseline.computeBaselines(target_host);
    }
  } catch {
    // Best effort — never block exit
  }

  closeMemoryDb(memoryDb);
  audit.log("session_end", { durationMs: Date.now() - startTime });
  sshManager.disconnectAll();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

