// game.js — Suite de 4 juegos ASCII en una página
// - Tiempo = total_local (tope 240).
// - HUD: "base → ×mult" y "Total score" en vivo.
// - Leaderboards: local (mejor por alumno) y global por equipo (mejor individual).
// - Guarda en tablas separadas: game_scores (flappy ya existe), game_scores_snake, game_scores_tetris, game_scores_road.

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

let COMMON = {
  user: null,
  student: null,    // { id, name }
  local:   null,    // { id, name }
  pool:    null,    // { id, name }
  totals:  { pool:0, spent:0, totalLocal:0 }
};

// ---------- Utilidades Supabase ----------
async function labelTeam(id){
  const { data } = await sb.from('teams').select('id,name,class').eq('id', id).maybeSingle();
  return data ? `${data.name}${data.class?` (${data.class})`:''}` : `#${id}`;
}

async function bootstrapCommon(){
  const { data:{ user } } = await sb.auth.getUser();
  if (!user){ location.href='./index.html'; return; }
  COMMON.user = user;

  const { data: stu } = await sb.from('students').select('id,name,class').eq('auth_user_id', user.id).maybeSingle();
  if (!stu){
    ['flappy','snake','tetris','road'].forEach(k => text($(`${k}-status`),'no team'));
    ['flappy','snake','tetris','road'].forEach(k => text($(`${k}-screen`),'Aún no tienes equipo local asignado. Pide a tu profesor que te asigne uno.'));
    return false;
  }
  COMMON.student = { id: stu.id, name: stu.name || 'Student' };

  const { data, error } = await sb.rpc('get_my_local_total');
  if (error || !data || data.length===0){
    ['flappy','snake','tetris','road'].forEach(k => text($(`${k}-status`),'no team'));
    ['flappy','snake','tetris','road'].forEach(k => text($(`${k}-screen`),'No se pudo obtener tu equipo local.'));
    return false;
  }
  const row = data[0];
  COMMON.totals.pool       = row.pool_points || 0;
  COMMON.totals.spent      = row.spent || 0;
  COMMON.totals.totalLocal = Math.min(240, row.total_local || 0);

  COMMON.local = { id: row.local_team_id, name: await labelTeam(row.local_team_id) };
  COMMON.pool  = { id: row.pool_team_id,  name: await labelTeam(row.pool_team_id)  };

  text($('common-user'),  COMMON.user.email || COMMON.user.id);
  text($('common-local'), COMMON.local.name);
  text($('common-pool'),  COMMON.pool.name);
  text($('common-poolpts'), COMMON.totals.pool);
  text($('common-spent'),   COMMON.totals.spent);
  text($('common-total'),   COMMON.totals.totalLocal);

  // habilitar botones start
  ['flappy','snake','tetris','road'].forEach(k => {
    const b = $(`${k}-start`);
    if (b) b.disabled = COMMON.totals.totalLocal <= 0;
  });
  return true;
}

// ---------- Mini framework por juego ----------
function makeGameModule(cfg){
  // cfg: { key, table, teamRpc, screenId, statusId, selectId, startBtnId, stopBtnId, timeId, scoreId, totalId, diffId, lbLocalId, lbTeamsId,
  //        init, tick, keydown, onStopComputeBase (=> baseScore), onRenderHudLine }
  const st = {
    active:false, paused:false, loop:null, timer:null,
    frame:0, tickMs:65, spawnEvery:22, timeLeft:0, baseScore:0
  };

  function tuneFromTotals(){
    const totalLocal = COMMON.totals.totalLocal || 0;
    st.timeLeft = totalLocal;

    // velocidad base depende de total_local (más puntos => un poco más rápido)
    st.tickMs = Math.max(50, 70 - Math.floor(totalLocal/6));
    st.spawnEvery = Math.max(14, 24 - Math.floor(totalLocal/5));

    const sel = $(cfg.selectId);
    const dv = sel?.value || 'normal';
    const d = DIFF[dv] || DIFF.normal;
    st.tickMs = Math.max(40, st.tickMs + d.tick);
    st.spawnEvery = Math.max(8, st.spawnEvery + d.spawn);

    text($(cfg.diffId), `${d.label} ×${d.mult.toFixed(2)}`);
    text($(cfg.timeId), String(st.timeLeft));
  }

  async function saveScore(finalScore){
    try{
      if (!COMMON.user || !COMMON.student || !COMMON.local) return;
      await sb.from(cfg.table).insert([{
        user_id: COMMON.user.id,
        student_id: COMMON.student.id,
        student_name: COMMON.student.name,
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
    $(cfg.stopBtnId).disabled = true;
    setStatus(cause==='time' ? 'time up' : (cause==='crashed'?'crashed':'finished'));

    // calcular final
    const mult = (DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal).mult;
    const finalScore = Math.max(0, Math.round(st.baseScore * mult));
    // persistir y refrescar LBs
    saveScore(finalScore).then(()=> {
      loadLocalLeaderboard();
      loadTeamsLeaderboard();
    });
  }

  function start(){
    if (st.active) return;
    // init específicos del juego
    cfg.init(st, cfg); // debe preparar pantalla y estado del juego
    st.baseScore = 0;
    st.frame = 0;
    st.paused = false;
    tuneFromTotals();

    $(cfg.startBtnId).disabled = true;
    $(cfg.stopBtnId).disabled  = false;
    setStatus('playing');
    st.active = true;

    // bucle del juego
    st.loop = setInterval(()=>{
      if (!st.paused){
        st.frame++;
        cfg.tick(st, cfg);   // avanza la lógica y escribe en screen
        updateHudLive();
      }
    }, st.tickMs);

    // temporizador s
    st.timer = setInterval(()=>{
      if (!st.paused){
        st.timeLeft -= 1;
        text($(cfg.timeId), String(st.timeLeft));
        if (st.timeLeft <= 0) stop('time');
      }
    }, 1000);
  }

  // wire UI
  $(cfg.startBtnId).addEventListener('click', start);
  $(cfg.stopBtnId).addEventListener('click', ()=> stop('finished'));
  $(cfg.selectId).addEventListener('change', ()=>{
    if (st.active){
      // no reajusto tick/spawn en caliente, solo HUD
      updateHudLive();
    } else {
      tuneFromTotals();
    }
  });

  // teclado
  document.addEventListener('keydown', (e)=>{
    if (!st.active) return;
    if (e.key==='p' || e.key==='P'){ st.paused = !st.paused; setStatus(st.paused?'paused':'playing'); return; }
    cfg.keydown && cfg.keydown(e, st, cfg);
  });

  // API pública del módulo (por si se necesita)
  return { start, stop, loadLocalLeaderboard, loadTeamsLeaderboard, setStatus, updateHudLive };
}

// ---------- Juego 1: Flappy ----------
function makeFlappy(){
  const W=60, H=20, GROUND=H-2;
  let grid=[], bird, gravity=0.35, cols=[], gapBase=6, spawnEvery=22;

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(st){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    for (let x=0;x<W;x++){ grid[GROUND][x]='_'; if (grid[GROUND+1]) grid[GROUND+1][x]='_'; }
    for (const c of cols){ for (let y=0;y<H;y++){ if (y<c.gapY || y>=c.gapY+c.gapH){ if (y<GROUND) put(c.x,y,'|'); } } }
    put(bird.x, Math.round(bird.y), '>');
    const s = grid.map(r=>r.join('')).join('\n');
    $('flappy-screen').textContent = s;
  }
  function spawnCol(){
    const margin=3;
    const jitter = (n)=> n + (Math.random()<0.25?-1:0) + (Math.random()<0.25?+1:0);
    const gapH = Math.max(3, jitter(gapBase));
    const gapY = Math.floor(Math.random() * (GROUND - margin - gapH)) + margin;
    cols.push({ x:W-1, gapY, gapH });
  }
  return makeGameModule({
    key:'flappy',
    table:'game_scores',
    teamRpc:'game_local_team_leaderboard',
    screenId:'flappy-screen', statusId:'flappy-status',
    selectId:'flappy-select', startBtnId:'flappy-start', stopBtnId:'flappy-stop',
    timeId:'flappy-time', scoreId:'flappy-score', totalId:'flappy-total', diffId:'flappy-diff',
    lbLocalId:'flappy-lb-local', lbTeamsId:'flappy-lb-teams',
    init:(st)=>{
      clear(); cols=[]; bird={x:8,y:Math.floor(H/2),vy:0};
      // parámetros por dificultad
      const d = DIFF[$('flappy-select').value||'normal']||DIFF.normal;
      st.tickMs = Math.max(40, st.tickMs + d.tick);
      spawnEvery = Math.max(10, st.spawnEvery + d.spawn);
      gapBase = Math.max(3, 6 + (d.spawn<-2?-1:0)); // más difícil => gap menor
      $('flappy-screen').textContent = `ASCII Flappy listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d.label} ×${d.mult.toFixed(2)}\nSpace/↑ para saltar · P pausa · Stop para terminar.`;
    },
    tick:(st)=>{
      // física
      bird.vy += gravity; bird.y += bird.vy;
      if (bird.y<1){ bird.y=1; bird.vy=0; }
      if (bird.y>=GROUND){ st.stopReason='crashed'; return; }
      // spawn/move
      if (st.frame % spawnEvery===0) spawnCol();
      let passed=false;
      for (const c of cols){ c.x -= 1; if (c.x === bird.x-1) passed=true; }
      if (passed) st.baseScore++;
      // colisión
      for (const c of cols){
        if (c.x===bird.x){
          const y=Math.round(bird.y);
          if (y<c.gapY || y>=c.gapY+c.gapH){ st.stopReason='crashed'; break; }
        }
      }
      cols = cols.filter(c => c.x>=0);
      if (st.stopReason){ this.stop && this.stop(st.stopReason); st.stopReason=null; return; }
      render(st);
    },
    keydown:(e, st)=>{
      if (e.code==='Space' || e.key===' ' || e.key==='ArrowUp'){ e.preventDefault(); bird.vy = -1.8; }
    }
  });
}

// ---------- Juego 2: Snake ----------
function makeSnake(){
  const W=28, H=18;
  let grid=[], snake=[], dir=[1,0], food=[10,8];
  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function rndFood(){
    while(true){
      const x = Math.floor(Math.random()*W), y=Math.floor(Math.random()*H);
      if (!snake.some(([sx,sy])=> sx===x && sy===y)){ food=[x,y]; return; }
    }
  }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    put(food[0], food[1], '*');
    snake.forEach(([x,y],i)=> put(x,y, i===0?'@':'o'));
    $('snake-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }
  return makeGameModule({
    key:'snake',
    table:'game_scores_snake',
    teamRpc:'game_local_team_leaderboard_snake',
    screenId:'snake-screen', statusId:'snake-status',
    selectId:'snake-select', startBtnId:'snake-start', stopBtnId:'snake-stop',
    timeId:'snake-time', scoreId:'snake-score', totalId:'snake-total', diffId:'snake-diff',
    lbLocalId:'snake-lb-local', lbTeamsId:'snake-lb-teams',
    init:(st)=>{
      clear(); snake=[[5,5],[4,5],[3,5]]; dir=[1,0]; rndFood();
      const d = DIFF[$('snake-select').value||'normal']||DIFF.normal;
      st.tickMs = Math.max(60, 110 + d.tick*2 - Math.floor((COMMON.totals.totalLocal||0)/3));
      $('snake-screen').textContent = `ASCII Snake listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d.label} ×${d.mult.toFixed(2)}\nFlechas para mover · P pausa · Stop para terminar.`;
    },
    tick:(st)=>{
      const head=[snake[0][0]+dir[0], snake[0][1]+dir[1]];
      // paredes
      if (head[0]<0||head[0]>=W||head[1]<0||head[1]>=H){ this.stop && this.stop('crashed'); return; }
      // self
      if (snake.some(([x,y])=> x===head[0] && y===head[1])){ this.stop && this.stop('crashed'); return; }
      snake.unshift(head);
      if (head[0]===food[0] && head[1]===food[1]){
        st.baseScore += 5; // cada fruta
        rndFood();
      } else {
        snake.pop();
      }
      render();
    },
    keydown:(e, st)=>{
      if (e.key==='ArrowLeft' && dir[0]!==1){ dir=[-1,0]; }
      else if (e.key==='ArrowRight' && dir[0]!==-1){ dir=[1,0]; }
      else if (e.key==='ArrowUp' && dir[1]!==1){ dir=[0,-1]; }
      else if (e.key==='ArrowDown' && dir[1]!==-1){ dir=[0,1]; }
    }
  });
}

// ---------- Juego 3: Tetris simplificado ----------
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
    const shape = SHAPES[cur][rot];
    for (let y=0;y<shape.length;y++)
      for (let x=0;x<shape[0].length;x++)
        if (shape[y][x] && cy+y>=0 && cy+y<H && cx+x>=0 && cx+x<W) buf[cy+y][cx+x] = '[]';
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
    spawnPiece();
  }
  function spawnPiece(){
    if (!bag || bag.length===0) bag = ['I','O','L','T'].sort(()=>Math.random()-0.5);
    cur = bag.pop(); rot=0; cx= Math.floor(W/2)-1; cy=-2;
  }
  return makeGameModule({
    key:'tetris',
    table:'game_scores_tetris',
    teamRpc:'game_local_team_leaderboard_tetris',
    screenId:'tetris-screen', statusId:'tetris-status',
    selectId:'tetris-select', startBtnId:'tetris-start', stopBtnId:'tetris-stop',
    timeId:'tetris-time', scoreId:'tetris-score', totalId:'tetris-total', diffId:'tetris-diff',
    lbLocalId:'tetris-lb-local', lbTeamsId:'tetris-lb-teams',
    init:(st)=>{
      grid = emptyGrid(); bag=null; spawnPiece();
      const d = DIFF[$('tetris-select').value||'normal']||DIFF.normal;
      st.tickMs = Math.max(80, 160 + d.tick*2 - Math.floor((COMMON.totals.totalLocal||0)/3));
      $('tetris-screen').textContent = `ASCII Tetris listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d.label} ×${d.mult.toFixed(2)}\n← → mover · ↑ rotar · ↓ caer rápido · P pausa · Stop terminar.`;
    },
    tick:(st)=>{
      // caída
      if (!collide(cx, cy+1, rot)){ cy++; }
      else {
        if (cy<0){ this.stop && this.stop('crashed'); return; }
        lockPiece(st);
      }
      draw();
    },
    keydown:(e, st)=>{
      if (e.key==='ArrowLeft' && !collide(cx-1, cy, rot)) cx--;
      else if (e.key==='ArrowRight' && !collide(cx+1, cy, rot)) cx++;
      else if (e.key==='ArrowUp'){ const nr=(rot+1)%SHAPES[cur].length; if (!collide(cx, cy, nr)) rot=nr; }
      else if (e.key==='ArrowDown'){ if (!collide(cx, cy+1, rot)) cy++; }
      draw();
    }
  });
}

// ---------- Juego 4: Road (tipo Road Fighter) ----------
function makeRoad(){
  const W=21, H=22, lanes=5, laneW=3; // carretera centrada
  let grid=[], carX, obs=[];
  const roadLeft = Math.floor((W - (lanes*laneW + (lanes-1))) / 2);
  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    // bordes/lineas
    for (let y=0;y<H;y++){
      put(roadLeft-1,y,'|'); put(W-roadLeft,y,'|');
      for (let l=1;l<lanes;l++){ const x=roadLeft + l*laneW + (l-1); if (y%2===0) put(x,y,':'); }
    }
    // car
    put(carX, H-2, '^');
    // obstacles
    for (const o of obs) put(o.x, o.y, 'X');
    $('road-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }
  function spawnObstacle(){
    const lane = Math.floor(Math.random()*lanes);
    const x = roadLeft + lane*laneW + (laneW>>1) + (lane);
    obs.push({ x, y:0 });
  }
  return makeGameModule({
    key:'road',
    table:'game_scores_road',
    teamRpc:'game_local_team_leaderboard_road',
    screenId:'road-screen', statusId:'road-status',
    selectId:'road-select', startBtnId:'road-start', stopBtnId:'road-stop',
    timeId:'road-time', scoreId:'road-score', totalId:'road-total', diffId:'road-diff',
    lbLocalId:'road-lb-local', lbTeamsId:'road-lb-teams',
    init:(st)=>{
      clear(); obs=[]; carX = roadLeft + (laneW>>1);
      const d = DIFF[$('road-select').value||'normal']||DIFF.normal;
      st.tickMs = Math.max(40, 90 + d.tick*2 - Math.floor((COMMON.totals.totalLocal||0)/4));
      $('road-screen').textContent = `ASCII Road listo.\nTiempo: ${st.timeLeft}s · Dificultad: ${d.label} ×${d.mult.toFixed(2)}\n← → mover · P pausa · Stop terminar.`;
    },
    tick:(st)=>{
      if (st.frame % Math.max(6, 16 + DIFF[$('road-select').value||'normal'].spawn) === 0) spawnObstacle();
      for (const o of obs) o.y += 1;
      // colisión
      if (obs.some(o => o.y===H-2 && o.x===carX)){ this.stop && this.stop('crashed'); return; }
      // puntos por esquivar / sobrevivir
      st.baseScore += obs.filter(o => o.y===H-2 && o.x!==carX).length + 1;
      obs = obs.filter(o => o.y < H-1);
      render();
    },
    keydown:(e, st)=>{
      if (e.key==='ArrowLeft' && carX>roadLeft+1) carX--;
      else if (e.key==='ArrowRight' && carX<W-roadLeft-1) carX++;
      render();
    }
  });
}

// ---------- Arranque ----------
async function main(){
  const ok = await bootstrapCommon();
  if (!ok) return;

  const flappy = makeFlappy();
  const snake  = makeSnake();
  const tetris = makeTetris();
  const road   = makeRoad();

  // Cargar leaderboards iniciales
  [flappy, snake, tetris, road].forEach(m => {
    m.loadLocalLeaderboard();
    m.loadTeamsLeaderboard();
  });

  // Exponer opcionalmente para depuración:
  window.__games = { flappy, snake, tetris, road };
}
document.addEventListener('DOMContentLoaded', ()=> { main().catch(console.error); });

