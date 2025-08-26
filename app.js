// app.js

// --- Supabase client (UMD) ---
// Lee SUPABASE_URL/ANON_KEY desde window.* (evita ReferenceError si no hay const globales)
const { createClient } = supabase;

const SUPA_URL = String((window && window.SUPABASE_URL) || '').trim();
const SUPA_KEY = String((window && window.SUPABASE_ANON_KEY) || '').trim();

if (!SUPA_URL || !/^https?:\/\//.test(SUPA_URL)) {
  console.error('SUPABASE_URL inválida o vacía:', SUPA_URL);
  alert('Config error: SUPABASE_URL inválida.');
}
if (!SUPA_KEY) {
  console.error('SUPABASE_ANON_KEY vacía.');
  alert('Config error: falta SUPABASE_ANON_KEY.');
}

const sb = createClient(SUPA_URL, SUPA_KEY);

// -------- Password recovery desde link de email --------
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

// --------- Utilidades UI ---------
const el = (id) => document.getElementById(id);
const authSec = el('auth');
const authedSec = el('authed');
const teacherPanel = el('teacher-panel');
const studentPanel = el('student-panel');
const whoami = el('whoami');
const roleBadge = el('role-badge');

// ---------- Auth ----------
el('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('email').value.trim();
  const password = el('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  refreshUI();
});

// soporte opcional si agregas un formulario de registro en tu index.html
el('signup-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('su-email').value.trim();
  const password = el('su-password').value;
  const name = (el('su-name')?.value || '').trim();
  const klass = (el('su-class')?.value || '').trim();

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return alert(error.message);

  if (data?.user?.id && (name || klass)) {
    await sb.from('students')
      .update({ name: name || null, class: klass || null })
      .eq('auth_user_id', data.user.id);
  }
  alert('Account created. Check your email if confirmation is required, then log in.');
});

el('logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
  refreshUI();
});

el('change-pass')?.addEventListener('click', async () => {
  const newPass = prompt('New password (min. 6 characters):');
  if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and sign back in.');
});

// ---------- Role-aware UI ----------
async function refreshUI() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    authSec && (authSec.style.display = 'block');
    authedSec && (authedSec.style.display = 'none');
    return;
  }
  authSec && (authSec.style.display = 'none');
  authedSec && (authedSec.style.display = 'block');
  whoami && (whoami.textContent = `${user.email}`);

  const { data: profile, error } = await sb
    .from('profiles').select('role')
    .eq('id', user.id).maybeSingle();
  if (error) {
    console.error(error);
    alert('Error loading profile/role.');
    return;
  }
  const role = profile?.role || 'student';
  if (roleBadge) roleBadge.textContent = role.toUpperCase();

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

// ---------- STUDENT ----------
async function loadStudent(userId) {
  const { data: student, error: e1 } = await sb
    .from('students').select('id,name,class')
    .eq('auth_user_id', userId).maybeSingle();

  if (e1 || !student) {
    el('student-info') && (el('student-info').textContent = 'Your account is not linked to a student record yet. Ask your teacher.');
    el('balance') && (el('balance').textContent = '—');
    const mt = el('mytx-table')?.querySelector('tbody'); if (mt) mt.innerHTML = '';
    // limpia panel de equipo si existe
    el('team-info') && (el('team-info').textContent = 'No team assigned.');
    el('my-team-balance') && (el('my-team-balance').textContent = '—');
    el('my-team-members') && (el('my-team-members').innerHTML = '');
    return;
  }

  el('student-info') && (el('student-info').textContent = `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  // balance individual
  const { data: bal } = await sb
    .from('balances').select('points')
    .eq('student_id', student.id).maybeSingle();
  el('balance') && (el('balance').textContent = bal?.points ?? 0);

  // movimientos individuales
  const { data: txs } = await sb
    .from('transactions').select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false }).limit(50);

  const mytxBody = el('mytx-table')?.querySelector('tbody');
  if (mytxBody) {
    mytxBody.innerHTML = (txs || []).map(t =>
      `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
    ).join('');
  }

  // ---- Equipo (si tienes el SQL de equipos) ----
  try {
    const { data: tm, error: tmErr } = await sb
      .from('team_members')
      .select('team_id, teams(name,class)')
      .eq('student_id', student.id).maybeSingle();

    if (tmErr) throw tmErr;

    if (!tm?.team_id) {
      el('team-info') && (el('team-info').textContent = 'No team assigned.');
      el('my-team-balance') && (el('my-team-balance').textContent = '—');
      el('my-team-members') && (el('my-team-members').innerHTML = '');
      return;
    }

    el('team-info') && (el('team-info').textContent = `${tm.teams?.name ?? tm.team_id} (${tm.teams?.class ?? '—'})`);

    const { data: tbal } = await sb
      .from('team_balances').select('points').eq('team_id', tm.team_id).maybeSingle();
    el('my-team-balance') && (el('my-team-balance').textContent = tbal?.points ?? 0);

    const { data: members } = await sb
      .from('team_member_points')
      .select('student_id,name,class,points')
      .eq('team_id', tm.team_id)
      .order('name', { ascending: true });

    const ul = el('my-team-members');
    if (ul) {
      ul.innerHTML = (members || []).map(m =>
        `<li>${m.name ?? m.student_id} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
      ).join('');
    }
  } catch (err) {
    // si no existe el esquema de equipos, ignora silenciosamente
    // console.warn('Teams not configured yet:', err?.message);
  }
}

// ---------- TEACHER ----------
async function loadTeacher() {
  // últimas transacciones
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false }).limit(30);

  const tbody = el('tx-table')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = (txs || []).map(t => `
      <tr><td>${new Date(t.created_at).toLocaleString()}</td>
      <td>${t.students?.name ?? t.student_id}</td>
      <td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`).join('');
  }

  await loadTeamsUI();   // no hace nada si la UI de equipos no existe
  await loadStudentsList();
}

// --- Gestión de equipos (protegido por existencia de elementos) ---
async function loadTeamsUI() {
  if (!el('team-select')) return; // UI de equipos no presente en tu index.html
  try {
    const { data: teams } = await sb
      .from('teams').select('id,name,class').order('name', { ascending: true });

    const sel = el('team-select');
    sel.innerHTML = (teams || []).map(t =>
      `<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

    const { data: students } = await sb
      .from('students').select('id,name,class').order('name', { ascending: true });
    el('student-pool').innerHTML = (students || []).map(s =>
      `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');

    await refreshTeamDetails();
  } catch (err) {
    // esquema de equipos no activo, no hacemos nada
  }
}

async function refreshTeamDetails() {
  if (!el('team-select')) return;
  const teamId = parseInt(el('team-select').value || '0', 10);
  if (!teamId) {
    el('team-members').innerHTML = '';
    el('team-balance').textContent = '—';
    return;
  }
  try {
    const { data: members } = await sb
      .from('team_member_points')
      .select('student_id,name,class,points')
      .eq('team_id', teamId)
      .order('name', { ascending: true });

    el('team-members').innerHTML = (members || []).map(m =>
      `<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`
    ).join('');

    const { data: tbal } = await sb
      .from('team_balances').select('points').eq('team_id', teamId).maybeSingle();
    el('team-balance').textContent = tbal?.points ?? 0;
  } catch (err) {
    // sin esquema, ignorar
  }
}

el('reload-teams')?.addEventListener('click', loadTeamsUI);
el('team-select')?.addEventListener('change', refreshTeamDetails);

el('new-team-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('team-name').value.trim();
  const klass = (el('team-class').value || '').trim();
  if (!name) return alert('Team name is required.');
  const { error } = await sb.from('teams').insert([{ name, class: klass || null }]);
  if (error) return alert(error.message);
  el('team-name').value = ''; el('team-class').value = '';
  await loadTeamsUI();
});

el('delete-team')?.addEventListener('click', async () => {
  const teamId = parseInt(el('team-select').value || '0', 10);
  if (!teamId) return;
  const ok = confirm('Delete this team? This removes memberships but not student records or transactions.');
  if (!ok) return;
  const { error } = await sb.from('teams').delete().eq('id', teamId);
  if (error) return alert(error.message);
  await loadTeamsUI();
});

el('assign-member')?.addEventListener('click', async () => {
  const teamId = parseInt(el('team-select').value || '0', 10);
  const studentId = parseInt(el('student-pool').value || '0', 10);
  if (!teamId || !studentId) return;
  await sb.from('team_members').delete().eq('student_id', studentId); // mueve si estaba en otro equipo
  const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

el('remove-member')?.addEventListener('click', async () => {
  const teamId = parseInt(el('team-select').value || '0', 10);
  const li = el('team-members')?.querySelector('li[data-student]');
  if (!teamId) return;
  const studentId = li ? parseInt(li.getAttribute('data-student'), 10) : null;
  if (!studentId) return alert('Selecciona un miembro (o implementa selección). Por ahora removerá el primero.');
  const { error } = await sb.from('team_members').delete().match({ team_id: teamId, student_id: studentId });
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

// ---------- Otorgar por identificador (UID/token) ----------
el('award-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const identifier = el('identifier').value.trim();
  const delta = parseInt(el('delta').value, 10);
  const reason = el('reason').value.trim() || null;
  const device = el('device')?.value.trim() || 'web-teacher';

  if (!identifier) return;

  const { error } = await sb.rpc('award_points', {
    _identifier: identifier,
    _delta: isNaN(delta) ? 1 : delta,
    _reason: reason,
    _device_id: device,
  });
  if (error) {
    alert(error.message);
    return;
  }

  // Limpieza + re-enfoque si Scan mode está activo
  const scanToggle = el('scan-mode');
  el('identifier').value = '';
  if (scanToggle?.checked) {
    el('reason').value = '';
    setTimeout(() => el('identifier').focus(), 0);
  }
  loadTeacher();
});

// ---------- Botones rápidos (+1..+4 sólo positivos) ----------
document.querySelectorAll('[data-quick]')?.forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-quick'); // ej. "+1", "+2", "+3", "+4"
    const deltaInput = el('delta');
    if (deltaInput) deltaInput.value = v;
  });
});

// --------- Alta de ALUMNO (sin login) ---------
el('new-student-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('ns-name').value.trim();
  const klass = el('ns-class').value.trim();
  const card = (el('ns-card').value || '').trim();

  if (!name || !klass) return alert('Name and class are required.');

  const { data: inserted, error: e1 } = await sb
    .from('students')
    .insert([{ name, class: klass }])
    .select('id')
    .single();
  if (e1) return alert(e1.message);

  if (card) {
    const { error: e2 } = await sb
      .from('cards')
      .upsert({ student_id: inserted.id, card_uid: card, active: true }, { onConflict: 'card_uid' });
    if (e2) return alert(e2.message);
  }

  el('ns-name').value = '';
  el('ns-class').value = '';
  el('ns-card').value = '';
  await loadTeacher();
  alert('Student created.');
});

// --------- Asignación por ALUMNO (sin tarjeta) ---------
el('reload-students')?.addEventListener('click', loadStudentsList);
el('class-filter')?.addEventListener('change', loadStudentsList);
el('search-name')?.addEventListener('input', () => {
  clearTimeout(loadStudentsList._t);
  loadStudentsList._t = setTimeout(loadStudentsList, 200);
});

async function loadStudentsList() {
  const cls = (el('class-filter')?.value || '').trim();
  const q = (el('search-name')?.value || '').trim().toLowerCase();

  let query = sb.from('students').select('id,name,class');
  if (cls) query = query.ilike('class', cls);
  if (q) query = query.ilike('name', `%${q}%`);
  query = query.order('class', { ascending: true }).order('name', { ascending: true });

  const { data: students, error } = await query;
  if (error) { console.error(error); return; }

  const container = el('students-list');
  if (!container) return;
  if (!students || students.length === 0) {
    container.innerHTML = '<p class="muted">No students found for this filter.</p>';
    return;
  }

  // balances
  const balances = {};
  const ids = students.map(s => s.id);
  if (ids.length > 0) {
    const { data: bals } = await sb
      .from('balances').select('student_id,points').in('student_id', ids);
    (bals || []).forEach(b => { balances[b.student_id] = b.points; });
  }

  container.innerHTML = students.map(s => {
    const pts = balances[s.id] ?? 0;
    return `
      <div class="card" style="margin:8px 0; padding:12px">
        <div class="row" style="justify-content:space-between">
          <div><strong>${s.name}</strong> <span class="muted">(${s.class ?? '—'})</span> — <strong>${pts}</strong> pts</div>
          <div class="row">
            <button data-award="+1" data-student="${s.id}">+1</button>
            <button data-award="+2" data-student="${s.id}">+2</button>
            <button data-award="+3" data-student="${s.id}">+3</button>
            <button data-award="+4" data-student="${s.id}">+4</button>
            <button data-award="custom" data-student="${s.id}">Custom…</button>
            <button data-link-card="${s.id}">Link card…</button>
            <button data-delete="${s.id}" data-name="${s.name}">Delete</button>
          </div>
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
      await loadTeacher();
    });
  });

  // vincular tarjeta
  container.querySelectorAll('button[data-link-card]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-link-card'), 10);
      const card = prompt('Card UID (write or scan later):'); if (!card) return;
      const { error } = await sb
        .from('cards')
        .upsert({ student_id: studentId, card_uid: card.trim(), active: true }, { onConflict: 'card_uid' });
      if (error) return alert(error.message);
      await loadTeacher();
    });
  });

  // borrar alumno
  container.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-delete'), 10);
      const name = btn.getAttribute('data-name') || 'this student';
      const confirmText = prompt(`Type DELETE to remove ${name} and ALL their cards & transactions. This cannot be undone.`);
      if (confirmText !== 'DELETE') return;
      const { error } = await sb.rpc('delete_student', { _student_id: studentId });
      if (error) return alert(error.message);
      await loadTeacher();
      alert('Student deleted.');
    });
  });
}

// --- Scan mode: focus persistente + auto-submit en Enter ---
(function setupScanMode(){
  const scanToggle = document.getElementById('scan-mode');
  const idInput = document.getElementById('identifier');
  const awardForm = document.getElementById('award-form');
  if (!scanToggle || !idInput || !awardForm) return;

  function keepFocus(){
    if (!scanToggle?.checked) return;
    if (document.activeElement !== idInput) idInput.focus();
  }
  setInterval(keepFocus, 500);

  // Auto-submit en Enter (para HID que mande '\n')
  idInput.addEventListener('keydown', (e) => {
    if (!scanToggle?.checked) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      awardForm.requestSubmit();
    }
  });
})();

// -------- Arranque --------
handleRecoveryFromHash().finally(refreshUI);

