// AI-generated. See PROMPT.md for the prompts and model used.

import { type ChildProcess, type ExecFileException, execFile } from "node:child_process";

export interface RunClaudeOptions {
  systemPrompt: string;
  userMessage: string;
  schema: object;
  model?: string;
  bin?: string;
  timeoutMs?: number;
  execFileImpl?: typeof execFile;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeRunMeta {
  duration_ms: number | null;
  duration_api_ms: number | null;
  num_turns: number | null;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: ClaudeUsage;
  raw_usage: unknown;
}

export interface RunClaudeResult {
  output: unknown;
  meta: ClaudeRunMeta;
}

const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "NotebookEdit",
  "TodoWrite",
];

interface ClaudeEnvelope {
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  stop_reason?: string;
  total_cost_usd?: number;
  usage?: unknown;
}

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

const extractUsage = (raw: unknown): ClaudeUsage => {
  if (!raw || typeof raw !== "object") {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
  }
  const u = raw as Record<string, unknown>;
  return {
    input_tokens: asNumber(u.input_tokens) ?? 0,
    output_tokens: asNumber(u.output_tokens) ?? 0,
    cache_creation_input_tokens: asNumber(u.cache_creation_input_tokens) ?? 0,
    cache_read_input_tokens: asNumber(u.cache_read_input_tokens) ?? 0,
  };
};

const extractMeta = (env: ClaudeEnvelope): ClaudeRunMeta => ({
  duration_ms: asNumber(env.duration_ms),
  duration_api_ms: asNumber(env.duration_api_ms),
  num_turns: asNumber(env.num_turns),
  stop_reason: asString(env.stop_reason),
  total_cost_usd: asNumber(env.total_cost_usd) ?? 0,
  usage: extractUsage(env.usage),
  raw_usage: env.usage ?? null,
});

const decodeOutput = (env: ClaudeEnvelope): unknown => {
  if (env.is_error) {
    throw new Error(`claude reported is_error: ${env.result ?? "(no result)"}`);
  }
  if (env.structured_output !== undefined && env.structured_output !== null) {
    return env.structured_output;
  }
  if (typeof env.result === "string" && env.result.trim().length > 0) {
    try {
      return JSON.parse(env.result);
    } catch {
      throw new Error(`claude result string was not valid JSON: ${env.result.slice(0, 256)}`);
    }
  }
  throw new Error("claude envelope had neither structured_output nor parseable result");
};

const decodeEnvelope = (stdout: string): RunClaudeResult => {
  let env: ClaudeEnvelope;
  try {
    env = JSON.parse(stdout) as ClaudeEnvelope;
  } catch {
    throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 256)}`);
  }
  const meta = extractMeta(env);
  const output = decodeOutput(env);
  return { output, meta };
};

const runOnce = (
  bin: string,
  args: readonly string[],
  input: string,
  timeoutMs: number,
  execFileImpl: typeof execFile,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child: ChildProcess = execFileImpl(
      bin,
      args as string[],
      {
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (err: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        if (err) {
          const errMsg =
            typeof stderr === "string"
              ? stderr
              : Buffer.isBuffer(stderr)
                ? stderr.toString("utf8")
                : err.message;
          reject(new Error(`claude failed (rc=${err.code ?? "?"}): ${errMsg || err.message}`));
          return;
        }
        if (typeof stdout === "string") resolve(stdout);
        else resolve(stdout.toString("utf8"));
      },
    );
    if (child.stdin) {
      child.stdin.end(input);
    }
  });

export const runClaude = async (opts: RunClaudeOptions): Promise<RunClaudeResult> => {
  const bin = opts.bin ?? "claude";
  const args: string[] = [
    "-p",
    "--model",
    opts.model ?? "sonnet",
    "--append-system-prompt",
    opts.systemPrompt,
    "--json-schema",
    JSON.stringify(opts.schema),
    "--output-format",
    "json",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--disallowedTools",
    ...DISALLOWED_TOOLS,
    "--",
  ];
  const stdout = await runOnce(
    bin,
    args,
    opts.userMessage,
    opts.timeoutMs ?? 120_000,
    opts.execFileImpl ?? execFile,
  );
  return decodeEnvelope(stdout);
};

export const _internal = { decodeEnvelope };
