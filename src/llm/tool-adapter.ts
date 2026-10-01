import type { ApprovedTool, ToolCall, ToolCallAdapter } from "./types.js";

/** Executes only tools explicitly registered by the application. It cannot mutate workflow state. */
export class AllowlistedToolCallAdapter implements ToolCallAdapter {
  /** Creates an adapter with the application's explicitly approved tools. */
  constructor(private readonly tools: ReadonlyMap<string, ApprovedTool>) {}

  /** Executes one approved tool call and rejects every unregistered tool name. */
  async execute(call: ToolCall): Promise<unknown> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`Tool is not approved: ${call.name}`);
    return tool(call.arguments);
  }
}
