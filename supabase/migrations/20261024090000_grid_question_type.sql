-- =============================================================================
-- Grid (matrix) question type - enum value only
--
-- PostgreSQL cannot use a new enum value in the same transaction that adds it,
-- so the value is added in its own migration file. The rest of the grid support
-- lives in 20261024090100_grid_questions.sql.
-- =============================================================================

alter type public.question_type add value if not exists 'grid';
