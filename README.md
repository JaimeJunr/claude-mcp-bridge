# claude-mcp-bridge

MCP server that lets **any** agent or MCP host (Cursor, Codex, Antigravity, another Claude Code,
your own app) delegate to **Claude Code** running headless (`claude -p`). Claude is the strongest
model here, so the tool surface is deliberately narrow — **reasoning, review and autonomous work**.
Cheap mechanical work (mapping a repo, scanning files) is intentionally left out: it would burn
expensive tokens, and Claude already explores natively (Explore subagent + LSP/Grep/Glob) inside
`delegate`. For cheap exploration use a lighter bridge (e.g. `cursor-mcp-bridge`).

Mirrors the ergonomics of `agy-bridge` / `codex`: every tool takes an optional **model** and
**effort**, returns a `session_id`, and supports `follow_up` to continue without resending context.

## Tools

| Tool | Purpose |
|------|---------|
| `delegate` | Full autonomous task — Claude runs its own loop with tool access in `cwd`. |
| `adversarial_review` | Strict review of a diff/plan/files: bugs, security, edge cases. Read-only. |
| `web_lookup` | Web/docs lookup via Claude's web access. |
| `follow_up` | Continue a prior session by `session_id`. |

Every tool accepts: `cwd` (project root), `model` (e.g. `opus`, `sonnet`, `haiku`), `effort`
(`low` \| `medium` \| `high`).

## Requirements

- Node ≥ 18
- [`claude`](https://claude.com/claude-code) CLI installed and authenticated (`claude` once to log in).

## Install

```bash
git clone https://github.com/JaimeJunr/claude-mcp-bridge.git
cd claude-mcp-bridge
npm install
npm run build
```

## Register in an MCP host

**Claude Code:**
```bash
claude mcp add claude-bridge -s user -- node /abs/path/to/claude-mcp-bridge/dist/index.js
```

**Cursor / Codex / any host** — add to its `mcp.json`:
```json
{
  "mcpServers": {
    "claude-bridge": {
      "command": "node",
      "args": ["/abs/path/to/claude-mcp-bridge/dist/index.js"]
    }
  }
}
```

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `CLAUDE_BIN` | `claude` | Path to the `claude` binary. |
| `CLAUDE_BRIDGE_PERMISSION` | `acceptEdits` | Permission mode: `plan` \| `default` \| `acceptEdits` \| `bypassPermissions`. |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `600000` | Per-call timeout. |

> **Security:** `acceptEdits` lets delegated Claude edit files autonomously; `bypassPermissions`
> additionally allows unrestricted shell. Only raise this for trusted workspaces. The review /
> analyze / search tools instruct Claude to stay read-only regardless.

## Develop

```bash
npm test       # vitest — unit tests for arg building / json parsing
npm run dev    # run from source via tsx
```

## License

MIT
