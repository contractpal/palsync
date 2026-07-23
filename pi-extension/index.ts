import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import metadata from "./tools.json";
import helpers from "./helpers.js";

const { routeTools, eagerToolNames, activateAdditively, hasPiMcpCollision, appendPiUsage,
  isPalsyncWorkspace, completionFingerprint, completionFollowUp } = helpers;

class PalsyncClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private buffer = "";

  constructor(private workspace: string) {}

  private request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn("palsync-mcp", [], {
      cwd: this.workspace,
      env: { ...process.env, PALSYNC_WORKSPACE: this.workspace, PALSYNC_TOOL_PROFILE: "pi-minimal" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.on("data", chunk => {
      this.buffer += chunk.toString("utf8");
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id == null) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "MCP request failed"));
        else pending.resolve(message.result);
      }
    });
    this.child.on("exit", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("palsync MCP server exited"));
      this.pending.clear();
      this.child = null;
    });
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "palsync-pi", version: "1" }
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  async call(name: string, args: Record<string, unknown>): Promise<any> {
    await this.start();
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void { this.child?.kill(); }
}

export default function palsyncExtension(pi: ExtensionAPI): void {
  let client: PalsyncClient | null = null;
  let lastCompletionFingerprint: string | null = null;
  const registered = new Set<string>();

  const registerMcpTool = (tool: any) => {
    if (registered.has(tool.name)) return;
    registered.add(tool.name);
    pi.registerTool({
      name: tool.name,
      label: tool.title || tool.name,
      description: tool.description,
      promptSnippet: tool.description.slice(0, 120),
      parameters: tool.inputSchema as any,
      async execute(_id, params) {
        const result = await client!.call(tool.name, params as Record<string, unknown>);
        if (result.isError) throw new Error((result.content || []).map((item: any) => item.text || "").join("\n"));
        return { content: result.content || [], details: { tool: tool.name } };
      }
    });
  };

  const activate = (names: string[]) => {
    for (const name of names) {
      const tool = (metadata as any[]).find(item => item.name === name);
      if (tool) registerMcpTool(tool);
    }
    pi.setActiveTools(activateAdditively(pi.getActiveTools(), names));
  };

  pi.on("session_start", (_event, ctx) => {
    if (!isPalsyncWorkspace(ctx.cwd)) return;
    if (hasPiMcpCollision(pi.getActiveTools())) {
      ctx.ui.notify("PalSync native extension disabled: pi-mcp is already serving palsync. Configure that server with lifecycle:\"lazy\" or disable one integration.", "warning");
      return;
    }
    client = new PalsyncClient(ctx.cwd);
    activate(eagerToolNames(metadata as any[]));
    pi.registerTool({
      name: "pal_tools",
      label: "Activate PalSync tools",
      description: "Activate additional PalSync tools by deterministic keyword or group: sync, browser, runtime, project, spec.",
      promptSnippet: "Load PalSync tools for the current task by keyword or group",
      parameters: { type: "object", properties: { query: { type: "string", description: "Keywords or groups for tools to activate." } }, required: ["query"], additionalProperties: false } as any,
      async execute(_id, params: any) {
        if (hasPiMcpCollision(pi.getActiveTools())) throw new Error("pi-mcp is already serving palsync; configure one integration only.");
        await client!.call("pal_tools", { query: params.query });
        const names = routeTools(params.query, metadata as any[]);
        activate(names);
        return { content: [{ type: "text", text: names.length ? "Activated: " + names.join(", ") : "No PalSync tools matched that query." }], details: { activated: names } };
      }
    });
    pi.setActiveTools(activateAdditively(pi.getActiveTools(), ["pal_tools"]));
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!isPalsyncWorkspace(ctx.cwd)) return;
    try {
      const result = await pi.exec("palsync", ["hook", "completion", "--mode", "json", "--dir", ctx.cwd], { timeout: 5000 });
      if (result.code !== 0 || !result.stdout.trim()) return;
      const gate = JSON.parse(result.stdout.trim());
      const fingerprint = completionFingerprint(ctx.cwd, gate);
      if (gate.allow) lastCompletionFingerprint = null;
      const followUp = completionFollowUp(gate, fingerprint, lastCompletionFingerprint);
      if (followUp) {
        lastCompletionFingerprint = followUp.fingerprint;
        pi.sendUserMessage(followUp.message, { deliverAs: "followUp" });
      }
      if (gate.state === "BLOCKED_HANDOFF" || gate.state === "FRONTIER_HANDOFF") {
        ctx.ui.setStatus("palsync-completion", "PalSync: blocked handoff recorded");
        ctx.ui.notify(gate.message, "warning");
      } else {
        ctx.ui.setStatus("palsync-completion", undefined);
      }
    } catch (error) {
      ctx.ui.notify("PalSync completion check skipped (fail open): " + (error instanceof Error ? error.message : String(error)), "warning");
    }
  });

  pi.on("session_shutdown", () => client?.close());
  pi.on("tool_result", (event, ctx) => { appendPiUsage(ctx.cwd, event, ctx.model); });
}
