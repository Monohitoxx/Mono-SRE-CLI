import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { loadSettings, isCommandAllowed } from "./config/settings.js";
import { loadSystemPrompt } from "./config/prompt.js";
import { createProvider } from "./providers/index.js";
import { createDefaultRegistry } from "./tools/registry.js";
import { Agent } from "./core/agent.js";
import {
  SSHConnectTool,
  SSHExecTool,
  SSHDisconnectTool,
} from "./tools/SSHTool/index.js";
import { SSHManager } from "./utils/ssh-manager.js";

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
  const systemPrompt = loadSystemPrompt();

  if (cli.flags.provider) {
    (envConfig as Record<string, string>).PROVIDER = cli.flags.provider;
  }
  if (cli.flags.model) {
    (envConfig as Record<string, string>).MODEL = cli.flags.model;
  }

  const provider = createProvider(envConfig);
  const toolRegistry = createDefaultRegistry((cmd) =>
    isCommandAllowed(cmd, settings),
  );

  const sshManager = new SSHManager();
  toolRegistry.register(new SSHConnectTool(sshManager));
  toolRegistry.register(new SSHExecTool(sshManager));
  toolRegistry.register(new SSHDisconnectTool(sshManager));

  const agent = new Agent(provider, toolRegistry, systemPrompt);

  const { waitUntilExit } = render(
    <App
      agent={agent}
      toolRegistry={toolRegistry}
      provider={envConfig.PROVIDER}
      model={envConfig.MODEL}
    />,
    { patchConsole: false },
  );

  await waitUntilExit();
  sshManager.disconnectAll();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
