// --- Supabase client (UMD build cargado en index.html) ---
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -------- Password recovery desde link de email --------
async function handleRecoveryFromHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);

  // Supabase pone #access_token=...&refresh_token=...&type=recovery
  if (params.get('type') === 'recovery' && params.get('access_token')) {
    try {
      // Establecer sesión temporal con el token del enlace
      await sb.auth.setSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
      });

      // Pedir nueva contraseña
      const newPass = prompt('Set a new password (min 6 chars):');
      if (newPass) {
        const { error } = await sb.auth.updateUser({ password: newPass });
        if (error) {
          alert(error.message);
        } else {
          alert('Password updated. Please log in again.');
        }
      }
    } catch (err) {
      console.error(err);
      alert('There was a problem updating your password.');
    } finally {
      // Limpiar hash y cerrar sesión para volver al login
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

// ---------- Auth handlers ----------
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
  // Buscar su fila en students
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

  // Balance actual
  const { data: bal } = await sb
    .from('balances')
    .select('points')
    .eq('student_id', student.id)
    .maybeSingle();
  el('balance').textContent = bal?.points ?? 0;

  // Últimos movimientos
  const { data: txs } = await sb
    .from('transactions')
    .select('delta,reason,created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (txs || [])
    .map(
      (t) =>
        `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${
          t.reason ?? ''
        }</td></tr>`
    )
    .join('');
  el('mytx-table').querySelector('tbody').innerHTML = rows;
}

// ---------- TEACHER ----------
async function loadTeacher() {
  // Últimas transacciones globales (join con students)
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at', { ascending: false })
    .limit(30);

  const rows = (txs || [])
    .map(
      (t) =>
        `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${
          t.students?.name ?? t.student_id
        }</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
    )
    .join('');
  el('tx-table').querySelector('tbody').innerHTML = rows;
}

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

  // Limpiar campos y refrescar lista
  el('identifier').value = '';
  el('reason').value = '';
  loadTeacher();
});

document.querySelectorAll('[data-quick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    el('delta').value = btn.getAttribute('data-quick');
  });
});

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

