// AI-generated. See PROMPT.md for the prompts and model used.

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  not_member: "You must be a member of the GitHub organization to sign in.",
  state: "Sign-in expired or was tampered with. Please try again.",
  oauth: "GitHub sign-in failed. Please try again.",
};

export const LoginPage = () => {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const error = new URLSearchParams(location.search).get("error");
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "Sign-in failed.") : null;

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 bg-card border border-border rounded-lg p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Claude Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in with GitHub to view sessions.
          </p>
        </div>
        {errorMessage && (
          <div className="text-sm text-red-500" data-testid="login-error">
            {errorMessage}
          </div>
        )}
        <a
          href="/api/auth/github/start"
          className="flex w-full items-center justify-center gap-2 px-3 py-2 rounded bg-foreground text-background font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
};
