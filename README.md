# claude-mcp-bridge

MCP server that lets **any** agent or MCP host (Cursor, Codex, Antigravity, another Claude Code,
your own app) escalate to **Opus** via **Claude Code** running headless (`claude -p` / `claude --bg`).

Opus is **expensive but very capable** — this bridge is deliberately narrow: complex reasoning,
architecture questions, adversarial review, and autonomous work. Cheap mechanical work (mapping a
repo, scanning files) should stay on the host agent's lighter model.

Nested MCP delegation is **blocked**: Opus sessions spawned by this bridge cannot call
claude-mcp-bridge (or any MCP) again.

## Tools

| Tool | Purpose | Model |
|------|---------|-------|
| `ask` | Read-only Q&A — architecture, explanation, planning (`claudecode({ prompt: "..." })`) | **Opus** (forced) |
| `delegate` | Full autonomous task — edit, shell, tests (max turns, synchronous) | **Opus** (forced) |
| `fire` | Fire-and-forget background task — returns `session_id` immediately | **Opus** (forced) |
| `check` | Compact progress report for a `fire` session | read-only (no model) |
| `follow_up` | Continue a prior session by `session_id` | **Opus** (forced) |

### Parallel background tasks

```
fire({ prompt: "Refactor the auth module to use JWT" })
→ returns session_id immediately

check({ session_id: "..." })
→ check progress anytime
```

### Examples

```json
// Ask Opus to explain architecture (read-only)
{ "prompt": "Explain the architecture of this project" }

// Delegate autonomous work (waits for completion)
{ "prompt": "Refactor auth to JWT and fix all tests" }

// Background refactor — poll while you keep working
{ "prompt": "Refactor the auth module to use JWT", "name": "JWT refactor" }
// → session_id: ...
{ "session_id": "..." }
```

Every tool accepts: `cwd` (project root), `effort` (`low` \| `medium` \| `high`, default `high`).

## Requirements

- Node ≥ 18
- [`claude`](https://claude.com/claude-code) CLI v2.1.139+ installed and authenticated (`claude` once to log in).
  Background tasks (`fire` / `check`) require `claude --bg` and `claude agents --json`.

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
| `CLAUDE_BRIDGE_MODEL` | `opus` | Model alias — always Opus in this bridge. |
| `CLAUDE_BRIDGE_EFFORT` | `high` | Default reasoning effort. |
| `CLAUDE_BRIDGE_MAX_TURNS` | `20` | Max agentic turns for `delegate` / `fire`. |
| `CLAUDE_BRIDGE_PERMISSION` | `acceptEdits` | Permission mode for delegate/fire: `plan` \| `default` \| `acceptEdits` \| `bypassPermissions`. |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `600000` | Per-call timeout for sync tools (`ask`, `delegate`). |
| `CLAUDE_BRIDGE_SHORT_TIMEOUT_MS` | `30000` | Timeout for `fire` / `check`. |

> **Security:** `acceptEdits` lets delegated Opus edit files autonomously; `bypassPermissions`
> additionally allows unrestricted shell. Only raise this for trusted workspaces. `ask` always
> uses `plan` (read-only).

## Develop

```bash
npm test       # vitest — unit tests for arg building / json parsing
npm run dev    # run from source via tsx
```

## License

MIT
