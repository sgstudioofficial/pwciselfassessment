-- =============================================================================
-- Widen the question payload limits
--
-- Two real question shapes from the Equipment Home Assignment bank do not fit
-- the original limits:
--
--   * The Cameron "DL" annular preventer diagram has 13 numbered callouts, so
--     its matching grid needs 13 columns (was limited to 10).
--   * Valve line-up questions ask the student to tick the open valves and list
--     up to 21 choices (was limited to 10).
--
-- Grids still cap at 15 rows / 15 columns and choice questions at 30 options.
-- =============================================================================

create or replace function public.question_choice_payload_valid(
  p_options jsonb,
  p_correct_options text[]
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p_options) = 'array'
    and jsonb_array_length(p_options) between 2 and 30
    and coalesce(array_length(p_correct_options, 1), 0) >= 1
    and (
      select count(*) = count(distinct option ->> 'id')
      from jsonb_array_elements(p_options) as option
    )
    and not exists (
      select 1
      from unnest(p_correct_options) as correct_id
      where not exists (
        select 1
        from jsonb_array_elements(p_options) as option
        where option ->> 'id' = correct_id
      )
    );
$$;

create or replace function public.question_grid_payload_valid(
  p_rows jsonb,
  p_options jsonb,
  p_correct_options text[]
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p_rows) = 'array'
    and jsonb_array_length(p_rows) between 1 and 15
    and jsonb_typeof(p_options) = 'array'
    and jsonb_array_length(p_options) between 2 and 15
    and (
      select count(*) = count(distinct row_data ->> 'id')
      from jsonb_array_elements(p_rows) as row_data
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_rows) as row_data
      where coalesce(btrim(row_data ->> 'id'), '') = ''
         or coalesce(btrim(row_data ->> 'text'), '') = ''
    )
    and (
      select count(*) = count(distinct option ->> 'id')
      from jsonb_array_elements(p_options) as option
    )
    and (
      coalesce(array_length(p_correct_options, 1), 0) = 0
      or (
        array_length(p_correct_options, 1) = jsonb_array_length(p_rows)
        and (
          select count(distinct split_part(pair, ':', 1))
          from unnest(p_correct_options) as pair
        ) = jsonb_array_length(p_rows)
        and not exists (
          select 1
          from unnest(p_correct_options) as pair
          where length(pair) - length(replace(pair, ':', '')) <> 1
             or not exists (
               select 1
               from jsonb_array_elements(p_rows) as row_data
               where row_data ->> 'id' = split_part(pair, ':', 1)
             )
             or not exists (
               select 1
               from jsonb_array_elements(p_options) as option
               where option ->> 'id' = split_part(pair, ':', 2)
             )
        )
      )
    );
$$;

grant execute on function public.question_choice_payload_valid(jsonb, text[])
  to authenticated;
grant execute on function public.question_grid_payload_valid(jsonb, jsonb, text[])
  to authenticated;
