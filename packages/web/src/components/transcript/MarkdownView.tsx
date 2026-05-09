// AI-generated. See PROMPT.md for the prompts and model used.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
}

/** Strip CSI / ANSI escape sequences (e.g. `\x1b[1m`, `\x1b[22m`,
 *  256-colour, OSC) that leak in from `<local-command-stdout>` blocks
 *  the slash-command machinery wraps shell output with. Without this
 *  the codes render as literal `\x1b[...m` in the message bubble. */
const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Matching ANSI escapes is the explicit purpose here.
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

export const MarkdownView = ({ children }: Props) => {
  return (
    <div className="prose-tight text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAnsi(children)}</ReactMarkdown>
    </div>
  );
};
