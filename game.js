// game.js — ASCII Flappy con leaderboard y dificultad
// - Tiempo de juego = Total (local) (tope 240)
// - Dificultad ajusta velocidad/obstáculos + multiplicador de puntaje
// - Guarda la partida en game_scores (no modifica puntos de equipo)

const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };

// ---------- Dificultad ----------
const DIFFS = {
  easy:   { label: 'easy',   mult: 1.00, tickMs: +10, spawnDelta: +4, gapDelta: +1 },
  normal: { label: 'normal', mult: 1.25, tickMs:  0,  spawnDelta:  0, gapDelta:  0 },
  hard:   { label: 'hard',   mult: 1.60, tickMs: -8,  spawnDelta: -3, gapDelta: -1 },
  insane: { label: 'insane', mult: 2.00, tickMs: -12, spawnDelta: -5, gapDelta: -2 },
};
function getDiff() {
  const v = $('difficulty')?.value || 'normal';
  return DIFFS[v] || DIFFS.normal;
}

// ---------- Estado del juego ----------
let playSeconds = 0;   // definido por total_local (cap 240)
let timerSec = null;
let loop = null;
let paused = false;

const W = 60;
const H = 20;
const GROUND = H - 2;
let grid = [];

let bird = { x: 8, y: 10, vy: 0 };
let gravity = 0.35;
let jumpV = -1.8;

let cols = [];           // { x, gapY, gapH }
let spawnEvery = 22;     // tuneado dinámicamente
let tickMs = 65;         // base 65ms; bajar = más rápido
let frameCount = 0;
let baseScore = 0;       // sin multiplicador
let timeLeft = 0;
let gapHBase = 6;        // base; puede ajustarse por dificultad

// Datos del jugador/equipo (para guardar y leaderboard)
let authUser = null;
let student = null;        // { id, name }
let localTeam = null;      // { id, name }
let poolTeam = null;       // { id, name }
let totals = { pool: 0, spent: 0, totalLocal: 0 };

// ---------- Grid ----------
function clearGrid(){ grid = Array.from({ length:H }, () => Array.from({ length:W }, ()=>' ')); }
function put(x,y,ch){ if (x>=0 && x<W && y>=0 && y<H) grid[y][x] = ch; }
function render(){
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
  for (let x=0;x<W;x++){ grid[GROUND][x]='_'; if (grid[GROUND+1]) grid[GROUND+1][x]='_'; }

  for (const c of cols){
    for (let y=0;y<H;y++){
      if (y < c.gapY || y >= c.gapY + c.gapH){
        if (y < GROUND) put(c.x, y, '|');
      }
    }
  }
  put(bird.x, Math.round(bird.y), '>');

  const d = getDiff();
  const hud = `time:${String(timeLeft).padStart(3)}  score:${String(baseScore).padStart(3)}  x${d.mult.toFixed(2)}`;
  for (let i=0;i<hud.length && i<W;i++) put(i,0,hud[i]);

  $('screen').textContent = grid.map(r => r.join('')).join('\n');
}

// ---------- Obstáculos ----------
function spawnColumn(){
  const margin = 3;
  const gapH = Math.max(3, gapHBase + (Math.random()<0.2?-1:0) + (Math.random()<0.2?+1:0));
  const gapY = Math.floor(Math.random() * (GROUND - margin - gapH)) + margin;
  cols.push({ x: W-1, gapY, gapH });
}

// ---------- Dificultad según total_local + selector ----------
function tuneDifficultyFromTotals(){
  // Tiempo = total_local (cap 240)
  playSeconds = Math.min(240, Math.max(0, Number(totals.totalLocal || 0)));
  timeLeft = playSeconds;
  text($('hud-time'), playSeconds);

  // Base según puntos (jugadores con pocos puntos: un poco más fácil)
  tickMs = Math.max(55, 70 - Math.floor(totals.totalLocal/6));
  spawnEvery = Math.max(14, 24 - Math.floor(totals.totalLocal/5));
  gapHBase = 6 - Math.min(2, Math.floor(totals.totalLocal/30));

  // Ajustes por dificultad seleccionada
  const d = getDiff();
  tickMs = Math.max(45, tickMs + d.tickMs);
  spawnEvery = Math.max(10, spawnEvery + d.spawnDelta);
  gapHBase = Math.max(3, gapHBase + d.gapDelta);

  text($('hud-diff'), `${d.label} ×${d.mult.toFixed(2)}`);
}

// ---------- Ciclo ----------
function resetGame(){
  clearGrid();
  bird = { x:8, y:Math.floor(H/2), vy:0 };
  cols = [];
  frameCount = 0;
  baseScore = 0;
  timeLeft = playSeconds;
  paused = false;
  $('btn-start').disabled = true;
  $('btn-stop').disabled = false;
  text($('status'), 'playing');
}
function tick(){
  if (paused) return;
  frameCount++;

  // Física
  bird.vy += gravity;
  bird.y += bird.vy;
  if (bird.y < 1){ bird.y=1; bird.vy=0; }
  if (bird.y >= GROUND){ stopGame('crashed'); return; }

  // Spawning
  if (frameCount % spawnEvery === 0) spawnColumn();

  // Mover columnas y contar “pasadas”
  let passed = false;
  for (const c of cols){
    if (frameCount % 1 === 0) c.x -= 1;
    if (c.x === bird.x - 1) passed = true;
  }
  if (passed) baseScore += 1;

  // Colisiones
  for (const c of cols){
    if (c.x === bird.x){
      const y = Math.round(bird.y);
      if (y < c.gapY || y >= c.gapY + c.gapH){ stopGame('crashed'); return; }
    }
  }
  cols = cols.filter(c => c.x >= 0);

  render();
}
function startLoops(){
  if (loop) clearInterval(loop);
  loop = setInterval(tick, tickMs);
  if (timerSec) clearInterval(timerSec);
  timerSec = setInterval(()=>{
    if (!paused){
      timeLeft -= 1;
      if (timeLeft <= 0){ stopGame('time'); }
    }
  }, 1000);
}
async function stopGame(cause='finished'){
  if (loop){ clearInterval(loop); loop=null; }
  if (timerSec){ clearInterval(timerSec); timerSec=null; }
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  text($('status'), cause === 'time' ? 'time up' : (cause==='crashed'?'crashed':'finished'));

  const d = getDiff();
  const finalScore = Math.max(0, Math.round(baseScore * d.mult));

  $('screen').textContent += `

Game Over — ${cause}.
Base score: ${baseScore}
Difficulty: ${d.label} ×${d.mult.toFixed(2)}
Final score: ${finalScore}
(Tus puntos de equipo NO cambian.)`;

  // Guardar en game_scores
  try{
    if (authUser && student && localTeam){
      await sb.from('game_scores').insert([{
        user_id: authUser.id,
        student_id: student.id,
        student_name: student.name || 'Student',
        local_team_id: localTeam.id,
        local_team_name: localTeam.name || `#${localTeam.id}`,
        difficulty: d.label,
        score: finalScore
      }]);
      await loadLeaderboard(); // refrescar top tras guardar
    }
  }catch(e){ console.warn('save score error', e); }
}
function jump(){ bird.vy = -1.8; }
function togglePause(){ paused = !paused; text($('status'), paused?'paused':'playing'); }

// ---------- Helpers de datos ----------
async function labelTeam(id){
  const { data } = await sb.from('teams').select('id,name,class').eq('id', id).maybeSingle();
  return data ? `${data.name}${data.class?` (${data.class})`:''}` : `#${id}`;
}
async function loadLeaderboard(){
  if (!localTeam?.id) return;
  // Mejor puntaje por estudiante en el mismo local
  const { data, error } = await sb
    .from('game_scores')
    .select('student_id,student_name,score')
    .eq('local_team_id', localTeam.id)
    .order('score', { ascending:false })
    .limit(200); // traigo varias para consolidar

  if (error){ console.warn(error); return; }

  // Consolidar "mejor por estudiante"
  const best = new Map();
  for (const r of (data||[])){
    const prev = best.get(r.student_id) || 0;
    if (r.score > prev) best.set(r.student_id, r.score);
  }
  const rows = Array.from(best.entries())
    .map(([sid,score]) => {
      const name = (data.find(d=>d.student_id===sid)?.student_name) || `#${sid}`;
      return { name, score };
    })
    .sort((a,b)=> b.score - a.score)
    .slice(0, 10);

  const tbody = $('lb-table').querySelector('tbody');
  tbody.innerHTML = rows.map((r,i)=> `<tr><td>${i+1}</td><td>${r.name}</td><td><strong>${r.score}</strong></td></tr>`).join('');
}

// ---------- Bootstrapping ----------
async function main(){
  const { data:{ user } } = await sb.auth.getUser();
  if (!user){ location.href='./index.html'; return; }
  authUser = user;
  text($('hud-user'), user.email || user.id);

  // Tomar student
  const { data: stu } = await sb.from('students').select('id,name,class').eq('auth_user_id', user.id).maybeSingle();
  if (!stu){
    text($('status'),'no team');
    $('screen').textContent = 'Aún no tienes equipo local asignado. Pide a tu profesor que te asigne uno.'; 
    return;
  }
  student = { id: stu.id, name: stu.name || 'Student' };

  // RPC read-only para Total (local)
  const { data, error } = await sb.rpc('get_my_local_total');
  if (error || !data || data.length===0){
    text($('status'),'no team');
    $('screen').textContent = 'No se pudo obtener tu equipo local.';
    return;
  }
  const row = data[0];
  totals.pool       = row.pool_points || 0;
  totals.spent      = row.spent || 0;
  totals.totalLocal = row.total_local || 0;

  localTeam = { id: row.local_team_id, name: await labelTeam(row.local_team_id) };
  poolTeam  = { id: row.pool_team_id,  name: await labelTeam(row.pool_team_id) };

  text($('hud-local'), localTeam.name);
  text($('hud-pool'),  poolTeam.name);
  text($('hud-poolpts'), totals.pool);
  text($('hud-spent'),   totals.spent);
  text($('hud-total'),   totals.totalLocal);

  // Dificultad/tiempo a partir del total_local
  tuneDifficultyFromTotals();

  // Pantalla inicial
  clearGrid(); render();
  $('screen').textContent =
`ASCII Flappy — listo.

Tiempo de juego: ${playSeconds}s (igual a tu Total (local), tope 240)
Dificultad actual: ${getDiff().label} ×${getDiff().mult.toFixed(2)}
Controles: Space/↑ para saltar · P para pausar · Stop para terminar.

Tu puntaje final = obstáculos superados × multiplicador de dificultad.
Tus puntos de equipo no cambian. ¡Suerte!`;

  text($('status'),'ready');
  $('btn-start').disabled = playSeconds <= 0;
  $('btn-stop').disabled = true;

  // Eventos
  $('difficulty').addEventListener('change', ()=>{
    if (!$('btn-stop').disabled){ // si está jugando, no reconfiguro en caliente
      text($('status'),'playing'); return;
    }
    tuneDifficultyFromTotals();
  });
  $('btn-start').addEventListener('click', ()=>{ resetGame(); startLoops(); });
  $('btn-stop').addEventListener('click', ()=>{ stopGame('finished'); });
  document.addEventListener('keydown', (e)=>{
    if ($('btn-stop').disabled) return;
    if (e.code==='Space' || e.key===' ' || e.key==='ArrowUp'){ e.preventDefault(); jump(); }
    if (e.key==='p' || e.key==='P') togglePause();
  });

  // HUD score (aprox cada 300ms)
  setInterval(()=> text($('hud-score'), `${baseScore} → ×${getDiff().mult.toFixed(2)}`), 300);

  // Leaderboard inicial
  await loadLeaderboard();
}

document.addEventListener('DOMContentLoaded', ()=> { main().catch(console.error); });

