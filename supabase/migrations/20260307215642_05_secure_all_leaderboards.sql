-- Migration: 05_secure_all_leaderboards
-- Converts the 4 existing game leaderboard functions from SECURITY DEFINER
-- to SECURITY INVOKER so they respect RLS on the underlying score tables.
--
-- IMPORTANT: SECURITY INVOKER means each function runs with the permissions
-- of the calling role. The SELECT policies below are required so that
-- authenticated users can read all teams' scores (not just their own local
-- team), which is the correct behaviour for a cross-team leaderboard.
-- Without these policies the aggregation would return only the caller's
-- team row and the leaderboard would be effectively broken.

-- ============================================================
-- 1. Convert functions to SECURITY INVOKER
-- ============================================================

ALTER FUNCTION "public"."game_local_team_leaderboard"("_limit" integer) SECURITY INVOKER;
ALTER FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer) SECURITY INVOKER;
ALTER FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer) SECURITY INVOKER;
ALTER FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer) SECURITY INVOKER;

-- ============================================================
-- 2. Enable RLS on game_scores_orbit (was missing entirely)
-- ============================================================

ALTER TABLE "public"."game_scores_orbit" ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Leaderboard SELECT policies
--    The existing "select same local" policies are scoped to the
--    caller's own local team and would produce single-row results
--    under SECURITY INVOKER.  These new permissive policies allow
--    any authenticated user to read all rows for aggregation.
--    (Permissive policies are OR-combined in PostgreSQL, so the
--    broader policy wins — authenticated users can read all scores.)
-- ============================================================

CREATE POLICY "road: select all for leaderboard"
  ON "public"."game_scores_road"
  FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "snake: select all for leaderboard"
  ON "public"."game_scores_snake"
  FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "tetris: select all for leaderboard"
  ON "public"."game_scores_tetris"
  FOR SELECT TO "authenticated"
  USING (true);

-- orbit: both INSERT (own run) and SELECT (leaderboard) policies
CREATE POLICY "orbit: insert own run"
  ON "public"."game_scores_orbit"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (
      ("user_id" = "auth"."uid"())
      AND (EXISTS (
        SELECT 1
        FROM public.students s
        JOIN public.team_members tm ON tm.student_id = s.id
        JOIN public.teams t ON t.id = tm.team_id
        WHERE s.auth_user_id = auth.uid()
          AND s.id = game_scores_orbit.student_id
          AND t.scope = 'local'
          AND tm.team_id = game_scores_orbit.local_team_id
      ))
    )
    OR (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    ))
  );

CREATE POLICY "orbit: select all for leaderboard"
  ON "public"."game_scores_orbit"
  FOR SELECT TO "authenticated"
  USING (true);

-- ============================================================
-- 4. game_scores (Flappy)
--    RLS already enabled. INSERT policies already exist.
--    Missing: broad SELECT policy for cross-team leaderboard.
-- ============================================================

CREATE POLICY "flappy: select all for leaderboard"
  ON "public"."game_scores"
  FOR SELECT TO "authenticated"
  USING (true);
