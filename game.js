// game.js — ASCII Flappy (read-only, usa get_my_local_total)

const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };

// --- Estado del juego ---
let playSeconds = 0;
let timerSec = null;  // cuenta atrás por segundos
let loop = null;      // bucle de frames
let paused = false;

const W = 60;         // ancho del mundo interno
const H = 20;         // alto del mundo interno
const GROUND = H - 2; // línea de suelo (deja una fila de margen)
let grid = [];        // matriz de caracteres

// Física “flappy”
let bird = { x: 8, y: 10, vy: 0 };
let gravity = 0.35;
let jumpV = -1.8;

// Obstáculos: columnas con hueco
let cols = []; // { x, gapY, gapH }
let colSpeed = 1;      // celdas por tick (se emula con skip)
let spawnEvery = 22;   // cada N columnas
let tickMs = 60;       // 60–90 ms, ajustable
let frameCount = 0;
let score = 0;
let timeLeft = 0;

// Dificultad según total_local (más puntos ⇒ más tiempo y un poco más de velocidad)
function tuneDifficulty(totalLocal) {
  // Tiempo: 25s base + 2.5s por punto, con top en 240s
  playSeconds = Math.min(240, Math.round(25 + 2.5 * totalLocal));
  // Velocidad: parte en 70ms y baja ligeramente con puntos (más rápido)
  tickMs = Math.max(55, 70 - Math.floor(totalLocal / 5));
  // Frecuencia de obstáculos: más puntos ⇒ aparecen más seguido
  spawnEvery = Math.max(14, 24 - Math.floor(totalLocal / 4));
  // gap altura
  const baseGap = 6;
  const reduce = Math.min(3, Math.floor(totalLocal / 20));
  gapHBase = baseGap - reduce; // global implícita usada en spawnColumn
}

let gapHBase = 6;

// --- Utilidades ---
function clearGrid() {
  grid = Array.from({ length: H }, () => Array.from({ length: W }, () => ' '));
}
function put(x, y, ch) {
  if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch;
}
function render() {
  // cielo
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y][x] = ' ';
  // terreno
  for (let x = 0; x < W; x++) { grid[GROUND][x] = '_'; grid[GROUND+1] && (grid[GROUND+1][x] = '_'); }
  // obstáculos
  for (const c of cols) {
    for (let y = 0; y < H; y++) {
      if (y < c.gapY || y >= c.gapY + c.gapH) {
        if (y < GROUND) put(c.x, y, '|');
      }
    }
  }
  // pájaro
  const by = Math.round(bird.y);
  put(bird.x, by, '>');
  // HUD inline
  const hud = `time:${String(timeLeft).padStart(3)}  score:${String(score).padStart(3)}`;
  for (let i = 0; i < hud.length && i < W; i++) put(i, 0, hud[i]);

  $('screen').textContent = grid.map(row => row.join('')).join('\n');
}

function spawnColumn() {
  const margin = 3;
  const gapH = Math.max(3, gapHBase + (Math.random() < 0.2 ? -1 : 0) + (Math.random() < 0.2 ? +1 : 0));
  const gapY = Math.floor(Math.random() * (GROUND - margin - gapH)) + margin;
  cols.push({ x: W - 1, gapY, gapH });
}

function resetGame() {
  clearGrid();
  bird = { x: 8, y: Math.floor(H/2), vy: 0 };
  cols = [];
  frameCount = 0;
  score = 0;
  timeLeft = playSeconds;
  paused = false;
  $('btn-start').disabled = true;
  $('btn-stop').disabled = false;
  text($('status'), 'playing');
}

function tick() {
  if (paused) return;

  frameCount++;

  // Física del pájaro
  bird.vy += gravity;
  bird.y += bird.vy;
  if (bird.y < 1) { bird.y = 1; bird.vy = 0; }
  if (bird.y >= GROUND) { // colisión con suelo
    stopGame("crashed");
    return;
  }

  // Spawning
  if (frameCount % spawnEvery === 0) spawnColumn();

  // Mover columnas
  let passed = false;
  for (const c of cols) {
    if (frameCount % (Math.max(1, colSpeed)) === 0) c.x -= 1;
    // Chequeo de paso (cuando el tubo pasa al pájaro)
    if (c.x === bird.x - 1) passed = true;
  }
  if (passed) score += 1;

  // Colisiones
  for (const c of cols) {
    if (c.x === bird.x) {
      const y = Math.round(bird.y);
      if (y < c.gapY || y >= c.gapY + c.gapH) {
        stopGame("crashed");
        return;
      }
    }
  }

  // Eliminar columnas fuera
  cols = cols.filter(c => c.x >= 0);

  render();
}

function startLoops() {
  if (loop) clearInterval(loop);
  loop = setInterval(tick, tickMs);
  if (timerSec) clearInterval(timerSec);
  timerSec = setInterval(() => {
    if (!paused) {
      timeLeft -= 1;
      if (timeLeft <= 0) { stopGame("time"); }
    }
  }, 1000);
}

function stopGame(cause = "finished") {
  if (loop) { clearInterval(loop); loop = null; }
  if (timerSec) { clearInterval(timerSec); timerSec = null; }
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  text($('status'), cause === "time" ? 'time up' : (cause === 'crashed' ? 'crashed' : 'finished'));

  // Mensaje final
  $('screen').textContent += `

Game Over — ${cause}.
Score: ${score}
(Recarga o pulsa Start para jugar de nuevo. Tus puntos de equipo no se modifican.)`;
}

function jump() { bird.vy = jumpV; }

function togglePause() {
  paused = !paused;
  text($('status'), paused ? 'paused' : 'playing');
}

// --- Bootstrapping con Supabase ---
async function main() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { location.href = './index.html'; return; }
  text($('hud-user'), user.email || user.id);

  // cache nombres
  const teamName = new Map();
  async function label(id) {
    if (!id) return '—';
    if (teamName.has(id)) return teamName.get(id);
    const { data } = await sb.from('teams').select('id,name,class').eq('id', id).maybeSingle();
    const s = data ? `${data.name}${data.class ? ` (${data.class})` : ''}` : `#${id}`;
    teamName.set(id, s);
    return s;
  }

  // RPC read-only
  const { data, error } = await sb.rpc('get_my_local_total');
  if (error) { console.error(error); text($('status'),'error'); $('screen').textContent = 'No se pudo cargar tu equipo.'; return; }
  if (!data || data.length === 0) {
    text($('status'), 'no team');
    $('screen').textContent = 'Aún no tienes equipo local asignado. Pide a tu profesor que te asigne uno.';
    return;
  }

  const row = data[0];
  const poolId  = row.pool_team_id;
  const localId = row.local_team_id;
  const poolPts = row.pool_points || 0;
  const spent   = row.spent || 0;
  const total   = row.total_local || 0;

  text($('hud-poolpts'), poolPts);
  text($('hud-spent'), spent);
  text($('hud-total'), total);
  text($('hud-pool'),  await label(poolId));
  text($('hud-local'), await label(localId));

  // Dificultad
  tuneDifficulty(total);
  text($('hud-time'), playSeconds);

  // Pantalla inicial
  clearGrid(); render();
  $('screen').textContent =
`ASCII Flappy — listo.
Tiempo de juego: ${playSeconds}s
Obstáculos cada ~${spawnEvery} tics. Velocidad: ${tickMs}ms/tic.
Controles: Space/↑ para saltar · P para pausar · Stop para terminar.`;

  text($('status'), 'ready');
  $('btn-start').disabled = false;
  $('btn-stop').disabled  = true;

  // Eventos
  $('btn-start').addEventListener('click', () => { resetGame(); startLoops(); });
  $('btn-stop').addEventListener('click', () => { stopGame('finished'); });

  window.addEventListener('keydown', (e) => {
    if ($('btn-stop').disabled) return; // no en ready
  });
  window.addEventListener('keydown', (e) => {
    if (text($('status')) === 'ready') return;
  });

  document.addEventListener('keydown', (e) => {
    if ($('btn-stop').disabled) return; // no jugando
    if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); jump(); }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });

  // Mostrar score en HUD cada frame (~300ms para no saturar)
  setInterval(() => text($('hud-score'), score), 300);
}

document.addEventListener('DOMContentLoaded', () => {
  main().catch(console.error);
});

