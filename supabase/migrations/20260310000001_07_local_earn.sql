-- ================================================================
-- Migration: 07_local_earn.sql
-- Add 'local_earn' tx_type for per-local-team exclusive points.
--
-- Changes:
--   1. Extend tx_type CHECK constraint (team_pool_tx + archive).
--   2. Update team_pool_balances to exclude 'local_earn'
--      (prevents local_earn from inflating the global pool balance).
--   3. Recreate team_local_remaining with new formula:
--      pool_remaining = GREATEST((pool_points + local_earned) - spent_by_local, 0)
--   4. New RPC: team_local_earn_adjust
-- ================================================================


-- ----------------------------------------------------------------
-- SECTION 1 — Extend tx_type constraint
-- ----------------------------------------------------------------

ALTER TABLE public.team_pool_tx
  DROP CONSTRAINT team_pool_tx_tx_type_check,
  ADD  CONSTRAINT team_pool_tx_tx_type_check
    CHECK (tx_type = ANY (ARRAY['earn','spend','adjust','local_earn']));

ALTER TABLE public.team_pool_tx_archive
  DROP CONSTRAINT team_pool_tx_tx_type_check,
  ADD  CONSTRAINT team_pool_tx_tx_type_check
    CHECK (tx_type = ANY (ARRAY['earn','spend','adjust','local_earn']));


-- ----------------------------------------------------------------
-- SECTION 2 — Update team_pool_balances to exclude 'local_earn'
-- IMPORTANT: local_earn rows are stored in team_pool_tx with a
-- pool_team_id for JOIN purposes, but must NOT count toward the
-- global pool balance. Without this fix, pool_points and
-- local_earned would be double-counted in team_local_remaining.
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.team_pool_balances
WITH (security_invoker = on)
AS
SELECT
  pool_team_id,
  COALESCE(SUM(delta), 0) AS points
FROM public.team_pool_tx
WHERE COALESCE(tx_type, 'earn') NOT IN ('spend', 'local_earn')
GROUP BY pool_team_id;

ALTER VIEW public.team_pool_balances OWNER TO postgres;


-- ----------------------------------------------------------------
-- SECTION 3 — Recreate team_local_remaining
-- New formula:
--   pool_remaining = GREATEST(
--     (pool_points + local_earned) - spent_by_local,
--     0
--   )
-- pool_points    = pool's earn+adjust total (updated team_pool_balances)
-- local_earned   = SUM of 'local_earn' deltas for THIS local team only
-- spent_by_local = SUM of 'spend' deltas for THIS local team (team_local_spend)
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.team_local_remaining
WITH (security_invoker = on)
AS
SELECT
  lt.id                  AS local_team_id,
  pg.id                  AS pool_team_id,
  COALESCE(pb.points, 0) AS pool_points,
  COALESCE(ls.spent, 0)  AS spent_by_local,
  GREATEST(
    (
      COALESCE(pb.points, 0)
      + COALESCE(
          (SELECT SUM(t.delta)
           FROM   public.team_pool_tx t
           WHERE  t.local_team_id = lt.id
             AND  t.tx_type       = 'local_earn'),
          0
        )
    ) - COALESCE(ls.spent, 0),
    0
  ) AS pool_remaining
FROM      public.teams lt
JOIN      public.teams pg
      ON  pg.id    = lt.parent_global_id
     AND  lt.scope = 'local'
     AND  pg.scope = 'global'
LEFT JOIN public.team_pool_balances pb
      ON  pb.pool_team_id = pg.id
LEFT JOIN public.team_local_spend ls
      ON  ls.local_team_id = lt.id;

ALTER VIEW public.team_local_remaining OWNER TO postgres;


-- ----------------------------------------------------------------
-- SECTION 4 — New RPC: team_local_earn_adjust
-- Mirrors team_local_spend_adjust but inserts tx_type='local_earn'
-- with a positive delta (exclusive to the local team).
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.team_local_earn_adjust(
  _local_team_id integer,
  _amount        integer,
  _reason        text    DEFAULT NULL,
  _device_id     text    DEFAULT 'web-teacher'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_teacher      uuid := auth.uid();
  v_pool         int;
  v_local_earned int;
  v_pool_points  int;
  v_spent_local  int;
  v_remaining    int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_teacher AND role = 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _amount = 0 THEN RAISE EXCEPTION 'ZERO_AMOUNT'; END IF;

  SELECT parent_global_id INTO v_pool
    FROM teams WHERE id = _local_team_id AND scope = 'local';
  IF v_pool IS NULL THEN RAISE EXCEPTION 'NOT_LOCAL'; END IF;

  INSERT INTO team_pool_tx
    (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
  VALUES
    (v_pool, abs(_amount), _local_team_id, _reason, _device_id, v_teacher, 'local_earn');

  -- Compute updated balance for return JSON (mirrors new view formula)
  SELECT COALESCE(SUM(delta), 0)  INTO v_local_earned
    FROM team_pool_tx
   WHERE local_team_id = _local_team_id AND tx_type = 'local_earn';

  SELECT COALESCE(SUM(delta), 0)  INTO v_pool_points
    FROM team_pool_tx
   WHERE pool_team_id = v_pool AND tx_type IN ('earn', 'adjust');

  SELECT COALESCE(SUM(-delta), 0) INTO v_spent_local
    FROM team_pool_tx
   WHERE local_team_id = _local_team_id AND tx_type = 'spend';

  v_remaining := GREATEST(v_pool_points + v_local_earned - v_spent_local, 0);

  RETURN json_build_object(
    'pool_team_id',    v_pool,
    'local_team_id',   _local_team_id,
    'local_earned',    v_local_earned,
    'local_remaining', v_remaining
  );
END;
$$;

ALTER  FUNCTION public.team_local_earn_adjust(integer, integer, text, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.team_local_earn_adjust(integer, integer, text, text) TO anon;
GRANT ALL ON FUNCTION public.team_local_earn_adjust(integer, integer, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.team_local_earn_adjust(integer, integer, text, text) TO service_role;
