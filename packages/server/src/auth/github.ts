// AI-generated. See PROMPT.md for the prompts and model used.

import type { Env } from "../env.js";

export interface GithubProfile {
  id: number;
  login: string;
  avatarUrl: string;
  email: string | null;
}

/**
 * Thin seam over the GitHub OAuth web flow + REST API. Implemented with raw
 * `fetch` (no SDK), mirroring the embed providers. Injected into the auth
 * router so tests can stub it without hitting the network.
 */
export interface GithubClient {
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }>;
  getProfile(accessToken: string): Promise<GithubProfile>;
  getPrimaryEmail(accessToken: string): Promise<string | null>;
  isOrgMember(accessToken: string, org: string): Promise<boolean>;
}

const USER_AGENT = "claude-sessions";

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface UserResponse {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
}

interface EmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface MembershipResponse {
  state?: string;
}

export const createGithubClient = (env: Env): GithubClient => {
  const apiHeaders = (accessToken: string): Record<string, string> => ({
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
    "x-github-api-version": "2022-11-28",
  });

  return {
    exchangeCode: async (code, redirectUri) => {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required for OAuth");
      }
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`github token exchange failed: HTTP ${res.status} ${body}`);
      }
      const data = (await res.json()) as TokenResponse;
      if (!data.access_token) {
        throw new Error(`github token exchange failed: ${data.error_description ?? data.error}`);
      }
      return { accessToken: data.access_token };
    },

    getProfile: async (accessToken) => {
      const res = await fetch("https://api.github.com/user", {
        headers: apiHeaders(accessToken),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`github getProfile failed: HTTP ${res.status} ${body}`);
      }
      const data = (await res.json()) as UserResponse;
      return {
        id: data.id,
        login: data.login,
        avatarUrl: data.avatar_url,
        email: data.email ?? null,
      };
    },

    getPrimaryEmail: async (accessToken) => {
      const res = await fetch("https://api.github.com/user/emails", {
        headers: apiHeaders(accessToken),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as EmailResponse[];
      const primary = data.find((e) => e.primary && e.verified) ?? data.find((e) => e.verified);
      return primary?.email ?? null;
    },

    isOrgMember: async (accessToken, org) => {
      const res = await fetch(
        `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
        { headers: apiHeaders(accessToken) },
      );
      const body = await res.text().catch(() => "");
      if (!res.ok) {
        // Log the reason so org-access-restriction / scope failures (which all
        // surface as "not a member") are diagnosable instead of silent.
        console.warn(
          `org membership check failed for "${org}": HTTP ${res.status} ${body.slice(0, 200)}`,
        );
        return false;
      }
      let data: MembershipResponse = {};
      try {
        data = JSON.parse(body) as MembershipResponse;
      } catch {}
      return data.state === "active";
    },
  };
};
