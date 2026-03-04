import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export type AskUserHandler = (question: string) => Promise<string>;

let _handler: AskUserHandler | null = null;

export function setAskUserHandler(handler: AskUserHandler) {
  _handler = handler;
}

export class AskUserTool extends BaseTool {
  name = "ask_user";
  description = `Ask the user a question and wait for their response. Use this when you need specific information from the user to proceed, such as:
- Credentials, hostnames, or configuration values
- Choosing between multiple options
- Confirming important details before a risky operation
- Any information you cannot infer from context

Format your question clearly. Do NOT fabricate answers — always wait for the user's actual response.`;

  parameters = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
    },
    required: ["question"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const question = args.question as string;

    if (!_handler) {
      return {
        toolCallId: "",
        content: "ask_user handler not configured. Cannot ask user.",
        isError: true,
      };
    }

    const answer = await _handler(question);

    return {
      toolCallId: "",
      content: answer || "(user provided no answer)",
    };
  }
}
