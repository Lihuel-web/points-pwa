// game.js — Suite de 4 juegos ASCII
// - Leaderboards por alumno (local) y por equipo (mejor individual del equipo).
// - Teclado sin scroll: preventDefault en cada juego + fallback global.
// - Snake: bordes + game over por pared/cuerpo.
// - Tetris: game over al llegar arriba; caída más lenta en easy/normal.
// - Road: cuerpo ASCII para coches; game over por bordes/choques; pista con ancho variable.
// - HUD: "base → ×mult" y "Total score" en vivo en cada juego.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
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

// Gravities mapped to real worlds for ASCII Flappy (m/s^2). Display uses real values.
const FLAPPY_PLANET_GRAVITY = {
  easy:   { planet:'Moon',    ms2:1.62 },
  normal: { planet:'Earth',   ms2:9.81 },
  hard:   { planet:'Neptune', ms2:11.15 },
  insane: { planet:'Jupiter', ms2:24.79 }
};
const FLAPPY_GRAVITY_INTERNAL = { easy:1.2, normal:1, hard:1, insane:0.8 }; // hidden gameplay tweak
const FLAPPY_GRAVITY_SLIDER = { min:80, max:120, def:100 }; // ±20%
const FLAPPY_GRAVITY_SCALE = 0.35 / FLAPPY_PLANET_GRAVITY.normal.ms2; // keep Earth ≈ previous gravity

const TEACHER_PRACTICE_ALIAS = 'The_Final_Boss.exe';
const VOLUME_KEY = 'pwa-volume';
const keysActive = { left:false, right:false };
let AUDIO_VOL = 1;

// -------- Audio (lightweight Web Audio blips) --------
let AUDIO_CTX = null;
function ensureAudio() {
  if (AUDIO_CTX) return AUDIO_CTX;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  AUDIO_CTX = new Ctx();
  return AUDIO_CTX;
}
function playSound(type='start') {
  if (localStorage.getItem('pwa-audio') === 'off') return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const cfg = {
    start:{ tones:[760], dur:0.12, vol:0.16, type:'triangle' },
    score:{ tones:[420], dur:0.08, vol:0.12, type:'square' },
    crash:{ tones:[190], dur:0.28, vol:0.22, type:'sawtooth', slide:-120 },
    power:{ tones:[960], dur:0.1,  vol:0.16, type:'square' },
    clear:{ tones:[960], dur:0.1,  vol:0.16, type:'square' }, // unified, short, bright
  }[type] || { tones:[440], dur:0.1, vol:0.12, type:'sine' };

  cfg.tones.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cfg.type;
    osc.frequency.setValueAtTime(freq, now);
    if (cfg.slide){
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq + cfg.slide), now + cfg.dur * 0.9);
    }
    const startVol = cfg.vol * (idx === 0 ? 1 : 0.6) * AUDIO_VOL;
    gain.gain.setValueAtTime(startVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + cfg.dur);
  });
}

const THEME_KEY = 'pwa-theme';
function applyTheme(mode) {
  const m = mode === 'cyber' ? 'cyber' : 'light';
  document.body.classList.toggle('theme-cyber', m === 'cyber');
  localStorage.setItem(THEME_KEY, m);
  const btn = document.getElementById('theme-toggle-game');
  if (btn) btn.textContent = m === 'cyber' ? 'Light mode' : 'Neon mode';
}
function initThemeToggleGame() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
  const btn = document.getElementById('theme-toggle-game');
  if (btn) btn.addEventListener('click', () => {
    const next = document.body.classList.contains('theme-cyber') ? 'light' : 'cyber';
    applyTheme(next);
  });
}

// Audio toggle (games page)
function initAudioToggle(){
  const btn = document.getElementById('audio-toggle');
  const saved = localStorage.getItem('pwa-audio') || 'on';
  if (btn) btn.textContent = saved === 'off' ? 'Unmute' : 'Mute';
  if (btn) btn.addEventListener('click', () => {
    const cur = localStorage.getItem('pwa-audio') || 'on';
    const next = cur === 'off' ? 'on' : 'off';
    localStorage.setItem('pwa-audio', next);
    btn.textContent = next === 'off' ? 'Unmute' : 'Mute';
  });
}

function initAudioVolume(){
  const slider = document.getElementById('audio-volume');
  const saved = parseFloat(localStorage.getItem(VOLUME_KEY) || '1');
  AUDIO_VOL = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 1;
  if (slider){
    slider.value = String(Math.round(AUDIO_VOL * 100));
    slider.addEventListener('input', () => {
      const v = Math.min(1, Math.max(0, (parseInt(slider.value, 10) || 0) / 100));
      AUDIO_VOL = v;
      localStorage.setItem(VOLUME_KEY, String(v));
    });
  }
}

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

initThemeToggleGame();
initAudioToggle();
initAudioVolume();

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
    setGamesUnavailable('You do not have a local team yet. Ask your teacher to assign you one.');
    return false;
  }
  COMMON.student = { id: stu.id, name: stu.name || 'Student' };

  const { data, error } = await sb.rpc('get_my_local_total');
  if (error || !data || data.length===0){
    setGamesUnavailable('Your local team could not be retrieved.');
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
    setGamesUnavailable('Could not prepare the teacher alias for leaderboards.');
    COMMON.teacherPractice = false;
    return false;
  }

  const { data, error } = await sb.rpc('top_local_leaderboard', { _limit: 1 });
  if (error || !data || data.length === 0) {
    setGamesUnavailable('No local teams with points available for practice.');
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

  const info = `Teacher mode: using the time from the local team with the most points (${COMMON.local.name}). Press any key after Start to begin.`;
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
    active:false, paused:false, loop:null, timer:null, armTimeout:null,
    frame:0, tickMs:65, spawnEvery:22, timeLeft:0, baseScore:0, _requestStop:null,
    awaitingKey:false,
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
      playSound('score');
    }catch(e){ console.warn(`[${cfg.key}] save error`, e); }
  }

  function getLbLimit(){
    const inp = $(`${cfg.key}-lb-limit`);
    const val = parseInt(inp?.value || '10', 10) || 10;
    const label = $(`${cfg.key}-lb-limit-val`);
    if (label) label.textContent = String(val);
    return Math.max(1, Math.min(200, val));
  }

  async function loadLocalLeaderboard(){
    const tb = $(cfg.lbLocalId);
    if (!tb) return;
    const limit = getLbLimit();
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
      .sort((a,b)=> b.score - a.score).slice(0, limit);
    tb.innerHTML = rows.map((r,i)=> `<tr><td>${i+1}</td><td>${r.name}</td><td><strong>${r.score}</strong></td></tr>`).join('') || `<tr><td colspan="3">—</td></tr>`;
  }

  async function loadTeamsLeaderboard(){
    const tb = $(cfg.lbTeamsId);
    if (!tb) return;
    const limit = getLbLimit();
    const { data, error } = await sb.rpc(cfg.teamRpc, { _limit: 100 });
    if (error){ console.warn(`[${cfg.key}] lb teams`, error); tb.innerHTML = `<tr><td colspan="4">N/A</td></tr>`; return; }
    const rows = (data||[]).map((r,i)=> ({
      rank:i+1,
      localName: r.local_team_name ?? `#${r.local_team_id}`,
      poolName:  r.pool_team_name ?? `#${r.pool_team_id}`,
      teamBest:  r.team_best ?? 0,
      bestPlayer: r.best_student_name ?? '—',
    })).slice(0, limit);
    tb.innerHTML = rows.map(r => `<tr><td>${r.rank}</td><td>${r.localName}</td><td>${r.poolName}</td><td>${r.bestPlayer}</td><td><strong>${r.teamBest}</strong></td></tr>`).join('') || `<tr><td colspan="5">—</td></tr>`;
  }

  function formatBaseScore(v){
    return cfg.formatScore ? cfg.formatScore(v) : String(v);
  }

  function updateHudLive(){
    const mult = (DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal).mult;
    const totalNow = Math.max(0, Math.round(st.baseScore * mult));
    text($(cfg.scoreId), `${formatBaseScore(st.baseScore)} → ×${mult.toFixed(2)}`);
    text($(cfg.totalId), String(totalNow));
    if (cfg.onHudUpdate) cfg.onHudUpdate(st, { mult, totalNow });
  }

  function setStatus(s){ text($(cfg.statusId), s); }

  function stop(cause='finished'){
    if (!st.active) return;
    st.active = false;
    st.awaitingKey = false;
    if (st.armTimeout){ clearTimeout(st.armTimeout); st.armTimeout=null; }
    if (st.loop){ clearTimeout(st.loop); st.loop=null; }
    if (st.timer){ clearInterval(st.timer); st.timer=null; }
    $(cfg.startBtnId).disabled = false;
    $(cfg.stopBtnId).disabled  = true;
    setStatus(cause==='time' ? 'time up' : (cause==='crashed'?'crashed':'finished'));

    const mult = (DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal).mult;
    const baseLabel = formatBaseScore(st.baseScore);
    const finalScore = Math.max(0, Math.round(st.baseScore * mult));
    // Append “Game Over” al screen (opcional si existe)
    const pre = $(cfg.screenId);
    if (pre) {
      pre.textContent += `

Game Over — ${cause}.
Base score: ${baseLabel}
Difficulty: ${(DIFF[$(cfg.selectId)?.value || 'normal']||DIFF.normal).label} ×${mult.toFixed(2)}
Final score: ${finalScore}
(Your team points do NOT change.)`;
    }
    if (cause==='crashed'){ playSound('crash'); } else { playSound('score'); }
    saveScore(finalScore).then(()=> {
      loadLocalLeaderboard();
      loadTeamsLeaderboard();
    });
  }

  function beginPlay(){
    st.awaitingKey = false;
    playSound('start');
    setStatus('playing');

    const runTick = ()=>{
      if (!st.active) return;
      if (!st.paused){
        st.frame++;
        cfg.tick(st);
        updateHudLive();
        if (st._requestStop){ const why = st._requestStop; st._requestStop=null; stop(why); return; }
      }
      st.loop = setTimeout(runTick, st.tickMs);
    };
    runTick();

    st.timer = setInterval(()=>{
      if (!st.paused){
        st.timeLeft -= 1;
        text($(cfg.timeId), String(st.timeLeft));
        if (st.timeLeft <= 0){ stop('time'); }
      }
    }, 1000);
  }

  function armStart(){
    if (st.active) return;
    st.baseScore = 0; st.frame = 0; st.paused=false; st._requestStop=null;
    st.awaitingKey = true;
    tuneFromTotals();
    $(cfg.startBtnId).disabled = true;
    $(cfg.stopBtnId).disabled  = false;
    setStatus('press any key to start'); st.active = true;

    cfg.init(st); // game can recalibrate tickMs here
    updateHudLive();

    if (st.armTimeout){ clearTimeout(st.armTimeout); }
    st.armTimeout = setTimeout(()=> {
      if (st.awaitingKey) beginPlay();
    }, 1800);
  }

  function maybeStartFromKey(e){
    if (!st.awaitingKey) return false;
    beginPlay();
    const handled = cfg.keydown && cfg.keydown(e, st);
    return handled || true;
  }

  $(cfg.startBtnId).addEventListener('click', armStart);
  $(cfg.stopBtnId).addEventListener('click', ()=> stop('finished'));
  $(cfg.selectId).addEventListener('change', ()=>{
    if (st.active && !st.awaitingKey){ updateHudLive(); } else { tuneFromTotals(); }
  });

  const lbSlider = $(`${cfg.key}-lb-limit`);
  if (lbSlider && !lbSlider.dataset.bound){
    lbSlider.dataset.bound = '1';
    lbSlider.addEventListener('input', ()=> {
      getLbLimit();
      loadLocalLeaderboard();
      loadTeamsLeaderboard();
    });
    getLbLimit();
  }

  // Keyboard: delegate to the game and avoid scroll on interaction
  document.addEventListener('keydown', (e)=>{
    if (!st.active) return;
    if (st.awaitingKey){
      const started = maybeStartFromKey(e);
      if (started) e.preventDefault();
      return;
    }
    const handled = cfg.keydown && cfg.keydown(e, st);
    if (handled) e.preventDefault();
    if (e.key==='p' || e.key==='P'){ e.preventDefault(); st.paused = !st.paused; setStatus(st.paused?'paused':'playing'); }
  });

  return { start: armStart, stop, loadLocalLeaderboard, loadTeamsLeaderboard, setStatus, updateHudLive, st };
}

// ---------- Juego 1: Flappy ----------
function makeFlappy(){
  const W=60, H=20, GROUND=H-2;
  let grid=[], bird, cols=[], gapBase=6, spawnEvery=22, gravityPerTick=0.35;

  const gravSlider = $('flappy-gravity');
  const gravPlanetTag = $('flappy-gravity-planet');
  const gravCurrentTag = $('flappy-gravity-current');
  const gravNote = $('flappy-gravity-note');

  const clampGravityPct = (v)=> Math.min(FLAPPY_GRAVITY_SLIDER.max, Math.max(FLAPPY_GRAVITY_SLIDER.min, v));
  function gravitySetting(){
    const diff = $('flappy-select')?.value || 'normal';
    const base = FLAPPY_PLANET_GRAVITY[diff] || FLAPPY_PLANET_GRAVITY.normal;
    const internalBoost = FLAPPY_GRAVITY_INTERNAL[diff] || 1;
    const raw = parseInt(gravSlider?.value || `${FLAPPY_GRAVITY_SLIDER.def}`, 10);
    const pct = clampGravityPct(Number.isFinite(raw) ? raw : FLAPPY_GRAVITY_SLIDER.def);
    if (gravSlider && String(pct) !== gravSlider.value) gravSlider.value = String(pct);
    const adjustedMs2Hidden = base.ms2 * internalBoost * (pct/100);
    return { base, pct, adjustedMs2Hidden, gameGravity: adjustedMs2Hidden * FLAPPY_GRAVITY_SCALE };
  }
  function refreshGravityUi(){
    const g = gravitySetting();
    gravityPerTick = g.gameGravity;
    if (gravPlanetTag) gravPlanetTag.textContent = `${g.base.planet} - ${g.base.ms2.toFixed(2)} m/s^2 (real)`;
    if (gravCurrentTag) gravCurrentTag.textContent = `Slider: ${g.pct}% (affects gameplay only)`;
    if (gravNote) gravNote.textContent = 'Visible values are real planet gravity; slider tweaks hidden gameplay gravity.';
  }

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(st){
    if (st) lastFuel = st.timeLeft;
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
      const baseGap = 6 + (d.spawn<-2?-1:0);
      const gapMult = (d.label === 'normal' || d.label === 'hard') ? 1 : 1.15;
      gapBase = Math.max(3, Math.round(baseGap * gapMult));
      const g = gravitySetting();
      gravityPerTick = g.gameGravity;
      $('flappy-screen').textContent = `ASCII Flappy ready.\nTime: ${st.timeLeft}s - Difficulty: ${d.label} x${d.mult.toFixed(2)}\nGravity: ${g.base.planet} (${g.base.ms2.toFixed(2)} m/s^2 real) · Slider ${g.pct}% (gameplay)\nSpace/ArrowUp jump - P pause - Stop ends game.`;
    },
    tick:(st)=>{
      bird.vy += gravityPerTick; bird.y += bird.vy;
      if (bird.y<1){ bird.y=1; bird.vy=0; }
      const GROUND=H-2;
      if (bird.y>=GROUND){ st._requestStop='crashed'; return; }
      if (st.frame % spawnEvery===0) spawnCol();
      let passed=false;
      for (const c of cols){ c.x -= 1; if (c.x === bird.x-1) passed=true; }
        if (passed){ st.baseScore++; playSound('clear'); }
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
  refreshGravityUi();

  if (gravSlider && !gravSlider.dataset.bound){
    gravSlider.dataset.bound = '1';
    gravSlider.addEventListener('input', refreshGravityUi);
  }
  const flappySelect = $('flappy-select');
  if (flappySelect && !flappySelect.dataset.gravityBound){
    flappySelect.dataset.gravityBound = '1';
    flappySelect.addEventListener('change', refreshGravityUi);
  }

  document.addEventListener('keyup', (e)=>{
    if (e.key==='ArrowLeft') keysActive.left=false;
    if (e.key==='ArrowRight') keysActive.right=false;
  });
  return mod;
}

// ---------- Juego 2: Snake ----------
function makeSnake(){
  const W=28, H=18; // zona jugable interior; dibujamos borde '#'
  const CELL_CM = 25; // cada celda ~25 cm para que la velocidad se sienta realista
  const START_WEIGHT_KG = 1.6;
  const FOOD_WEIGHT_KG = 0.6;
  const WEIGHT_SLOW_PER_KG = 0.04; // cada kg extra reduce 4% la velocidad base
  const MAX_SLOWDOWN = 0.4; // maximo 40% mas lento
  const OBSTACLE_DENSITY = { easy:0, normal:0.03, hard:0.06, insane:0.09 };
  const OBSTACLE_SHAPES = { easy:0, normal:6, hard:9, insane:12 };
  const SAFE_START = { xMin:3, xMax:10, yMin:2, yMax:4 }; // delante de la cabeza inicial

  let grid=[], snake=[], dir=[1,0], food=[10,8], obstacles=[], baseTickMs=100, speedCms=0;

  function clear(){ grid = Array.from({length:H+2}, ()=> Array.from({length:W+2}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W+2&&y>=0&&y<H+2) grid[y][x]=ch; }
  function drawBorder(){
    for (let x=0;x<W+2;x++){ put(x,0,'#'); put(x,H+1,'#'); }
    for (let y=0;y<H+2;y++){ put(0,y,'#'); put(W+1,y,'#'); }
  }
  function isSnake(x,y){ return snake.some(([sx,sy])=> sx===x && sy===y); }
  function isObstacle(x,y){ return obstacles.some(([ox,oy])=> ox===x && oy===y); }
  function blocked(x,y){ return isSnake(x,y) || isObstacle(x,y); }
  function inSafeStart(x,y){ return x>=SAFE_START.xMin && x<=SAFE_START.xMax && y>=SAFE_START.yMin && y<=SAFE_START.yMax; }

  function randomShape(ox, oy){
    const cells=[];
    const roll = Math.random();
    if (roll < 0.4){
      const w = 1 + Math.floor(Math.random()*3); // 1-3
      const h = 1 + Math.floor(Math.random()*2); // 1-2
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) cells.push([ox+x, oy+y]);
    } else if (roll < 0.75){
      const len = 2 + Math.floor(Math.random()*3); // barra 2-4
      const horizontal = Math.random() > 0.5;
      for (let i=0;i<len;i++) cells.push(horizontal ? [ox+i, oy] : [ox, oy+i]);
    } else {
      const size = 2 + Math.floor(Math.random()*2); // L compacta
      for (let i=0;i<size;i++){ cells.push([ox+i, oy]); cells.push([ox, oy+i]); }
      if (Math.random()>0.5){ cells.push([ox+size-1, oy+1]); } else { cells.push([ox+1, oy+size-1]); }
    }
    const uniq=[], seen=new Set();
    for (const [x,y] of cells){
      const k=`${x},${y}`;
      if (!seen.has(k)){ seen.add(k); uniq.push([x,y]); }
    }
    return uniq;
  }

  function canPlace(shape){
    return shape.every(([cx,cy])=>
      cx>0 && cx<W+1 && cy>0 && cy<H+1 &&
      !blocked(cx,cy) && !inSafeStart(cx,cy)
    );
  }

  function generateObstacles(diff){
    obstacles = [];
    const density = OBSTACLE_DENSITY[diff] || 0;
    const targetCells = Math.floor(W * H * density);
    const maxShapes = OBSTACLE_SHAPES[diff] || 0;
    let placed=0, tries=0, shapes=0;
    while (placed < targetCells && tries < 220 && shapes < maxShapes){
      const ox = 1 + Math.floor(Math.random()*W);
      const oy = 1 + Math.floor(Math.random()*H);
      const shape = randomShape(ox, oy);
      if (!shape || shape.length===0){ tries++; continue; }
      if (!canPlace(shape)){ tries++; continue; }
      obstacles.push(...shape);
      placed += shape.length;
      shapes++;
    }
  }

  function rndFood(){
    let attempts=0;
    while(true){
      const x = 1 + Math.floor(Math.random()*W), y = 1 + Math.floor(Math.random()*H);
      if (!blocked(x,y)){ food=[x,y]; return; }
      attempts++; if (attempts>160) break;
    }
    for (let y=1;y<=H;y++){
      for (let x=1;x<=W;x++){
        if (!blocked(x,y)){ food=[x,y]; return; }
      }
    }
    food=[1,1];
  }

  function slowdownFor(st){
    const extra = Math.max(0, st.baseScore - START_WEIGHT_KG);
    return Math.min(MAX_SLOWDOWN, extra * WEIGHT_SLOW_PER_KG);
  }
  function refreshSpeed(st){
    const slow = slowdownFor(st);
    const effective = Math.max(55, Math.round(baseTickMs / Math.max(0.2, 1 - slow)));
    st.tickMs = effective;
    const cellsPerSec = 1000 / effective;
    speedCms = Math.round(cellsPerSec * CELL_CM);
  }
  function updateMeters(st){
    text(document.getElementById('snake-speed'), `${speedCms} cm/s`);
    text(document.getElementById('snake-weight'), `${st.baseScore.toFixed(1)} kg`);
  }

  function render(){
    for (let y=0;y<H+2;y++) for (let x=0;x<W+2;x++) grid[y][x]=' ';
    drawBorder();
    obstacles.forEach(([x,y])=> put(x,y,'X'));
    put(food[0], food[1], '*');
    snake.forEach(([x,y],i)=> put(x,y, i===0?'@':'o'));
    document.getElementById('snake-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }

  const mod = makeGameModule({
    key:'snake',
    table:'game_scores_snake',
    teamRpc:'game_local_team_leaderboard_snake',
    screenId:'snake-screen', statusId:'snake-status',
    selectId:'snake-select', startBtnId:'snake-start', stopBtnId:'snake-stop',
    timeId:'snake-time', scoreId:'snake-score', totalId:'snake-total', diffId:'snake-diff',
    lbLocalId:'snake-lb-local', lbTeamsId:'snake-lb-teams',
    formatScore:(v)=> `${(v||0).toFixed(1)} kg`,
    onHudUpdate:(st)=> updateMeters(st),
    init:(st)=>{
      clear(); snake=[[3,3],[2,3],[1,3]]; dir=[1,0]; st.baseScore = START_WEIGHT_KG;
      const d = (document.getElementById('snake-select')?.value || 'normal');
      const base = d==='easy' ? 126 : d==='normal' ? 108 : d==='hard' ? 86 : 72; // 10% faster
      baseTickMs = Math.max(55, base - Math.floor((COMMON.totals.totalLocal||0)/4));
      if (d!=='easy') generateObstacles(d);
      rndFood();
      refreshSpeed(st);
      updateMeters(st);
      document.getElementById('snake-screen').textContent = `ASCII Snake ready.
Time: ${st.timeLeft}s - Difficulty: ${d} x${(DIFF[d]||DIFF.normal).mult.toFixed(2)}
Arrows move - P pause - Stop ends game.
Obstacles scale with difficulty (not in easy). Weight slows you up to 40%.`;
    },
    tick:(st)=>{
      const head=[snake[0][0]+dir[0], snake[0][1]+dir[1]];
      // pared (borde '#'): si toca, fin
      if (head[0] <= 0 || head[0] >= W+1 || head[1] <= 0 || head[1] >= H+1){ st._requestStop='crashed'; return; }
      if (isObstacle(head[0], head[1])){ st._requestStop='crashed'; return; }
      // self
      if (snake.some(([x,y])=> x===head[0] && y===head[1])){ st._requestStop='crashed'; return; }
      snake.unshift(head);
      if (head[0]===food[0] && head[1]===food[1]){
        st.baseScore = parseFloat((st.baseScore + FOOD_WEIGHT_KG).toFixed(1));
        rndFood(); refreshSpeed(st); playSound('clear');
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
    if (cleared>0){
      st.baseScore += cleared*10;
      playSound('clear');
    } else {
      playSound('place');
    }
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
      const d = ($('tetris-select')?.value || 'normal');
      // Caída más lenta en easy/normal, más rápida en hard/insane
      const base = d==='easy' ? 630 : d==='normal' ? 525 : d==='hard' ? 385 : 294; // ms (30% faster)
      st.tickMs = Math.max(250, base - Math.floor((COMMON.totals.totalLocal||0)/2));
      $('tetris-screen').textContent = `ASCII Tetris ready.\nTime: ${st.timeLeft}s · Difficulty: ${d} ×${(DIFF[d]||DIFF.normal).mult.toFixed(2)}\n← → move · ↑ rotate · ↓ fall faster · P pause · Stop ends game.`;
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
  const W=40, H=22; // más ancho
  let grid=[], carX, carY, carPos, obs=[], powerUps=[], left=6, right=W-6, driftTimer=0, slipDir=0, slipFrames=0, hitCooldown=0, awaitingRecovery=false;
  let speedKmh=0, speedTarget=0, lastFuel=0;

  const CAR  = [ [0,0,'^'], [-1,1,'/'], [0,1,'#'], [1,1,'\\'] ];   // coche del jugador (~3 ancho)
  const CAR_L = [ [0,0,'^'], [-1,1,'/'], [0,1,'#'], [1,1,'|'] ];    // coche inclinado izq
  const CAR_R = [ [0,0,'^'], [-1,1,'|'], [0,1,'#'], [1,1,'\\'] ];    // coche inclinado der
  const ENEM = [ [0,0,'A'], [-1,1,'o'], [1,1,'o'] ];                // coche rival simple
  const HIT_COOLDOWN_FRAMES = 6;
  const SLIP_BASE_SPEED = 0.75;
  const SLIP_ACCEL = 0.18;
  const SLIP_MAX_SPEED = 1.6;

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
    const shape = slipDir<0 ? CAR_L : slipDir>0 ? CAR_R : CAR;
    for (const [dx,dy,ch] of shape) put(carX+dx, carY+dy, ch);
    for (const o of obs) for (const [dx,dy,ch] of ENEM) put(o.x+dx, o.y+dy, ch);
    for (const p of powerUps) put(p.x, p.y, '*');
    const hud = `SPD: ${Math.round(speedKmh).toString().padStart(3,' ')} km/h | Fuel: ${Math.max(0, Math.round(lastFuel))} L`;
    $('road-screen').textContent = `${hud}\n${grid.map(r=>r.join('')).join('\n')}`;
  }

  function spawnEnemy(){
    const min = left+2, max = right-2;
    const x = Math.max(min, Math.min(max, Math.floor(Math.random()*(max-min+1))+min));
    obs.push({ x, y:0 });
  }

  function spawnPower(){
    const min = left+2, max = right-2;
    const x = Math.max(min, Math.min(max, Math.floor(Math.random()*(max-min+1))+min));
    powerUps.push({ x, y:0 });
  }

  function collideCar(){
    // choque con bordes
    for (const [dx,dy] of CAR){
      const x=carX+dx, y=carY+dy;
      if (x<=left || x>=right) return { hit:true, side: x<=left ? -1 : 1, type:'border' };
    }
    // choque con enemigos
    const carCells = new Set(CAR.map(([dx,dy])=>`${carX+dx},${carY+dy}`));
    for (const o of obs){
      for (const [dx,dy] of ENEM){
        if (carCells.has(`${o.x+dx},${o.y+dy}`)) {
          const side = (o.x < carX) ? -1 : 1;
          return { hit:true, side, type:'enemy' };
        }
      }
    }
    return { hit:false, side:0, type:null };
  }

  function startSlip(side){
    slipDir = side || (Math.random() < 0.5 ? -1 : 1);
    slipFrames = 0;
    awaitingRecovery = true;
    carPos = carX;
    speedKmh = Math.max(40, speedKmh - 25);
  }

  function recoverSlip(){
    slipDir = 0;
    slipFrames = 0;
    awaitingRecovery = false;
    hitCooldown = HIT_COOLDOWN_FRAMES;
    carPos = carX;
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
      clear(); obs=[]; powerUps=[]; left=6; right=W-6; carX=Math.floor(W/2); carY=H-3; driftTimer=0; slipDir=0; slipFrames=0; hitCooldown=0; awaitingRecovery=false; keysActive.left=false; keysActive.right=false;
      carPos = carX;
      const speedMap = { easy:160, normal:180, hard:200, insane:220 };
      const d = ($('road-select')?.value || 'normal');
      // velocidad/spawn por dificultad
      const base = d==='easy' ? 110 : d==='normal' ? 95 : d==='hard' ? 80 : 65; // ms
      st.tickMs = Math.max(45, base - Math.floor((COMMON.totals.totalLocal||0)/5));
      st._spawnEvery = d==='easy' ? 12 : d==='normal' ? 9 : d==='hard' ? 7 : 5; // más difícil = más rivales
      speedTarget = speedMap[d] || speedMap.normal;
      speedKmh = speedTarget - 20;
      lastFuel = st.timeLeft;
      $('road-screen').textContent = `ASCII Road ready.\nTime: ${st.timeLeft}s · Difficulty: ${d} ×${(DIFF[d]||DIFF.normal).mult.toFixed(2)}\n← → move (tras choque derrapas: pulsa hacia ese lado para recuperar control) · P pause · Stop ends game.`;
    },
    tick:(st)=>{
      // spawn enemigos y powerups
      if (st.frame % st._spawnEvery === 0) spawnEnemy();
      if (st.frame % 55 === 0 && Math.random() < 0.6) spawnPower();
      // mover enemigos/powerups
      for (const o of obs) o.y += 1;
      for (const p of powerUps) p.y += 1;
      obs = obs.filter(o => o.y < H-1);
      powerUps = powerUps.filter(p => p.y < H-1);

      // HUD dinámico: velocidad y combustible
      lastFuel = st.timeLeft;
      if (slipDir !== 0){
        speedKmh = Math.max(40, speedKmh - 6);
      } else {
        const accel = 3;
        if (speedKmh < speedTarget) speedKmh = Math.min(speedTarget, speedKmh + accel);
        else if (speedKmh > speedTarget) speedKmh = Math.max(speedTarget, speedKmh - 2);
      }

      // drift de pista: a veces angosta desde izquierda o derecha
      driftTimer++;
      if (driftTimer % 25 === 0){
        const minWidth = 18, maxWidth = 32;
        const width = right - left;
        const narrow = Math.random() < 0.6;
        const side = Math.random() < 0.5 ? 'left' : 'right';
        if (narrow && width > minWidth){
          if (side==='left'){ left += 1; }
          else { right -= 1; }
        } else if (!narrow && width < maxWidth){
          if (side==='left'){ left -= 1; }
          else { right += 1; }
        }
        // clamps suaves
        const margin = 3;
        left = Math.max(margin, Math.min(left, Math.floor(W/2)-6));
        right = Math.min(W-1-margin, Math.max(right, Math.floor(W/2)+6));
      }

      // puntos por supervivencia + rivales “sobrepasados” (heurística)
      st.baseScore += 1 + obs.filter(o => o.y===carY && Math.abs(o.x - carX) > 2).length;

      // recoger powerups
      const carCells = new Set(CAR.map(([dx,dy])=>`${carX+dx},${carY+dy}`));
      powerUps = powerUps.filter(p => {
        if (carCells.has(`${p.x},${p.y}`)){
          st.baseScore += 5;
          playSound('power');
          return false;
        }
        return true;
      });

      // colisiones: activar resbalón y descontar puntos en lugar de terminar (en insane sí termina)
      if (hitCooldown > 0) hitCooldown--;

      if (slipDir === 0 && hitCooldown === 0){
        const col = collideCar();
        if (col.hit){
          const diffMode = ($('road-select')?.value || 'normal');
          const borderHit = col.type === 'border';
          if (diffMode === 'insane' || borderHit) {
            st._requestStop='crashed';
          } else {
            st.baseScore = Math.max(0, st.baseScore - 8);
            startSlip(col.side);
            playSound('crash');
          }
        }
      }

      // resbalón: mover el coche lateralmente hasta recuperar control
      if (slipDir !== 0){
        const slipSpeed = Math.min(SLIP_MAX_SPEED, SLIP_BASE_SPEED + slipFrames * SLIP_ACCEL);
        carPos += slipDir * slipSpeed;
        carX = Math.round(carPos);
        slipFrames += 1;
        const recoverLeft = slipDir === -1 && keysActive.left;
        const recoverRight = slipDir === 1 && keysActive.right;
        if (awaitingRecovery && (recoverLeft || recoverRight)){
          recoverSlip();
        }
      }

      // colisión final solo si nos salimos de la pista
      if (carX <= left || carX >= right){ st._requestStop='crashed'; return; }

      render(st);
    },
    keydown:(e)=>{
      if (e.key==='ArrowLeft'){
        keysActive.left=true; keysActive.right=false;
        if (slipDir !== 0){
          if (slipDir === -1 && awaitingRecovery) recoverSlip();
          e.preventDefault(); render(st); return true;
        }
        carX -= 1; carPos = carX;
        e.preventDefault(); render(st); return true;
      }
      if (e.key==='ArrowRight'){
        keysActive.right=true; keysActive.left=false;
        if (slipDir !== 0){
          if (slipDir === 1 && awaitingRecovery) recoverSlip();
          e.preventDefault(); render(st); return true;
        }
        carX += 1; carPos = carX;
        e.preventDefault(); render(st); return true;
      }
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
