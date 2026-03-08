-- ================================================================
-- Migration: 06_patch_orbit_resets.sql
-- Fix Schema Drift: include game_scores_orbit in all reset RPCs.
--
-- Changes:
--   1. Create game_scores_orbit_archive with independent sequence.
--   2. Patch reset_all_points: lock + archive + truncate orbit.
--   3. Patch reset_game_scores: add want_orbit / c_orbit block.
-- ================================================================


-- ----------------------------------------------------------------
-- SECTION 1 — Create game_scores_orbit_archive
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.game_scores_orbit_archive (
    id              bigint      NOT NULL,
    created_at      timestamptz DEFAULT now(),
    user_id         uuid,
    student_id      bigint,
    student_name    text,
    local_team_id   bigint,
    local_team_name text,
    difficulty      text,
    score           integer,
    archived_at     timestamptz,
    actor           uuid,
    CONSTRAINT game_scores_orbit_archive_pkey PRIMARY KEY (id)
);

ALTER TABLE public.game_scores_orbit_archive OWNER TO postgres;

CREATE INDEX IF NOT EXISTS game_scores_orbit_archive_local_team_id_score_idx
    ON public.game_scores_orbit_archive USING btree (local_team_id, score DESC);

CREATE INDEX IF NOT EXISTS game_scores_orbit_archive_student_id_idx
    ON public.game_scores_orbit_archive USING btree (student_id);

GRANT ALL ON TABLE public.game_scores_orbit_archive TO anon;
GRANT ALL ON TABLE public.game_scores_orbit_archive TO authenticated;
GRANT ALL ON TABLE public.game_scores_orbit_archive TO service_role;


-- ----------------------------------------------------------------
-- SECTION 2 — Independent sequence for game_scores_orbit_archive
-- ----------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.game_scores_orbit_archive_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

SELECT setval(
    'public.game_scores_orbit_archive_id_seq',
    COALESCE((SELECT MAX(id) FROM public.game_scores_orbit_archive), 0) + 1,
    false
);

ALTER SEQUENCE public.game_scores_orbit_archive_id_seq
    OWNED BY public.game_scores_orbit_archive.id;

ALTER TABLE public.game_scores_orbit_archive
    ALTER COLUMN id SET DEFAULT nextval('public.game_scores_orbit_archive_id_seq');

GRANT ALL ON SEQUENCE public.game_scores_orbit_archive_id_seq TO anon;
GRANT ALL ON SEQUENCE public.game_scores_orbit_archive_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.game_scores_orbit_archive_id_seq TO service_role;


-- ----------------------------------------------------------------
-- SECTION 3 — Patch reset_all_points (full replacement)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_all_points(
    include_game_scores boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    is_teacher boolean;
    c_tx   int := 0;
    c_pool int := 0;
    c_gs   int := 0;
    rc     int := 0;
    u      uuid := auth.uid();
BEGIN
    -- Solo teachers
    SELECT EXISTS(
        SELECT 1 FROM public.profiles p
        WHERE p.id = u AND p.role = 'teacher'
    ) INTO is_teacher;

    IF NOT is_teacher THEN
        RAISE EXCEPTION 'Not allowed: teacher role required';
    END IF;

    -- Bloqueo consistente
    LOCK TABLE public.transactions IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE public.team_pool_tx IN ACCESS EXCLUSIVE MODE;

    -- 1) transactions → transactions_archive
    INSERT INTO public.transactions_archive
        (student_id, delta, reason, device_id, teacher_id, created_at, archived_at, actor)
    SELECT
        t.student_id,
        t.delta,
        t.reason,
        t.device_id,
        t.teacher_id,
        t.created_at,
        now(),
        u
    FROM public.transactions t;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_tx := c_tx + rc;

    TRUNCATE TABLE public.transactions RESTART IDENTITY;

    -- 2) team_pool_tx → team_pool_tx_archive
    INSERT INTO public.team_pool_tx_archive
        (pool_team_id, local_team_id, delta, reason, device_id, teacher_id, created_at, tx_type, archived_at, actor)
    SELECT
        p.pool_team_id,
        p.local_team_id,
        p.delta,
        p.reason,
        p.device_id,
        p.teacher_id,
        p.created_at,
        p.tx_type,
        now(),
        u
    FROM public.team_pool_tx p;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_pool := c_pool + rc;

    TRUNCATE TABLE public.team_pool_tx RESTART IDENTITY;

    -- 3) Opcional: game scores
    IF include_game_scores THEN
        LOCK TABLE public.game_scores              IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE public.game_scores_snake        IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE public.game_scores_tetris       IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE public.game_scores_road         IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE public.game_scores_orbit        IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE public.game_scores_orbit_archive IN ACCESS EXCLUSIVE MODE;

        -- game_scores → game_scores_archive
        INSERT INTO public.game_scores_archive
            (user_id, student_id, student_name, local_team_id, local_team_name,
             difficulty, score, created_at, archived_at, actor)
        SELECT
            g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
            g.difficulty, g.score, g.created_at, now(), u
        FROM public.game_scores g;
        GET DIAGNOSTICS rc = ROW_COUNT;
        c_gs := c_gs + rc;
        TRUNCATE TABLE public.game_scores RESTART IDENTITY;

        -- game_scores_snake → game_scores_snake_archive
        INSERT INTO public.game_scores_snake_archive
            (user_id, student_id, student_name, local_team_id, local_team_name,
             difficulty, score, created_at, archived_at, actor)
        SELECT
            g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
            g.difficulty, g.score, g.created_at, now(), u
        FROM public.game_scores_snake g;
        GET DIAGNOSTICS rc = ROW_COUNT;
        c_gs := c_gs + rc;
        TRUNCATE TABLE public.game_scores_snake RESTART IDENTITY;

        -- game_scores_tetris → game_scores_tetris_archive
        INSERT INTO public.game_scores_tetris_archive
            (user_id, student_id, student_name, local_team_id, local_team_name,
             difficulty, score, created_at, archived_at, actor)
        SELECT
            g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
            g.difficulty, g.score, g.created_at, now(), u
        FROM public.game_scores_tetris g;
        GET DIAGNOSTICS rc = ROW_COUNT;
        c_gs := c_gs + rc;
        TRUNCATE TABLE public.game_scores_tetris RESTART IDENTITY;

        -- game_scores_road → game_scores_road_archive
        INSERT INTO public.game_scores_road_archive
            (user_id, student_id, student_name, local_team_id, local_team_name,
             difficulty, score, created_at, archived_at, actor)
        SELECT
            g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
            g.difficulty, g.score, g.created_at, now(), u
        FROM public.game_scores_road g;
        GET DIAGNOSTICS rc = ROW_COUNT;
        c_gs := c_gs + rc;
        TRUNCATE TABLE public.game_scores_road RESTART IDENTITY;

        -- game_scores_orbit → game_scores_orbit_archive
        INSERT INTO public.game_scores_orbit_archive
            (user_id, student_id, student_name, local_team_id, local_team_name,
             difficulty, score, created_at, archived_at, actor)
        SELECT
            g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
            g.difficulty, g.score, g.created_at, now(), u
        FROM public.game_scores_orbit g;
        GET DIAGNOSTICS rc = ROW_COUNT;
        c_gs := c_gs + rc;
        TRUNCATE TABLE public.game_scores_orbit RESTART IDENTITY;

    END IF;

    -- Auditoría
    INSERT INTO public.admin_actions (actor, action, details)
    VALUES (
        u,
        'reset_all_points',
        json_build_object(
            'include_game_scores', include_game_scores,
            'counts', json_build_object(
                'transactions',      c_tx,
                'team_pool_tx',      c_pool,
                'game_scores_total', CASE WHEN include_game_scores THEN c_gs ELSE 0 END
            )
        )
    );

    RETURN json_build_object(
        'ok',                   true,
        'transactions_deleted', c_tx,
        'team_pool_tx_deleted', c_pool,
        'game_scores_deleted',  CASE WHEN include_game_scores THEN c_gs ELSE 0 END
    );
END;
$$;

ALTER FUNCTION public.reset_all_points(boolean) OWNER TO postgres;
GRANT ALL ON FUNCTION public.reset_all_points(boolean) TO anon;
GRANT ALL ON FUNCTION public.reset_all_points(boolean) TO authenticated;
GRANT ALL ON FUNCTION public.reset_all_points(boolean) TO service_role;


-- ----------------------------------------------------------------
-- SECTION 4 — Patch reset_game_scores (full replacement)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_game_scores(
    games text[] DEFAULT ARRAY['flappy', 'snake', 'tetris', 'road', 'orbit']
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  is_teacher boolean;
  u          uuid    := auth.uid();
  want_flappy boolean := array_position(games, 'flappy') is not null;
  want_snake  boolean := array_position(games, 'snake')  is not null;
  want_tetris boolean := array_position(games, 'tetris') is not null;
  want_road   boolean := array_position(games, 'road')   is not null;
  want_orbit  boolean := array_position(games, 'orbit')  is not null;

  c_flappy int := 0;
  c_snake  int := 0;
  c_tetris int := 0;
  c_road   int := 0;
  c_orbit  int := 0;
  rc       int := 0;
begin
  -- Solo teachers
  select exists(select 1 from public.profiles p where p.id=u and p.role='teacher') into is_teacher;
  if not is_teacher then
    raise exception 'Not allowed: teacher role required';
  end if;

  -- Flappy
  if want_flappy and to_regclass('public.game_scores') is not null then
    lock table public.game_scores in access exclusive mode;
    perform setval(
      'public.game_scores_id_seq',
      greatest(
        coalesce((select max(id) from public.game_scores_archive), 0),
        coalesce((select max(id) from public.game_scores), 0)
      ),
      true
    );
    insert into public.game_scores_archive (
      user_id, student_id, student_name, local_team_id, local_team_name,
      difficulty, score, created_at, archived_at, actor
    )
    select
      g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
      g.difficulty, g.score, g.created_at, now(), u
    from public.game_scores g;
    get diagnostics rc = row_count; c_flappy := c_flappy + rc;
    truncate table public.game_scores; -- no restart identity; setval already advanced seq
  end if;

  -- Snake
  if want_snake and to_regclass('public.game_scores_snake') is not null then
    lock table public.game_scores_snake in access exclusive mode;
    perform setval(
      'public.game_scores_snake_id_seq',
      greatest(
        coalesce((select max(id) from public.game_scores_snake_archive), 0),
        coalesce((select max(id) from public.game_scores_snake), 0)
      ),
      true
    );
    insert into public.game_scores_snake_archive (
      user_id, student_id, student_name, local_team_id, local_team_name,
      difficulty, score, created_at, archived_at, actor
    )
    select
      g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
      g.difficulty, g.score, g.created_at, now(), u
    from public.game_scores_snake g;
    get diagnostics rc = row_count; c_snake := c_snake + rc;
    truncate table public.game_scores_snake;
  end if;

  -- Tetris
  if want_tetris and to_regclass('public.game_scores_tetris') is not null then
    lock table public.game_scores_tetris in access exclusive mode;
    perform setval(
      'public.game_scores_tetris_id_seq',
      greatest(
        coalesce((select max(id) from public.game_scores_tetris_archive), 0),
        coalesce((select max(id) from public.game_scores_tetris), 0)
      ),
      true
    );
    insert into public.game_scores_tetris_archive (
      user_id, student_id, student_name, local_team_id, local_team_name,
      difficulty, score, created_at, archived_at, actor
    )
    select
      g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
      g.difficulty, g.score, g.created_at, now(), u
    from public.game_scores_tetris g;
    get diagnostics rc = row_count; c_tetris := c_tetris + rc;
    truncate table public.game_scores_tetris;
  end if;

  -- Road
  if want_road and to_regclass('public.game_scores_road') is not null then
    lock table public.game_scores_road in access exclusive mode;
    perform setval(
      'public.game_scores_road_id_seq',
      greatest(
        coalesce((select max(id) from public.game_scores_road_archive), 0),
        coalesce((select max(id) from public.game_scores_road), 0)
      ),
      true
    );
    insert into public.game_scores_road_archive (
      user_id, student_id, student_name, local_team_id, local_team_name,
      difficulty, score, created_at, archived_at, actor
    )
    select
      g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
      g.difficulty, g.score, g.created_at, now(), u
    from public.game_scores_road g;
    get diagnostics rc = row_count; c_road := c_road + rc;
    truncate table public.game_scores_road;
  end if;

  -- Orbit
  if want_orbit and to_regclass('public.game_scores_orbit') is not null then
    lock table public.game_scores_orbit in access exclusive mode;
    perform setval(
      'public.game_scores_orbit_id_seq',
      greatest(
        coalesce((select max(id) from public.game_scores_orbit_archive), 0),
        coalesce((select max(id) from public.game_scores_orbit), 0)
      ),
      true
    );
    insert into public.game_scores_orbit_archive (
      user_id, student_id, student_name, local_team_id, local_team_name,
      difficulty, score, created_at, archived_at, actor
    )
    select
      g.user_id, g.student_id, g.student_name, g.local_team_id, g.local_team_name,
      g.difficulty, g.score, g.created_at, now(), u
    from public.game_scores_orbit g;
    get diagnostics rc = row_count; c_orbit := c_orbit + rc;
    truncate table public.game_scores_orbit;
  end if;

  insert into public.admin_actions(actor, action, details)
  values (
    u, 'reset_game_scores',
    json_build_object(
      'games', games,
      'counts', json_build_object(
        'flappy', c_flappy,
        'snake',  c_snake,
        'tetris', c_tetris,
        'road',   c_road,
        'orbit',  c_orbit
      )
    )
  );

  return json_build_object(
    'ok',            true,
    'flappy_deleted', c_flappy,
    'snake_deleted',  c_snake,
    'tetris_deleted', c_tetris,
    'road_deleted',   c_road,
    'orbit_deleted',  c_orbit
  );
end;
$$;

ALTER FUNCTION public.reset_game_scores(text[]) OWNER TO postgres;
GRANT ALL ON FUNCTION public.reset_game_scores(text[]) TO anon;
GRANT ALL ON FUNCTION public.reset_game_scores(text[]) TO authenticated;
GRANT ALL ON FUNCTION public.reset_game_scores(text[]) TO service_role;
