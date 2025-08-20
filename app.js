// --- Supabase client (UMD build cargado en index.html) ---
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function refreshUI() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    authSec.style.display = 'block';
    authedSec.style.display = 'none';
    return;
  }

  authSec.style.display = 'none';
  authedSec.style.display = 'block';
  whoami.textContent = `${user.email}`;

  // Rol (profiles.role)
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = profile?.role || 'student';

  if (role === 'teacher') {
    teacherPanel.style.display = 'block';
    studentPanel.style.display = 'none';
    loadTeacher();
  } else {
    teacherPanel.style.display = 'none';
    studentPanel.style.display = 'block';
    loadStudent(user.id);
  }
}

// ---------- Auth ----------
el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('email').value.trim();
  const password = el('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  refreshUI();
});

el('logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  refreshUI();
});

// ---------- STUDENT ----------
async function loadStudent(userId) {
  const { data: student, error: e1 } = await sb
    .from('students')
    .select('id,name,class')
    .eq('auth_user_id', userId)
    .single();

  if (e1) {
    el('student-info').textContent =
      'Your account is not linked to a student record yet. Ask your teacher.';
    el('balance').textContent = '—';
    el('mytx-table').querySelector('tbody').innerHTML = '';
    return;
  }

  el('student-info').textContent = `${student.name} (${student.class})`;

  const { data: bal } = await sb
    .from('balances')
    .select('points')
    .eq('student_id', student.id)
    .maybeSingle();
  el('balance').textContent = bal?.points ?? 0;

  const { data: txs } = await sb
    .from('transactions')
    .select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (txs || [])
    .map(t => `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`)
    .join('');
  el('mytx-table').querySelector('tbody').innerHTML = rows;
}

// ---------- TEACHER ----------
async function loadTeacher() {
  // Últimas transacciones globales
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false })
    .limit(30);
  const rows = (txs || []).map(t =>
    `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.students?.name ?? t.student_id}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
  ).join('');
  el('tx-table').querySelector('tbody').innerHTML = rows;

  // Carga la lista de alumnos (por si ya hay filtros puestos)
  await loadStudentsList();
}

// Form de asignación por IDENTIFICADOR (función existente)
el('award-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const identifier = el('identifier').value.trim();
  const delta = parseInt(el('delta').value, 10);
  const reason = el('reason').value.trim() || null;
  const device = el('device').value.trim() || null;

  const { error } = await sb.rpc('award_points', {
    _identifier: identifier,
    _delta: delta,
    _reason: reason,
    _device_id: device,
  });
  if (error) return alert(error.message);
  el('identifier').value = '';
  el('reason').value = '';
  loadTeacher();
});

// Botones rápidos (IDENTIFICADOR)
document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    el('delta').value = btn.getAttribute('data-quick');
  });
});

// --------- Asignación por ALUMNO (sin tarjeta) ---------
el('reload-students')?.addEventListener('click', loadStudentsList);
el('class-filter')?.addEventListener('change', loadStudentsList);
el('search-name')?.addEventListener('input', () => {
  // debounce sencillo
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
  if (!students || students.length === 0) {
    container.innerHTML = '<p class="muted">No students found for this filter.</p>';
    return;
  }

  // Para cada alumno, leemos el balance actual (rápido por ser pocos; optimizable con join/vista)
  const balances = {};
  const ids = students.map(s => s.id);
  if (ids.length > 0) {
    const { data: bals } = await sb.from('balances').select('student_id,points').in('student_id', ids);
    (bals || []).forEach(b => { balances[b.student_id] = b.points; });
  }

  container.innerHTML = students.map(s => {
    const pts = balances[s.id] ?? 0;
    return `
      <div class="card" style="margin:8px 0; padding:12px">
        <div class="row" style="justify-content:space-between">
          <div><strong>${s.name}</strong> <span class="muted">(${s.class})</span> — <strong>${pts}</strong> pts</div>
          <div class="row">
            <button data-award="+1" data-student="${s.id}">+1</button>
            <button data-award="+3" data-student="${s.id}">+3</button>
            <button data-award="-1" data-student="${s.id}">-1</button>
            <button data-award="-5" data-student="${s.id}">-5</button>
            <button data-award="custom" data-student="${s.id}">Custom…</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Enlazar eventos
  container.querySelectorAll('button[data-award]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = parseInt(btn.getAttribute('data-student'), 10);
      let delta;
      const t = btn.getAttribute('data-award');
      if (t === 'custom') {
        const val = prompt('Δ points (e.g., 2 or -3):');
        if (!val) return;
        delta = parseInt(val, 10);
        if (isNaN(delta)) return alert('Invalid number');
      } else {
        delta = parseInt(t, 10);
      }
      const reason = prompt('Reason (optional):') || null;
      const device = 'web-teacher';
      const { error } = await sb.rpc('award_points_by_student', {
        _student_id: studentId,
        _delta: delta,
        _reason: reason,
        _device_id: device,
      });
      if (error) return alert(error.message);
      // refrescar vista
      await loadTeacher();
    });
  });
}

// Cambiar contraseña manual desde la app (opcional)
el('change-pass')?.addEventListener('click', async () => {
  const newPass = prompt('New password (min. 6 characters):');
  if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and sign back in.');
});

// -------- Arranque --------
handleRecoveryFromHash().finally(refreshUI);

