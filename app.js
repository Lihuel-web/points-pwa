const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  // ¿Qué rol tiene?
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
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
  // Encuentra su fila en students
  const { data: student, error: e1 } = await sb
    .from('students')
    .select('id,name,class')
    .eq('auth_user_id', userId)
    .single();

  if (e1) {
    el('student-info').textContent = 'Tu cuenta aún no está vinculada a un registro de estudiante. Avísale al profesor.';
    el('balance').textContent = '—';
    el('mytx-table').querySelector('tbody').innerHTML = '';
    return;
  }

  el('student-info').textContent = `${student.name} (${student.class})`;

  // Balance
  const { data: bal } = await sb
    .from('balances')
    .select('points')
    .eq('student_id', student.id)
    .maybeSingle();
  el('balance').textContent = bal?.points ?? 0;

  // Movimientos
  const { data: txs } = await sb
    .from('transactions')
    .select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (txs || []).map(t =>
    `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
  ).join('');
  el('mytx-table').querySelector('tbody').innerHTML = rows;
}

// ---------- TEACHER ----------
async function loadTeacher() {
  // Ultimas transacciones globales
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false })
    .limit(30);
  const rows = (txs || []).map(t =>
    `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.students?.name ?? t.student_id}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
  ).join('');
  el('tx-table').querySelector('tbody').innerHTML = rows;
}

el('award-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const identifier = el('identifier').value.trim();
  const delta = parseInt(el('delta').value, 10);
  const reason = el('reason').value.trim() || null;
  const device = el('device').value.trim() || null;

  const { data, error } = await sb.rpc('award_points', {
    _identifier: identifier,
    _delta: delta,
    _reason: reason,
    _device_id: device
  });
  if (error) return alert(error.message);
  // Limpia UI y recarga lista
  el('identifier').value = '';
  el('reason').value = '';
  loadTeacher();
});

document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    el('delta').value = btn.getAttribute('data-quick');
  });
});

// Arranque
refreshUI();
