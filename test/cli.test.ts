import { describe, it, expect } from "vitest";
import { buildClaudeArgs, parseCliJson } from "../src/cli.js";

describe("buildClaudeArgs", () => {
  it("always runs headless json with a permission mode", () => {
    const args = buildClaudeArgs({ prompt: "hi" });
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(args).toContain("--permission-mode");
    expect(args.at(-1)).toBe("hi");
  });

  it("passes model and effort when provided", () => {
    const args = buildClaudeArgs({ prompt: "hi", model: "opus", effort: "high" });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
  });

  it("adds --resume for follow-ups", () => {
    const args = buildClaudeArgs({ prompt: "more", resume: "abc-123" });
    expect(args[args.indexOf("--resume") + 1]).toBe("abc-123");
  });

  it("omits model/effort/resume when absent", () => {
    const args = buildClaudeArgs({ prompt: "hi" });
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--effort");
    expect(args).not.toContain("--resume");
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
