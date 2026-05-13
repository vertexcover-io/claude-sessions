// AI-generated. See PROMPT.md for the prompts and model used.

import type { SummarizationRunRow, SummarizationStats, UploadClient } from "../upload/client.js";

export interface RunsOptions {
  client: UploadClient;
  limit?: number;
  since?: string;
  status?: "ok" | "failed";
  sessionId?: string;
  sinceDays?: number;
  statsOnly?: boolean;
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padLeft = (s: string, n: number): string =>
  s.length >= n ? s : " ".repeat(n - s.length) + s;

const fmtDuration = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

const fmtUsd = (raw: string | number): string => {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(n)) return "$?";
  return `$${n.toFixed(4)}`;
};

const fmtRow = (r: SummarizationRunRow): string[] => [
  r.started_at.slice(0, 19).replace("T", " "),
  r.session_id.slice(0, 8),
  String(r.attempt),
  r.status,
  r.claude_model,
  fmtDuration(r.duration_ms),
  String(r.input_tokens),
  String(r.output_tokens),
  String(r.cache_creation_tokens),
  String(r.cache_read_tokens),
  fmtUsd(r.total_cost_usd),
];

const printTable = (rows: SummarizationRunRow[]): string => {
  if (rows.length === 0) return "no summarization runs recorded yet.\n";
  const headers = [
    "STARTED",
    "SESSION",
    "TRY",
    "STATUS",
    "MODEL",
    "DUR",
    "IN",
    "OUT",
    "CACHE-W",
    "CACHE-R",
    "COST",
  ];
  const rights = new Set([2, 5, 6, 7, 8, 9, 10]);
  const cells = rows.map(fmtRow);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => (row[i] ?? "").length)),
  );
  const render = (row: string[]): string =>
    row
      .map((c, i) => (rights.has(i) ? padLeft(c, widths[i] as number) : pad(c, widths[i] as number)))
      .join("  ");
  return `${[render(headers), ...cells.map(render)].join("\n")}\n`;
};

const printStats = (s: SummarizationStats): string => {
  const lines = [
    s.since ? `since:          ${s.since}` : "since:          (all time)",
    `calls:          ${s.calls}  (ok=${s.successes}, failed=${s.failures}, retries=${s.retries})`,
    `total cost:     ${fmtUsd(s.total_cost_usd)}`,
    `input tokens:   ${s.input_tokens}`,
    `output tokens:  ${s.output_tokens}`,
    `cache write:    ${s.cache_creation_tokens}`,
    `cache read:     ${s.cache_read_tokens}`,
    `avg duration:   ${s.avg_duration_ms === null ? "-" : fmtDuration(s.avg_duration_ms)}`,
    `p95 duration:   ${s.p95_duration_ms === null ? "-" : fmtDuration(s.p95_duration_ms)}`,
  ];
  return `${lines.join("\n")}\n`;
};

export const runsCommand = async (opts: RunsOptions): Promise<{ exit: number; output: string }> => {
  const { client } = opts;

  const statsParams: { since?: string; sinceDays?: number } = {};
  if (opts.since) statsParams.since = opts.since;
  if (opts.sinceDays !== undefined) statsParams.sinceDays = opts.sinceDays;
  const stats = await client.getSummarizationStats(statsParams);

  if (opts.statsOnly) {
    const out = printStats(stats);
    process.stdout.write(out);
    return { exit: 0, output: out };
  }

  const listParams: {
    since?: string;
    status?: "ok" | "failed";
    sessionId?: string;
    limit?: number;
  } = {};
  if (opts.since) listParams.since = opts.since;
  if (opts.status) listParams.status = opts.status;
  if (opts.sessionId) listParams.sessionId = opts.sessionId;
  if (opts.limit !== undefined) listParams.limit = opts.limit;
  const list = await client.listSummarizationRuns(listParams);

  const out = `${printTable(list.runs)}\n${printStats(stats)}`;
  process.stdout.write(out);
  return { exit: 0, output: out };
};
