-- Watermark column: how many canonical events were visible to the
-- summarizer when the summary row was generated. Nullable for back-compat
-- with summaries written before this column existed; the CLI populates it
-- on every fresh write so it converges to non-null in steady state.
-- Used by the backfill-vs-live distinction (REQ-007, REQ-014).

ALTER TABLE summaries ADD COLUMN summarized_event_count integer NULL;
