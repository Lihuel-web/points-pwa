  -- ================================================================
  -- Migration: 03_fix_archive_sequence_collision.sql
  -- Fix: duplicate key violations on all _archive tables during reset.
  --
  -- Root cause: all archive tables borrowed the same sequence as their
  -- source table. TRUNCATE ... RESTART IDENTITY resets that sequence,
  -- causing PK collisions on subsequent resets.
  --
  -- Fix: give each archive table its own independent sequence, then
  -- rewrite reset_all_points with explicit column lists (no 'id').
  -- ================================================================


  -- ----------------------------------------------------------------
  -- SECTION 1 — Independent sequences for each archive table
  -- ----------------------------------------------------------------

  -- transactions_archive
  CREATE SEQUENCE IF NOT EXISTS public.transactions_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.transactions_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.transactions_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.transactions_archive_id_seq
      OWNED BY public.transactions_archive.id;

  ALTER TABLE public.transactions_archive
      ALTER COLUMN id SET DEFAULT nextval('public.transactions_archive_id_seq');


  -- team_pool_tx_archive
  CREATE SEQUENCE IF NOT EXISTS public.team_pool_tx_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.team_pool_tx_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.team_pool_tx_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.team_pool_tx_archive_id_seq
      OWNED BY public.team_pool_tx_archive.id;

  ALTER TABLE public.team_pool_tx_archive
      ALTER COLUMN id SET DEFAULT nextval('public.team_pool_tx_archive_id_seq');


  -- game_scores_archive
  CREATE SEQUENCE IF NOT EXISTS public.game_scores_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.game_scores_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.game_scores_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.game_scores_archive_id_seq
      OWNED BY public.game_scores_archive.id;

  ALTER TABLE public.game_scores_archive
      ALTER COLUMN id SET DEFAULT nextval('public.game_scores_archive_id_seq');


  -- game_scores_snake_archive
  CREATE SEQUENCE IF NOT EXISTS public.game_scores_snake_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.game_scores_snake_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.game_scores_snake_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.game_scores_snake_archive_id_seq
      OWNED BY public.game_scores_snake_archive.id;

  ALTER TABLE public.game_scores_snake_archive
      ALTER COLUMN id SET DEFAULT nextval('public.game_scores_snake_archive_id_seq');


  -- game_scores_tetris_archive
  CREATE SEQUENCE IF NOT EXISTS public.game_scores_tetris_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.game_scores_tetris_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.game_scores_tetris_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.game_scores_tetris_archive_id_seq
      OWNED BY public.game_scores_tetris_archive.id;

  ALTER TABLE public.game_scores_tetris_archive
      ALTER COLUMN id SET DEFAULT nextval('public.game_scores_tetris_archive_id_seq');


  -- game_scores_road_archive
  CREATE SEQUENCE IF NOT EXISTS public.game_scores_road_archive_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

  SELECT setval(
      'public.game_scores_road_archive_id_seq',
      COALESCE((SELECT MAX(id) FROM public.game_scores_road_archive), 0) + 1,
      false
  );

  ALTER SEQUENCE public.game_scores_road_archive_id_seq
      OWNED BY public.game_scores_road_archive.id;

  ALTER TABLE public.game_scores_road_archive
      ALTER COLUMN id SET DEFAULT nextval('public.game_scores_road_archive_id_seq');


  -- ----------------------------------------------------------------
  -- SECTION 2 — Grant permissions on new sequences
  -- ----------------------------------------------------------------

  GRANT ALL ON SEQUENCE public.transactions_archive_id_seq      TO anon, authenticated, service_role;
  GRANT ALL ON SEQUENCE public.team_pool_tx_archive_id_seq      TO anon, authenticated, service_role;
  GRANT ALL ON SEQUENCE public.game_scores_archive_id_seq       TO anon, authenticated, service_role;
  GRANT ALL ON SEQUENCE public.game_scores_snake_archive_id_seq TO anon, authenticated, service_role;
  GRANT ALL ON SEQUENCE public.game_scores_tetris_archive_id_seq TO anon, authenticated, service_role;
  GRANT ALL ON SEQUENCE public.game_scores_road_archive_id_seq  TO anon, authenticated, service_role;


  -- ----------------------------------------------------------------
  -- SECTION 3 — reset_all_points: explicit column INSERTs, no 'id'
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
          LOCK TABLE public.game_scores        IN ACCESS EXCLUSIVE MODE;
          LOCK TABLE public.game_scores_snake  IN ACCESS EXCLUSIVE MODE;
          LOCK TABLE public.game_scores_tetris IN ACCESS EXCLUSIVE MODE;
          LOCK TABLE public.game_scores_road   IN ACCESS EXCLUSIVE MODE;

          -- game_scores → game_scores_archive
          -- Columns: user_id, student_id, student_name, local_team_id, local_team_name,
          --          difficulty, score, created_at, archived_at, actor
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
          -- Columns: user_id, student_id, student_name, local_team_id, local_team_name,
          --          difficulty, score, created_at, archived_at, actor
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
          -- Columns: user_id, student_id, student_name, local_team_id, local_team_name,
          --          difficulty, score, created_at, archived_at, actor
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
          -- Columns: user_id, student_id, student_name, local_team_id, local_team_name,
          --          difficulty, score, created_at, archived_at, actor
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