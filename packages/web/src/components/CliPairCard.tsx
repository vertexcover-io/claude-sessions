import { useState } from "react";
import { useCliCode } from "../lib/api";

export const CliPairCard = () => {
  const cliCode = useCliCode();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!cliCode.data) return;
    await navigator.clipboard.writeText(cliCode.data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-card p-4 rounded border border-border space-y-2" data-testid="cli-pair-card">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Pair the CLI</h3>
        {cliCode.data && (
          <span className="text-xs text-muted-foreground">
            expires in {Math.floor(cliCode.data.expiresInSeconds / 60)}m
          </span>
        )}
      </div>
      {!cliCode.data && (
        <>
          <p className="text-xs text-muted-foreground">
            Generate a one-time code, then paste it into your terminal where
            <code className="font-mono mx-1">claude-sessions</code>
            is waiting.
          </p>
          <button
            type="button"
            className="text-sm rounded border border-border px-3 py-1 hover:bg-accent"
            onClick={() => cliCode.mutate()}
            disabled={cliCode.isPending}
            data-testid="cli-pair-generate"
          >
            {cliCode.isPending ? "Generating…" : "Generate code"}
          </button>
        </>
      )}
      {cliCode.data && (
        <div className="flex items-center gap-3">
          <code
            className="font-mono text-lg tracking-widest bg-muted px-3 py-1 rounded select-all"
            data-testid="cli-pair-code"
          >
            {cliCode.data.code}
          </code>
          <button
            type="button"
            className="text-xs rounded border border-border px-2 py-1 hover:bg-accent"
            onClick={() => void onCopy()}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => cliCode.reset()}
          >
            New code
          </button>
        </div>
      )}
      {cliCode.isError && <div className="text-xs text-red-500">Failed to generate code.</div>}
    </div>
  );
};
