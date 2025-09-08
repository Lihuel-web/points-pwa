// app.js — PWA Points Control (versión con Team Labels en Overview)

// ---------------- Supabase client (UMD) ----------------
const { createClient } = supabase;
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();

if (!/^https?:\/\//.test(SUPA_URL) || !SUPA_KEY) {
  console.error('Config error. SUPABASE_URL or SUPABASE_ANON_KEY missing.');
  alert('Config error. Check SUPABASE_URL / SUPABASE_ANON_KEY.');
}
const sb = createClient(SUPA_URL, SUPA_KEY);

// ---------------- Utilidades DOM ----------------
const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

// Normaliza UID a HEX mayúsculas sin separadores
function normalizeUID(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

// ---------------- Team name cache (labels bonitos) ----------------
let TEAM_CACHE = null;
async function ensureTeamCache() {
  if (TEAM_CACHE) return TEAM_CACHE;
  const { data, error } = await sb.from('teams').select('id,name,class,scope');
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
function teamLabel(id) {
  return (TEAM_CACHE?.byId?.get(id)) ?? `#${id}`;
}
function invalidateTeamCache() { TEAM_CACHE = null; }

// ---------------- Auth & UI de sesión ----------------
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

on($('logout'), 'click', async () => {
  await sb.auth.signOut();
  await refreshUI();
});

on($('change-pass'), 'click', async () => {
  const newPass = prompt('New password (min. 6 chars):');
  if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and in again.');
});

// Password recovery via magic hash
(async function handleRecoveryFromHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const p = new URLSearchParams(hash);
  if (p.get('type') === 'recovery' && p.get('access_token')) {
    try {
      await sb.auth.setSession({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
      });
      const newPass = prompt('Set a new password (min 6):');
      if (newPass) {
        const { error } = await sb.auth.updateUser({ password: newPass });
        if (error) alert(error.message);
        else alert('Password updated. Please log in again.');
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
  if (error) {
    console.error('load profile', error);
    alert('Error loading profile/role.');
    return;
  }
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
  // Student row
  const { data: student } = await sb.from('students')
    .select('id,name,class')
    .eq('auth_user_id', userId).maybeSingle();

  if (!student) {
    text($('student-info'), 'Your account is not linked to a student record yet. Ask your teacher.');
    text($('balance'), '—');
    const mt = $('mytx-table')?.querySelector('tbody'); if (mt) mt.innerHTML = '';
    text($('team-info'), 'No team assigned.');
    text($('my-team-balance'), '—');
    const ul = $('my-team-members'); if (ul) ul.innerHTML = '';
    return;
  }

  text($('student-info'), `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  // Individual balance
  const { data: bal } = await sb.from('balances').select('points').eq('student_id', student.id).maybeSingle();
  text($('balance'), bal?.points ?? 0);

  // Movements
  const { data: txs } = await sb.from('transactions')
    .select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50);
  const tb = $('mytx-table')?.querySelector('tbody');
  if (tb) {
    tb.innerHTML = (txs || []).map(t =>
      `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
    ).join('');
  }

  // Team info (legacy: muestra el equipo único si existe)
  try {
    const { data: tm } = await sb
      .from('team_members')
      .select('team_id, teams(name,class)')
      .eq('student_id', student.id).maybeSingle();

    if (!tm?.team_id) {
      text($('team-info'), 'No team assigned.');
      text($('my-team-balance'), '—');
      const ul = $('my-team-members'); if (ul) ul.innerHTML = '';
      return;
    }

    text($('team-info'), `${tm.teams?.name ?? tm.team_id} (${tm.teams?.class ?? '—'})`);

    const { data: tbal } = await sb.from('team_balances').select('points')
      .eq('team_id', tm.team_id).maybeSingle();
    text($('my-team-balance'), tbal?.points ?? 0);

    const { data: members } = await sb
      .from('team_member_points')
      .select('student_id,name,class,points')
      .eq('team_id', tm.team_id)
      .order('name', { ascending: true });

    const ul = $('my-team-members');
    if (ul) {
      ul.innerHTML = (members || []).map(m =>
        `<li>${m.name ?? m.student_id} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
      ).join('');
    }
  } catch {
    // si no existen vistas/relaciones, no se muestra
  }
}

// ---------------- Teacher panel ----------------
async function loadTeacher() {
  await ensureTeamCache();
  await loadLatestTransactions();
  await loadTeamsUI();             // gestión/relación de alumnos <-> equipo (si existe en HTML)
  await loadTeamAdjustOptions();   // selects de ajuste manual (si existen)
  await refreshTeamOverview();     // tablas de pools/locales con nombres bonitos
  await loadCardSelects();         // selects para vincular tarjetas (si existen)
}

// Últimas transacciones (con scroll limitado en CSS)
async function loadLatestTransactions() {
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  const tbody = $('tx-table')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = (txs || []).map(t => `
      <tr>
        <td>${new Date(t.created_at).toLocaleString()}</td>
        <td>${t.students?.name ?? t.student_id}</td>
        <td>${t.delta}</td>
        <td>${t.reason ?? ''}</td>
      </tr>`).join('');
  }
}

// ---------------- Teams overview (con nombres) ----------------
let _selectedPoolId = null;

async function refreshTeamOverview() {
  await ensureTeamCache();

  const poolBody = document.querySelector('#pool-table tbody');
  if (!poolBody) return;

  const { data: pools, status } = await sb
    .from('team_pool_balances')
    .select('pool_team_id,points');

  if (status === 404) {
    poolBody.innerHTML = `<tr><td colspan="2">Views missing.</td></tr>`;
    return;
  }

  poolBody.innerHTML = (pools || []).map(p => `
    <tr data-pool="${p.pool_team_id}">
      <td>${teamLabel(p.pool_team_id)}</td>
      <td><strong>${p.points ?? 0}</strong></td>
    </tr>`).join('');

  if (!_selectedPoolId && pools && pools.length) _selectedPoolId = pools[0].pool_team_id;

  Array.from(poolBody.querySelectorAll('tr[data-pool]')).forEach(tr => {
    tr.addEventListener('click', () => {
      _selectedPoolId = parseInt(tr.getAttribute('data-pool'), 10);
      loadLocalSummary();
    });
  });

  await loadLocalSummary();
}

async function loadLocalSummary() {
  await ensureTeamCache();
  const tbody = document.querySelector('#local-table tbody');
  const title = $('local-title');
  if (!tbody) return;

  if (!_selectedPoolId) {
    tbody.innerHTML = '';
    text(title, '—');
    return;
  }

  const { data: locals } = await sb
    .from('team_local_remaining')
    .select('local_team_id,pool_team_id,spent_by_local,pool_remaining')
    .eq('pool_team_id', _selectedPoolId)
    .order('local_team_id', { ascending: true });

  text(title, teamLabel(_selectedPoolId));

  tbody.innerHTML = (locals || []).map(r => `
    <tr>
      <td>${teamLabel(r.local_team_id)}</td>
      <td>${r.spent_by_local ?? 0}</td>
      <td><strong>${r.pool_remaining ?? 0}</strong></td>
    </tr>`).join('');
}

// ---------------- Gestión de equipos y alumnos (si el HTML lo tiene) ----------------
async function loadTeamsUI() {
  // Lista de equipos para selects genéricos
  const selTeam = $('team-select');
  const selStudent = $('student-pool');
  const ulMembers = $('team-members');
  const teamBalance = $('team-balance');

  if (!selTeam && !selStudent && !ulMembers) return; // no hay UI de equipos en este index

  try {
    // Rellena todas las listas si existen
    if (selTeam) {
      const { data: teams } = await sb.from('teams').select('id,name,class').order('name', { ascending: true });
      selTeam.innerHTML = (teams || []).map(t => `<option value="${t.id}">${t.name}${t.class ? ` (${t.class})` : ''}</option>`).join('');
    }
    if (selStudent) {
      const { data: students } = await sb.from('students').select('id,name,class').order('name', { ascending: true });
      selStudent.innerHTML = (students || []).map(s => `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
    }
    await refreshTeamDetails();
  } catch (e) {
    console.warn('loadTeamsUI:', e);
  }

  on($('reload-teams'), 'click', loadTeamsUI);

  on($('new-team-form'), 'submit', async (e) => {
    e.preventDefault();
    const name = $('team-name').value.trim();
    const klass = ($('team-class').value || '').trim();
    if (!name) return alert('Team name is required.');
    const row = { name, class: klass || null };
    const { error } = await sb.from('teams').insert([row]);
    if (error) return alert(error.message);
    invalidateTeamCache();
    $('team-name').value = ''; $('team-class').value = '';
    await loadTeamsUI();
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
  });

  on($('assign-member'), 'click', async () => {
    const teamId = parseInt(selTeam?.value || '0', 10);
    const studentId = parseInt(selStudent?.value || '0', 10);
    if (!teamId || !studentId) return;
    await sb.from('team_members').delete().eq('student_id', studentId); // 1 team por alumno (si ese es tu modelo)
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
    if (!teamId) {
      if (ulMembers) ulMembers.innerHTML = '';
      if (teamBalance) text(teamBalance, '—');
      return;
    }
    try {
      const { data: members } = await sb
        .from('team_member_points')
        .select('student_id,name,class,points')
        .eq('team_id', teamId)
        .order('name', { ascending: true });

      if (ulMembers) {
        ulMembers.innerHTML = (members || []).map(m =>
          `<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
        ).join('');
      }

      const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', teamId).maybeSingle();
      if (teamBalance) text(teamBalance, tbal?.points ?? 0);
    } catch (e) {
      console.warn('refreshTeamDetails:', e);
    }
  }
}

// ---------------- Ajustes manuales (pools / locales) ----------------
async function loadTeamAdjustOptions() {
  const poolSel = $('adjust-pool-id');
  const localSel = $('adjust-local-id');
  const form = $('adjust-form');
  if (!form) return;

  await ensureTeamCache();

  // Rellena pools (scope='global')
  if (poolSel) {
    const { data: pools } = await sb.from('teams').select('id,name,class,scope')
      .eq('scope', 'global').order('name', { ascending: true });
    poolSel.innerHTML = (pools || []).map(p =>
      `<option value="${p.id}">${p.name}${p.class ? ` (${p.class})` : ''}</option>`).join('');
  }

  // Rellena locales del pool seleccionado
  async function fillLocals() {
    if (!poolSel || !localSel) return;
    const poolId = parseInt(poolSel.value || '0', 10);
    if (!poolId) { localSel.innerHTML = ''; return; }
    const { data: locals } = await sb.from('teams').select('id,name,class,scope,parent_global_id')
      .eq('scope', 'local').eq('parent_global_id', poolId).order('name', { ascending: true });
    localSel.innerHTML = (locals || []).map(t =>
      `<option value="${t.id}">${t.name}${t.class ? ` (${t.class})` : ''}</option>`).join('');
  }
  on(poolSel, 'change', fillLocals);
  await fillLocals();

  // Aplicar ajuste manual
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
        // RPC que definiste para sumar/restar al pool global
        const { error } = await sb.rpc('adjust_pool_points', {
          _pool_team_id: poolId,
          _delta: delta,
          _reason: reason,
          _device_id: 'manual-adjust',
        });
        if (error) throw error;
      } else {
        const localId = parseInt(localSel?.value || '0', 10);
        if (!localId) return alert('Select a local team');
        // RPC que definiste para registrar gasto local
        const { error } = await sb.rpc('adjust_local_spend', {
          _local_team_id: localId,
          _delta: delta,
          _reason: reason,
          _device_id: 'manual-adjust',
        });
        if (error) throw error;
      }
      await refreshTeamOverview();
      await loadLatestTransactions();
      alert('Adjustment applied.');
    } catch (err) {
      console.error('adjust error', err);
      alert(err?.message || 'Adjust failed.');
    }
  });
}

// ---------------- Vincular tarjetas (si la UI existe) ----------------
async function loadCardSelects() {
  const roleSel = $('link-card-role');
  const uidInput = $('link-card-uid');
  const stuSel = $('link-card-student');
  const teamSel = $('link-card-team');
  const btn = $('link-card-btn');
  if (!btn) return;

  // Poblamos selects
  if (stuSel) {
    const { data: students } = await sb.from('students').select('id,name,class').order('name', { ascending: true });
    stuSel.innerHTML = (students || []).map(s =>
      `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
  }
  if (teamSel) {
    const { data: teams } = await sb.from('teams').select('id,name,class,scope').order('name', { ascending: true });
    teamSel.innerHTML = (teams || []).map(t =>
      `<option value="${t.id}">${t.name}${t.class ? ` (${t.class})` : ''} — ${t.scope}</option>`).join('');
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
    } catch (err) {
      console.error('link card', err);
      alert(err?.message || 'Link failed.');
    }
  });
}

// ---------------- Arranque ----------------
refreshUI().catch(err => console.error(err));

// Opcional: refresco periódico del overview para ver cambios del bridge sin recargar la PWA.
// Descomenta si lo deseas.
// setInterval(() => { refreshTeamOverview().catch(()=>{}); loadLatestTransactions().catch(()=>{}); }, 5000);
