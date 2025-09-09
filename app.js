// app.js — PWA Points Control (con Local leaderboard en Teacher)

// ---------------- Supabase client (UMD) ----------------
const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();

if (!/^https?:\/\//.test(SUPA_URL) || !SUPA_KEY) {
  console.error('Config error. SUPABASE_URL or SUPABASE_ANON_KEY missing.');
  alert('Config error. Check SUPABASE_URL / SUPABASE_ANON_KEY.');
}
const sb = createClient(SUPA_URL, SUPA_KEY);
const EDGE_BASE = SUPA_URL.replace('.supabase.co', '.functions.supabase.co');

// ---------------- Utilidades DOM ----------------
const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
function normalizeUID(s) { return String(s || '').toUpperCase().replace(/[^0-9A-F]/g, ''); }

// ---------------- Team name cache ----------------
let TEAM_CACHE = null;
async function ensureTeamCache() {
  if (TEAM_CACHE) return TEAM_CACHE;
  const { data, error } = await sb.from('teams').select('id,name,class,scope,parent_global_id');
  if (error) {
    console.warn('ensureTeamCache:', error);
    TEAM_CACHE = { byId: new Map() };
    return TEAM_CACHE;
  }
  const byId = new Map();
  (data || []).forEach(t => byId.set(t.id, `${t.name}${t.class ? ` (${t.class})` : ''}`));
  TEAM_CACHE = { byId };
  return TEAM_CACHE;
}
function teamLabel(id) { return (TEAM_CACHE?.byId?.get(id)) ?? `#${id}`; }
function invalidateTeamCache() { TEAM_CACHE = null; }

// ---------------- Auth & UI ----------------
const authSec = $('auth');
const authedSec = $('authed');
const whoami = $('whoami');
const roleBadge = $('role-badge');
const teacherPanel = $('teacher-panel');
const studentPanel = $('student-panel');

on($('login-form'), 'submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  await refreshUI();
});

on($('logout'), 'click', async () => { await sb.auth.signOut(); await refreshUI(); });

on($('change-pass'), 'click', async () => {
  const newPass = prompt('New password (min. 6 characters):');
  if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and sign back in.');
});

// Password recovery via hash
(async function handleRecoveryFromHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const p = new URLSearchParams(hash);
  if (p.get('type') === 'recovery' && p.get('access_token')) {
    try {
      await sb.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
      const newPass = prompt('Set a new password (min 6):');
      if (newPass) {
        const { error } = await sb.auth.updateUser({ password: newPass });
        if (error) alert(error.message); else alert('Password updated. Please log in again.');
      }
    } finally {
      history.replaceState({}, document.title, location.pathname);
      await sb.auth.signOut();
    }
  }
})();

// ---------------- Entrypoint UI ----------------
async function refreshUI() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    if (authSec) authSec.style.display = 'block';
    if (authedSec) authedSec.style.display = 'none';
    return;
  }
  if (authSec) authSec.style.display = 'none';
  if (authedSec) authedSec.style.display = 'block';
  text(whoami, user.email || user.id);

  const { data: profile, error } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) { console.error('load profile', error); alert('Error loading profile/role.'); return; }

  const role = profile?.role || 'student';
  text(roleBadge, role.toUpperCase());

  if (role === 'teacher') {
    if (teacherPanel) teacherPanel.style.display = 'block';
    if (studentPanel) studentPanel.style.display = 'none';
    await loadTeacher();
  } else {
    if (teacherPanel) teacherPanel.style.display = 'none';
    if (studentPanel) studentPanel.style.display = 'block';
    await loadStudent(user.id);
  }
}

// ---------------- Student panel ----------------
async function loadStudent(userId) {
  const { data: student } = await sb.from('students').select('id,name,class').eq('auth_user_id', userId).maybeSingle();

  if (!student) {
    text($('student-info'), 'Your account is not linked to a student record yet. Ask your teacher.');
    text($('balance'), '—');
    const mt = $('mytx-table')?.querySelector('tbody'); if (mt) mt.innerHTML = '';
    text($('team-info'), 'No team assigned.'); text($('my-team-balance'), '—');
    const ul = $('my-team-members'); if (ul) ul.innerHTML = '';
    await renderPoolOverviewForStudent(null, null);
    return;
  }

  text($('student-info'), `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  const { data: bal } = await sb.from('balances').select('points').eq('student_id', student.id).maybeSingle();
  text($('balance'), bal?.points ?? 0);

  const { data: txs } = await sb.from('transactions')
    .select('delta,reason,created_at')
    .eq('student_id', student.id).order('created_at', { ascending:false }).limit(50);

  const tb = $('mytx-table')?.querySelector('tbody');
  if (tb) tb.innerHTML = (txs || []).map(t =>
    `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
  ).join('');

  try {
    const { data: tm } = await sb.from('team_members')
      .select('team_id, teams(name,class,scope,parent_global_id)')
      .eq('student_id', student.id).maybeSingle();

    if (!tm?.team_id) {
      text($('team-info'), 'No team assigned.'); text($('my-team-balance'), '—');
      const ul = $('my-team-members'); if (ul) ul.innerHTML = '';
      await renderPoolOverviewForStudent(null, null);
      return;
    }

    text($('team-info'), `${tm.teams?.name ?? tm.team_id} (${tm.teams?.class ?? '—'})`);
    const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', tm.team_id).maybeSingle();
    text($('my-team-balance'), tbal?.points ?? 0);

    const { data: members } = await sb.from('team_member_points')
      .select('student_id,name,class,points').eq('team_id', tm.team_id).order('name', { ascending:true });

    const ul = $('my-team-members');
    if (ul) ul.innerHTML = (members || []).map(m =>
      `<li>${m.name ?? m.student_id} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
    ).join('');

    const isLocal = tm?.teams?.scope === 'local';
    const poolId = isLocal ? (tm.teams?.parent_global_id || null) : (tm?.team_id || null);
    const localId = isLocal ? tm.team_id : null;

    await renderPoolOverviewForStudent(poolId, localId);
  } catch (e) {
    console.warn('loadStudent membership:', e);
    await renderPoolOverviewForStudent(null, null);
  }
}

async function renderPoolOverviewForStudent(poolId, localId) {
  const meta = $('pool-meta');
  const totalEl = $('pool-total');
  const remGlobalEl = $('pool-remaining-global');
  const tbody = $('pool-locals-tbody');
  const mySpentEl = $('my-local-spent');
  const myRemainEl = $('my-local-remaining');

  if (!meta || !totalEl || !remGlobalEl || !tbody) return;

  if (!poolId) {
    meta.textContent = 'No global pool assigned.';
    totalEl.textContent = '—';
    remGlobalEl.textContent = '—';
    tbody.innerHTML = '';
    if (mySpentEl) mySpentEl.textContent = '—';
    if (myRemainEl) myRemainEl.textContent = '—';
    return;
  }

  await ensureTeamCache();
  meta.textContent = `Global team: ${teamLabel(poolId)}`;

  const { data: rows } = await sb.from('team_local_remaining')
    .select('local_team_id,pool_team_id,pool_points,spent_by_local,pool_remaining')
    .eq('pool_team_id', poolId)
    .order('local_team_id', { ascending: true });

  if (!rows || rows.length === 0) {
    const { data: bal2 } = await sb.from('team_pool_balances')
      .select('points').eq('pool_team_id', poolId).maybeSingle();
    const poolPoints = bal2?.points ?? 0;
    totalEl.textContent = poolPoints;
    remGlobalEl.textContent = poolPoints;
    tbody.innerHTML = '';
    if (mySpentEl) mySpentEl.textContent = '—';
    if (myRemainEl) myRemainEl.textContent = '—';
    return;
  }

  const visible = localId ? rows.filter(r => r.local_team_id === localId) : rows;
  const baseRow = rows[0];

  const poolPoints = baseRow?.pool_points ?? 0;
  const overallRemaining = baseRow?.pool_remaining ?? poolPoints;
  totalEl.textContent = poolPoints;
  remGlobalEl.textContent = overallRemaining;

  tbody.innerHTML = (visible || []).map(r => {
    const spent = r.spent_by_local ?? 0;
    const remainingForLocal = Math.max(poolPoints - spent, 0);
    const hl = (localId && r.local_team_id === localId) ? ' class="hl"' : '';
    return `<tr${hl}>
      <td>${teamLabel(r.local_team_id)}</td>
      <td>${spent}</td>
      <td><strong>${remainingForLocal}</strong></td>
    </tr>`;
  }).join('');

  const mine = localId ? visible[0] : null;
  const mySpent = mine?.spent_by_local ?? 0;
  const myRemaining = Math.max((poolPoints ?? 0) - mySpent, 0);
  if (mySpentEl) mySpentEl.textContent = mySpent;
  if (myRemainEl) myRemainEl.textContent = myRemaining;
}

// ---------------- Teacher panel ----------------
let _selectedPoolId = null;       // usado por overview locales
let _leaderboardPoolId = null;    // usado por leaderboard

async function loadTeacher() {
  await ensureTeamCache();
  await loadLatestTransactions();
  await loadTeamsUI();
  await loadTeamAdjustOptions();
  await refreshTeamOverview();
  await loadCardSelects();
  await initStudentForms();
  await initLeaderboardUI();
}

async function loadLatestTransactions() {
  const { data: txs } = await sb.from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending:false }).limit(50);

  const tbody = $('tx-table')?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = (txs || []).map(t => `
    <tr><td>${new Date(t.created_at).toLocaleString()}</td>
    <td>${t.students?.name ?? t.student_id}</td>
    <td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`).join('');
}

// ---- Teams overview ----
async function refreshTeamOverview() {
  await ensureTeamCache();
  const poolBody = document.querySelector('#pool-table tbody');
  if (!poolBody) return;

  const { data: pools, error } = await sb.from('team_pool_balances').select('pool_team_id,points');
  if (error && error.code === 'PGRST116') {
    poolBody.innerHTML = `<tr><td colspan="2">Views missing.</td></tr>`; return;
  }

  poolBody.innerHTML = (pools || []).map(p => `
    <tr data-pool="${p.pool_team_id}">
      <td>${teamLabel(p.pool_team_id)}</td>
      <td><strong>${p.points ?? 0}</strong></td>
    </tr>`).join('');

  if (!_selectedPoolId && pools && pools.length) _selectedPoolId = pools[0].pool_team_id;
  poolBody.querySelectorAll('tr[data-pool]').forEach(tr => {
    tr.addEventListener('click', async () => {
      _selectedPoolId = parseInt(tr.getAttribute('data-pool'),10);
      await loadLocalSummary();
      await syncLeaderboardToSelectedPool();
    });
  });
  await loadLocalSummary();
  await syncLeaderboardToSelectedPool();
}

async function loadLocalSummary() {
  await ensureTeamCache();
  const tbody = document.querySelector('#local-table tbody');
  const title = $('local-title');
  if (!tbody) return;

  if (!_selectedPoolId) { tbody.innerHTML = ''; text(title, '—'); return; }

  const { data: locals } = await sb.from('team_local_remaining')
    .select('local_team_id,pool_team_id,pool_points,spent_by_local,pool_remaining')
    .eq('pool_team_id', _selectedPoolId).order('local_team_id',{ascending:true});

  text(title, teamLabel(_selectedPoolId));
  tbody.innerHTML = (locals || []).map(r => {
    const poolPoints = r.pool_points ?? 0;
    const spent = r.spent_by_local ?? 0;
    const remainingForLocal = Math.max(poolPoints - spent, 0);
    return `
      <tr>
        <td>${teamLabel(r.local_team_id)}</td>
        <td>${spent}</td>
        <td><strong>${remainingForLocal}</strong></td>
      </tr>`;
  }).join('');
}

// ---- Local leaderboard (Teacher) ----
async function initLeaderboardUI() {
  const sel = $('leaderboard-pool');
  const btn = $('refresh-leaderboard');

  // opciones de pools globales
  const { data: pools } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name',{ascending:true});
  if (sel) {
    sel.innerHTML = (pools || []).map(p => `<option value="${p.id}">${p.name}${p.class?` (${p.class})`:''}</option>`).join('');
  }

  // valor inicial: pool seleccionado en overview o primero disponible
  if (pools && pools.length) {
    _leaderboardPoolId = (_selectedPoolId && pools.find(p => p.id === _selectedPoolId))
      ? _selectedPoolId
      : pools[0].id;
    if (sel) sel.value = String(_leaderboardPoolId);
  }

  on(sel, 'change', async () => {
    _leaderboardPoolId = parseInt(sel.value || '0',10) || null;
    await refreshLeaderboard();
  });
  on(btn, 'click', refreshLeaderboard);

  await refreshLeaderboard();
}

async function syncLeaderboardToSelectedPool() {
  const sel = $('leaderboard-pool');
  if (!sel) return;
  if (_selectedPoolId && String(sel.value) !== String(_selectedPoolId)) {
    _leaderboardPoolId = _selectedPoolId;
    sel.value = String(_leaderboardPoolId);
    await refreshLeaderboard();
  }
}

async function refreshLeaderboard() {
  const tbody = $('leaderboard-table')?.querySelector('tbody');
  if (!tbody) return;
  if (!_leaderboardPoolId) { tbody.innerHTML = ''; return; }

  await ensureTeamCache();

  const { data: rows } = await sb.from('team_local_remaining')
    .select('local_team_id,pool_team_id,pool_points,spent_by_local')
    .eq('pool_team_id', _leaderboardPoolId);

  if (!rows || rows.length === 0) { tbody.innerHTML = ''; return; }

  const poolPoints = rows[0]?.pool_points ?? 0;
  const ranked = rows.map(r => ({
    local_team_id: r.local_team_id,
    spent: r.spent_by_local ?? 0,
    totalLocal: Math.max((poolPoints ?? 0) - (r.spent_by_local ?? 0), 0),
  }))
  .sort((a,b) => b.totalLocal - a.totalLocal || a.local_team_id - b.local_team_id);

  tbody.innerHTML = ranked.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${teamLabel(r.local_team_id)}</td>
      <td>${r.spent}</td>
      <td><strong>${r.totalLocal}</strong></td>
    </tr>
  `).join('');
}

// ---- Gestión equipos + membresías ----
async function loadTeamsUI() {
  const selTeam = $('team-select');
  const selStudent = $('student-pool');
  const ulMembers = $('team-members');
  const teamBalance = $('team-balance');
  if (!selTeam && !selStudent && !ulMembers) return;

  try {
    if (selTeam) {
      const { data: teams } = await sb.from('teams').select('id,name,class').order('name', { ascending:true });
      selTeam.innerHTML = (teams || []).map(t => `<option value="${t.id}">${t.name}${t.class?` (${t.class})`:''}</option>`).join('');
    }
    if (selStudent) {
      const { data: students } = await sb.from('students').select('id,name,class').order('name',{ascending:true});
      selStudent.innerHTML = (students || []).map(s => `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
    }
    await refreshTeamDetails();
  } catch (e) { console.warn('loadTeamsUI:', e); }

  on($('reload-teams'), 'click', loadTeamsUI);

  on($('new-team-form'), 'submit', async (e) => {
    e.preventDefault();
    const name = $('team-name').value.trim();
    const klass = ($('team-class').value || '').trim();
    if (!name) return alert('Team name is required.');
    const { error } = await sb.from('teams').insert([{ name, class: klass || null }]);
    if (error) return alert(error.message);
    invalidateTeamCache();
    $('team-name').value=''; $('team-class').value='';
    await loadTeamsUI();
    await refreshTeamOverview();
    await initLeaderboardUI();
  });

  on($('delete-team'), 'click', async () => {
    const teamId = parseInt(selTeam?.value || '0', 10);
    if (!teamId) return;
    const ok = confirm('Delete this team? This removes memberships but not student records or transactions.');
    if (!ok) return;
    const { error } = await sb.from('teams').delete().eq('id', teamId);
    if (error) return alert(error.message);
    invalidateTeamCache();
    await loadTeamsUI();
    await refreshTeamOverview();
    await initLeaderboardUI();
  });

  on($('assign-member'), 'click', async () => {
    const teamId = parseInt(selTeam?.value || '0', 10);
    const studentId = parseInt(selStudent?.value || '0', 10);
    if (!teamId || !studentId) return;
    await sb.from('team_members').delete().eq('student_id', studentId); // 1 equipo por alumno
    const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
    if (error) return alert(error.message);
    await refreshTeamDetails();
  });

  on($('remove-member'), 'click', async () => {
    const teamId = parseInt(selTeam?.value || '0', 10);
    const firstLi = ulMembers?.querySelector('li[data-student]');
    if (!teamId || !firstLi) return;
    const studentId = parseInt(firstLi.getAttribute('data-student'), 10);
    const { error } = await sb.from('team_members').delete().match({ team_id: teamId, student_id: studentId });
    if (error) return alert(error.message);
    await refreshTeamDetails();
  });

  on(selTeam, 'change', refreshTeamDetails);

  async function refreshTeamDetails() {
    if (!selTeam) return;
    const teamId = parseInt(selTeam.value || '0', 10);
    if (!teamId) { if (ulMembers) ulMembers.innerHTML=''; text(teamBalance,'—'); return; }
    try {
      const { data: members } = await sb.from('team_member_points')
        .select('student_id,name,class,points').eq('team_id', teamId).order('name',{ascending:true});

      if (ulMembers) {
        ulMembers.innerHTML = (members || []).map(m =>
          `<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
        ).join('');
      }
      const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', teamId).maybeSingle();
      text(teamBalance, tbal?.points ?? 0);
    } catch (e) { console.warn('refreshTeamDetails:', e); }
  }
}

// ---- Ajustes manuales ----
async function loadTeamAdjustOptions() {
  const poolSel = $('adjust-pool-id');
  const localSel = $('adjust-local-id');
  const form = $('adjust-form');
  if (!form) return;

  await ensureTeamCache();

  if (poolSel) {
    const { data: pools } = await sb.from('teams').select('id,name,class,scope').eq('scope','global').order('name',{ascending:true});
    poolSel.innerHTML = (pools || []).map(p => `<option value="${p.id}">${p.name}${p.class?` (${p.class})`:''}</option>`).join('');
  }

  async function fillLocals() {
    if (!poolSel || !localSel) return;
    const poolId = parseInt(poolSel.value || '0', 10);
    if (!poolId) { localSel.innerHTML=''; return; }
    const { data: locals } = await sb.from('teams').select('id,name,class,scope,parent_global_id')
      .eq('scope','local').eq('parent_global_id', poolId).order('name',{ascending:true});
    localSel.innerHTML = (locals || []).map(t => `<option value="${t.id}">${t.name}${t.class?` (${t.class})`:''}</option>`).join('');
  }
  on(poolSel, 'change', fillLocals);
  await fillLocals();

  on(form, 'submit', async (e) => {
    e.preventDefault();
    const scope = ($('adjust-scope')?.value || 'pool'); // 'pool' | 'local'
    const delta = parseInt(($('adjust-delta')?.value || '0'), 10);
    const reason = ($('adjust-reason')?.value || '').trim() || null;
    if (!Number.isFinite(delta) || delta === 0) return alert('Δ must be a non-zero integer.');

    try {
      if (scope === 'pool') {
        const poolId = parseInt(poolSel?.value || '0', 10);
        if (!poolId) return alert('Select a global pool');
        const { error } = await sb.rpc('team_pool_adjust', {
          _pool_team_id: poolId, _delta: delta, _reason: reason, _device_id: 'manual-adjust',
        });
        if (error) throw error;
      } else {
        const localId = parseInt(localSel?.value || '0', 10);
        if (!localId) return alert('Select a local team');
        const { error } = await sb.rpc('team_local_spend_adjust', {
          _local_team_id: localId, _amount: Math.abs(delta), _reason: reason, _device_id: 'manual-adjust',
        });
        if (error) throw error;
      }
      await refreshTeamOverview();
      await loadLatestTransactions();
      await refreshLeaderboard();
      alert('Adjustment applied.');
    } catch (err) { console.error('adjust error', err); alert(err?.message || 'Adjust failed.'); }
  });
}

// ---- Vincular tarjetas ----
async function loadCardSelects() {
  const roleSel = $('link-card-role');
  const uidInput = $('link-card-uid');
  const stuSel = $('link-card-student');
  const teamSel = $('link-card-team');
  const btn = $('link-card-btn');
  if (!btn) return;

  if (stuSel) {
    const { data: students } = await sb.from('students').select('id,name,class').order('name',{ascending:true});
    stuSel.innerHTML = (students || []).map(s => `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
  }
  if (teamSel) {
    const { data: teams } = await sb.from('teams').select('id,name,class,scope').order('name',{ascending:true});
    teamSel.innerHTML = (teams || []).map(t => `<option value="${t.id}">${t.name}${t.class?` (${t.class})`:''} — ${t.scope}</option>`).join('');
  }

  on(btn, 'click', async () => {
    const raw = uidInput?.value || '';
    const uid = normalizeUID(raw);
    if (!uid) return alert('Scan or write a card UID.');
    const role = roleSel?.value || 'student';
    try {
      if (role === 'student') {
        const sid = parseInt(stuSel?.value || '0', 10);
        if (!sid) return alert('Select a student');
        const { error } = await sb.from('cards').upsert(
          { student_id: sid, card_uid: uid, active: true, card_role: 'student', team_id: null },
          { onConflict: 'card_uid' }
        );
        if (error) throw error;
      } else {
        const tid = parseInt(teamSel?.value || '0', 10);
        if (!tid) return alert('Select a team');
        const { error } = await sb.from('cards').upsert(
          { team_id: tid, card_uid: uid, active: true, card_role: 'team_earn', student_id: null },
          { onConflict: 'card_uid' }
        );
        if (error) throw error;
      }
      alert('Card linked.');
      uidInput.value = '';
    } catch (err) { console.error('link card', err); alert(err?.message || 'Link failed.'); }
  });
}

// ---------------- Student forms (alta + delete; solo teacher) ----------------
async function initStudentForms() {
  await populateStudentTeamSelectors('real');
  await populateStudentTeamSelectors('fake');
  await populateDeleteStudentSelect();

  // Real (Auth)
  const realForm = $('real-student-form');
  on(realForm, 'submit', async (e) => {
    e.preventDefault();
    const name = $('real-name').value.trim();
    const klass = $('real-class').value.trim();
    const email = $('real-email').value.trim().toLowerCase();
    const password = $('real-pass').value;
    const uidRaw = $('real-card-uid').value;
    const uid = normalizeUID(uidRaw);
    const poolId = parseInt(($('real-pool-team')?.value || '0'), 10) || null;
    const localId = parseInt(($('real-local-team')?.value || '0'), 10) || null;

    if (!email || password.length < 6) return alert('Email and a 6+ char password are required.');

    try {
      const { data: sess } = await sb.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) return alert('No auth token. Please re-login.');
      const res = await fetch(`${EDGE_BASE}/admin_create_student`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
        },
        body: JSON.stringify({ name, klass, email, password })
      });
      if (res.status === 409) {
        alert('Email already registered.');
        return;
      }
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'admin_create_student failed');
      }
      const payload = await res.json();
      const studentId = payload?.student?.id;
      if (!studentId) throw new Error('No student id from edge function');

      await upsertMembership(studentId, localId || poolId);
      if (uid) await upsertStudentCard(studentId, uid);

      $('real-name').value = '';
      $('real-class').value = '';
      $('real-email').value = '';
      $('real-pass').value = '';
      $('real-card-uid').value = '';
      await loadTeamsUI();
      await loadCardSelects();
      await populateDeleteStudentSelect();
      await refreshTeamOverview();
      await refreshLeaderboard();
      alert('Student created.');
    } catch (err) { console.error(err); alert(err?.message || 'Create student failed'); }
  });

  // Record-only
  const fakeForm = $('fake-student-form');
  on(fakeForm, 'submit', async (e) => {
    e.preventDefault();
    const name = $('fake-name').value.trim();
    const klass = $('fake-class').value.trim();
    const uidRaw = $('fake-card-uid').value;
    const uid = normalizeUID(uidRaw);
    const poolId = parseInt(($('fake-pool-team')?.value || '0'), 10) || null;
    const localId = parseInt(($('fake-local-team')?.value || '0'), 10) || null;

    if (!name) return alert('Name is required.');

    try {
      const { data, error } = await sb.from('students').insert([{ name, class: klass || null }]).select('id').single();
      if (error) throw error;
      const studentId = data.id;
      await upsertMembership(studentId, localId || poolId);
      if (uid) await upsertStudentCard(studentId, uid);

      $('fake-name').value = '';
      $('fake-class').value = '';
      $('fake-card-uid').value = '';
      await loadTeamsUI();
      await loadCardSelects();
      await populateDeleteStudentSelect();
      await refreshTeamOverview();
      await refreshLeaderboard();
      alert('Record-only student added.');
    } catch (err) { console.error(err); alert(err?.message || 'Add record-only failed'); }
  });

  // Delete student
  on($('delete-student-btn'), 'click', async () => {
    const sel = $('delete-student-select');
    const studentId = parseInt(sel?.value || '0', 10);
    if (!studentId) return alert('Select a student to delete.');
    const ok = confirm('Delete this student? Esto removerá membresías, tarjetas, transacciones; y si tiene usuario Auth, también se elimina.');
    if (!ok) return;

    try {
      const { data: sess } = await sb.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) return alert('No auth token. Please re-login.');

      const res = await fetch(`${EDGE_BASE}/admin_delete_student`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
        },
        body: JSON.stringify({ student_id: studentId })
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'admin_delete_student failed');
      }

      await loadTeamsUI();
      await loadCardSelects();
      await populateDeleteStudentSelect();
      await refreshTeamOverview();
      await refreshLeaderboard();
      await loadLatestTransactions();
      alert('Student deleted.');
    } catch (err) { console.error(err); alert(err?.message || 'Delete student failed'); }
  });
}

async function populateStudentTeamSelectors(prefix) {
  const poolSel = $(`${prefix}-pool-team`);
  const localSel = $(`${prefix}-local-team`);
  if (poolSel) {
    const { data: pools } = await sb.from('teams').select('id,name,class,scope').eq('scope','global').order('name',{ascending:true});
    poolSel.innerHTML = `<option value="">— Global (optional) —</option>` +
      (pools || []).map(p => `<option value="${p.id}">${p.name}${p.class?` (${p.class})`:''}</option>`).join('');
  }
  async function fillLocalsFor(poolId) {
    if (!localSel) return;
    if (!poolId) { localSel.innerHTML = `<option value="">— Local (optional) —</option>`; return; }
    const { data: locals } = await sb.from('teams').select('id,name,class,scope,parent_global_id')
      .eq('scope','local').eq('parent_global_id', poolId).order('name',{ascending:true});
    localSel.innerHTML = `<option value="">— Local (optional) —</option>` +
      (locals || []).map(t => `<option value="${t.id}">${t.name}${t.class?` (${t.class})`:''}</option>`).join('');
  }
  if (poolSel && localSel) {
    on(poolSel, 'change', () => fillLocalsFor(parseInt(poolSel.value||'0',10)||null));
    await fillLocalsFor(parseInt(poolSel.value||'0',10)||null);
  }
}

async function populateDeleteStudentSelect() {
  const sel = $('delete-student-select');
  if (!sel) return;
  const { data: students } = await sb.from('students').select('id,name,class').order('name',{ascending:true});
  sel.innerHTML = (students || []).map(s => `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
}

async function upsertMembership(studentId, teamId) {
  if (!studentId || !teamId) return;
  await sb.from('team_members').delete().eq('student_id', studentId); // 1 equipo por alumno
  const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
  if (error) throw error;
}

async function upsertStudentCard(studentId, uid) {
  const { error } = await sb.from('cards').upsert(
    { student_id: studentId, card_uid: uid, active: true, card_role: 'student', team_id: null },
    { onConflict: 'card_uid' }
  );
  if (error) throw error;
}

// ---------------- Arranque ----------------
refreshUI().catch(err => console.error(err));
// setInterval(() => { refreshTeamOverview().catch(()=>{}); loadLatestTransactions().catch(()=>{}); }, 5000);


