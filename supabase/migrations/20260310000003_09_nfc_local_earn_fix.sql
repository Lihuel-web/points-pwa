-- ================================================================
-- Migration: 09_nfc_local_earn_fix.sql
-- Add 'team_local_earn' to cards.card_role CHECK constraint and
-- extend award_points RPC to handle team_local_earn NFC cards.
--
-- Changes:
--   1. cards.cards_card_role_check — add 'team_local_earn'.
--   2. Recreate award_points with team_local_earn branch
--      (team_spend remains intact: uses -abs(_delta) + tx_type='spend').
-- ================================================================


-- ----------------------------------------------------------------
-- SECTION 1 — Extend cards.card_role constraint
-- ----------------------------------------------------------------

ALTER TABLE public.cards
  DROP CONSTRAINT cards_card_role_check,
  ADD  CONSTRAINT cards_card_role_check
    CHECK (card_role = ANY (ARRAY['student', 'team_earn', 'team_spend', 'team_local_earn']));


-- ----------------------------------------------------------------
-- SECTION 2 — Recreate award_points with team_local_earn support
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.award_points(
  _identifier text,
  _delta      integer,
  _reason     text,
  _device_id  text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_teacher     uuid := auth.uid();
  v_id_canon    text := upper(regexp_replace(coalesce(_identifier,''), '[^0-9A-F]', '', 'g'));
  v_card        record;
  v_new_balance int;
  v_pool        int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_teacher AND role = 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN: teacher role required';
  END IF;

  SELECT c.* INTO v_card
  FROM cards c
  WHERE coalesce(c.active, true) IS TRUE
    AND upper(regexp_replace(c.card_uid,'[^0-9A-F]','','g')) = v_id_canon
  LIMIT 1;

  IF v_card IS NULL THEN RAISE EXCEPTION 'CARD_NOT_LINKED'; END IF;

  -- Student card
  IF v_card.student_id IS NOT NULL AND v_card.card_role = 'student' THEN
    IF EXISTS (SELECT 1 FROM transactions
               WHERE student_id = v_card.student_id
                 AND coalesce(device_id,'') = coalesce(_device_id,'')
                 AND created_at >= now() - interval '2 seconds') THEN
      RAISE EXCEPTION 'RATE_LIMIT';
    END IF;

    INSERT INTO transactions (student_id, delta, reason, device_id, teacher_id)
    VALUES (v_card.student_id, _delta, _reason, _device_id, v_teacher);

    SELECT coalesce(sum(delta),0) INTO v_new_balance
      FROM transactions WHERE student_id = v_card.student_id;

    RETURN json_build_object(
      'mode',        'student',
      'student_id',   v_card.student_id,
      'new_balance',  v_new_balance
    );
  END IF;

  -- Team cards
  IF v_card.team_id IS NOT NULL AND v_card.card_role IN ('team_earn','team_spend','team_local_earn') THEN

    IF v_card.card_role = 'team_earn' THEN
      IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_card.team_id AND scope='global') THEN
        RAISE EXCEPTION 'BAD_CARD_ROLE';
      END IF;
      INSERT INTO team_pool_tx (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
      VALUES (v_card.team_id, _delta, null, coalesce(_reason,'EARN'), _device_id, v_teacher, 'earn');
      RETURN json_build_object('mode','team_earn','pool_team_id', v_card.team_id);

    ELSIF v_card.card_role = 'team_local_earn' THEN
      SELECT parent_global_id INTO v_pool FROM teams WHERE id = v_card.team_id AND scope='local';
      IF v_pool IS NULL THEN RAISE EXCEPTION 'BAD_CARD_ROLE'; END IF;
      INSERT INTO team_pool_tx (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
      VALUES (v_pool, abs(_delta), v_card.team_id, coalesce(_reason,'LOCAL_EARN'), _device_id, v_teacher, 'local_earn');
      RETURN json_build_object(
        'mode',          'team_local_earn',
        'pool_team_id',   v_pool,
        'local_team_id',  v_card.team_id
      );

    ELSE -- team_spend
      SELECT parent_global_id INTO v_pool FROM teams WHERE id = v_card.team_id AND scope='local';
      IF v_pool IS NULL THEN RAISE EXCEPTION 'BAD_CARD_ROLE'; END IF;
      INSERT INTO team_pool_tx (pool_team_id, delta, local_team_id, reason, device_id, teacher_id, tx_type)
      VALUES (v_pool, -abs(_delta), v_card.team_id, coalesce(_reason,'SPEND'), _device_id, v_teacher, 'spend');
      RETURN json_build_object(
        'mode',          'team_spend',
        'pool_team_id',   v_pool,
        'local_team_id',  v_card.team_id
      );
    END IF;

  END IF;

  RAISE EXCEPTION 'CARD_NOT_LINKED';
END;
$$;

ALTER  FUNCTION public.award_points(text, integer, text, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.award_points(text, integer, text, text) TO anon;
GRANT ALL ON FUNCTION public.award_points(text, integer, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.award_points(text, integer, text, text) TO service_role;
