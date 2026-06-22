#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runClaude, type CliResult } from "./cli.js";

const server = new McpServer({ name: "claude-mcp-bridge", version: "0.2.0" });

// Params de roteamento compartilhados por todas as tools.
const routing = {
  cwd: z.string().optional().describe("Absolute path to the project root. Defaults to the server's cwd."),
  model: z
    .string()
    .optional()
    .describe("Claude model alias or full name (e.g. 'opus', 'sonnet', 'haiku'). Omit to use the default."),
  effort: z
    .string()
    .optional()
    .describe("Reasoning effort: 'low' | 'medium' | 'high'. Higher = deeper, slower, costlier."),
};

/** Anexa o session_id para permitir follow_up encadeado. */
function format(res: CliResult): { content: { type: "text"; text: string }[] } {
  const footer = res.sessionId
    ? `\n\n---\nsession_id: ${res.sessionId} (pass to follow_up to continue this session)`
    : "";
  return { content: [{ type: "text", text: res.text + footer }] };
}

server.registerTool(
  "delegate",
  {
    description:
      "Delegate a complete task to Claude Code running headless (claude -p). Claude has full tool access (read, edit, shell, web) in the given cwd and runs its own agentic loop. Use for heavy autonomous work: refactors, multi-file implementation, running and fixing tests.",
    inputSchema: { prompt: z.string().describe("The complete task prompt for Claude."), ...routing },
  },
  async ({ prompt, cwd, model, effort }) => format(await runClaude({ prompt, cwd, model, effort })),
);

server.registerTool(
  "adversarial_review",
  {
    description:
      "Get an adversarial code/plan review from Claude. Claude hunts for bugs, edge cases, security issues, race conditions and unstated assumptions. USE THIS before merging or committing. Read-only: Claude is instructed not to modify files.",
    inputSchema: {
      content: z.string().optional().describe("Inline content to review (plan, diff, code snippet)."),
      files: z.array(z.string()).optional().describe("File paths to review instead of inline content."),
      focus: z.string().optional().describe("Optional focus area, e.g. 'security', 'concurrency'."),
      ...routing,
    },
  },
  async ({ content, files, focus, cwd, model, effort }) => {
    const target = files?.length ? `the files: ${files.join(", ")}` : "the content below";
    const focusLine = focus ? `\nFocus especially on: ${focus}.` : "";
    const body = content ? `\n\n--- CONTENT ---\n${content}` : "";
    const prompt = `Do a strict adversarial review of ${target}. Do NOT modify any files — this is read-only analysis. Hunt for correctness bugs, security flaws, edge cases, race conditions, and unstated assumptions. Be specific: cite file:line and give a concrete fix for each finding. Classify each as blocker / warning / suggestion.${focusLine}${body}`;
    return format(await runClaude({ prompt, cwd, model, effort }));
  },
);

server.registerTool(
  "web_lookup",
  {
    description:
      "Delegate a web/documentation lookup to Claude (with web access): library docs, API references, error messages, current versions. Use when you need information that may be newer than your training data.",
    inputSchema: { query: z.string().describe("What to look up on the web."), ...routing },
  },
  async ({ query, cwd, model, effort }) => {
    const prompt = `Look this up on the web and answer concisely with sources/links.\n\nQuery: ${query}`;
    return format(await runClaude({ prompt, cwd, model, effort }));
  },
);

server.registerTool(
  "follow_up",
  {
    description:
      "Continue a previous Claude session by session_id (returned by every other tool). The prior context lives on Claude's side, so you don't resend it.",
    inputSchema: {
      session_id: z.string().describe("The session id returned by a previous claude-mcp-bridge call."),
      question: z.string().describe("The follow-up question."),
      ...routing,
    },
  },
  async ({ session_id, question, cwd, model, effort }) =>
    format(await runClaude({ prompt: question, resume: session_id, cwd, model, effort })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
