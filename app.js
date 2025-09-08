// app.js — versión robusta (sincrónica, no módulos)

// ====== Utilidades mínimas ======
(function () {
  const $ = (id) => document.getElementById(id);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const html = (el, s) => { if (el) el.innerHTML = s; };
  const text = (el, s) => { if (el) el.textContent = s; };

  function fatal(msg, more) {
    console.error('[FATAL]', msg, more || '');
    let box = document.getElementById('fatal-overlay');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatal-overlay';
      box.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.65); color:#fff;
        display:flex; align-items:center; justify-content:center; z-index:99999; padding:24px;
        font:14px/1.4 system-ui,Segoe UI,Arial;
      `;
      document.body.appendChild(box);
    }
    box.innerHTML = `
      <div style="max-width:720px; background:#111; border-radius:12px; padding:20px; border:1px solid #333;">
        <h3 style="margin:0 0 8px 0; font-size:18px">There was a startup error</h3>
        <div style="opacity:.9">${String(msg)}</div>
        ${more ? `<pre style="white-space:pre-wrap;background:#000;padding:10px;border-radius:8px;margin-top:10px">${String(more)}</pre>` : ''}
        <div style="margin-top:10px; font-size:12px; opacity:.8">Tip: abre DevTools → Console para ver el detalle.</div>
      </div>
    `;
  }

  // ====== Validación de SDK Supabase ======
  const SUPA_URL = (window && window.SUPABASE_URL) || '';
  const SUPA_KEY = (window && window.SUPABASE_ANON_KEY) || '';

  if (!window.supabase) {
    fatal("El SDK UMD de Supabase no está disponible en 'window.supabase'.",
      "Revisa que esté este tag ANTES de app.js:\n" +
      `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>`
    );
    return;
  }
  if (!/^https?:\/\//.test(SUPA_URL) || !SUPA_KEY) {
    fatal("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en window.*",
      "Asegúrate de tener en index.html:\n" +
      `<script>window.SUPABASE_URL="https://xxxx.supabase.co";window.SUPABASE_ANON_KEY="...";</script>`
    );
    return;
  }

  const { createClient } = window.supabase;
  const sb = createClient(SUPA_URL, SUPA_KEY);

  // ====== Elementos que pueden o no existir (no tronamos si no están) ======
  const authSec        = $('auth');
  const authedSec      = $('authed');
  const whoami         = $('whoami');
  const roleBadge      = $('role-badge');
  const teacherPanel   = $('teacher-panel');
  const studentPanel   = $('student-panel');

  // ====== Login / Logout / Change pass ======
  on($('login-form'), 'submit', async (e) => {
    e.preventDefault();
    try {
      const email = $('email')?.value?.trim();
      const password = $('password')?.value || '';
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return alert(error.message);
      await refreshUI(true);
    } catch (err) {
      alert(String(err?.message || err));
    }
  });

  on($('logout'), 'click', async () => {
    await sb.auth.signOut();
    await refreshUI(true);
  });

  on($('change-pass'), 'click', async () => {
    const p = prompt('New password (min 6 chars):');
    if (!p) return;
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return alert(error.message);
    alert('Password updated.');
  });

  // ====== Password recovery desde hash ======
  async function handleRecoveryFromHash() {
    const h = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const q = new URLSearchParams(h);
    if (q.get('type') === 'recovery' && q.get('access_token')) {
      try {
        await sb.auth.setSession({
          access_token: q.get('access_token'),
          refresh_token: q.get('refresh_token'),
        });
        const np = prompt('Set a new password (min 6 chars):');
        if (np) {
          const { error } = await sb.auth.updateUser({ password: np });
          if (error) alert(error.message);
          else alert('Password updated. Please log in again.');
        }
      } catch (e) {
        console.error(e);
      } finally {
        history.replaceState({}, document.title, location.pathname);
        await sb.auth.signOut();
      }
    }
  }

  // ====== Carga de UI por rol ======
  async function refreshUI(force) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        if (authSec)  authSec.style.display = 'block';
        if (authedSec) authedSec.style.display = 'none';
        return;
      }
      if (authSec)  authSec.style.display = 'none';
      if (authedSec) authedSec.style.display = 'block';
      if (whoami) whoami.textContent = user.email || user.id;

      const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = prof?.role || 'student';
      if (roleBadge) roleBadge.textContent = role.toUpperCase();

      if (role === 'teacher') {
        if (teacherPanel) teacherPanel.style.display = 'block';
        if (studentPanel) studentPanel.style.display = 'none';
        await loadTeacher(force);
      } else {
        if (teacherPanel) teacherPanel.style.display = 'none';
        if (studentPanel) studentPanel.style.display = 'block';
        await loadStudent(user.id, force);
      }
    } catch (e) {
      fatal('refreshUI() lanzó un error', e?.message || e);
    }
  }

  // ====== STUDENT ======
  async function loadStudent(userId, force) {
    try {
      const { data: s } = await sb.from('students')
        .select('id,name,class')
        .eq('auth_user_id', userId).maybeSingle();

      if (!s) {
        text($('student-info'), 'Your account is not linked to a student record yet. Ask your teacher.');
        text($('balance'), '—');
        html($('mytx-table')?.querySelector('tbody'), '');
        text($('team-info'), 'No team assigned.');
        text($('my-team-balance'), '—');
        html($('my-team-members'), '');
        return;
      }

      text($('student-info'), `${s.name ?? 'Unnamed'} (${s.class ?? '—'})`);

      // Balance individual
      const { data: bal } = await sb.from('balances')
        .select('points').eq('student_id', s.id).maybeSingle();
      text($('balance'), bal?.points ?? 0);

      // Tx del alumno
      const { data: txs } = await sb.from('transactions')
        .select('delta,reason,created_at')
        .eq('student_id', s.id)
        .order('created_at', { ascending: false }).limit(50);

      const mt = $('mytx-table')?.querySelector('tbody');
      if (mt) {
        mt.innerHTML = (txs || []).map(t =>
          `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
        ).join('');
      }

      // Equipo (si existe)
      try {
        const { data: tm } = await sb
          .from('team_members')
          .select('team_id, teams(name,class)')
          .eq('student_id', s.id).maybeSingle();

        if (!tm?.team_id) {
          text($('team-info'), 'No team assigned.');
          text($('my-team-balance'), '—');
          html($('my-team-members'), '');
          return;
        }

        text($('team-info'), `${tm.teams?.name ?? tm.team_id} (${tm.teams?.class ?? '—'})`);

        const { data: tbal } = await sb.from('team_balances')
          .select('points').eq('team_id', tm.team_id).maybeSingle();
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
        // si no hay esquema de equipos, ignoramos
      }
    } catch (e) {
      console.error('loadStudent()', e);
    }
  }

  // ====== TEACHER ======
  async function loadTeacher(force) {
    try {
      // Últimas transacciones (con scroll si hay un contenedor con id tx-table)
      const { data: txs } = await sb
        .from('transactions')
        .select('student_id,delta,reason,created_at,students!inner(name)')
        .order('created_at', { ascending: false }).limit(40);

      const tbody = $('tx-table')?.querySelector('tbody');
      if (tbody) {
        tbody.innerHTML = (txs || []).map(t => `
          <tr>
            <td>${new Date(t.created_at).toLocaleString()}</td>
            <td>${t.students?.name ?? t.student_id}</td>
            <td>${t.delta}</td>
            <td>${t.reason ?? ''}</td>
          </tr>
        `).join('');
      }

      // Overview de equipos (si tus vistas existen; si no, no crashea)
      await renderTeamsOverview();

      // También recarga listas si existen en el DOM (asignación por alumno / equipos)
      await loadTeamsUI();
      await loadStudentsList();  // no crashea si no existe el contenedor
    } catch (e) {
      console.error('loadTeacher()', e);
    }
  }

  // ====== Overview (nombres, no IDs) ======
  async function renderTeamsOverview() {
    const gpTbody = $('tbl-global-pools');         // <tbody id="tbl-global-pools">
    const locTbody = $('tbl-local-summary');       // <tbody id="tbl-local-summary">
    const locTitle = $('local-summary-title');     // <span id="local-summary-title">

    if (!gpTbody) return; // el HTML puede no tener esta sección

    try {
      // Intento 1: vista materializada/normal (si existe)
      let pools = null;
      try {
        const r = await sb.from('team_pool_balances')
          .select('global_id, global_name, points')
          .order('global_name', { ascending: true });
        pools = r.data || null;
      } catch { /* vista no existe */ }

      // Intento 2: derivarlo con teams(scope='global') + alguna view de puntos
      if (!pools) {
        const { data: globals } = await sb.from('teams')
          .select('id,name,scope').eq('scope', 'global').order('name', { ascending: true });
        const { data: b } = await sb.from('team_balances')
          .select('team_id,points');

        const map = new Map((b || []).map(x => [x.team_id, x.points || 0]));
        pools = (globals || []).map(g => ({
          global_id: g.id,
          global_name: g.name || `Pool ${g.id}`,
          points: map.get(g.id) || 0
        }));
      }

      // Render globales
      gpTbody.innerHTML = (pools || []).map(p => `
        <tr data-global="${p.global_id}">
          <td>${p.global_name}</td>
          <td style="text-align:right">${p.points}</td>
        </tr>
      `).join('') || `<tr><td colspan="2">No global pools</td></tr>`;

      // Click para ver locales del pool
      gpTbody.querySelectorAll('tr[data-global]').forEach(tr => {
        tr.addEventListener('click', async () => {
          const gid = parseInt(tr.getAttribute('data-global'), 10);
          await renderLocalSummary(gid, tr.cells[0]?.textContent || `Pool ${gid}`);
        });
      });

      // Selecciona el primero por defecto
      if ((pools || []).length) {
        await renderLocalSummary(pools[0].global_id, pools[0].global_name);
      } else if (locTbody) {
        locTbody.innerHTML = `<tr><td colspan="3">—</td></tr>`;
        text(locTitle, '—');
      }
    } catch (e) {
      console.error('renderTeamsOverview()', e);
    }
  }

  async function renderLocalSummary(globalId, globalName) {
    const locTbody = $('tbl-local-summary');
    const locTitle = $('local-summary-title');
    if (!locTbody) return;

    text(locTitle, globalName || `Pool ${globalId}`);

    try {
      // Intento 1: vistas si existen
      let rows = null;
      try {
        const spend = await sb.from('team_local_spend')
          .select('local_id, local_name, spent')
          .eq('global_id', globalId);
        const remaining = await sb.from('team_local_remaining')
          .select('local_id, remaining')
          .eq('global_id', globalId);

        const remMap = new Map((remaining.data || [])
          .map(x => [x.local_id, x.remaining || 0]));

        rows = (spend.data || []).map(s => ({
          local_id: s.local_id,
          local_name: s.local_name,
          spent: s.spent || 0,
          remaining: remMap.get(s.local_id) || 0
        }));
      } catch { /* no existen vistas */ }

      // Intento 2: derivado con tablas base
      if (!rows) {
        const { data: locals } = await sb.from('teams')
          .select('id,name,parent_global_id')
          .eq('parent_global_id', globalId)
          .order('name', { ascending: true });

        // Gastos = sum(delta negativos) por cada local (si tu modelo los guarda así)
        // Si no existe esa medida, mostramos 0 y el “remaining” igual al global (placeholder).
        rows = (locals || []).map(t => ({
          local_id: t.id,
          local_name: t.name || `Local ${t.id}`,
          spent: 0,
          remaining: 0
        }));
      }

      locTbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.local_name}</td>
          <td style="text-align:right">${r.spent}</td>
          <td style="text-align:right">${r.remaining}</td>
        </tr>
      `).join('') || `<tr><td colspan="3">No local teams</td></tr>`;
    } catch (e) {
      console.error('renderLocalSummary()', e);
    }
  }

  // ====== Gestión de equipos (si existe UI) ======
  async function loadTeamsUI() {
    // poblar selects si existen
    const selGlobal = $('sel-global');
    const selLocal  = $('sel-local');
    const selPoolStudents = $('student-pool'); // reuso si existe

    if (!selGlobal && !selLocal && !selPoolStudents) return;

    try {
      const { data: globals } = await sb.from('teams')
        .select('id,name,scope').eq('scope','global').order('name',{ascending:true});
      const { data: locals } = await sb.from('teams')
        .select('id,name,parent_global_id,scope').eq('scope','local').order('name',{ascending:true});
      const { data: students } = await sb.from('students')
        .select('id,name,class').order('name',{ascending:true});

      if (selGlobal) {
        selGlobal.innerHTML = (globals || []).map(g =>
          `<option value="${g.id}">${g.name}</option>`).join('');
      }
      if (selLocal && selGlobal) {
        const gid = parseInt(selGlobal.value || '0', 10);
        const localsFor = (locals || []).filter(l => l.parent_global_id === gid);
        selLocal.innerHTML = localsFor.map(l =>
          `<option value="${l.id}">${l.name}</option>`).join('');
        selGlobal.addEventListener('change', () => loadTeamsUI());
      }
      if (selPoolStudents) {
        selPoolStudents.innerHTML = (students || []).map(s =>
          `<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
      }
    } catch (e) {
      console.error('loadTeamsUI()', e);
    }
  }

  // ====== Lista de alumnos (si el contenedor existe) ======
  on($('reload-students'), 'click', loadStudentsList);
  on($('class-filter'), 'change', loadStudentsList);
  on($('search-name'), 'input', () => {
    clearTimeout(loadStudentsList._t);
    loadStudentsList._t = setTimeout(loadStudentsList, 200);
  });

  async function loadStudentsList() {
    const container = $('students-list');
    if (!container) return;

    const cls = ($('class-filter')?.value || '').trim();
    const q   = ($('search-name')?.value || '').trim().toLowerCase();

    try {
      let query = sb.from('students').select('id,name,class');
      if (cls) query = query.ilike('class', `${cls}%`);
      if (q)   query = query.ilike('name', `%${q}%`);
      query = query.order('class', { ascending: true }).order('name', { ascending: true });

      const { data: students, error } = await query;
      if (error) throw error;

      if (!students?.length) {
        container.innerHTML = '<p class="muted">No students found for this filter.</p>';
        return;
      }

      // balances en lote
      const ids = students.map(s => s.id);
      const balMap = new Map();
      if (ids.length) {
        const { data: bals } = await sb.from('balances').select('student_id,points').in('student_id', ids);
        (bals || []).forEach(b => balMap.set(b.student_id, b.points || 0));
      }

      container.innerHTML = students.map(s => {
        const pts = balMap.get(s.id) ?? 0;
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
                <button data-unlink-card="${s.id}">Unlink</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // otorga por alumno
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
          const { error } = await sb.rpc('award_points_by_student', {
            _student_id: studentId, _delta: delta, _reason: reason, _device_id: 'web-teacher',
          });
          if (error) return alert(error.message);
          await loadTeacher(true);
        });
      });

      // link/unlink tarjeta
      container.querySelectorAll('button[data-link-card]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const studentId = parseInt(btn.getAttribute('data-link-card'), 10);
          const card = prompt('Card UID:'); if (!card) return;
          const { error } = await sb.from('cards').upsert(
            { student_id: studentId, card_uid: card.trim(), active: true, card_role: 'student' },
            { onConflict: 'card_uid' }
          );
          if (error) return alert(error.message);
          await loadTeacher(true);
        });
      });
      container.querySelectorAll('button[data-unlink-card]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const studentId = parseInt(btn.getAttribute('data-unlink-card'), 10);
          const uid = prompt('UID to unlink (exact):'); if (!uid) return;
          const { error } = await sb.from('cards')
            .update({ active:false, student_id:null })
            .eq('student_id', studentId).eq('card_uid', uid.trim());
          if (error) return alert(error.message);
          await loadTeacher(true);
        });
      });

    } catch (e) {
      console.error('loadStudentsList()', e);
    }
  }

  // ====== Arranque seguro ======
  window.addEventListener('load', async () => {
    try {
      await handleRecoveryFromHash();
      await refreshUI(true);

      // Auto-refresh leve (no agresivo)
      setInterval(() => refreshUI(false), 10_000);
    } catch (e) {
      fatal('Fallo al iniciar la app', e?.message || e);
    }
  });

})();

