import { spawn } from "node:child_process";

/** Binário do Claude Code. Override via env CLAUDE_BIN (ex.: caminho absoluto). */
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

/** Modelo fixo — este bridge só escala para Opus (caro, mas muito capaz). */
export const OPUS_MODEL = process.env.CLAUDE_BRIDGE_MODEL ?? "opus";

/** Esforço de raciocínio padrão para todas as chamadas Opus. */
export const DEFAULT_EFFORT = process.env.CLAUDE_BRIDGE_EFFORT ?? "high";

/**
 * Permission mode para delegate/fire. Default `acceptEdits`: o Claude trabalha
 * autônomo sem prompts (que travariam em modo headless), aceitando edições.
 */
export const PERMISSION_MODE = process.env.CLAUDE_BRIDGE_PERMISSION ?? "acceptEdits";

/** Limite de turns agenticos no delegate/fire. Evita loops longos e custo descontrolado. */
export const MAX_TURNS = Number(process.env.CLAUDE_BRIDGE_MAX_TURNS ?? 20);

/** Timeout padrão (ms) por chamada síncrona. Override via env CLAUDE_BRIDGE_TIMEOUT_MS. */
export const DEFAULT_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS ?? 600_000);

/** Timeout curto para fire/check (spawn + parse). */
export const SHORT_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_SHORT_TIMEOUT_MS ?? 30_000);

export type RunMode = "ask" | "delegate";

export interface RunOpts {
  prompt: string;
  mode: RunMode;
  resume?: string;
  cwd?: string;
  effort?: string;
}

export interface FireOpts {
  prompt: string;
  cwd?: string;
  effort?: string;
  name?: string;
  resume?: string;
}

export interface CliResult {
  text: string;
  sessionId?: string;
}

export interface AgentSession {
  id: string;
  status?: string;
  title?: string;
  lastMessage?: string;
  [key: string]: unknown;
}

/** Flags que impedem o Opus de re-delegar via MCP (nested bridge calls). */
const BLOCK_MCP_FLAGS = ["--strict-mcp-config", "--disallowedTools", "mcp__*"] as const;

/**
 * Monta os argumentos do `claude -p` ou `claude --bg`.
 * Função pura — isolada para teste.
 */
export function buildClaudeArgs(opts: RunOpts & { background?: boolean }): string[] {
  const effort = opts.effort ?? DEFAULT_EFFORT;
  const args: string[] = [];

  if (opts.background) {
    args.push("--bg");
  } else {
    args.push("-p", "--output-format", "json");
  }

  args.push("--model", OPUS_MODEL, "--effort", effort, ...BLOCK_MCP_FLAGS);

  if (opts.mode === "ask") {
    args.push("--permission-mode", "plan");
  } else {
    args.push("--permission-mode", PERMISSION_MODE, "--max-turns", String(MAX_TURNS));
  }

  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  return args;
}

/** Monta args para `claude --bg` (fire-and-forget). */
export function buildFireArgs(opts: FireOpts): string[] {
  const effort = opts.effort ?? DEFAULT_EFFORT;
  const args = [
    "--bg",
    "--model",
    OPUS_MODEL,
    "--effort",
    effort,
    ...BLOCK_MCP_FLAGS,
    "--permission-mode",
    PERMISSION_MODE,
    "--max-turns",
    String(MAX_TURNS),
  ];
  if (opts.name) args.push("--name", opts.name);
  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  return args;
}

/** Monta args para `claude agents --json`. */
export function buildAgentsArgs(cwd?: string, includeAll = true): string[] {
  const args = ["agents", "--json"];
  if (includeAll) args.push("--all");
  if (cwd) args.push("--cwd", cwd);
  return args;
}

/**
 * Extrai texto e session_id do JSON do `claude -p --output-format json`.
 * Cai para texto cru se o stdout não for JSON parseável.
 */
export function parseCliJson(raw: string): CliResult {
  const trimmed = raw.trim();
  try {
    const obj = JSON.parse(trimmed) as { result?: unknown; session_id?: unknown };
    return {
      text: typeof obj.result === "string" ? obj.result : trimmed,
      sessionId: typeof obj.session_id === "string" ? obj.session_id : undefined,
    };
  } catch {
    return { text: trimmed };
  }
}

/** Extrai session_id do stdout de `claude --bg`. */
export function parseBgSessionId(raw: string): string | undefined {
  const trimmed = raw.trim();

  // Tenta JSON primeiro (formato futuro/scriptável).
  try {
    const obj = JSON.parse(trimmed) as { session_id?: unknown; id?: unknown };
    if (typeof obj.session_id === "string") return obj.session_id;
    if (typeof obj.id === "string") return obj.id;
  } catch {
    // segue para heurísticas de texto
  }

  // UUID completo ou prefixo curto exibido pelo agent view.
  const uuid = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  if (uuid) return uuid[0];

  const labeled =
    trimmed.match(/session(?:\s+id)?[:\s]+["']?([a-zA-Z0-9_-]+)["']?/i) ??
    trimmed.match(/attach\s+["']?([a-zA-Z0-9_-]+)["']?/i);
  if (labeled?.[1]) return labeled[1];

  return undefined;
}

/** Parseia o array JSON de `claude agents --json`. */
export function parseAgentsJson(raw: string): AgentSession[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is AgentSession => typeof item === "object" && item !== null && "id" in item);
}

/** Encontra uma sessão pelo id (match exato ou prefixo). */
export function findAgentSession(sessions: AgentSession[], sessionId: string): AgentSession | undefined {
  const exact = sessions.find((s) => s.id === sessionId);
  if (exact) return exact;
  return sessions.find((s) => s.id.startsWith(sessionId) || sessionId.startsWith(s.id));
}

function spawnClaude(args: string[], cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: cwd ?? process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn '${CLAUDE_BIN}': ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Roda o Claude em modo headless síncrono (ask/delegate) e devolve o resultado parseado. */
export async function runClaude(opts: RunOpts): Promise<CliResult> {
  const args = buildClaudeArgs(opts);
  const stdout = await spawnClaude(args, opts.cwd);
  return parseCliJson(stdout);
}

/** Dispara tarefa em background (`claude --bg`) e devolve o session_id imediatamente. */
export async function fireClaude(opts: FireOpts): Promise<{ sessionId: string; raw: string }> {
  const args = buildFireArgs(opts);
  const stdout = await spawnClaude(args, opts.cwd, SHORT_TIMEOUT_MS);
  const sessionId = parseBgSessionId(stdout);
  if (!sessionId) {
    throw new Error(`could not parse session id from claude --bg output:\n${stdout.trim()}`);
  }
  return { sessionId, raw: stdout.trim() };
}

/** Lista sessões de background via `claude agents --json`. */
export async function listAgents(cwd?: string): Promise<AgentSession[]> {
  const args = buildAgentsArgs(cwd, true);
  const stdout = await spawnClaude(args, cwd, SHORT_TIMEOUT_MS);
  return parseAgentsJson(stdout);
}

/** Relatório compacto de progresso de uma sessão em background. */
export async function checkSession(
  sessionId: string,
  cwd?: string,
  detailed = false,
): Promise<{ found: boolean; session?: AgentSession; summary: string }> {
  const sessions = await listAgents(cwd);
  const session = findAgentSession(sessions, sessionId);

  if (!session) {
    return {
      found: false,
      summary: `Session "${sessionId}" not found. It may have completed and been cleaned up, or the id is wrong. Use fire again or check cwd.`,
    };
  }

  const status = String(session.status ?? session.state ?? "unknown");
  const title = session.title ? `title: ${session.title}` : "";
  const last =
    detailed && (session.lastMessage ?? session.last_message)
      ? `\nlast_message: ${String(session.lastMessage ?? session.last_message)}`
      : "";

  const summary = [`status: ${status}`, title, `session_id: ${session.id}`, last].filter(Boolean).join("\n");

  return { found: true, session, summary };
}
