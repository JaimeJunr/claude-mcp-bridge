#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  checkSession,
  fireClaude,
  MAX_TURNS,
  OPUS_MODEL,
  runClaude,
  type CliResult,
} from "./cli.js";

const server = new McpServer({ name: "claude-mcp-bridge", version: "0.4.0" });

const OPUS_WARNING =
  `⚠️ OPUS ONLY — ${OPUS_MODEL} is expensive but very capable. Use for complex reasoning, architecture questions, and heavy autonomous work. Do NOT use for cheap exploration (grep, file listing, simple edits).`;

const BLOCK_NESTED =
  "Nested MCP delegation is blocked: this Opus session cannot call claude-mcp-bridge (or any MCP) again.";

const routing = {
  cwd: z.string().optional().describe("Absolute path to the project root. Defaults to the server's cwd."),
  effort: z
    .string()
    .optional()
    .describe("Reasoning effort: 'low' | 'medium' | 'high'. Default: high. Higher = deeper, slower, costlier."),
};

function format(res: CliResult, hint?: string): { content: { type: "text"; text: string }[] } {
  const footer = res.sessionId
    ? `\n\n---\nsession_id: ${res.sessionId} (pass to follow_up to continue this session)`
    : "";
  const extra = hint ? `\n\n${hint}` : "";
  return { content: [{ type: "text", text: res.text + footer + extra }] };
}

server.registerTool(
  "ask",
  {
    description: `${OPUS_WARNING} Ask Opus a question — read-only analysis (architecture, code explanation, planning). Like claudecode({ prompt: "Explain the architecture" }). Does NOT modify files. ${BLOCK_NESTED}`,
    inputSchema: {
      prompt: z.string().describe("The question or analysis request for Opus."),
      ...routing,
    },
  },
  async ({ prompt, cwd, effort }) =>
    format(await runClaude({ prompt, mode: "ask", cwd, effort }), BLOCK_NESTED),
);

server.registerTool(
  "delegate",
  {
    description: `${OPUS_WARNING} Delegate a complete autonomous task to Opus (claude -p). Full tool access (read, edit, shell) in cwd, max ${MAX_TURNS} agentic turns. Use for refactors, multi-file implementation, running/fixing tests. For read-only questions use ask instead. ${BLOCK_NESTED}`,
    inputSchema: {
      prompt: z.string().describe("The complete task prompt for Opus."),
      ...routing,
    },
  },
  async ({ prompt, cwd, effort }) =>
    format(
      await runClaude({ prompt, mode: "delegate", cwd, effort }),
      `max_turns: ${MAX_TURNS}. ${BLOCK_NESTED}`,
    ),
);

server.registerTool(
  "follow_up",
  {
    description: `${OPUS_WARNING} Continue a previous Opus session by session_id (from ask, delegate, or fire). Prior context lives on Claude's side — do not resend it. ${BLOCK_NESTED}`,
    inputSchema: {
      session_id: z.string().describe("The session id returned by a previous claude-mcp-bridge call."),
      question: z.string().describe("The follow-up question or instruction."),
      mode: z
        .enum(["ask", "delegate"])
        .optional()
        .describe("Session mode: 'ask' (read-only) or 'delegate' (can edit). Default: ask."),
      ...routing,
    },
  },
  async ({ session_id, question, mode, cwd, effort }) =>
    format(
      await runClaude({
        prompt: question,
        mode: mode ?? "ask",
        resume: session_id,
        cwd,
        effort,
      }),
      BLOCK_NESTED,
    ),
);

server.registerTool(
  "fire",
  {
    description: `${OPUS_WARNING} Fire-and-forget: dispatch an autonomous Opus task in the background (claude --bg). Returns session_id immediately — keep working and poll with check. Max ${MAX_TURNS} turns. Example: fire({ prompt: "Refactor the auth module to use JWT" }). ${BLOCK_NESTED}`,
    inputSchema: {
      prompt: z.string().describe("The complete task for Opus to run in the background."),
      name: z.string().optional().describe("Optional session name for easier identification in claude agents."),
      session_id: z
        .string()
        .optional()
        .describe("Optional existing session id to continue (omit to start a new background session)."),
      ...routing,
    },
  },
  async ({ prompt, name, session_id, cwd, effort }) => {
    const { sessionId, raw } = await fireClaude({
      prompt,
      name,
      resume: session_id,
      cwd,
      effort,
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `session_id: ${sessionId}`,
            `status: running (background)`,
            `max_turns: ${MAX_TURNS}`,
            "",
            "Poll progress anytime:",
            `  check({ session_id: "${sessionId}" })`,
            "",
            raw,
            "",
            BLOCK_NESTED,
          ].join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "check",
  {
    description:
      "Compact progress report for a background Opus session started with fire. Returns status and session metadata. Much cheaper than resuming the full session. Set detailed=true to include last message text.",
    inputSchema: {
      session_id: z.string().describe("The session id returned by fire."),
      detailed: z.boolean().optional().describe("Include last message text (default: false)."),
      ...routing,
    },
  },
  async ({ session_id, detailed, cwd }) => {
    const report = await checkSession(session_id, cwd, detailed ?? false);
    return { content: [{ type: "text", text: report.summary }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
