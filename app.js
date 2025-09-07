// app.js — Westhill build (sin Realtime; con polling)

const { createClient } = supabase;
const SUPA_URL = String(window.SUPABASE_URL || "").trim();
const SUPA_KEY = String(window.SUPABASE_ANON_KEY || "").trim();
if (!/^https?:\/\//.test(SUPA_URL) || !SUPA_KEY) {
  alert("Config error: revisa SUPABASE_URL / SUPABASE_ANON_KEY en index.html"); 
}
const sb = createClient(SUPA_URL, SUPA_KEY);

// ======= Helpers UI =======
const $ = (id) => document.getElementById(id);
const show = (el, on=true) => el && (el.classList.toggle('hidden', !on));
const text = (el, t) => el && (el.textContent = t);
const POLL_MS = 5000; // refresco cada 5s (sin Realtime)
let _pollHandles = [];

function clearPollers() {
  _pollHandles.forEach(h => clearInterval(h));
  _pollHandles = [];
}

function startPoller(fn, ms=POLL_MS) {
  const h = setInterval(() => fn().catch(()=>{}), ms);
  _pollHandles.push(h);
  return h;
}

function fmtDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function normalizeUID(s){
  return (s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

// ======= Auth / Session =======
$('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  await refreshUI();
});

$('logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
  clearPollers();
  await refreshUI();
});

$('change-pass')?.addEventListener('click', async () => {
  const newPass = prompt('New password (min. 6 characters):');
  if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and sign back in.');
});

// Password recovery from magic link
async function handleRecoveryFromHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  if (params.get('type') === 'recovery' && params.get('access_token')) {
    try {
      await sb.auth.setSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
      });
      const newPass = prompt('Set a new password (min 6 chars):');
      if (newPass) {
        const { error } = await sb.auth.updateUser({ password: newPass });
        if (error) alert(error.message);
        else alert('Password updated. Please log in again.');
      }
    } catch (err) {
      console.error(err);
      alert('There was a problem updating your password.');
    } finally {
      history.replaceState({}, document.title, location.pathname);
      await sb.auth.signOut();
    }
  }
}

// ======= Role-aware UI =======
async function refreshUI() {
  const { data: { user } } = await sb.auth.getUser();
  show($('auth'), !user);
  show($('authed'), !!user);
  if (!user) return;

  text($('whoami'), user.email || '');
  const { data: profile, error } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) { alert('Error loading profile'); return; }
  const role = profile?.role || 'student';
  text($('role-badge'), role.toUpperCase());

  if (role === 'teacher') {
    show($('teacher-panel'), true);
    show($('student-panel'), false);
    clearPollers();
    await loadTeacher();
    // Pollers (sin Realtime)
    startPoller(loadLatestTransactions);
    startPoller(refreshTeamOverview);
  } else {
    show($('teacher-panel'), false);
    show($('student-panel'), true);
    clearPollers();
    await loadStudent(user.id);
    // Poller simple para tabla personal
    startPoller(() => loadStudent(user.id));
  }
}

// ======= STUDENT =======
async function loadStudent(userId) {
  const { data: student, error: e1 } = await sb
    .from('students').select('id,name,class')
    .eq('auth_user_id', userId).maybeSingle();

  if (e1 || !student) {
    text($('student-info'), 'Your account is not linked to a student record yet. Ask your teacher.');
    text($('balance'), '—');
    const mt = $('mytx-table')?.querySelector('tbody'); if (mt) mt.innerHTML = '';
    text($('team-info'), 'No team assigned.');
    text($('my-team-balance'), '—');
    $('my-team-members') && ($('my-team-members').innerHTML = '');
    return;
  }

  text($('student-info'), `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  const { data: bal } = await sb.from('balances').select('points').eq('student_id', student.id).maybeSingle();
  text($('balance'), bal?.points ?? 0);

  const { data: txs } = await sb
    .from('transactions').select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false }).limit(50);

  const mytxBody = $('mytx-table')?.querySelector('tbody');
  if (mytxBody) {
    mytxBody.innerHTML = (txs || []).map(t =>
      `<tr><td>${fmtDate(t.created_at)}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
    ).join('');
  }

  try {
    const { data: tm } = await sb
      .from('team_members')
      .select('team_id, teams(name,class)')
      .eq('student_id', student.id).maybeSingle();

    if (!tm?.team_id) {
      text($('team-info'), 'No team assigned.');
      text($('my-team-balance'), '—');
      $('my-team-members') && ($('my-team-members').innerHTML = '');
      return;
    }

    text($('team-info'), `${tm.teams?.name ?? tm.team_id} (${tm.teams?.class ?? '—'})`);

    const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', tm.team_id).maybeSingle();
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
  } catch {}
}

// ======= TEACHER =======
async function loadTeacher() {
  await loadLatestTransactions();
  await loadTeamsUI();
  await loadTeamAdjustOptions();
  await refreshTeamOverview();
}

// Últimas transacciones
async function loadLatestTransactions() {
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false }).limit(30);

  const tbody = $('tx-table')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = (txs || []).map(t => `
      <tr><td>${fmtDate(t.created_at)}</td>
      <td>${t.students?.name ?? t.student_id}</td>
      <td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`).join('');
  }
}

// Gestión equipos: carga selects/listas
async function loadTeamsUI() {
  // parent global para crear locales
  const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name', { ascending: true });
  $('parent-global').innerHTML = `<option value="">(none)</option>` + (globals || []).map(t =>
    `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

  // selector de equipo activo
  const { data: teams } = await sb.from('teams').select('id,name,class').order('name', { ascending: true });
  $('team-select').innerHTML = (teams || []).map(t =>
    `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

  // pool de alumnos
  const { data: students } = await sb.from('students').select('id,name,class').order('name', { ascending: true });
  $('student-pool').innerHTML = (students || []).map(s =>
    `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');

  await refreshTeamDetails();
}

$('reload-teams')?.addEventListener('click', loadTeamsUI);
$('team-select')?.addEventListener('change', refreshTeamDetails);

async function refreshTeamDetails() {
  const teamId = parseInt(($('team-select').value || '0'), 10);
  if (!teamId) {
    $('team-members').innerHTML = '';
    text($('team-balance'), '—');
    return;
  }

  const { data: members } = await sb
    .from('team_member_points')
    .select('student_id,name,class,points')
    .eq('team_id', teamId)
    .order('name', { ascending: true });

  $('team-members').innerHTML = (members || []).map(m =>
    `<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
  ).join('');

  const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', teamId).maybeSingle();
  text($('team-balance'), tbal?.points ?? 0);
}

$('new-team-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('team-name').value.trim();
  const klass = ($('team-class').value || '').trim();
  const scope = $('team-scope').value || 'global';
  const parent = parseInt(($('parent-global').value || '0'), 10) || null;

  if (!name) return alert('Team name is required.');
  if (scope === 'local' && !parent) return alert('Local teams require a parent Global.');

  // crea con scope/parent si el esquema lo soporta; si no, cae a nombre/clase
  const row = scope === 'local'
    ? { name, class: klass || null, scope: 'local', parent_global_id: parent }
    : { name, class: klass || null, scope: 'global', parent_global_id: null };

  const { error } = await sb.from('teams').insert([row]);
  if (error) return alert(error.message);
  $('team-name').value = ''; $('team-class').value = '';
  await loadTeamsUI();
});

$('delete-team')?.addEventListener('click', async () => {
  const teamId = parseInt(($('team-select').value || '0'), 10);
  if (!teamId) return;
  const ok = confirm('Delete this team? This removes memberships but not student records or transactions.');
  if (!ok) return;
  const { error } = await sb.from('teams').delete().eq('id', teamId);
  if (error) return alert(error.message);
  await loadTeamsUI();
});

$('assign-member')?.addEventListener('click', async () => {
  const teamId = parseInt(($('team-select').value || '0'), 10);
  const studentId = parseInt(($('student-pool').value || '0'), 10);
  if (!teamId || !studentId) return;
  await sb.from('team_members').delete().eq('student_id', studentId);
  const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

$('remove-member')?.addEventListener('click', async () => {
  const teamId = parseInt(($('team-select').value || '0'), 10);
  const li = $('team-members')?.querySelector('li[data-student]');
  if (!teamId) return;
  const studentId = li ? parseInt(li.getAttribute('data-student'), 10) : null;
  if (!studentId) return alert('Selecciona un miembro (o implementa selección). Por ahora removerá el primero.');
  const { error } = await sb.from('team_members').delete().match({ team_id: teamId, student_id: studentId });
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

// ======= Linking de tarjetas =======
async function loadCardSelects() {
  const { data: students } = await sb.from('students').select('id,name,class').order('name', { ascending: true });
  $('card-student').innerHTML = (students || []).map(s =>
    `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');

  await reloadTeamOptionsForCard();
}

async function reloadTeamOptionsForCard() {
  const role = $('card-role').value;
  if (role === 'team_earn') {
    const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name', { ascending: true });
    $('card-team').innerHTML = (globals || []).map(t =>
      `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
  } else {
    const { data: locals } = await sb.from('teams').select('id,name,class').eq('scope','local').order('name', { ascending: true });
    $('card-team').innerHTML = (locals || []).map(t =>
      `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
  }
}

$('card-role')?.addEventListener('change', reloadTeamOptionsForCard);

$('link-card-student')?.addEventListener('click', async () => {
  const studentId = parseInt(($('card-student').value || '0'), 10);
  const uid = normalizeUID($('card-uid-stu').value);
  if (!studentId || !uid) return alert('Student + UID required');
  const { error } = await sb.from('cards').upsert(
    { card_uid: uid, student_id: studentId, team_id: null, card_role: 'student', active: true },
    { onConflict: 'card_uid' }
  );
  if (error) return alert(error.message);
  alert('Card linked to student.');
  $('card-uid-stu').value = '';
});

$('unlink-card-student')?.addEventListener('click', async () => {
  const uid = normalizeUID($('card-uid-stu').value);
  if (!uid) return alert('UID required');
  const { error } = await sb.from('cards').update({ active: false }).eq('card_uid', uid);
  if (error) return alert(error.message);
  alert('Card set inactive.');
  $('card-uid-stu').value = '';
});

$('link-card-team')?.addEventListener('click', async () => {
  const role = $('card-role').value; // team_earn | team_spend
  const teamId = parseInt(($('card-team').value || '0'), 10);
  const uid = normalizeUID($('card-uid-team').value);
  if (!teamId || !uid) return alert('Team + UID required');

  // Para equipo: student_id debe quedar NULL
  const { error } = await sb.from('cards').upsert(
    { card_uid: uid, team_id: teamId, student_id: null, card_role: role, active: true },
    { onConflict: 'card_uid' }
  );
  if (error) return alert(error.message);
  alert('Card linked to team.');
  $('card-uid-team').value = '';
});

$('unlink-card-team')?.addEventListener('click', async () => {
  const uid = normalizeUID($('card-uid-team').value);
  if (!uid) return alert('UID required');
  const { error } = await sb.from('cards').update({ active: false }).eq('card_uid', uid);
  if (error) return alert(error.message);
  alert('Card set inactive.');
  $('card-uid-team').value = '';
});

// ======= Ajustes manuales =======
async function loadTeamAdjustOptions() {
  const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name', { ascending: true });
  const selG = $('adjust-pool-team');
  if (selG) selG.innerHTML = (globals || []).map(t =>
    `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

  const { data: locals } = await sb.from('teams').select('id,name,class').eq('scope','local').order('name', { ascending: true });
  const selL = $('adjust-local-team');
  if (selL) selL.innerHTML = (locals || []).map(t =>
    `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
}

$('adjust-pool-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const teamId = parseInt(($('adjust-pool-team').value || '0'), 10);
  const delta  = parseInt($('adjust-pool-delta').value, 10);
  const reason = ($('adjust-pool-reason').value || '').trim() || null;
  if (!teamId || !Number.isFinite(delta) || delta === 0) return alert('Team + non-zero Δ required');

  const device = 'web-teacher';
  const { data, error } = await sb.rpc('team_pool_adjust', {
    _pool_team_id: teamId, _delta: delta, _reason: reason, _device_id: device
  });
  if (error) return alert(error.message);
  alert(`Pool adjusted. Remaining: ${data?.remaining ?? 'n/a'}`);
  await refreshTeamOverview();
});

$('adjust-local-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const localId = parseInt(($('adjust-local-team').value || '0'), 10);
  const amount  = parseInt($('adjust-local-amount').value, 10);
  const reason  = ($('adjust-local-reason').value || '').trim() || null;
  if (!localId || !Number.isFinite(amount) || amount <= 0) return alert('Local team + positive amount required');

  const device = 'web-teacher';
  const { data, error } = await sb.rpc('team_local_spend_adjust', {
    _local_team_id: localId, _amount: amount, _reason: reason, _device_id: device
  });
  if (error) return alert(error.message);
  alert(`Local spend applied. Pool remaining: ${data?.pool_remaining ?? 'n/a'}`);
  await refreshTeamOverview();
});

// ======= Overview (vistas del pool) =======
let _selectedPoolId = null;

async function refreshTeamOverview() {
  // Pools
  const { data: pools, error: e1, status } = await sb.from('team_pool_balances').select('pool_team_id,points');
  if (e1 && status === 404) {
    // vistas aún no creadas: no rompas la UI
    document.querySelector('#pool-table tbody').innerHTML = `<tr><td colspan="2">Views missing.</td></tr>`;
    return;
  }
  const tbody = document.querySelector('#pool-table tbody');
  tbody.innerHTML = (pools || []).map(p =>
    `<tr data-pool="${p.pool_team_id}"><td>${p.pool_team_id}</td><td><strong>${p.points ?? 0}</strong></td></tr>`
  ).join('');

  // por defecto selecciona el primero si no hay seleccionado
  if (!_selectedPoolId && pools && pools.length) _selectedPoolId = pools[0].pool_team_id;

  // click to select
  Array.from(tbody.querySelectorAll('tr[data-pool]')).forEach(tr => {
    tr.addEventListener('click', () => {
      _selectedPoolId = parseInt(tr.getAttribute('data-pool'), 10);
      loadLocalSummary();
    });
  });

  await loadLocalSummary();
}

async function loadLocalSummary() {
  if (!_selectedPoolId) {
    document.querySelector('#local-table tbody').innerHTML = '';
    text($('local-title'), '—');
    return;
  }

  // locales bajo ese pool: usamos team_local_remaining (pool + gasto local)
  const { data: locals } = await sb
    .from('team_local_remaining')
    .select('local_team_id,pool_team_id,spent_by_local,pool_remaining')
    .eq('pool_team_id', _selectedPoolId)
    .order('local_team_id', { ascending: true });

  text($('local-title'), `Pool ${_selectedPoolId}`);
  const tbody = document.querySelector('#local-table tbody');
  tbody.innerHTML = (locals || []).map(r =>
    `<tr><td>${r.local_team_id}</td><td>${r.spent_by_local ?? 0}</td><td><strong>${r.pool_remaining ?? 0}</strong></td></tr>`
  ).join('');
}

// ======= Asignar por alumno =======
$('reload-students')?.addEventListener('click', loadStudentsList);
$('class-filter')?.addEventListener('change', loadStudentsList);
$('search-name')?.addEventListener('input', () => {
  clearTimeout(loadStudentsList._t);
  loadStudentsList._t = setTimeout(loadStudentsList, 200);
});

document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.getAttribute('data-quick'), 10);
    const deltaInput = document.getElementById('delta');
    // ya no existe input#delta global; sólo ajustamos prompt cuando se use "custom".
  });
});

async function loadStudentsList() {
  const cls = ($('class-filter')?.value || '').trim();
  const q = ($('search-name')?.value || '').trim().toLowerCase();

  let query = sb.from('students').select('id,name,class');
  if (cls) query = query.ilike('class', `${cls}%`);
  if (q) query = query.ilike('name', `%${q}%`);
  query = query.order('class', { ascending: true }).order('name', { ascending: true });

  const { data: students, error } = await query;
  if (error) { console.error(error); return; }

  const container = $('students-list');
  if (!container) return;
  if (!students || students.length === 0) {
    container.innerHTML = '<p class="muted">No students found for this filter.</p>';
    return;
  }

  const balances = {};
  const ids = students.map(s => s.id);
  if (ids.length > 0) {
    const { data: bals } = await sb.from('balances').select('student_id,points').in('student_id', ids);
    (bals || []).forEach(b => { balances[b.student_id] = b.points; });
  }

  container.innerHTML = students.map(s => {
    const pts = balances[s.id] ?? 0;
    return `
      <div class="row listitem">
        <div><strong>${s.name}</strong> <span class="muted">(${s.class ?? '—'})</span> — <strong>${pts}</strong> pts</div>
        <div class="row">
          <button data-award="+1" data-student="${s.id}" class="btn">+1</button>
          <button data-award="+2" data-student="${s.id}" class="btn">+2</button>
          <button data-award="+3" data-student="${s.id}" class="btn">+3</button>
          <button data-award="+4" data-student="${s.id}" class="btn">+4</button>
          <button data-award="custom" data-student="${s.id}" class="btn">Custom…</button>
          <button data-link-card="${s.id}" class="btn">Link card…</button>
          <button data-delete="${s.id}" data-name="${s.name}" class="btn danger">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // otorgar por alumno
  container.querySelectorAll('button[data-award]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-student'), 10);
      let delta;
      const t = btn.getAttribute('data-award');
      if (t === 'custom') {
        const val = prompt('Δ points (e.g., 2 or -3):'); if (!val) return;
        delta = parseInt(val, 10); if (isNaN(delta)) return alert('Invalid number');
      } else {
        delta = parseInt(t, 10);
      }
      const reason = prompt('Reason (optional):') || null;
      const device = 'web-teacher';
      const { error } = await sb.rpc('award_points_by_student', {
        _student_id: studentId, _delta: delta, _reason: reason, _device_id: device,
      });
      if (error) return alert(error.message);
      await loadLatestTransactions();
      await loadStudentsList();
    });
  });

  // vincular tarjeta a alumno
  container.querySelectorAll('button[data-link-card]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-link-card'), 10);
      const raw = prompt('Card UID (write or scan later):'); if (!raw) return;
      const uid = normalizeUID(raw);
      const { error } = await sb.from('cards').upsert(
        { student_id: studentId, team_id: null, card_role: 'student', card_uid: uid, active: true },
        { onConflict: 'card_uid' }
      );
      if (error) return alert(error.message);
      alert('Card linked.');
    });
  });

  // borrar alumno
  container.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-delete'), 10);
      const name = btn.getAttribute('data-name') || 'this student';
      const confirmText = prompt(`Type DELETE to remove ${name} (Auth account + cards + transactions). This cannot be undone.`);
      if (confirmText !== 'DELETE') return;
      try {
        await callEdge('admin_delete_student', { student_id: studentId });
        await loadLatestTransactions();
        await loadStudentsList();
        alert('Student deleted (Auth + data).');
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Delete failed');
      }
    });
  });
}

// Edge Function helper
async function callEdge(fnName, payload) {
  const { data: { session} } = await sb.auth.getSession();
  const resp = await fetch(`${SUPA_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${fnName} failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}

// Arranque
handleRecoveryFromHash().finally(async () => {
  await refreshUI();
  await loadCardSelects().catch(()=>{});
  await reloadTeamOptionsForCard().catch(()=>{});
});
