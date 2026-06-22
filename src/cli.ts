import { spawn } from "node:child_process";

/** Binário do Claude Code. Override via env CLAUDE_BIN (ex.: caminho absoluto). */
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

/**
 * Permission mode aplicado às chamadas. Default `acceptEdits`: o Claude trabalha
 * autônomo sem prompts (que travariam em modo headless), aceitando edições.
 * Para autonomia total (shell sem restrição) use `bypassPermissions`.
 * Valores válidos: plan | default | acceptEdits | bypassPermissions.
 */
export const PERMISSION_MODE = process.env.CLAUDE_BRIDGE_PERMISSION ?? "acceptEdits";

/** Timeout padrão (ms) por delegação. Override via env CLAUDE_BRIDGE_TIMEOUT_MS. */
export const DEFAULT_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS ?? 600_000);

export interface RunOpts {
  prompt: string;
  model?: string;
  effort?: string;
  resume?: string;
  cwd?: string;
}

/**
 * Monta os argumentos do `claude -p`. Função pura — isolada para teste.
 * @example buildClaudeArgs({ prompt: "oi", model: "opus", effort: "high" })
 * // ["-p","--output-format","json","--permission-mode","acceptEdits","--model","opus","--effort","high","oi"]
 */
export function buildClaudeArgs(opts: RunOpts): string[] {
  const args = ["-p", "--output-format", "json", "--permission-mode", PERMISSION_MODE];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  return args;
}

export interface CliResult {
  text: string;
  sessionId?: string;
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

/** Roda o Claude em modo headless e devolve o resultado parseado. */
export function runClaude(opts: RunOpts): Promise<CliResult> {
  const args = buildClaudeArgs(opts);
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

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
      resolve(parseCliJson(stdout));
    });
  });
}
