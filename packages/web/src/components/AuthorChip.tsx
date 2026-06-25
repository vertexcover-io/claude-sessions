// AI-generated. See PROMPT.md for the prompts and model used.

import type { Author } from "../lib/types";

export const AuthorChip = ({ author }: { author: Author | null | undefined }) => {
  if (!author) return null;
  return (
    <span className="flex items-center gap-1" data-testid="author-chip">
      {author.avatar_url ? (
        <img
          src={author.avatar_url}
          alt=""
          className="w-4 h-4 rounded-full"
          loading="lazy"
          width={16}
          height={16}
        />
      ) : null}
      <span>{author.github_login}</span>
    </span>
  );
};
