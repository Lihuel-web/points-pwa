// app.js — versión con “Create account” y “Record-only” reactivadas

const { createClient } = supabase;
const SUPA_URL = String(window.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window.SUPABASE_ANON_KEY || '').trim();
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);
const text = (id, v) => { const el = $(id); if (el) el.textContent = v; };

async function callEdge(fnName, payload) {
  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch(`${SUPA_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(`${fnName} failed: ${resp.status} ${await resp.text().catch(()=>'')}`);
  return await resp.json();
}

// ---------- Auth ----------
$('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  refreshUI();
});
$('logout')?.addEventListener('click', async () => { await sb.auth.signOut(); refreshUI(); });
$('change-pass')?.addEventListener('click', async () => {
  const p = prompt('New password (min 6 chars):'); if (!p) return;
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return alert(error.message);
  alert('Password updated.');
});

async function refreshUI() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    $('auth').style.display = 'block';
    $('authed').style.display = 'none';
    return;
  }
  $('auth').style.display = 'none';
  $('authed').style.display = 'block';
  text('whoami', user.email);

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role || 'student';
  text('role-badge', role.toUpperCase());

  if (role === 'teacher') {
    $('teacher-panel').style.display = 'block';
    $('student-panel').style.display = 'none';
    await loadTeacher();
  } else {
    $('teacher-panel').style.display = 'none';
    $('student-panel').style.display = 'block';
    await loadStudent(user.id);
  }
}

// ---------- STUDENT ----------
async function loadStudent(userId) {
  const { data: s } = await sb.from('students').select('id,name,class').eq('auth_user_id', userId).maybeSingle();
  if (!s) {
    text('student-info','Your account is not linked to a student record yet. Ask your teacher.');
    return;
  }
  text('student-info', `${s.name ?? 'Unnamed'} (${s.class ?? '—'})`);

  // últimas transacciones
  const { data: txs } = await sb.from('transactions')
    .select('delta,reason,created_at').eq('student_id', s.id)
    .order('created_at',{ascending:false}).limit(50);
  const tbody = $('mytx-body'); if (tbody) {
    tbody.innerHTML = (txs||[]).map(t =>
      `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.delta}</td><td>${t.reason??''}</td></tr>`).join('');
  }

  // Global/local summary para el alumno
  try {
    // local membership
    const { data: tm } = await sb.from('team_members')
      .select('team_id, teams(id,name,parent_global_id)')
      .eq('student_id', s.id).maybeSingle();
    if (!tm?.team_id) return;

    const local = tm.teams;
    text('st-local-name', local?.name || local?.id || '—');

    // global team
    const { data: g } = await sb.from('teams').select('id,name')
      .eq('id', local.parent_global_id).maybeSingle();
    text('st-global-name', g?.name || g?.id || '—');

    // vistas (si existen)
    let pool = 0, spent = 0, rem = 0;
    try {
      const { data: p } = await sb.from('team_pool_balances')
        .select('points').eq('global_id', g.id).maybeSingle();
      pool = p?.points || 0;
    } catch {}
    try {
      const { data: sp } = await sb.from('team_local_spend')
        .select('spent').match({ global_id: g.id, local_id: local.id }).maybeSingle();
      spent = sp?.spent || 0;
    } catch {}
    try {
      const { data: r } = await sb.from('team_local_remaining')
        .select('remaining').match({ global_id: g.id, local_id: local.id }).maybeSingle();
      rem = r?.remaining ?? (pool - spent);
    } catch {
      rem = pool - spent;
    }
    text('st-global-points', pool);
    text('st-local-spent',  spent);
    text('st-local-rem',    rem);
  } catch {}
}

// ---------- TEACHER ----------
$('refresh-overview')?.addEventListener('click', async (e)=>{ e.preventDefault(); await renderTeamsOverview(); });

async function loadTeacher() {
  // últimas tx
  const { data: txs } = await sb.from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at',{ascending:false}).limit(40);

  const tbody = $('tx-table');
  if (tbody) {
    tbody.innerHTML = (txs||[]).map(t =>
      `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.students?.name ?? t.student_id}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`
    ).join('');
  }

  await renderTeamsOverview();
  await loadTeamsUI();
}

// Overview (muestra nombres)
async function renderTeamsOverview() {
  const gp = $('tbl-global-pools'); const ls = $('tbl-local-summary');
  if (!gp) return;
  // global
  let pools=null;
  try {
    const r = await sb.from('team_pool_balances').select('global_id,global_name,points').order('global_name',{ascending:true});
    pools = r.data || null;
  } catch {}
  if (!pools) {
    const { data: globals } = await sb.from('teams').select('id,name').eq('scope','global').order('name',{ascending:true});
    const { data: b } = await sb.from('team_balances').select('team_id,points');
    const m = new Map((b||[]).map(x=>[x.team_id,x.points||0]));
    pools = (globals||[]).map(g=>({ global_id:g.id, global_name:g.name||`Pool ${g.id}`, points:m.get(g.id)||0 }));
  }
  gp.innerHTML = (pools||[]).map(p=>`<tr data-global="${p.global_id}"><td>${p.global_name}</td><td class="right">${p.points}</td></tr>`).join('') || `<tr><td colspan="2">—</td></tr>`;
  gp.querySelectorAll('tr[data-global]').forEach(tr=>{
    tr.addEventListener('click', ()=> renderLocalSummary(parseInt(tr.getAttribute('data-global'),10), tr.cells[0].textContent));
  });
  if ((pools||[]).length) renderLocalSummary(pools[0].global_id, pools[0].global_name);
}
async function renderLocalSummary(globalId, globalName){
  text('local-summary-title', globalName || `Pool ${globalId}`);
  const ls = $('tbl-local-summary'); if (!ls) return;
  let rows=null;
  try {
    const sp = await sb.from('team_local_spend').select('local_id,local_name,spent').eq('global_id',globalId);
    const rm = await sb.from('team_local_remaining').select('local_id,remaining').eq('global_id',globalId);
    const map = new Map((rm.data||[]).map(x=>[x.local_id,x.remaining||0]));
    rows = (sp.data||[]).map(s=>({local_id:s.local_id,local_name:s.local_name,spent:s.spent||0,remaining:map.get(s.local_id)||0}));
  } catch {}
  if (!rows) {
    const { data: locals } = await sb.from('teams').select('id,name').match({scope:'local', parent_global_id: globalId}).order('name',{ascending:true});
    rows = (locals||[]).map(l=>({ local_id:l.id, local_name:l.name, spent:0, remaining:0 }));
  }
  ls.innerHTML = rows.map(r=>`<tr><td>${r.local_name}</td><td class="right">${r.spent}</td><td class="right">${r.remaining}</td></tr>`).join('') || `<tr><td colspan="3">—</td></tr>`;
}

// ------ Gestión de equipos (selects y membresía) ------
async function loadTeamsUI() {
  const selG = $('sel-global'), selL = $('sel-local'), studentPool = $('student-pool');
  if (!selG && !selL && !studentPool) return;

  const { data: globals } = await sb.from('teams').select('id,name').eq('scope','global').order('name',{ascending:true});
  const { data: locals  } = await sb.from('teams').select('id,name,parent_global_id').eq('scope','local').order('name',{ascending:true});
  const { data: students} = await sb.from('students').select('id,name,class').order('name',{ascending:true});

  if (selG) selG.innerHTML = (globals||[]).map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
  if (selL && selG) {
    const gid = parseInt(selG.value||'0',10);
    const locFor = (locals||[]).filter(l => l.parent_global_id === gid);
    selL.innerHTML = locFor.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
    selG.onchange = loadTeamsUI;
  }
  if (studentPool) studentPool.innerHTML = (students||[]).map(s=>`<option value="${s.id}">${s.name} (${s.class??'—'})</option>`).join('');

  await refreshTeamDetails();
}
async function refreshTeamDetails() {
  const selL = $('sel-local'); const ul = $('team-members');
  if (!selL || !ul) return;
  const teamId = parseInt(selL.value||'0',10);
  if (!teamId) { ul.innerHTML=''; return; }
  const { data: members } = await sb.from('team_member_points')
    .select('student_id,name,class,points').eq('team_id',teamId).order('name',{ascending:true});
  ul.innerHTML = (members||[]).map(m => `<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`).join('');
}
$('assign-member')?.addEventListener('click', async ()=>{
  const teamId = parseInt(($('sel-local')?.value||'0'),10);
  const studentId = parseInt(($('student-pool')?.value||'0'),10);
  if (!teamId || !studentId) return;
  await sb.from('team_members').delete().eq('student_id', studentId);
  const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
  if (error) return alert(error.message);
  await refreshTeamDetails();
});
$('remove-member')?.addEventListener('click', async ()=>{
  const teamId = parseInt(($('sel-local')?.value||'0'),10);
  const li = $('team-members')?.querySelector('li[data-student]');
  if (!teamId || !li) return;
  const studentId = parseInt(li.getAttribute('data-student'),10);
  const { error } = await sb.from('team_members').delete().match({ team_id: teamId, student_id: studentId });
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

// ---------- NUEVO: crear cuenta (Edge) ----------
$('create-student-account')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = $('ct-name').value.trim();
  const klass= $('ct-class').value.trim();
  const email= $('ct-email').value.trim();
  const pass = $('ct-pass').value;
  if (!name || !email || pass.length<6) return alert('Completa nombre, email y password ≥6.');
  try {
    const r = await callEdge('admin_create_student', { name, klass, email, password: pass });
    $('ct-name').value = ''; $('ct-class').value=''; $('ct-email').value=''; $('ct-pass').value='';
    await loadTeacher();
    alert(`Account created: ${r?.student?.name || name}`);
  } catch(err){
    const msg = String(err?.message||'');
    if (msg.includes(' 409 ') || /already been registered/i.test(msg)) {
      alert('Ese email ya está registrado.');
    } else {
      alert(msg);
    }
  }
});

// ---------- NUEVO: alta record-only ----------
(function wireRecordOnly(){
  const form = $('new-student-form'); if (!form) return;
  if (form.dataset.wired==='1') return; form.dataset.wired='1';
  let busy=false;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); if (busy) return; busy=true;
    const btn = $('ns-create-btn'); btn?.setAttribute('disabled','disabled');
    try{
      const name = $('ns-name').value.trim();
      const klass= $('ns-class').value.trim();
      const card = $('ns-card').value.trim();
      if (!name) throw new Error('Name is required');
      const { data: ins, error: e1 } = await sb.from('students').insert([{ name, class: (klass||null) }]).select('id').single();
      if (e1) throw e1;
      if (card) {
        const { error: e2 } = await sb.from('cards').upsert(
          { student_id: ins.id, card_uid: card, active: true, card_role: 'student' },
          { onConflict: 'card_uid' }
        );
        if (e2) throw e2;
      }
      $('ns-name').value=''; $('ns-class').value=''; $('ns-card').value='';
      await loadTeacher();
      alert('Student created.');
    } catch(err){
      alert(err?.message||'Insert failed');
    } finally {
      busy=false; btn?.removeAttribute('disabled');
    }
  });
})();

// ---------- Arranque ----------
window.addEventListener('load', refreshUI);


