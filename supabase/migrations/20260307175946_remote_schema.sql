


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."award_points"("_identifier" "text", "_delta" integer, "_reason" "text", "_device_id" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher uuid := auth.uid();
  v_id_canon text := upper(regexp_replace(coalesce(_identifier,''), '[^0-9A-F]', '', 'g'));
  v_card record; v_new_balance int; v_pool int;
begin
  if not exists (select 1 from profiles where id = v_teacher and role = 'teacher') then
    raise exception 'FORBIDDEN: teacher role required';
  end if;

  select c.* into v_card
  from cards c
  where coalesce(c.active, true) is true
    and upper(regexp_replace(c.card_uid,'[^0-9A-F]','','g')) = v_id_canon
  limit 1;

  if v_card is null then raise exception 'CARD_NOT_LINKED'; end if;

  -- Student card
  if v_card.student_id is not null and v_card.card_role = 'student' then
    if exists (select 1 from transactions 
               where student_id = v_card.student_id
                 and coalesce(device_id,'') = coalesce(_device_id,'')
                 and created_at >= now() - interval '2 seconds') then
      raise exception 'RATE_LIMIT';
    end if;

    insert into transactions (student_id, delta, reason, device_id, teacher_id)
    values (v_card.student_id, _delta, _reason, _device_id, v_teacher);

    select coalesce(sum(delta),0) into v_new_balance
      from transactions where student_id = v_card.student_id;

    return json_build_object('mode','student','student_id', v_card.student_id, 'new_balance', v_new_balance);
  end if;

  -- Team cards
  if v_card.team_id is not null and v_card.card_role in ('team_earn','team_spend') then
    if v_card.card_role = 'team_earn' then
      if not exists (select 1 from teams where id = v_card.team_id and scope='global') then
        raise exception 'BAD_CARD_ROLE';
      end if;
      insert into team_pool_tx (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
      values (v_card.team_id, _delta, null, coalesce(_reason,'EARN'), _device_id, v_teacher, 'earn');
      return json_build_object('mode','team_earn','pool_team_id', v_card.team_id);
    else
      select parent_global_id into v_pool from teams where id = v_card.team_id and scope='local';
      if v_pool is null then raise exception 'BAD_CARD_ROLE'; end if;
      insert into team_pool_tx (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
      values (v_pool, -abs(_delta), v_card.team_id, coalesce(_reason,'SPEND'), _device_id, v_teacher, 'spend');
      return json_build_object('mode','team_spend','pool_team_id', v_pool, 'local_team_id', v_card.team_id);
    end if;
  end if;

  raise exception 'CARD_NOT_LINKED';
end $$;


ALTER FUNCTION "public"."award_points"("_identifier" "text", "_delta" integer, "_reason" "text", "_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."award_points_by_student"("_student_id" bigint, "_delta" integer, "_reason" "text", "_device_id" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher uuid := auth.uid();
  v_new_balance int;
begin
  if not exists (select 1 from profiles where id = v_teacher and role = 'teacher') then
    raise exception 'FORBIDDEN: teacher role required';
  end if;

  insert into transactions (student_id, delta, reason, device_id, teacher_id)
  values (_student_id, _delta, _reason, _device_id, v_teacher);

  select coalesce(sum(delta),0) into v_new_balance
  from transactions where student_id = _student_id;

  return json_build_object('student_id', _student_id, 'new_balance', v_new_balance);
end
$$;


ALTER FUNCTION "public"."award_points_by_student"("_student_id" bigint, "_delta" integer, "_reason" "text", "_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_student"("_student_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher uuid := auth.uid();
begin
  -- Permitir solo a teachers
  if not exists (select 1 from profiles where id = v_teacher and role = 'teacher') then
    raise exception 'FORBIDDEN: teacher role required';
  end if;

  -- Borra al alumno (cards y transactions caen por cascada)
  delete from students where id = _student_id;
end;
$$;


ALTER FUNCTION "public"."delete_student"("_student_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_local_team_leaderboard"("_limit" integer DEFAULT 50) RETURNS TABLE("local_team_id" integer, "local_team_name" "text", "pool_team_id" integer, "pool_team_name" "text", "team_best" integer, "best_student_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with best_per_student as (
  select local_team_id, student_id, max(score) as best_score
  from public.game_scores
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
  from public.game_scores g
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


ALTER FUNCTION "public"."game_local_team_leaderboard"("_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer DEFAULT 50) RETURNS TABLE("local_team_id" integer, "local_team_name" "text", "pool_team_id" integer, "pool_team_name" "text", "team_best" integer, "best_student_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with best_per_student as (
  select local_team_id, student_id, max(score) as best_score
  from public.game_scores_road
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
  from public.game_scores_road g
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


ALTER FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer DEFAULT 50) RETURNS TABLE("local_team_id" integer, "local_team_name" "text", "pool_team_id" integer, "pool_team_name" "text", "team_best" integer, "best_student_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with best_per_student as (
  select local_team_id, student_id, max(score) as best_score
  from public.game_scores_snake
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
  from public.game_scores_snake g
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


ALTER FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer DEFAULT 50) RETURNS TABLE("local_team_id" integer, "local_team_name" "text", "pool_team_id" integer, "pool_team_name" "text", "team_best" integer, "best_student_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with best_per_student as (
  select local_team_id, student_id, max(score) as best_score
  from public.game_scores_tetris
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
  from public.game_scores_tetris g
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


ALTER FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_local_total"() RETURNS TABLE("pool_team_id" integer, "local_team_id" integer, "pool_points" integer, "spent" integer, "total_local" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    -- Un equipo por alumno (tu modelo actual)
    select tm.team_id
    from team_members tm
    join stu on tm.student_id = stu.id
    limit 1
  )
  select
    tlr.pool_team_id,
    tlr.local_team_id,
    coalesce(tlr.pool_points,0)    as pool_points,
    coalesce(tlr.spent_by_local,0) as spent,
    greatest(coalesce(tlr.pool_points,0) - coalesce(tlr.spent_by_local,0), 0) as total_local
  from team_local_remaining tlr
  join mem on mem.team_id = tlr.local_team_id
  -- si el alumno no tiene equipo local, la función devolverá 0 filas
$$;


ALTER FUNCTION "public"."get_my_local_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_auth_user_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into profiles (id, role) values (new.id, 'student')
  on conflict (id) do nothing;

  insert into students (name, class, auth_user_id)
  values (
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    null,
    new.id
  )
  on conflict do nothing;

  return new;
end
$$;


ALTER FUNCTION "public"."handle_auth_user_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_all_points"("include_game_scores" boolean DEFAULT false) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  is_teacher boolean;
  c_tx   int := 0;   -- filas archivadas de transactions
  c_pool int := 0;   -- filas archivadas de team_pool_tx
  c_gs   int := 0;   -- total archivado de game scores (todas las tablas)
  rc     int := 0;   -- buffer para ROW_COUNT
  u uuid := auth.uid();
begin
  -- Solo teachers
  select exists(
    select 1 from public.profiles p
    where p.id = u and p.role = 'teacher'
  ) into is_teacher;

  if not is_teacher then
    raise exception 'Not allowed: teacher role required';
  end if;

  -- Bloqueo consistente
  lock table public.transactions  in access exclusive mode;
  lock table public.team_pool_tx  in access exclusive mode;

  -- 1) Respaldo + borrado de movimientos individuales
  insert into public.transactions_archive
  select t.*, now() as archived_at, u as actor
  from public.transactions t;
  GET DIAGNOSTICS rc = ROW_COUNT;
  c_tx := c_tx + rc;

  truncate table public.transactions restart identity;

  -- 2) Respaldo + borrado de pool de equipos
  insert into public.team_pool_tx_archive
  select p.*, now() as archived_at, u as actor
  from public.team_pool_tx p;
  GET DIAGNOSTICS rc = ROW_COUNT;
  c_pool := c_pool + rc;

  truncate table public.team_pool_tx restart identity;

  -- 3) Opcional: respaldar + borrar marcadores de juegos
  if include_game_scores then
    lock table public.game_scores        in access exclusive mode;
    lock table public.game_scores_snake  in access exclusive mode;
    lock table public.game_scores_tetris in access exclusive mode;
    lock table public.game_scores_road   in access exclusive mode;

    insert into public.game_scores_archive
    select g.*, now() as archived_at, u as actor
    from public.game_scores g;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_gs := c_gs + rc;
    truncate table public.game_scores restart identity;

    insert into public.game_scores_snake_archive
    select g.*, now() as archived_at, u as actor
    from public.game_scores_snake g;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_gs := c_gs + rc;
    truncate table public.game_scores_snake restart identity;

    insert into public.game_scores_tetris_archive
    select g.*, now() as archived_at, u as actor
    from public.game_scores_tetris g;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_gs := c_gs + rc;
    truncate table public.game_scores_tetris restart identity;

    insert into public.game_scores_road_archive
    select g.*, now() as archived_at, u as actor
    from public.game_scores_road g;
    GET DIAGNOSTICS rc = ROW_COUNT;
    c_gs := c_gs + rc;
    truncate table public.game_scores_road restart identity;
  end if;

  -- Auditoría
  insert into public.admin_actions(actor, action, details)
  values (
    u,
    'reset_all_points',
    json_build_object(
      'include_game_scores', include_game_scores,
      'counts', json_build_object(
        'transactions',  c_tx,
        'team_pool_tx',  c_pool,
        'game_scores_total', case when include_game_scores then c_gs else 0 end
      )
    )
  );

  return json_build_object(
    'ok', true,
    'transactions_deleted',  c_tx,
    'team_pool_tx_deleted',  c_pool,
    'game_scores_deleted',   case when include_game_scores then c_gs else 0 end
  );
end;
$$;


ALTER FUNCTION "public"."reset_all_points"("include_game_scores" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_game_scores"("games" "text"[] DEFAULT ARRAY['flappy'::"text", 'snake'::"text", 'tetris'::"text", 'road'::"text"]) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  is_teacher boolean;
  u uuid := auth.uid();
  want_flappy boolean := array_position(games, 'flappy') is not null;
  want_snake  boolean := array_position(games, 'snake')  is not null;
  want_tetris boolean := array_position(games, 'tetris') is not null;
  want_road   boolean := array_position(games, 'road')   is not null;

  c_flappy int := 0;
  c_snake  int := 0;
  c_tetris int := 0;
  c_road   int := 0;
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
    truncate table public.game_scores; -- no restart identity
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

  insert into public.admin_actions(actor, action, details)
  values (
    u, 'reset_game_scores',
    json_build_object(
      'games', games,
      'counts', json_build_object(
        'flappy', c_flappy,
        'snake',  c_snake,
        'tetris', c_tetris,
        'road',   c_road
      )
    )
  );

  return json_build_object(
    'ok', true,
    'flappy_deleted', c_flappy,
    'snake_deleted',  c_snake,
    'tetris_deleted', c_tetris,
    'road_deleted',   c_road
  );
end;
$$;


ALTER FUNCTION "public"."reset_game_scores"("games" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."student_can_read_team"("_uid" "uuid", "_team_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  my_local_ids  bigint[];
  my_global_ids bigint[];
  tgt_scope     text;
  tgt_parent    bigint;
begin
  -- Local(es) donde está el alumno y su(s) global(es) padre
  select array_agg(distinct t.id::bigint),
         array_agg(distinct t.parent_global_id::bigint)
  into   my_local_ids, my_global_ids
  from team_members tm
  join students s on s.id = tm.student_id
  join teams t    on t.id = tm.team_id
  where s.auth_user_id = _uid
    and t.scope = 'local';

  if my_local_ids is null then
    return false; -- el alumno no pertenece a ningún local
  end if;

  -- Puede leer su(s) equipo(s) local(es)
  if _team_id = any(my_local_ids) then
    return true;
  end if;

  -- Puede leer SOLO el global padre (no otros locales)
  select scope, parent_global_id::bigint into tgt_scope, tgt_parent
  from teams where id = _team_id;

  if tgt_scope = 'global' and _team_id = any(my_global_ids) then
    return true;
  end if;

  return false;
end
$$;


ALTER FUNCTION "public"."student_can_read_team"("_uid" "uuid", "_team_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_local_spend_adjust"("_local_team_id" integer, "_amount" integer, "_reason" "text" DEFAULT NULL::"text", "_device_id" "text" DEFAULT 'web-teacher'::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher uuid := auth.uid();
  v_pool int; v_spent_local int; v_points int; v_spent_total int; v_remaining int;
begin
  if not exists (select 1 from profiles where id=v_teacher and role='teacher') then
    raise exception 'FORBIDDEN';
  end if;
  if _amount = 0 then raise exception 'ZERO_AMOUNT'; end if;

  select parent_global_id into v_pool from teams where id=_local_team_id and scope='local';
  if v_pool is null then raise exception 'NOT_LOCAL'; end if;

  insert into team_pool_tx(pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
  values (v_pool, -abs(_amount), _local_team_id, _reason, _device_id, v_teacher, 'spend');

  select coalesce(sum(-delta),0) into v_spent_local
    from team_pool_tx where local_team_id=_local_team_id and tx_type='spend';
  select coalesce(sum(delta),0) into v_points
    from team_pool_tx where pool_team_id=v_pool and tx_type <> 'spend';
  select coalesce(sum(-delta),0) into v_spent_total
    from team_pool_tx where pool_team_id=v_pool and tx_type='spend';
  v_remaining := greatest(v_points - v_spent_total, 0);

  return json_build_object(
    'pool_team_id', v_pool,
    'local_team_id', _local_team_id,
    'spent_local',  v_spent_local,
    'pool_remaining', v_remaining
  );
end $$;


ALTER FUNCTION "public"."team_local_spend_adjust"("_local_team_id" integer, "_amount" integer, "_reason" "text", "_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_pool_adjust"("_pool_team_id" integer, "_delta" integer, "_reason" "text" DEFAULT NULL::"text", "_device_id" "text" DEFAULT 'web-teacher'::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher uuid := auth.uid();
  v_points int; v_spent int; v_remaining int;
begin
  if not exists (select 1 from profiles where id=v_teacher and role='teacher') then
    raise exception 'FORBIDDEN';
  end if;
  if _delta = 0 then raise exception 'ZERO_DELTA'; end if;
  if not exists (select 1 from teams where id=_pool_team_id and scope='global') then
    raise exception 'NOT_GLOBAL';
  end if;

  insert into team_pool_tx(pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
  values (_pool_team_id, _delta, null, _reason, _device_id, v_teacher, 'adjust');

  select coalesce(sum(delta),0) into v_points
    from team_pool_tx where pool_team_id=_pool_team_id and tx_type <> 'spend';
  select coalesce(sum(-delta),0) into v_spent
    from team_pool_tx where pool_team_id=_pool_team_id and tx_type = 'spend';
  v_remaining := greatest(v_points - v_spent, 0);

  return json_build_object('pool_team_id', _pool_team_id, 'points', v_points, 'spent', v_spent, 'remaining', v_remaining);
end $$;


ALTER FUNCTION "public"."team_pool_adjust"("_pool_team_id" integer, "_delta" integer, "_reason" "text", "_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."top_local_leaderboard"("_limit" integer DEFAULT 9) RETURNS TABLE("local_team_id" integer, "pool_team_id" integer, "local_name" "text", "pool_name" "text", "spent" integer, "pool_points" integer, "total_local" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with base as (
    -- Esta vista ya trae: pool_points (NETO), spent_by_local y pool_team_id
    select
      tlr.local_team_id,
      tlr.pool_team_id,
      coalesce(tlr.pool_points,   0) as pool_points,   -- NETO
      coalesce(tlr.spent_by_local,0) as spent
    from team_local_remaining tlr
  ),
  ranked as (
    select
      b.local_team_id,
      b.pool_team_id,
      b.pool_points,
      b.spent,
      greatest(b.pool_points - b.spent, 0) as total_local
    from base b
  )
  select
    r.local_team_id,
    r.pool_team_id,
    tl.name as local_name,
    tp.name as pool_name,
    r.spent,
    r.pool_points,
    r.total_local
  from ranked r
  left join teams tl on tl.id = r.local_team_id
  left join teams tp on tp.id = r.pool_team_id
  order by r.total_local desc, r.local_team_id asc
  limit coalesce(_limit, 9);
$$;


ALTER FUNCTION "public"."top_local_leaderboard"("_limit" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_actions" (
    "id" bigint NOT NULL,
    "actor" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_actions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."admin_actions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."admin_actions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."admin_actions_id_seq" OWNED BY "public"."admin_actions"."id";



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" bigint NOT NULL,
    "student_id" bigint,
    "delta" integer NOT NULL,
    "reason" "text",
    "device_id" "text",
    "teacher_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."balances" WITH ("security_invoker"='on') AS
 SELECT "student_id",
    COALESCE("sum"("delta"), (0)::bigint) AS "points"
   FROM "public"."transactions"
  GROUP BY "student_id";


ALTER VIEW "public"."balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bridge_status" (
    "device_id" "text" NOT NULL,
    "last_uid" "text",
    "last_seen" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bridge_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cards" (
    "id" bigint NOT NULL,
    "student_id" bigint,
    "card_uid" "text",
    "card_token" "text",
    "active" boolean DEFAULT true,
    "team_id" integer,
    "card_role" "text" DEFAULT 'student'::"text" NOT NULL,
    CONSTRAINT "cards_card_role_check" CHECK (("card_role" = ANY (ARRAY['student'::"text", 'team_earn'::"text", 'team_spend'::"text"])))
);


ALTER TABLE "public"."cards" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cards_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cards_id_seq" OWNED BY "public"."cards"."id";



CREATE TABLE IF NOT EXISTS "public"."game_scores" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_scores_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."game_local_best" AS
 SELECT "local_team_id",
    "student_id",
    "student_name",
    "max"("score") AS "best_score"
   FROM "public"."game_scores"
  GROUP BY "local_team_id", "student_id", "student_name";


ALTER VIEW "public"."game_local_best" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."game_scores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."game_scores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."game_scores_id_seq" OWNED BY "public"."game_scores"."id";



CREATE TABLE IF NOT EXISTS "public"."game_scores_archive" (
    "id" bigint DEFAULT "nextval"('"public"."game_scores_id_seq"'::"regclass") NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    CONSTRAINT "game_scores_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_scores_orbit" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "student_id" bigint,
    "student_name" "text",
    "local_team_id" bigint,
    "local_team_name" "text",
    "difficulty" "text",
    "score" integer,
    CONSTRAINT "game_scores_orbit_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_orbit_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_orbit" OWNER TO "postgres";


ALTER TABLE "public"."game_scores_orbit" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."game_scores_orbit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_scores_road" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_scores_road_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_road_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_road" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."game_scores_road_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."game_scores_road_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."game_scores_road_id_seq" OWNED BY "public"."game_scores_road"."id";



CREATE TABLE IF NOT EXISTS "public"."game_scores_road_archive" (
    "id" bigint DEFAULT "nextval"('"public"."game_scores_road_id_seq"'::"regclass") NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    CONSTRAINT "game_scores_road_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_road_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_road_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_scores_snake" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_scores_snake_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_snake_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_snake" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."game_scores_snake_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."game_scores_snake_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."game_scores_snake_id_seq" OWNED BY "public"."game_scores_snake"."id";



CREATE TABLE IF NOT EXISTS "public"."game_scores_snake_archive" (
    "id" bigint DEFAULT "nextval"('"public"."game_scores_snake_id_seq"'::"regclass") NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    CONSTRAINT "game_scores_snake_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_snake_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_snake_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_scores_tetris" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_scores_tetris_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_tetris_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_tetris" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."game_scores_tetris_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."game_scores_tetris_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."game_scores_tetris_id_seq" OWNED BY "public"."game_scores_tetris"."id";



CREATE TABLE IF NOT EXISTS "public"."game_scores_tetris_archive" (
    "id" bigint DEFAULT "nextval"('"public"."game_scores_tetris_id_seq"'::"regclass") NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" bigint NOT NULL,
    "student_name" "text" NOT NULL,
    "local_team_id" bigint NOT NULL,
    "local_team_name" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    CONSTRAINT "game_scores_tetris_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'normal'::"text", 'hard'::"text", 'insane'::"text"]))),
    CONSTRAINT "game_scores_tetris_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."game_scores_tetris_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['teacher'::"text", 'student'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "class" "text",
    "auth_user_id" "uuid"
);


ALTER TABLE "public"."students" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."students_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."students_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."students_id_seq" OWNED BY "public"."students"."id";



CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" bigint NOT NULL,
    "team_id" bigint NOT NULL,
    "student_id" bigint NOT NULL
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."team_balances" WITH ("security_invoker"='on') AS
 SELECT "tm"."team_id",
    COALESCE("sum"("b"."points"), (0)::numeric) AS "points"
   FROM ("public"."team_members" "tm"
     JOIN "public"."balances" "b" ON (("b"."student_id" = "tm"."student_id")))
  GROUP BY "tm"."team_id";


ALTER VIEW "public"."team_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_pool_tx" (
    "id" bigint NOT NULL,
    "pool_team_id" integer NOT NULL,
    "local_team_id" integer,
    "delta" integer NOT NULL,
    "reason" "text",
    "device_id" "text",
    "teacher_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tx_type" "text" DEFAULT 'earn'::"text",
    CONSTRAINT "team_pool_tx_tx_type_check" CHECK (("tx_type" = ANY (ARRAY['earn'::"text", 'spend'::"text", 'adjust'::"text"])))
);


ALTER TABLE "public"."team_pool_tx" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."team_local_spend" WITH ("security_invoker"='on') AS
 SELECT "local_team_id",
    COALESCE("sum"((- "delta")), (0)::bigint) AS "spent"
   FROM "public"."team_pool_tx"
  WHERE (COALESCE("tx_type", 'earn'::"text") = 'spend'::"text")
  GROUP BY "local_team_id";


ALTER VIEW "public"."team_local_spend" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."team_pool_balances" WITH ("security_invoker"='on') AS
 SELECT "pool_team_id",
    COALESCE("sum"("delta"), (0)::bigint) AS "points"
   FROM "public"."team_pool_tx"
  WHERE (COALESCE("tx_type", 'earn'::"text") <> 'spend'::"text")
  GROUP BY "pool_team_id";


ALTER VIEW "public"."team_pool_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "class" "text",
    "scope" "text",
    "parent_global_id" integer
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."team_local_remaining" WITH ("security_invoker"='on') AS
 SELECT "lt"."id" AS "local_team_id",
    "pg"."id" AS "pool_team_id",
    COALESCE("pb"."points", (0)::bigint) AS "pool_points",
    COALESCE("ls"."spent", (0)::bigint) AS "spent_by_local",
    GREATEST((COALESCE("pb"."points", (0)::bigint) - COALESCE(( SELECT "sum"((- "t"."delta")) AS "sum"
           FROM "public"."team_pool_tx" "t"
          WHERE (("t"."pool_team_id" = "pg"."id") AND (COALESCE("t"."tx_type", 'earn'::"text") = 'spend'::"text"))), (0)::bigint)), (0)::bigint) AS "pool_remaining"
   FROM ((("public"."teams" "lt"
     JOIN "public"."teams" "pg" ON ((("pg"."id" = "lt"."parent_global_id") AND ("lt"."scope" = 'local'::"text") AND ("pg"."scope" = 'global'::"text"))))
     LEFT JOIN "public"."team_pool_balances" "pb" ON (("pb"."pool_team_id" = "pg"."id")))
     LEFT JOIN "public"."team_local_spend" "ls" ON (("ls"."local_team_id" = "lt"."id")));


ALTER VIEW "public"."team_local_remaining" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."team_member_points" WITH ("security_invoker"='on') AS
 SELECT "tm"."team_id",
    "s"."id" AS "student_id",
    "s"."name",
    "s"."class",
    COALESCE("b"."points", (0)::bigint) AS "points"
   FROM (("public"."team_members" "tm"
     JOIN "public"."students" "s" ON (("s"."id" = "tm"."student_id")))
     LEFT JOIN "public"."balances" "b" ON (("b"."student_id" = "s"."id")));


ALTER VIEW "public"."team_member_points" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."team_members_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."team_members_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."team_members_id_seq" OWNED BY "public"."team_members"."id";



CREATE OR REPLACE VIEW "public"."team_pool_earned" WITH ("security_invoker"='on') AS
 SELECT "pool_team_id",
    COALESCE("sum"(
        CASE
            WHEN ("delta" > 0) THEN "delta"
            ELSE 0
        END), (0)::bigint) AS "earned"
   FROM "public"."team_pool_tx"
  GROUP BY "pool_team_id";


ALTER VIEW "public"."team_pool_earned" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."team_pool_tx_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."team_pool_tx_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."team_pool_tx_id_seq" OWNED BY "public"."team_pool_tx"."id";



CREATE TABLE IF NOT EXISTS "public"."team_pool_tx_archive" (
    "id" bigint DEFAULT "nextval"('"public"."team_pool_tx_id_seq"'::"regclass") NOT NULL,
    "pool_team_id" integer NOT NULL,
    "local_team_id" integer,
    "delta" integer NOT NULL,
    "reason" "text",
    "device_id" "text",
    "teacher_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tx_type" "text" DEFAULT 'earn'::"text",
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    CONSTRAINT "team_pool_tx_tx_type_check" CHECK (("tx_type" = ANY (ARRAY['earn'::"text", 'spend'::"text", 'adjust'::"text"])))
);


ALTER TABLE "public"."team_pool_tx_archive" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."teams_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."teams_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."teams_id_seq" OWNED BY "public"."teams"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transactions_id_seq" OWNED BY "public"."transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."transactions_archive" (
    "id" bigint DEFAULT "nextval"('"public"."transactions_id_seq"'::"regclass") NOT NULL,
    "student_id" bigint,
    "delta" integer NOT NULL,
    "reason" "text",
    "device_id" "text",
    "teacher_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid"
);


ALTER TABLE "public"."transactions_archive" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_actions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."admin_actions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cards" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cards_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."game_scores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."game_scores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."game_scores_road" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."game_scores_road_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."game_scores_snake" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."game_scores_snake_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."game_scores_tetris" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."game_scores_tetris_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."students" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."students_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."team_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."team_members_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."team_pool_tx" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."team_pool_tx_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."teams" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."teams_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_actions"
    ADD CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bridge_status"
    ADD CONSTRAINT "bridge_status_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_card_token_key" UNIQUE ("card_token");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_card_uid_key" UNIQUE ("card_uid");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_archive"
    ADD CONSTRAINT "game_scores_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_orbit"
    ADD CONSTRAINT "game_scores_orbit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores"
    ADD CONSTRAINT "game_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_road_archive"
    ADD CONSTRAINT "game_scores_road_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_road"
    ADD CONSTRAINT "game_scores_road_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_snake_archive"
    ADD CONSTRAINT "game_scores_snake_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_snake"
    ADD CONSTRAINT "game_scores_snake_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_tetris_archive"
    ADD CONSTRAINT "game_scores_tetris_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores_tetris"
    ADD CONSTRAINT "game_scores_tetris_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_student_id_key" UNIQUE ("team_id", "student_id");



ALTER TABLE ONLY "public"."team_pool_tx_archive"
    ADD CONSTRAINT "team_pool_tx_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_pool_tx"
    ADD CONSTRAINT "team_pool_tx_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_key" UNIQUE ("name");



ALTER TABLE "public"."teams"
    ADD CONSTRAINT "teams_parent_scope_chk" CHECK (((("scope" = 'global'::"text") AND ("parent_global_id" IS NULL)) OR (("scope" = 'local'::"text") AND ("parent_global_id" IS NOT NULL)))) NOT VALID;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."teams"
    ADD CONSTRAINT "teams_scope_allowed_chk" CHECK (("scope" = ANY (ARRAY['global'::"text", 'local'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."transactions_archive"
    ADD CONSTRAINT "transactions_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "game_scores_road_archive_local_team_id_score_idx" ON "public"."game_scores_road_archive" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "game_scores_road_archive_student_id_idx" ON "public"."game_scores_road_archive" USING "btree" ("student_id");



CREATE INDEX "game_scores_snake_archive_local_team_id_score_idx" ON "public"."game_scores_snake_archive" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "game_scores_snake_archive_student_id_idx" ON "public"."game_scores_snake_archive" USING "btree" ("student_id");



CREATE INDEX "game_scores_tetris_archive_local_team_id_score_idx" ON "public"."game_scores_tetris_archive" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "game_scores_tetris_archive_student_id_idx" ON "public"."game_scores_tetris_archive" USING "btree" ("student_id");



CREATE INDEX "idx_cards_uid" ON "public"."cards" USING "btree" ("card_uid") WHERE ("active" IS TRUE);



CREATE INDEX "idx_gs_orbit_local_score" ON "public"."game_scores_orbit" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "idx_gs_orbit_student" ON "public"."game_scores_orbit" USING "btree" ("student_id");



CREATE INDEX "idx_gs_road_local_score" ON "public"."game_scores_road" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "idx_gs_road_student" ON "public"."game_scores_road" USING "btree" ("student_id");



CREATE INDEX "idx_gs_snake_local_score" ON "public"."game_scores_snake" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "idx_gs_snake_student" ON "public"."game_scores_snake" USING "btree" ("student_id");



CREATE INDEX "idx_gs_tetris_local_score" ON "public"."game_scores_tetris" USING "btree" ("local_team_id", "score" DESC);



CREATE INDEX "idx_gs_tetris_student" ON "public"."game_scores_tetris" USING "btree" ("student_id");



CREATE INDEX "idx_students_class_name" ON "public"."students" USING "btree" ("class", "name");



CREATE INDEX "idx_team_members_team" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "idx_teams_parent_scope" ON "public"."teams" USING "btree" ("parent_global_id", "scope");



CREATE INDEX "idx_transactions_created_at" ON "public"."transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_transactions_student" ON "public"."transactions" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_transactions_student_created" ON "public"."transactions" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "transactions_archive_created_at_idx" ON "public"."transactions_archive" USING "btree" ("created_at" DESC);



CREATE INDEX "transactions_archive_student_id_created_at_idx" ON "public"."transactions_archive" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "transactions_archive_student_id_created_at_idx1" ON "public"."transactions_archive" USING "btree" ("student_id", "created_at" DESC);



CREATE UNIQUE INDEX "uq_cards_card_uid" ON "public"."cards" USING "btree" ("card_uid");



CREATE UNIQUE INDEX "uq_students_auth_user_id" ON "public"."students" USING "btree" ("auth_user_id");



ALTER TABLE ONLY "public"."admin_actions"
    ADD CONSTRAINT "admin_actions_actor_fkey" FOREIGN KEY ("actor") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_scores"
    ADD CONSTRAINT "game_scores_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_orbit"
    ADD CONSTRAINT "game_scores_orbit_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_orbit"
    ADD CONSTRAINT "game_scores_orbit_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_orbit"
    ADD CONSTRAINT "game_scores_orbit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_road"
    ADD CONSTRAINT "game_scores_road_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_road"
    ADD CONSTRAINT "game_scores_road_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_road"
    ADD CONSTRAINT "game_scores_road_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_snake"
    ADD CONSTRAINT "game_scores_snake_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_snake"
    ADD CONSTRAINT "game_scores_snake_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_snake"
    ADD CONSTRAINT "game_scores_snake_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores"
    ADD CONSTRAINT "game_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_tetris"
    ADD CONSTRAINT "game_scores_tetris_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_tetris"
    ADD CONSTRAINT "game_scores_tetris_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores_tetris"
    ADD CONSTRAINT "game_scores_tetris_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_scores"
    ADD CONSTRAINT "game_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_pool_tx"
    ADD CONSTRAINT "team_pool_tx_local_team_id_fkey" FOREIGN KEY ("local_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_pool_tx"
    ADD CONSTRAINT "team_pool_tx_pool_team_id_fkey" FOREIGN KEY ("pool_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_parent_global_id_fkey" FOREIGN KEY ("parent_global_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Students can view their cards" ON "public"."cards" FOR SELECT USING (("student_id" IN ( SELECT "students"."id"
   FROM "public"."students"
  WHERE ("students"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Students can view their transactions" ON "public"."transactions" FOR SELECT USING (("student_id" IN ( SELECT "students"."id"
   FROM "public"."students"
  WHERE ("students"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Students can view themselves" ON "public"."students" FOR SELECT USING (("auth"."uid"() = "auth_user_id"));



ALTER TABLE "public"."admin_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bridge_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cards: teacher can insert" ON "public"."cards" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



CREATE POLICY "cards: teacher can select all" ON "public"."cards" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



CREATE POLICY "cards: teacher can update" ON "public"."cards" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



CREATE POLICY "flappy: insert own run" ON "public"."game_scores" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("s"."id" = "game_scores"."student_id") AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores"."local_team_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "flappy: select same local" ON "public"."game_scores" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores"."local_team_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "game: insert own run" ON "public"."game_scores" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("s"."id" = "game_scores"."student_id") AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores"."local_team_id"))))));



CREATE POLICY "game: select same local" ON "public"."game_scores" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores"."local_team_id")))));



ALTER TABLE "public"."game_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_scores_road" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_scores_snake" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_scores_tetris" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile: self can read" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: read own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles: read self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "road: insert own run" ON "public"."game_scores_road" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("s"."id" = "game_scores_road"."student_id") AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_road"."local_team_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "road: select same local" ON "public"."game_scores_road" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_road"."local_team_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "snake: insert own run" ON "public"."game_scores_snake" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("s"."id" = "game_scores_snake"."student_id") AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_snake"."local_team_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "snake: select same local" ON "public"."game_scores_snake" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_snake"."local_team_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "student: read all globals" ON "public"."teams" FOR SELECT TO "authenticated" USING (("scope" = 'global'::"text"));



CREATE POLICY "student: read own membership" ON "public"."team_members" FOR SELECT TO "authenticated" USING (("student_id" IN ( SELECT "students"."id"
   FROM "public"."students"
  WHERE ("students"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "student: read own tx" ON "public"."transactions" FOR SELECT TO "authenticated" USING (("student_id" IN ( SELECT "students"."id"
   FROM "public"."students"
  WHERE ("students"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "student: read self" ON "public"."students" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "student: read via fn" ON "public"."teams" FOR SELECT TO "authenticated" USING ("public"."student_can_read_team"("auth"."uid"(), "id"));



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students: teacher can insert" ON "public"."students" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



CREATE POLICY "students: teacher can select all" ON "public"."students" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher rw bridge_status" ON "public"."bridge_status" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: all teams" ON "public"."teams" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: delete students" ON "public"."students" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: delete team_members" ON "public"."team_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: insert students" ON "public"."students" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: insert team_members" ON "public"."team_members" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: insert tx" ON "public"."transactions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read admin_actions" ON "public"."admin_actions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read cards" ON "public"."cards" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read pool_archive" ON "public"."team_pool_tx_archive" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read students" ON "public"."students" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read team_members" ON "public"."team_members" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read tx" ON "public"."transactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: read tx_archive" ON "public"."transactions_archive" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: update cards" ON "public"."cards" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: update students" ON "public"."students" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



CREATE POLICY "teacher: upsert cards" ON "public"."cards" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text")))));



ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_pool_tx_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tetris: insert own run" ON "public"."game_scores_tetris" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("s"."id" = "game_scores_tetris"."student_id") AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_tetris"."local_team_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



CREATE POLICY "tetris: select same local" ON "public"."game_scores_tetris" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM (("public"."students" "s"
     JOIN "public"."team_members" "tm" ON (("tm"."student_id" = "s"."id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "tm"."team_id")))
  WHERE (("s"."auth_user_id" = "auth"."uid"()) AND ("t"."scope" = 'local'::"text") AND ("tm"."team_id" = "game_scores_tetris"."local_team_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'teacher'::"text"))))));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions: teacher can select all" ON "public"."transactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'teacher'::"text")))));



ALTER TABLE "public"."transactions_archive" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."award_points"("_identifier" "text", "_delta" integer, "_reason" "text", "_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."award_points"("_identifier" "text", "_delta" integer, "_reason" "text", "_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_points"("_identifier" "text", "_delta" integer, "_reason" "text", "_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."award_points_by_student"("_student_id" bigint, "_delta" integer, "_reason" "text", "_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."award_points_by_student"("_student_id" bigint, "_delta" integer, "_reason" "text", "_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_points_by_student"("_student_id" bigint, "_delta" integer, "_reason" "text", "_device_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_student"("_student_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_student"("_student_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_student"("_student_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_student"("_student_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard"("_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard"("_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard"("_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_road"("_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_snake"("_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."game_local_team_leaderboard_tetris"("_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_local_total"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_local_total"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_local_total"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_auth_user_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_auth_user_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_auth_user_created"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_all_points"("include_game_scores" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."reset_all_points"("include_game_scores" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_all_points"("include_game_scores" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_game_scores"("games" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."reset_game_scores"("games" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_game_scores"("games" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."student_can_read_team"("_uid" "uuid", "_team_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."student_can_read_team"("_uid" "uuid", "_team_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."student_can_read_team"("_uid" "uuid", "_team_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."team_local_spend_adjust"("_local_team_id" integer, "_amount" integer, "_reason" "text", "_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."team_local_spend_adjust"("_local_team_id" integer, "_amount" integer, "_reason" "text", "_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_local_spend_adjust"("_local_team_id" integer, "_amount" integer, "_reason" "text", "_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."team_pool_adjust"("_pool_team_id" integer, "_delta" integer, "_reason" "text", "_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."team_pool_adjust"("_pool_team_id" integer, "_delta" integer, "_reason" "text", "_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_pool_adjust"("_pool_team_id" integer, "_delta" integer, "_reason" "text", "_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."top_local_leaderboard"("_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."top_local_leaderboard"("_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."top_local_leaderboard"("_limit" integer) TO "service_role";


















GRANT ALL ON TABLE "public"."admin_actions" TO "anon";
GRANT ALL ON TABLE "public"."admin_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_actions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."balances" TO "anon";
GRANT ALL ON TABLE "public"."balances" TO "authenticated";
GRANT ALL ON TABLE "public"."balances" TO "service_role";



GRANT ALL ON TABLE "public"."bridge_status" TO "anon";
GRANT ALL ON TABLE "public"."bridge_status" TO "authenticated";
GRANT ALL ON TABLE "public"."bridge_status" TO "service_role";



GRANT ALL ON TABLE "public"."cards" TO "anon";
GRANT ALL ON TABLE "public"."cards" TO "authenticated";
GRANT ALL ON TABLE "public"."cards" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cards_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores" TO "anon";
GRANT ALL ON TABLE "public"."game_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores" TO "service_role";



GRANT ALL ON TABLE "public"."game_local_best" TO "anon";
GRANT ALL ON TABLE "public"."game_local_best" TO "authenticated";
GRANT ALL ON TABLE "public"."game_local_best" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_archive" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_archive" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_orbit" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_orbit" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_orbit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_scores_orbit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_scores_orbit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_scores_orbit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_road" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_road" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_road" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_scores_road_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_scores_road_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_scores_road_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_road_archive" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_road_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_road_archive" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_snake" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_snake" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_snake" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_scores_snake_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_scores_snake_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_scores_snake_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_snake_archive" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_snake_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_snake_archive" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_tetris" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_tetris" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_tetris" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_scores_tetris_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_scores_tetris_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_scores_tetris_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores_tetris_archive" TO "anon";
GRANT ALL ON TABLE "public"."game_scores_tetris_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores_tetris_archive" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON SEQUENCE "public"."students_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."students_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."students_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."team_balances" TO "anon";
GRANT ALL ON TABLE "public"."team_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."team_balances" TO "service_role";



GRANT ALL ON TABLE "public"."team_pool_tx" TO "anon";
GRANT ALL ON TABLE "public"."team_pool_tx" TO "authenticated";
GRANT ALL ON TABLE "public"."team_pool_tx" TO "service_role";



GRANT ALL ON TABLE "public"."team_local_spend" TO "anon";
GRANT ALL ON TABLE "public"."team_local_spend" TO "authenticated";
GRANT ALL ON TABLE "public"."team_local_spend" TO "service_role";



GRANT ALL ON TABLE "public"."team_pool_balances" TO "anon";
GRANT ALL ON TABLE "public"."team_pool_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."team_pool_balances" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."team_local_remaining" TO "anon";
GRANT ALL ON TABLE "public"."team_local_remaining" TO "authenticated";
GRANT ALL ON TABLE "public"."team_local_remaining" TO "service_role";



GRANT ALL ON TABLE "public"."team_member_points" TO "anon";
GRANT ALL ON TABLE "public"."team_member_points" TO "authenticated";
GRANT ALL ON TABLE "public"."team_member_points" TO "service_role";



GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_pool_earned" TO "anon";
GRANT ALL ON TABLE "public"."team_pool_earned" TO "authenticated";
GRANT ALL ON TABLE "public"."team_pool_earned" TO "service_role";



GRANT ALL ON SEQUENCE "public"."team_pool_tx_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."team_pool_tx_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."team_pool_tx_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_pool_tx_archive" TO "anon";
GRANT ALL ON TABLE "public"."team_pool_tx_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."team_pool_tx_archive" TO "service_role";



GRANT ALL ON SEQUENCE "public"."teams_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."teams_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."teams_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transactions_archive" TO "anon";
GRANT ALL ON TABLE "public"."transactions_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions_archive" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_created();


