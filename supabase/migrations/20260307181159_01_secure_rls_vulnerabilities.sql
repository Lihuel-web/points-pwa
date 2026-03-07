-- =================================================================================
-- MIGRATION: 01_secure_rls_vulnerabilities
-- TARGET: Mitigación de "RLS Disabled in Public" reportado en auditoría
-- =================================================================================

-- 1. ACTIVACIÓN DEL ESCUDO (Lockdown)
-- Habilitamos Row Level Security en las tablas expuestas. Esto deniega todo acceso por defecto.
ALTER TABLE public.game_scores_orbit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_pool_tx ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_pool_tx_archive ENABLE ROW LEVEL SECURITY;

-- =================================================================================
-- POLÍTICAS PARA: game_scores_orbit
-- =================================================================================

-- READ: Permitimos a cualquier usuario autenticado leer los scores (necesario para la Leaderboard)
CREATE POLICY "Allow authenticated read access on game_scores_orbit" 
ON public.game_scores_orbit FOR SELECT 
TO authenticated USING (true);

-- INSERT: Validación biométrica. El usuario solo puede insertar su propio score.
-- Bloquea a los atacantes que intenten inyectar JSON con IDs de otros alumnos.
CREATE POLICY "Allow students to insert their own scores" 
ON public.game_scores_orbit FOR INSERT 
TO authenticated WITH CHECK (auth.uid() = user_id);

-- ADMIN: Los profesores tienen control total (CRUD) sobre los scores para corregir errores o borrar trampas.
CREATE POLICY "Allow teachers full access to game_scores_orbit" 
ON public.game_scores_orbit FOR ALL 
TO authenticated 
USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher' );

-- =================================================================================
-- POLÍTICAS PARA: team_pool_tx (Transacciones de puntos)
-- =================================================================================

-- READ: Los alumnos necesitan leer esto para calcular el balance de su equipo.
CREATE POLICY "Allow authenticated read access on team_pool_tx" 
ON public.team_pool_tx FOR SELECT 
TO authenticated USING (true);

-- WRITE/ADMIN: Estrictamente restringido al rol 'teacher'. 
-- Ningún alumno puede transferirse puntos a sí mismo o a su equipo.
CREATE POLICY "Allow teachers to manage team pool transactions" 
ON public.team_pool_tx FOR ALL 
TO authenticated 
USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher' );

-- =================================================================================
-- POLÍTICAS PARA: team_pool_tx_archive (Historial inmutable)
-- =================================================================================

-- READ: Lectura pública para usuarios logueados.
CREATE POLICY "Allow authenticated read access on team_pool_tx_archive" 
ON public.team_pool_tx_archive FOR SELECT 
TO authenticated USING (true);

-- WRITE/ADMIN: Estrictamente restringido al rol 'teacher'.
CREATE POLICY "Allow teachers to manage transaction archives" 
ON public.team_pool_tx_archive FOR ALL 
TO authenticated 
USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher' );