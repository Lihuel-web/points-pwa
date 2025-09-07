// app.js

const { createClient } = supabase;

// --- Config ---
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
  roleBadge && (roleBadge.textContent = role.toUpperCase());

  if (role === 'teacher') {
    teacherPanel && (teacherPanel.style.display = 'block');
    studentPanel && (studentPanel.style.display = 'none');
    await loadTeacher();
  } else {
    teacherPanel && (teacherPanel.style.display = 'none');
    studentPanel && (studentPanel.style.display = 'block');
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
    el('team-info') && (el('team-info').textContent = 'No team assigned.');
    el('my-team-balance') && (el('my-team-balance').textContent = '—');
    el('my-team-members') && (el('my-team-members').innerHTML = '');
    return;
  }

  el('student-info') && (el('student-info').textContent = `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  const { data: bal } = await sb
    .from('balances').select('points')
    .eq('student_id', student.id).maybeSingle();
  el('balance') && (el('balance').textContent = bal?.points ?? 0);

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

  try {
    const { data: tm } = await sb
      .from('team_members')
      .select('team_id, teams(name,class)')
      .eq('student_id', student.id).maybeSingle();

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
  } catch {}
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

  await loadTeamsUI();
  await loadStudentsList();
  await loadTeamsOverview();
}

// --- Gestión de equipos (UI CRUD básico) ---
async function loadTeamsUI() {
  if (!el('team-select')) return;
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
  } catch {}
}

async function refreshTeamDetails() {
  if (!el('team-select')) return;
  const teamId = parseInt(el('team-select').value || '0', 10);
  if (!teamId) {
    el('team-members') && (el('team-members').innerHTML = '');
    el('team-balance') && (el('team-balance').textContent = '—');
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
  } catch {}
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
  await sb.from('team_members').delete().eq('student_id', studentId);
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

// ---------- Edge Function helper ----------
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

// ---------- Crear cuenta de estudiante ----------
el('create-student-account')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('ct-name').value.trim();
  const klass = (el('ct-class').value || '').trim();
  const email = el('ct-email').value.trim();
  const pass = el('ct-pass').value;
  if (!name || !email || pass.length < 6) return alert('Completa nombre, email y password ≥6.');

  try {
    const r = await callEdge('admin_create_student', { name, klass, email, password: pass });
    el('ct-name').value = '';
    el('ct-class').value = '';
    el('ct-email').value = '';
    el('ct-pass').value = '';
    await loadTeacher();
    alert(`Account created: ${r?.student?.name || name}`);
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || "");
    if (msg.includes(" 409 ") || /already been registered/i.test(msg)) {
      alert("Ese email ya está registrado. Usa otro o borra la cuenta existente.");
    } else {
      alert(msg);
    }
  }
});

// --------- Alta de ALUMNO (record only) ---------
(function wireRecordOnlyForm(){
  const form = el('new-student-form');
  if (!form) return;
  if (form.dataset.wired === '1') return;
  form.dataset.wired = '1';

  let busy = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn?.setAttribute('disabled', 'disabled');

    const name  = (el('ns-name')?.value  || '').trim();
    const klass = (el('ns-class')?.value || '').trim();
    const raw   = (el('ns-card')?.value  || '').trim();
    const card  = normalizeUID(raw);
    if (!name) { alert('Name is required.'); submitBtn?.removeAttribute('disabled'); busy = false; return; }

    try {
      const { data: inserted, error: e1 } = await sb
        .from('students')
        .insert([{ name, class: klass || null }])
        .select('id')
        .single();
      if (e1) throw e1;

      if (card) {
        const { error: e2 } = await sb
          .from('cards')
          .upsert(
            { student_id: inserted.id, card_uid: card, active: true },
            { onConflict: 'card_uid' }
          );
        if (e2) throw e2;
      }

      el('ns-name').value = '';
      el('ns-class').value = '';
      el('ns-card').value  = '';
      await loadTeacher();
      alert('Student created.');
    } catch (err) {
      console.error('record-only insert failed:', err);
      alert(err?.message || 'Insert failed');
    } finally {
      busy = false;
      submitBtn?.removeAttribute('disabled');
    }
  });
})();

// ---------- Normalización ----------
function normalizeUID(s){
  return (s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}
function extractUIDs(raw){
  const canon = normalizeUID(raw);
  if (!canon) return [];
  const lens = [8,14,16,20];
  for (const L of lens){
    if (canon.length === L) return [canon];
    if (canon.length > L && canon.length % L === 0){
      const out = [];
      for (let i=0;i<canon.length;i+=L) out.push(canon.slice(i,i+L));
      return out;
    }
  }
  const m = canon.match(/[0-9A-F]{8,}/g);
  if (m && m.length) return m;
  return [canon];
}

// ---------- Botones rápidos (+1..+4) ----------
document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.getAttribute('data-quick'), 10);
    const deltaInput = el('delta');
    if (Number.isFinite(n) && deltaInput) deltaInput.value = String(n);
  });
});

// --------- Lista de alumnos + (link/unlink) ---------
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
  if (cls) query = query.ilike('class', `${cls}%`);
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
            <button data-unlink-card="${s.id}">Unlink card…</button>
            <button data-delete="${s.id}" data-name="${s.name}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // otorgar por alumno (RPC by student)
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

  // vincular tarjeta (normaliza)
  container.querySelectorAll('button[data-link-card]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-link-card'), 10);
      const raw = prompt('Card UID (scan now or paste):'); if (!raw) return;
      const card = normalizeUID(raw.trim());
      if (!card) return alert('UID inválido.');
      const { error } = await sb
        .from('cards')
        .upsert({ student_id: studentId, card_uid: card, active: true }, { onConflict: 'card_uid' });
      if (error) return alert(error.message);
      await loadTeacher();
    });
  });

  // desvincular tarjeta -> inactive + sin alumno
  container.querySelectorAll('button[data-unlink-card]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const raw = prompt('UID to unlink (scan or paste):'); if (!raw) return;
      const uid = normalizeUID(raw.trim());
      if (!uid) return alert('UID inválido.');
      const { error } = await sb
        .from('cards')
        .update({ student_id: null, active: false })
        .eq('card_uid', uid);
      if (error) return alert(error.message);
      await loadTeacher();
      alert('Card unlinked.');
    });
  });

  // borrar alumno (Auth + datos)
  container.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-delete'), 10);
      const name = btn.getAttribute('data-name') || 'this student';
      const confirmText = prompt(`Type DELETE to remove ${name} (Auth account + cards + transactions). This cannot be undone.`);
      if (confirmText !== 'DELETE') return;
      try {
        await callEdge('admin_delete_student', { student_id: studentId });
        await loadTeacher();
        alert('Student deleted (Auth + data).');
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Delete failed');
      }
    });
  });
}

// ---------- Teams overview ----------
async function loadTeamsOverview(){
  const box = el('teams-overview');
  if (!box) return;
  box.textContent = 'Loading…';

  try {
    const [{ data: teams }, { data: totals }, { data: rows }] = await Promise.all([
      sb.from('teams').select('id,name,class').order('name', { ascending:true }),
      sb.from('team_balances').select('team_id,points'),
      sb.from('team_member_points').select('team_id,student_id,name,class,points').order('team_id', { ascending:true }).order('name', { ascending:true })
    ]);

    const tmap = new Map();
    (teams || []).forEach(t => tmap.set(t.id, { ...t, total: 0, members: [] }));
    (totals || []).forEach(tb => {
      if (tmap.has(tb.team_id)) tmap.get(tb.team_id).total = tb.points ?? 0;
    });
    (rows || []).forEach(r => {
      if (tmap.has(r.team_id)) tmap.get(r.team_id).members.push(r);
    });

    const html = Array.from(tmap.values()).map(t => `
      <div class="team-box">
        <div class="team-header">
          <div><strong>${t.name}</strong> <span class="muted">(${t.class ?? '—'})</span></div>
          <div><strong>${t.total ?? 0}</strong> pts</div>
        </div>
        <ul>
          ${t.members.map(m => `<li>${m.name} <span class="muted">(${m.class ?? '—'})</span> — <strong>${m.points ?? 0}</strong> pts</li>`).join('')}
        </ul>
      </div>
    `).join('');

    box.classList.remove('muted');
    box.innerHTML = html || '<p class="muted">No teams yet.</p>';
  } catch (e){
    console.error(e);
    box.textContent = 'Error loading overview (RLS/permissions?)';
  }
}

// ---------- Scan UID viewer ----------
(function wireUIDViewer(){
  const input = el('uid-viewer');
  const out = el('uid-output');
  const clearBtn = el('uid-clear');
  if (!input || !out) return;

  function render(){
    const parts = extractUIDs(input.value);
    if (!parts.length){ out.textContent = ''; return; }
    out.innerHTML = parts.map(p => `<div>${p}</div>`).join('');
  }

  input.addEventListener('input', render);
  clearBtn?.addEventListener('click', () => { input.value = ''; out.textContent=''; });
})();

// -------- Arranque --------
handleRecoveryFromHash().finally(refreshUI);
