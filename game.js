// game.js — página del juego (read-only)

const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();
const sb = createClient(SUPA_URL, SUPA_KEY);

// DOM helpers
const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };

let playSeconds = 0;
let timer = null;
let timeLeft = 0;

async function main() {
  // 1) Sesión requerida
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    location.href = './index.html';
    return;
  }
  text($('hud-user'), user.email || user.id);

  // 2) Cargar nombres de equipos (cache muy simple)
  const teamName = new Map();
  async function loadTeamName(id) {
    if (!id) return null;
    if (teamName.has(id)) return teamName.get(id);
    const { data } = await sb.from('teams').select('id,name,class').eq('id', id).maybeSingle();
    const label = data ? `${data.name}${data.class ? ` (${data.class})` : ''}` : `#${id}`;
    teamName.set(id, label);
    return label;
  }

  // 3) RPC segura: puntos del equipo local del alumno
  const { data, error } = await sb.rpc('get_my_local_total');
  if (error) {
    console.error('get_my_local_total', error);
    text($('status'), 'error'); return;
  }
  if (!data || data.length === 0) {
    text($('status'), 'no team');
    $('screen').textContent = 'Tu usuario no tiene equipo local asignado aún.';
    return;
  }
  const row = data[0]; // una fila
  const poolId  = row.pool_team_id;
  const localId = row.local_team_id;
  const poolPts = row.pool_points || 0;
  const spent   = row.spent || 0;
  const total   = row.total_local || 0;

  text($('hud-poolpts'), poolPts);
  text($('hud-spent'), spent);
  text($('hud-total'), total);
  text($('hud-pool'),  await loadTeamName(poolId));
  text($('hud-local'), await loadTeamName(localId));

  // 4) Mecánicas del juego basadas en total_local (read-only)
  //    Ejemplo: 20s base + 2s por punto local, cap en 180s
  playSeconds = Math.min(180, 20 + 2 * total);
  text($('hud-time'), playSeconds);

  text($('status'), 'ready');
  $('btn-start').disabled = false;
  $('btn-stop').disabled  = true;
  $('screen').textContent =
`Ready.
Tu tiempo de juego será: ${playSeconds}s (read-only, sin descontar puntos).
Pulsa "Start" para comenzar.`;
}

function startGame() {
  $('btn-start').disabled = true;
  $('btn-stop').disabled  = false;
  text($('status'), 'playing');

  timeLeft = playSeconds;
  $('screen').textContent = renderFrame();

  timer = setInterval(() => {
    timeLeft -= 1;
    $('screen').textContent = renderFrame();
    if (timeLeft <= 0) stopGame();
  }, 1000);
}

function stopGame() {
  if (timer) clearInterval(timer);
  timer = null;
  $('btn-start').disabled = false;
  $('btn-stop').disabled  = true;
  text($('status'), 'finished');
  $('screen').textContent += `

Game Over.
(Vuelve a esta página cuando quieras; siempre se usará tu total local actual, sin descontar.)`;
}

// Placeholder ASCII (reemplaza por tu juego real)
function renderFrame() {
  const barLen = 40;
  const filled = Math.max(0, Math.floor(barLen * timeLeft / playSeconds));
  const bar = '#'.repeat(filled).padEnd(barLen, '.');
  return `Tiempo restante: ${timeLeft}s
[${bar}]
Usando puntos de tu equipo local (read-only).`;
}

// Wire UI
document.addEventListener('DOMContentLoaded', () => {
  main().catch(err => console.error(err));
  $('btn-start').addEventListener('click', startGame);
  $('btn-stop').addEventListener('click', stopGame);
});
