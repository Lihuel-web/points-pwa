-- ================================================================
-- Migration: 08_fix_leaderboard_math.sql
-- Stop recomputing pool_remaining manually; read it from the view.
--
-- Changes:
--   1. top_local_leaderboard  — drop manual `greatest(pool_points - spent)`
--                               and pull tlr.pool_remaining as total_local.
--   2. get_my_local_total     — same: replace manual math with
--                               tlr.pool_remaining as total_local.
-- ================================================================


-- ----------------------------------------------------------------
-- SECTION 1 — top_local_leaderboard
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.top_local_leaderboard(
  _limit integer DEFAULT 9
)
RETURNS TABLE(
  local_team_id integer,
  pool_team_id  integer,
  local_name    text,
  pool_name     text,
  spent         integer,
  pool_points   integer,
  total_local   integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  with base as (
    select
      tlr.local_team_id,
      tlr.pool_team_id,
      coalesce(tlr.pool_points,    0) as pool_points,
      coalesce(tlr.spent_by_local, 0) as spent,
      coalesce(tlr.pool_remaining, 0) as total_local   -- view already handles local_earn
    from team_local_remaining tlr
  )
  select
    b.local_team_id,
    b.pool_team_id,
    tl.name as local_name,
    tp.name as pool_name,
    b.spent,
    b.pool_points,
    b.total_local
  from base b
  left join teams tl on tl.id = b.local_team_id
  left join teams tp on tp.id = b.pool_team_id
  order by b.total_local desc, b.local_team_id asc
  limit coalesce(_limit, 9);
$$;

ALTER  FUNCTION public.top_local_leaderboard(integer) OWNER TO postgres;
GRANT ALL ON FUNCTION public.top_local_leaderboard(integer) TO anon;
GRANT ALL ON FUNCTION public.top_local_leaderboard(integer) TO authenticated;
GRANT ALL ON FUNCTION public.top_local_leaderboard(integer) TO service_role;


-- ----------------------------------------------------------------
-- SECTION 2 — get_my_local_total
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_local_total()
RETURNS TABLE(
  pool_team_id  integer,
  local_team_id integer,
  pool_points   integer,
  spent         integer,
  total_local   integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  with me as (
    select auth.uid() as uid
  ),
  stu as (
    select s.id
    from students s
    join me on s.auth_user_id = me.uid
    limit 1
  ),
  mem as (
    select tm.team_id
    from team_members tm
    join stu on tm.student_id = stu.id
    limit 1
  )
  select
    tlr.pool_team_id,
    tlr.local_team_id,
    coalesce(tlr.pool_points,    0) as pool_points,
    coalesce(tlr.spent_by_local, 0) as spent,
    coalesce(tlr.pool_remaining, 0) as total_local   -- view already handles local_earn
  from team_local_remaining tlr
  join mem on mem.team_id = tlr.local_team_id
  -- si el alumno no tiene equipo local, la función devolverá 0 filas
$$;

ALTER  FUNCTION public.get_my_local_total() OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_my_local_total() TO anon;
GRANT ALL ON FUNCTION public.get_my_local_total() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_local_total() TO service_role;
