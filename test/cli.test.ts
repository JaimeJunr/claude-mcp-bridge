import { describe, it, expect } from "vitest";
import {
  buildClaudeArgs,
  buildFireArgs,
  buildAgentsArgs,
  parseCliJson,
  parseBgSessionId,
  parseAgentsJson,
  findAgentSession,
  MAX_TURNS,
  OPUS_MODEL,
} from "../src/cli.js";

describe("buildClaudeArgs", () => {
  it("ask mode runs headless json with opus, plan permission, and blocks MCP", () => {
    const args = buildClaudeArgs({ prompt: "explain arch", mode: "ask" });
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe(OPUS_MODEL);
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("mcp__*");
    expect(args).not.toContain("--max-turns");
    expect(args.at(-1)).toBe("explain arch");
  });

  it("delegate mode adds max-turns and edit permission", () => {
    const args = buildClaudeArgs({ prompt: "refactor auth", mode: "delegate", effort: "high" });
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args[args.indexOf("--max-turns") + 1]).toBe(String(MAX_TURNS));
  });

  it("adds --resume for follow-ups", () => {
    const args = buildClaudeArgs({ prompt: "more", mode: "ask", resume: "abc-123" });
    expect(args[args.indexOf("--resume") + 1]).toBe("abc-123");
  });
});

describe("buildFireArgs", () => {
  it("uses --bg with opus, max-turns, and MCP block", () => {
    const args = buildFireArgs({ prompt: "fix tests", name: "nightly" });
    expect(args[0]).toBe("--bg");
    expect(args[args.indexOf("--model") + 1]).toBe(OPUS_MODEL);
    expect(args[args.indexOf("--max-turns") + 1]).toBe(String(MAX_TURNS));
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--name") + 1]).toBe("nightly");
    expect(args.at(-1)).toBe("fix tests");
  });
});

describe("buildAgentsArgs", () => {
  it("builds agents json query with cwd", () => {
    expect(buildAgentsArgs("/proj", true)).toEqual(["agents", "--json", "--all", "--cwd", "/proj"]);
  });
});

describe("parseCliJson", () => {
  it("extracts result and session_id from claude json", () => {
    const raw = JSON.stringify({ type: "result", result: "PONG", session_id: "s-1" });
    expect(parseCliJson(raw)).toEqual({ text: "PONG", sessionId: "s-1" });
  });

  it("falls back to raw text on non-json", () => {
    expect(parseCliJson("plain text")).toEqual({ text: "plain text" });
  });
});

describe("parseBgSessionId", () => {
  it("extracts UUID from bg output", () => {
    const raw = 'Background session started.\nUse `claude attach 550e8400-e29b-41d4-a716-446655440000`';
    expect(parseBgSessionId(raw)).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("extracts labeled session id", () => {
    expect(parseBgSessionId("Session ID: abc123-def")).toBe("abc123-def");
  });
});

describe("parseAgentsJson + findAgentSession", () => {
  it("parses array and finds by id or prefix", () => {
    const sessions = parseAgentsJson(
      JSON.stringify([
        { id: "550e8400-e29b-41d4-a716-446655440000", status: "running", title: "JWT refactor" },
      ]),
    );
    expect(sessions).toHaveLength(1);
    expect(findAgentSession(sessions, "550e8400")?.title).toBe("JWT refactor");
  });
});
