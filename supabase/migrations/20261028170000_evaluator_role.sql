-- Adds the results-reviewer role.
--
-- This lives in its own migration because a new enum value cannot be used in
-- the same transaction that adds it (the next migration references it).

alter type public.user_role add value if not exists 'evaluator';
