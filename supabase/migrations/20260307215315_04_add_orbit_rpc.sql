-- Migration: 04_add_orbit_rpc
-- Creates game_local_team_leaderboard_orbit RPC.
-- Uses SECURITY INVOKER so RLS policies on game_scores_orbit are enforced.

CREATE OR REPLACE FUNCTION "public"."game_local_team_leaderboard_orbit"("_limit" integer DEFAULT 50)
RETURNS TABLE(
  "local_team_id"      integer,
  "local_team_name"    "text",
  "pool_team_id"       integer,
  "pool_team_name"     "text",
  "team_best"          integer,
  "best_student_name"  "text"
)
    LANGUAGE "sql" SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
with best_per_student as (
  select local_team_id, student_id, max(score) as best_score
  from public.game_scores_orbit
  group by local_team_id, student_id
),
best_per_team as (
  select local_team_id, coalesce(max(best_score),0)::int as team_best
  from best_per_student
  group by local_team_id
),
best_student as (
  select g.local_team_id, g.student_name, g.score,
         row_number() over (partition by g.local_team_id order by g.score desc, g.created_at asc) as rn
  from public.game_scores_orbit g
)
select lt.id, lt.name, pg.id, pg.name,
       coalesce(bt.team_best,0),
       bs.student_name
from public.teams lt
join public.teams pg on pg.id = lt.parent_global_id and lt.scope='local' and pg.scope='global'
left join best_per_team bt on bt.local_team_id = lt.id
left join best_student bs on bs.local_team_id = lt.id and bs.rn = 1
order by coalesce(bt.team_best,0) desc, lt.name asc
limit coalesce(_limit, 50);
$$;

ALTER FUNCTION "public"."game_local_team_leaderboard_orbit"("_limit" integer) OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION public.game_local_team_leaderboard_orbit(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.game_local_team_leaderboard_orbit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_local_team_leaderboard_orbit(integer) TO service_role;
