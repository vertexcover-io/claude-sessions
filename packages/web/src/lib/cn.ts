// AI-generated. See PROMPT.md for the prompts and model used.

export const cn = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(" ");

export const formatDuration = (startedAt: string, endedAt: string): string => {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const totalMinutes = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
};

export const formatCost = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined) return "$0.00";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
};

export const formatRepo = (canonical: string | null | undefined): string => {
  if (!canonical) return "(no repo)";
  // canonical is like "github.com/owner/repo"
  const parts = canonical.split("/");
  if (parts.length >= 3) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return canonical;
};
