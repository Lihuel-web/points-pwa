-- =================================================================================
-- MIGRATION: 02_patch_security_definer_view
-- TARGET: Mitigación de escalada de privilegios en vista (Security Definer)
-- =================================================================================

-- Reemplazamos la vista inyectando la directiva de seguridad.
-- Esto asegura que la vista respete el RLS de la tabla public.game_scores.
CREATE OR REPLACE VIEW public.game_local_best WITH (security_invoker = on) AS 
SELECT 
    local_team_id,
    student_id,
    student_name,
    max(score) AS best_score
FROM public.game_scores
GROUP BY local_team_id, student_id, student_name;