// game.js — Suite de 4 juegos ASCII
// - Leaderboards por alumno (local) y por equipo (mejor individual del equipo).
// - Teclado sin scroll: preventDefault en cada juego + fallback global.
// - Snake: bordes + game over por pared/cuerpo.
// - Tetris: game over al llegar arriba; caída más lenta en easy/normal.
// - Road: cuerpo ASCII para coches; game over por bordes/choques; pista con ancho variable.
// - HUD: "base → ×mult" y "Total score" en vivo en cada juego.

const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };

const DIFF = {
  easy:   { label:'easy',   mult:1.00, tick:-8,  spawn:+4  },
  normal: { label:'normal', mult:1.25, tick: 0,  spawn: 0  },
  hard:   { label:'hard',   mult:1.60, tick:-8,  spawn:-3  },
  insane: { label:'insane', mult:2.00, tick:-12, spawn:-5  }
};

const TEACHER_PRACTICE_ALIAS = 'The_Final_Boss.exe';

let COMMON = {
  user: null,
  student: null,
  local:   null,
  pool:    null,
  totals:  { pool:0, spent:0, totalLocal:0 },
  teacherPractice: false,
  teacherAvatar: null,
};

function setGamesUnavailable(message){
  ['flappy','snake','tetris','road'].forEach(key => {
    text($(`${key}-status`), 'no team');
    text($(`${key}-screen`), message);
  });
}

async function ensureTeacherAvatar(){
  if (COMMON.teacherAvatar) return COMMON.teacherAvatar;
  try{
    const { data: existing } = await sb.from('students')
      .select('id')
      .eq('name', TEACHER_PRACTICE_ALIAS)
      .order('id', { ascending:true })
      .limit(1);
    if (existing && existing.length){
      COMMON.teacherAvatar = { id: existing[0].id, name: TEACHER_PRACTICE_ALIAS };
      return COMMON.teacherAvatar;
    }
    const { data: created, error } = await sb.from('students')
      .insert([{ name: TEACHER_PRACTICE_ALIAS, class: 'teacher' }])
      .select('id')
      .single();
    if (error) throw error;
    COMMON.teacherAvatar = { id: created.id, name: TEACHER_PRACTICE_ALIAS };
    return COMMON.teacherAvatar;
  }catch(e){
    console.warn('teacher avatar student unavailable', e);
    return null;
  }
}

// ---------- Supabase helpers ----------
async function labelTeam(id){
  const { data } = await sb.from('teams').select('id,name,class').eq('id', id).maybeSingle();
  return data ? `${data.name}${data.class?` (${data.class})`:''}` : `#${id}`;
}

async function bootstrapCommon(){
  const { data:{ user } } = await sb.auth.getUser();
  if (!user){ location.href='./index.html'; return false; }
  COMMON.user = user;

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role || 'student';
  if (role === 'teacher') {
    return bootstrapTeacherPractice();
  }

  const { data: stu } = await sb.from('students').select('id,name,class').eq('auth_user_id', user.id).maybeSingle();
  if (!stu){
    setGamesUnavailable('Aún no tienes equipo local asignado. Pide a tu profesor que te asigne uno.');
    return false;
  }
  COMMON.student = { id: stu.id, name: stu.name || 'Student' };

  const { data, error } = await sb.rpc('get_my_local_total');
  if (error || !data || data.length===0){
    setGamesUnavailable('No se pudo obtener tu equipo local.');
    return false;
  }
  const row = data[0];
  COMMON.totals.pool       = row.pool_points || 0;
  COMMON.totals.spent      = row.spent || 0;
  COMMON.totals.totalLocal = Math.min(240, row.total_local || 0);

  COMMON.local = { id: row.local_team_id, name: await labelTeam(row.local_team_id) };
  COMMON.pool  = { id: row.pool_team_id,  name: await labelTeam(row.pool_team_id)  };

  // Estos IDs son opcionales; si no existen, no pasa nada.
  text($('common-user'),  COMMON.user.email || COMMON.user.id);
  text($('common-local'), COMMON.local.name);
  text($('common-pool'),  COMMON.pool.name);
  text($('common-poolpts'), COMMON.totals.pool);
  text($('common-spent'),   COMMON.totals.spent);
  text($('common-total'),   COMMON.totals.totalLocal);

  ['flappy','snake','tetris','road'].forEach(k => {
    const b = $(`${k}-start`);
    if (b) b.disabled = COMMON.totals.totalLocal <= 0;
  });
  return true;
}

async function bootstrapTeacherPractice(){
  COMMON.teacherPractice = true;
  const avatar = await ensureTeacherAvatar();
  if (!avatar){
    setGamesUnavailable('No se pudo preparar el alias del profe para el leaderboard.');
    COMMON.teacherPractice = false;
    return false;
  }

  const { data, error } = await sb.rpc('top_local_leaderboard', { _limit: 1 });
  if (error || !data || data.length === 0) {
    setGamesUnavailable('No hay equipos locales con puntos disponibles para practicar.');
    COMMON.teacherPractice = false;
    return false;
  }

  const top = data[0];
  const localName = top.local_name || await labelTeam(top.local_team_id);
  const poolName  = top.pool_name  || await labelTeam(top.pool_team_id);
  const poolPointsRaw = Number(top.pool_points);
  const poolPoints = Number.isFinite(poolPointsRaw) ? poolPointsRaw : ((top.total_local ?? 0) + (top.spent ?? 0));

  COMMON.student = avatar;
  COMMON.teacherAvatar = avatar;
  COMMON.local = { id: top.local_team_id, name: localName };
  COMMON.pool  = { id: top.pool_team_id,  name: poolName  };
  COMMON.totals.pool       = poolPoints || 0;
  COMMON.totals.spent      = top.spent ?? 0;
  COMMON.totals.totalLocal = Math.min(240, top.total_local ?? 0);

  text($('common-user'), `${COMMON.user.email || COMMON.user.id} (${TEACHER_PRACTICE_ALIAS})`);
  text($('common-local'), COMMON.local.name);
  text($('common-pool'), COMMON.pool.name);
  text($('common-poolpts'), COMMON.totals.pool);
  text($('common-spent'), COMMON.totals.spent);
  text($('common-total'), COMMON.totals.totalLocal);

  const info = `Modo profesor: usas el tiempo del equipo con más puntos (${COMMON.local.name}).`;
  ['flappy','snake','tetris','road'].forEach(key => {
    text($(`${key}-status`), 'ready');
    text($(`${key}-screen`), info);
    const startBtn = $(`${key}-start`);
    if (startBtn) startBtn.disabled = COMMON.totals.totalLocal <= 0;
    const stopBtn = $(`${key}-stop`);
    if (stopBtn) stopBtn.disabled = true;
  });

  return true;
}

// ---------- Mini framework ----------
function makeGameModule(cfg){
  // cfg: { key, table, teamRpc,
  //        screenId, statusId, selectId, startBtnId, stopBtnId,
  //        timeId, scoreId, totalId, diffId,
  //        lbLocalId, lbTeamsId,
  //        init(st), tick(st), keydown(e, st) }
  const st = {
    active:false, paused:false, loop:null, timer:null,
    frame:0, tickMs:65, spawnEvery:22, timeLeft:0, baseScore:0, _requestStop:null
  };

  function tuneFromTotals(){
    const totalLocal = COMMON.totals.totalLocal || 0;
    st.timeLeft = totalLocal;
    // base según total_local
    st.tickMs = Math.max(50, 70 - Math.floor(totalLocal/6));
    st.spawnEvery = Math.max(14, 24 - Math.floor(totalLocal/5));

    const dv = ($(cfg.selectId)?.value || 'normal');
    const d = DIFF[dv] || DIFF.normal;
    st.tickMs = Math.max(40, st.tickMs + d.tick);
    st.spawnEvery = Math.max(8, st.spawnEvery + d.spawn);

    text($(cfg.diffId), `${d.label} ×${d.mult.toFixed(2)}`);
    text($(cfg.timeId), String(st.timeLeft));
  }

  async function saveScore(finalScore){
    try{
      if (!COMMON.user || !COMMON.local) return;
      const avatar = COMMON.student || COMMON.teacherAvatar;
      const studentName = avatar?.name || (COMMON.teacherPractice ? TEACHER_PRACTICE_ALIAS : null);
      if (!studentName) return;
      await sb.from(cfg.table).insert([{
        user_id: COMMON.user.id,
        student_id: avatar?.id ?? null,
        student_name: studentName,
        local_team_id: COMMON.local.id,
        local_team_name: COMMON.local.name,
        difficulty: ($(cfg.selectId)?.value || 'normal'),
        score: finalScore
      }]);
    }catch(e){ console.warn(`[${cfg.key}] save error`, e); }
  }

  async function loadLocalLeaderboard(){
    const tb = $(cfg.lbLocalId);
    if (!tb) return;
    const { data, error } = await sb
      .from(cfg.table)
      .select('student_id,student_name,score')
      .eq('local_team_id', COMMON.local.id)
      .order('score', { ascending:false })
      .limit(200);
    if (error){ console.warn(`[${cfg.key}] lb local`, error); tb.innerHTML = `<tr><td colspan="3">N/A</td></tr>`; return; }
    const best = new Map();
    for (const r of (data||[])) best.set(r.student_id, Math.max(best.get(r.student_id)||0, r.score||0));
    const rows = Array.from(best.entries())
      .map(([sid,score]) => ({ name: (data.find(d=>d.student_id===sid)?.student_name)||`#${sid}`, score }))
      .sort((a,b)=> b.score - a.score).slice(0, 10);
    tb.innerHTML = rows.map((r,i)=> `<tr><td>${i+1}</td><td>${r.name}</td><td><strong>${r.score}</strong></td></tr>`).join('') || `<tr><td colspan="3">—</td></tr>`;
  }

  async function loadTeamsLeaderboard(){
    const tb = $(cfg.lbTeamsId);
    if (!tb) return;
    const { data, error } = await sb.rpc(cfg.teamRpc, { _limit: 100 });
    if (error){ console.warn(`[${cfg.key}] lb teams`, error); tb.innerHTML = `<tr><td colspan="4">N/A</td></tr>`; return; }
    const rows = (data||[]).map((r,i)=> ({
      rank:i+1,
      localName: r.local_team_name ?? `#${r.local_team_id}`,
      poolName:  r.pool_team_name ?? `#${r.pool_team_id}`,
      teamBest:  r.team_best ?? 0
    }));
    tb.innerHTML = rows.map(r => `<tr><td>${r.rank}</td><td>${r.localName}</td><td>${r.poolName}</td><td><strong>${r.teamBest}</strong></td></tr>`).join('') || `<tr><td colspan="4">—</td></tr>`;
  }

  function updateHudLive(){
    const mult = (DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal).mult;
    const totalNow = Math.max(0, Math.round(st.baseScore * mult));
    text($(cfg.scoreId), `${st.baseScore} → ×${mult.toFixed(2)}`);
    text($(cfg.totalId), String(totalNow));
  }

  function setStatus(s){ text($(cfg.statusId), s); }

  function stop(cause='finished'){
    if (!st.active) return;
    st.active = false;
    if (st.loop){ clearInterval(st.loop); st.loop=null; }
    if (st.timer){ clearInterval(st.timer); st.timer=null; }
    $(cfg.startBtnId).disabled = false;
    $(cfg.stopBtnId).disabled  = true;
    setStatus(cause==='time' ? 'time up' : (cause==='crashed'?'crashed':'finished'));

    const mult = (DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal).mult;
    const finalScore = Math.max(0, Math.round(st.baseScore * mult));
    // Append “Game Over” al screen (opcional si existe)
    const pre = $(cfg.screenId);
    if (pre) {
      pre.textContent += `

Game Over — ${cause}.
Base score: ${st.baseScore}
Difficulty: ${(DIFF[$(cfg.selectId)?.value || 'normal']||DIFF.normal).label} ×${mult.toFixed(2)}
Final score: ${finalScore}
(Tus puntos de equipo NO cambian.)`;
    }
    saveScore(finalScore).then(()=> {
      loadLocalLeaderboard();
      loadTeamsLeaderboard();
    });
  }

  function start(){
    if (st.active) return;
    st.baseScore = 0; st.frame = 0; st.paused=false; st._requestStop=null;
    tuneFromTotals();
    $(cfg.startBtnId).disabled = true;
    $(cfg.stopBtnId).disabled  = false;
    setStatus('playing'); st.active = true;

    cfg.init(st); // el juego puede recalibrar tickMs aquí

    st.loop = setInterval(()=>{
      if (!st.paused){
        st.frame++;
        cfg.tick(st);
        updateHudLive();
        if (st._requestStop){ const why = st._requestStop; st._requestStop=null; stop(why); }
      }
    }, st.tickMs);

    st.timer = setInterval(()=>{
      if (!st.paused){
        st.timeLeft -= 1;
        text($(cfg.timeId), String(st.timeLeft));
        if (st.timeLeft <= 0){ stop('time'); }
      }
    }, 1000);
  }

  $(cfg.startBtnId).addEventListener('click', start);
  $(cfg.stopBtnId).addEventListener('click', ()=> stop('finished'));
  $(cfg.selectId).addEventListener('change', ()=>{
    if (st.active){ updateHudLive(); } else { tuneFromTotals(); }
  });

  // Teclado: delega al juego y evita scroll si hay interacción
  document.addEventListener('keydown', (e)=>{
    if (!st.active) return;
    const handled = cfg.keydown && cfg.keydown(e, st);
    if (handled) e.preventDefault();
    if (e.key==='p' || e.key==='P'){ e.preventDefault(); st.paused = !st.paused; setStatus(st.paused?'paused':'playing'); }
  });

  return { start, stop, loadLocalLeaderboard, loadTeamsLeaderboard, setStatus, updateHudLive, st };
}

// ---------- Juego 1: Flappy ----------
function makeFlappy(){
  const W=60, H=20, GROUND=H-2;
  let grid=[], bird, cols=[], gapBase=6, spawnEvery=22;

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    for (let x=0;x<W;x++){ grid[GROUND][x]='_'; if (grid[GROUND+1]) grid[GROUND+1][x]='_'; }
    for (const c of cols){ for (let y=0;y<H;y++){ if (y<c.gapY || y>=c.gapY+c.gapH){ if (y<GROUND) put(c.x,y,'|'); } } }
    put(bird.x, Math.round(bird.y), '>');
    $('flappy-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }
  function spawnCol(){
    const margin=3;
    const jitter = (n)=> n + (Math.random()<0.25?-1:0) + (Math.random()<0.25?+1:0);
    const gapH = Math.max(3, jitter(gapBase));
    const gapY = Math.floor(Math.random() * (GROUND - margin - gapH)) + margin;
    cols.push({ x:W-1, gapY, gapH });
  }
  const mod = makeGameModule({
    key:'flappy',
    table:'game_scores',
    teamRpc:'game_local_team_leaderboard', // ya existente para Flappy
    screenId:'flappy-screen', statusId:'flappy-status',
    selectId:'flappy-select', startBtnId:'flappy-start', stopBtnId:'flappy-stop',
    timeId:'flappy-time', scoreId:'flappy-score', totalId:'flappy-total', diffId:'flappy-diff',
    lbLocalId:'flappy-lb-local', lbTeamsId:'flappy-lb-teams',
    init:(st)=>{
      clear(); cols=[]; bird={x:8,y:Math.floor(H/2),vy:0};
      const d = DIFF[$('flappy-select').value||'normal']||DIFF.normal;
      st.tickMs = Math.max(40, st.tickMs + d.tick);
      spawnEvery = Math.max(10, st.spawnEvery + d.spawn);
      gapBase = Math.max(3, 6 + (d.spawn<-2?-1:0));
      $('flappy-screen').textContent = `ASCII Flappy listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d.label} ×${d.mult.toFixed(2)}\nSpace/↑ saltar · P pausa · Stop terminar.`;
    },
    tick:(st)=>{
      bird.vy += 0.35; bird.y += bird.vy;
      if (bird.y<1){ bird.y=1; bird.vy=0; }
      const GROUND=H-2;
      if (bird.y>=GROUND){ st._requestStop='crashed'; return; }
      if (st.frame % spawnEvery===0) spawnCol();
      let passed=false;
      for (const c of cols){ c.x -= 1; if (c.x === bird.x-1) passed=true; }
      if (passed) st.baseScore++;
      for (const c of cols){
        if (c.x===bird.x){
          const y=Math.round(bird.y);
          if (y<c.gapY || y>=c.gapY+c.gapH){ st._requestStop='crashed'; return; }
        }
      }
      cols = cols.filter(c => c.x>=0);
      render();
    },
    keydown:(e)=>{
      if (e.code==='Space' || e.key===' ' || e.key==='ArrowUp'){ e.preventDefault(); bird.vy = -1.8; return true; }
      return false;
    }
  });
  return mod;
}

// ---------- Juego 2: Snake ----------
function makeSnake(){
  const W=28, H=18; // zona jugable interior; dibujamos borde '#'
  let grid=[], snake=[], dir=[1,0], food=[10,8];

  function clear(){ grid = Array.from({length:H+2}, ()=> Array.from({length:W+2}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W+2&&y>=0&&y<H+2) grid[y][x]=ch; }
  function drawBorder(){
    for (let x=0;x<W+2;x++){ put(x,0,'#'); put(x,H+1,'#'); }
    for (let y=0;y<H+2;y++){ put(0,y,'#'); put(W+1,y,'#'); }
  }
  function rndFood(){
    while(true){
      const x = 1 + Math.floor(Math.random()*W), y = 1 + Math.floor(Math.random()*H);
      if (!snake.some(([sx,sy])=> sx===x && sy===y)){ food=[x,y]; return; }
    }
  }
  function render(){
    for (let y=0;y<H+2;y++) for (let x=0;x<W+2;x++) grid[y][x]=' ';
    drawBorder();
    put(food[0], food[1], '*');
    snake.forEach(([x,y],i)=> put(x,y, i===0?'@':'o'));
    $('snake-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }

  const mod = makeGameModule({
    key:'snake',
    table:'game_scores_snake',
    teamRpc:'game_local_team_leaderboard_snake',
    screenId:'snake-screen', statusId:'snake-status',
    selectId:'snake-select', startBtnId:'snake-start', stopBtnId:'snake-stop',
    timeId:'snake-time', scoreId:'snake-score', totalId:'snake-total', diffId:'snake-diff',
    lbLocalId:'snake-lb-local', lbTeamsId:'snake-lb-teams',
    init:(st)=>{
      clear(); snake=[[3,3],[2,3],[1,3]]; dir=[1,0]; rndFood();
      // Velocidad: más lenta en easy/normal
      const d = ($( 'snake-select').value || 'normal');
      const base = d==='easy' ? 140 : d==='normal' ? 120 : d==='hard' ? 95 : 80; // ms
      st.tickMs = Math.max(60, base - Math.floor((COMMON.totals.totalLocal||0)/4));
      $('snake-screen').textContent = `ASCII Snake listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d} ×${(DIFF[d]||DIFF.normal).mult.toFixed(2)}\nFlechas mover · P pausa · Stop terminar.`;
    },
    tick:(st)=>{
      const head=[snake[0][0]+dir[0], snake[0][1]+dir[1]];
      // pared (borde '#'): si toca, fin
      if (head[0] <= 0 || head[0] >= W+1 || head[1] <= 0 || head[1] >= H+1){ st._requestStop='crashed'; return; }
      // self
      if (snake.some(([x,y])=> x===head[0] && y===head[1])){ st._requestStop='crashed'; return; }
      snake.unshift(head);
      if (head[0]===food[0] && head[1]===food[1]){
        st.baseScore += 5; rndFood();
      } else {
        snake.pop();
      }
      render();
    },
    keydown:(e)=>{
      let handled=false;
      if (e.key==='ArrowLeft' && dir[0]!==1){ dir=[-1,0]; handled=true; }
      else if (e.key==='ArrowRight' && dir[0]!==-1){ dir=[1,0]; handled=true; }
      else if (e.key==='ArrowUp' && dir[1]!==1){ dir=[0,-1]; handled=true; }
      else if (e.key==='ArrowDown' && dir[1]!==-1){ dir=[0,1]; handled=true; }
      if (handled) e.preventDefault();
      return handled;
    }
  });
  return mod;
}

// ---------- Juego 3: Tetris (simplificado) ----------
function makeTetris(){
  const W=10, H=18;
  let grid, cur, cx, cy, rot, bag;

  const SHAPES = {
    O: [[[1,1],[1,1]]],
    I: [[[1],[1],[1],[1]], [[1,1,1,1]]],
    L: [[[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]], [[0,0,1],[1,1,1]]],
    T: [[[1,1,1],[0,1,0]], [[1,0],[1,1],[1,0]], [[0,1,0],[1,1,1]], [[0,1],[1,1],[0,1]]]
  };

  function emptyGrid(){ return Array.from({length:H}, ()=> Array.from({length:W}, ()=> 0)); }
  function draw(){
    const buf = Array.from({length:H}, (_,y)=> Array.from({length:W}, (_,x)=> grid[y][x] ? '[]' : ' .'));
    const s = SHAPES[cur][rot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++)
        if (s[y][x] && cy+y>=0 && cy+y<H && cx+x>=0 && cx+x<W) buf[cy+y][cx+x] = '[]';
    $('tetris-screen').textContent = buf.map(r=>r.join('')).join('\n');
  }
  function collide(nx=cx, ny=cy, nrot=rot){
    const s = SHAPES[cur][nrot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++){
        if (!s[y][x]) continue;
        const X = nx+x, Y = ny+y;
        if (X<0||X>=W||Y>=H) return true;
        if (Y>=0 && grid[Y][X]) return true;
      }
    return false;
  }
  function lockPiece(st){
    const s = SHAPES[cur][rot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++)
        if (s[y][x] && cy+y>=0) grid[cy+y][cx+x]=1;
    // líneas
    let cleared=0;
    for (let y=H-1;y>=0;y--){
      if (grid[y].every(v=>v)){ grid.splice(y,1); grid.unshift(Array.from({length:W},()=>0)); cleared++; y++; }
    }
    if (cleared>0){ st.baseScore += cleared*10; }
    if (!spawnPiece(st)){ st._requestStop='crashed'; }
  }
  function spawnPiece(st){
    if (!bag || bag.length===0) bag = ['I','O','L','T'].sort(()=>Math.random()-0.5);
    cur = bag.pop(); rot=0; cx= Math.floor(W/2)-1; cy=-2;
    if (collide(cx, cy, rot)) return false; // pila hasta arriba => game over
    return true;
  }

  const mod = makeGameModule({
    key:'tetris',
    table:'game_scores_tetris',
    teamRpc:'game_local_team_leaderboard_tetris',
    screenId:'tetris-screen', statusId:'tetris-status',
    selectId:'tetris-select', startBtnId:'tetris-start', stopBtnId:'tetris-stop',
    timeId:'tetris-time', scoreId:'tetris-score', totalId:'tetris-total', diffId:'tetris-diff',
    lbLocalId:'tetris-lb-local', lbTeamsId:'tetris-lb-teams',
    init:(st)=>{
      grid = emptyGrid(); bag=null;
      const d = ($( 'tetris-select').value || 'normal');
      // Caída más lenta en easy/normal, más rápida en hard/insane
      const base = d==='easy' ? 900 : d==='normal' ? 750 : d==='hard' ? 550 : 420; // ms
      st.tickMs = Math.max(250, base - Math.floor((COMMON.totals.totalLocal||0)/2));
      $('tetris-screen').textContent = `ASCII Tetris listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d} ×${(DIFF[d]||DIFF.normal).mult.toFixed(2)}\n← → mover · ↑ rotar · ↓ caer rápido · P pausa · Stop terminar.`;
      if (!spawnPiece(st)){ st._requestStop='crashed'; }
    },
    tick:(st)=>{
      // caída
      if (!collide(cx, cy+1, rot)){ cy++; }
      else {
        if (cy<0){ st._requestStop='crashed'; return; }
        lockPiece(st);
        if (st._requestStop) return;
      }
      draw();
    },
    keydown:(e)=>{
      let handled=false;
      if (e.key==='ArrowLeft' && !collide(cx-1, cy, rot)){ cx--; handled=true; }
      else if (e.key==='ArrowRight' && !collide(cx+1, cy, rot)){ cx++; handled=true; }
      else if (e.key==='ArrowUp'){ const nr=(rot+1)%SHAPES[cur].length; if (!collide(cx, cy, nr)){ rot=nr; handled=true; } }
      else if (e.key==='ArrowDown'){ if (!collide(cx, cy+1, rot)){ cy++; handled=true; } }
      if (handled) { draw(); e.preventDefault(); }
      return handled;
    }
  });
  return mod;
}

// ---------- Juego 4: Road (tipo Road Fighter ASCII) ----------
function makeRoad(){
  const W=27, H=22; // un poco más ancho
  let grid=[], carX, carY, obs=[], left=5, right=W-5, driftTimer=0;

  const CAR  = [ [0,0,'^'], [-1,1,'/'], [0,1,'#'], [1,1,'\\'] ];   // coche del jugador (~3 ancho)
  const ENEM = [ [0,0,'A'], [-1,1,'o'], [1,1,'o'] ];                // coche rival simple

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }

  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    // bordes de pista
    for (let y=0;y<H;y++){ grid[y][left]='|'; grid[y][right]='|'; }
    // línea central
    const mid = Math.floor((left+right)/2);
    for (let y=0;y<H;y++) if (y%2===0) grid[y][mid]=':';
    // coche y enemigos
    for (const [dx,dy,ch] of CAR) put(carX+dx, carY+dy, ch);
    for (const o of obs) for (const [dx,dy,ch] of ENEM) put(o.x+dx, o.y+dy, ch);
    $('road-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }

  function spawnEnemy(){
    const min = left+2, max = right-2;
    const x = Math.max(min, Math.min(max, Math.floor(Math.random()*(max-min+1))+min));
    obs.push({ x, y:0 });
  }

  function collideCar(){
    // choque con bordes
    for (const [dx,dy] of CAR){
      const x=carX+dx, y=carY+dy;
      if (x<=left || x>=right) return true;
    }
    // choque con enemigos
    const carCells = new Set(CAR.map(([dx,dy])=>`${carX+dx},${carY+dy}`));
    for (const o of obs){
      for (const [dx,dy] of ENEM){
        if (carCells.has(`${o.x+dx},${o.y+dy}`)) return true;
      }
    }
    return false;
  }

  const mod = makeGameModule({
    key:'road',
    table:'game_scores_road',
    teamRpc:'game_local_team_leaderboard_road',
    screenId:'road-screen', statusId:'road-status',
    selectId:'road-select', startBtnId:'road-start', stopBtnId:'road-stop',
    timeId:'road-time', scoreId:'road-score', totalId:'road-total', diffId:'road-diff',
    lbLocalId:'road-lb-local', lbTeamsId:'road-lb-teams',
    init:(st)=>{
      clear(); obs=[]; left=5; right=W-5; carX=Math.floor(W/2); carY=H-3; driftTimer=0;
      const d = ($( 'road-select').value || 'normal');
      // velocidad/spawn por dificultad
      const base = d==='easy' ? 110 : d==='normal' ? 95 : d==='hard' ? 80 : 65; // ms
      st.tickMs = Math.max(45, base - Math.floor((COMMON.totals.totalLocal||0)/5));
      st._spawnEvery = d==='easy' ? 12 : d==='normal' ? 9 : d==='hard' ? 7 : 5; // más difícil = más rivales
      $('road-screen').textContent = `ASCII Road listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d} ×${(DIFF[d]||DIFF.normal).mult.toFixed(2)}\n← → mover · P pausa · Stop terminar.`;
    },
    tick:(st)=>{
      // spawn enemigos
      if (st.frame % st._spawnEvery === 0) spawnEnemy();
      // mover enemigos
      for (const o of obs) o.y += 1;
      obs = obs.filter(o => o.y < H-1);

      // drift de pista: cada cierto tiempo angosta/ensancha
      driftTimer++;
      if (driftTimer % 25 === 0){
        const minWidth = 9, maxWidth = 17;
        const width = right - left;
        const narrow = Math.random() < 0.6; // más probabilidad de angostar
        if (narrow && width > minWidth){ left += 1; right -= 1; }
        else if (!narrow && width < maxWidth){ left -= 1; right += 1; }
        // clamps suaves
        left = Math.max(2, Math.min(left, Math.floor(W/2)-4));
        right = Math.min(W-3, Math.max(right, Math.floor(W/2)+4));
      }

      // puntos por supervivencia + rivales “sobrepasados” (heurística)
      st.baseScore += 1 + obs.filter(o => o.y===carY && Math.abs(o.x - carX) > 2).length;

      // colisiones
      if (collideCar()){ st._requestStop='crashed'; return; }

      render();
    },
    keydown:(e)=>{
      if (e.key==='ArrowLeft'){ carX -= 1; e.preventDefault(); render(); return true; }
      if (e.key==='ArrowRight'){ carX += 1; e.preventDefault(); render(); return true; }
      return false;
    }
  });
  return mod;
}

// ---------- Arranque ----------
const ALL_GAMES = [];

async function main(){
  const ok = await bootstrapCommon();
  if (!ok) return;

  const flappy = makeFlappy();
  const snake  = makeSnake();
  const tetris = makeTetris();
  const road   = makeRoad();

  ALL_GAMES.push(flappy, snake, tetris, road);

  [flappy, snake, tetris, road].forEach(m => {
    m.loadLocalLeaderboard();
    m.loadTeamsLeaderboard();
  });

  // Fallback global anti-scroll: si cualquier juego está activo, bloquea scroll en flechas/espacio
  document.addEventListener('keydown', (e)=>{
    const key = e.key || e.code;
    const scrollingKey = key==='ArrowUp' || key==='ArrowDown' || key==='ArrowLeft' || key==='ArrowRight' || key===' ' || key==='Space' || e.code==='Space';
    if (!scrollingKey) return;
    if (ALL_GAMES.some(m => m.st.active)) e.preventDefault();
  });
}
document.addEventListener('DOMContentLoaded', ()=> { main().catch(console.error); });
