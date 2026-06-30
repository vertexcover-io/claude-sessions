// AI-generated. See PROMPT.md for the prompts and model used.

import DOMPurify from "dompurify";

/** Sanitize engine-emitted SVG and make it fit-to-width: strip the fixed
 *  pixel `width`/`height` on the root `<svg>` so its `viewBox` drives
 *  responsive scaling (paired with `max-width:100%; height:auto` in CSS).
 *  Without this the diagram keeps its intrinsic px size and overflows the
 *  drawer with a horizontal scrollbar. */
export const toFittedSvg = (raw: string): string => {
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
  return clean.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(width|height)="[^"]*"/g, "").replace(/\s(width|height)='[^']*'/g, ""),
  );
};
