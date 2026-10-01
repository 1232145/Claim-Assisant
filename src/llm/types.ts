import type { LlmTurnProposal, SessionState } from "../shared/index.js";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmCompletionClient {
  complete(messages: LlmMessage[], responseSchema: object): Promise<unknown>;
}

export interface LlmAdapterOptions {
  client?: LlmCompletionClient;
  env?: NodeJS.ProcessEnv;
}

export interface ProposalResolver {
  propose(state: SessionState, message: string): Promise<LlmTurnProposal>;
}

export type ApprovedTool = (arguments_: Record<string, unknown>) => unknown | Promise<unknown>;

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallAdapter {
  execute(call: ToolCall): Promise<unknown>;
}
