// app.js — Westhill build (teacher: alta alumnos + asignación a local, student: pool/spent/remaining)

const { createClient } = supabase;
const SUPA_URL = String(window.SUPABASE_URL || "").trim();
const SUPA_KEY = String(window.SUPABASE_ANON_KEY || "").trim();
if (!/^https?:\/\//.test(SUPA_URL) || !SUPA_KEY) {
  alert("Config error: revisa SUPABASE_URL / SUPABASE_ANON_KEY en index.html");
}
const sb = createClient(SUPA_URL, SUPA_KEY);

const $  = (id) => document.getElementById(id);
const show = (el, on=true) => el && (el.classList.toggle('hidden', !on));
const text = (el, t) => el && (el.textContent = t);
const POLL_MS = 5000;
let _polls = [];
function startPoller(fn, ms=POLL_MS){ const h=setInterval(()=>fn().catch(()=>{}),ms); _polls.push(h); }
function clearPollers(){ _polls.forEach(clearInterval); _polls=[]; }
const fmtDate = (s)=>{ try{ return new Date(s).toLocaleString(); }catch{ return s; } };
const normalizeUID = (s)=> (s||'').toUpperCase().replace(/[^0-9A-F]/g,'');

// ---------- Auth ----------
$('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return alert(error.message);
  await refreshUI();
});
$('logout')?.addEventListener('click', async () => { await sb.auth.signOut(); clearPollers(); await refreshUI(); });
$('change-pass')?.addEventListener('click', async () => {
  const newPass = prompt('New password (min. 6 characters):'); if (!newPass) return;
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return alert(error.message);
  alert('Password updated. Sign out and sign back in.');
});

// recovery
async function handleRecoveryFromHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const p = new URLSearchParams(hash);
  if (p.get('type') === 'recovery' && p.get('access_token')) {
    try {
      await sb.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
      const np = prompt('Set a new password (min 6 chars):');
      if (np) {
        const { error } = await sb.auth.updateUser({ password: np });
        if (error) alert(error.message); else alert('Password updated. Please log in again.');
      }
    } finally {
      history.replaceState({}, document.title, location.pathname);
      await sb.auth.signOut();
    }
  }
}

// ---------- Role-aware UI ----------
async function refreshUI(){
  const { data:{ user } } = await sb.auth.getUser();
  show($('auth'), !user); show($('authed'), !!user);
  if (!user) return;
  text($('whoami'), user.email || '');
  const { data: prof, error } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) { alert('Error loading profile'); return; }
  const role = prof?.role || 'student';
  text($('role-badge'), role.toUpperCase());
  clearPollers();
  if (role === 'teacher') {
    show($('teacher-panel'), true); show($('student-panel'), false);
    await loadTeacher();
    startPoller(loadLatestTransactions);
    startPoller(refreshTeamOverview);
  } else {
    show($('teacher-panel'), false); show($('student-panel'), true);
    await loadStudent(user.id);
    startPoller(()=>loadStudent(user.id));
  }
}

// ---------- STUDENT ----------
async function loadStudent(userId){
  const { data: student } = await sb.from('students').select('id,name,class').eq('auth_user_id', userId).maybeSingle();
  if (!student) {
    text($('student-info'), 'Your account is not linked to a student record yet. Ask your teacher.');
    text($('balance'),'—'); text($('pool-points'),'—'); text($('local-spent'),'—'); text($('local-remaining'),'—');
    $('my-team-members').innerHTML=''; text($('team-info'),'—');
    $('mytx-table').querySelector('tbody').innerHTML='';
    return;
  }
  text($('student-info'), `${student.name ?? 'Unnamed'} (${student.class ?? '—'})`);

  // balance individual
  const { data: bal } = await sb.from('balances').select('points').eq('student_id', student.id).maybeSingle();
  text($('balance'), bal?.points ?? 0);

  // movimientos individuales
  const { data: txs } = await sb
    .from('transactions').select('delta,reason,created_at')
    .eq('student_id', student.id).order('created_at', { ascending:false }).limit(50);
  $('mytx-table').querySelector('tbody').innerHTML = (txs||[]).map(t=>
    `<tr><td>${fmtDate(t.created_at)}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`).join('');

  // equipo local + pool global + remaining
  const { data: tm } = await sb.from('team_members').select('team_id').eq('student_id', student.id).maybeSingle();
  if (!tm?.team_id) { text($('team-info'),'No team assigned.'); $('my-team-members').innerHTML=''; text($('pool-points'),'—'); text($('local-spent'),'—'); text($('local-remaining'),'—'); return; }

  const { data: local } = await sb.from('teams').select('id,name,class,scope,parent_global_id').eq('id', tm.team_id).maybeSingle();
  if (!local) { text($('team-info'),'No team assigned.'); return; }

  let poolId = local.parent_global_id || null;
  let globalInfo = '';
  if (poolId) {
    const { data: g } = await sb.from('teams').select('id,name,class').eq('id', poolId).maybeSingle();
    globalInfo = g ? `${g.name} (${g.class ?? '—'})` : `Pool ${poolId}`;
  } else {
    globalInfo = '(no global parent)';
  }
  text($('team-info'), `Local: ${local.name} (${local.class ?? '—'}) — Global: ${globalInfo}`);

  // miembros del local
  const { data: members } = await sb
    .from('team_member_points')
    .select('student_id,name,class,points')
    .eq('team_id', local.id).order('name',{ascending:true});
  $('my-team-members').innerHTML = (members||[]).map(m=>`<li>${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`).join('');

  // pool global / spent local / remaining
  if (poolId){
    const { data: pool } = await sb.from('team_pool_balances').select('points').eq('pool_team_id', poolId).maybeSingle();
    text($('pool-points'), pool?.points ?? 0);

    const { data: lr } = await sb.from('team_local_remaining')
      .select('spent_by_local,pool_remaining')
      .eq('local_team_id', local.id).maybeSingle();
    text($('local-spent'), lr?.spent_by_local ?? 0);
    text($('local-remaining'), lr?.pool_remaining ?? 0);
  } else {
    text($('pool-points'),'—'); text($('local-spent'),'—'); text($('local-remaining'),'—');
  }
}

// ---------- TEACHER ----------
async function loadTeacher(){
  await loadLatestTransactions();
  await loadTeamsUI();
  await loadTeamAdjustOptions();
  await refreshTeamOverview();
  await loadCardSelects();
}

// últimas transacciones
async function loadLatestTransactions(){
  const { data: txs } = await sb
    .from('transactions')
    .select('student_id,delta,reason,created_at,students!inner(name)')
    .order('created_at',{ascending:false}).limit(30);
  $('tx-table').querySelector('tbody').innerHTML = (txs||[]).map(t=>
    `<tr><td>${fmtDate(t.created_at)}</td><td>${t.students?.name ?? t.student_id}</td><td>${t.delta}</td><td>${t.reason ?? ''}</td></tr>`).join('');
}

// Equipos: cargar selects/listas
async function loadTeamsUI(){
  // parent global para crear locales
  const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name',{ascending:true});
  $('parent-global').innerHTML = `<option value="">(none)</option>` + (globals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

  // selector de equipo LOCAL para asignación de alumnos
  const { data: locals } = await sb.from('teams').select('id,name,class').eq('scope','local').order('name',{ascending:true});
  $('team-select').innerHTML = (locals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');

  // pool de alumnos
  const { data: students } = await sb.from('students').select('id,name,class').order('name',{ascending:true});
  $('student-pool').innerHTML = (students||[]).map(s=>`<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');

  await refreshTeamDetails();
}
$('reload-teams')?.addEventListener('click', loadTeamsUI);
$('team-select')?.addEventListener('change', refreshTeamDetails);

async function refreshTeamDetails(){
  const teamId = parseInt(($('team-select').value||'0'),10);
  if (!teamId){ $('team-members').innerHTML=''; text($('team-balance'),'—'); return; }

  const { data: members } = await sb
    .from('team_member_points')
    .select('student_id,name,class,points')
    .eq('team_id', teamId).order('name',{ascending:true});
  $('team-members').innerHTML = (members||[]).map(m=>`<li data-student="${m.student_id}">${m.name} (${m.class ?? '—'}) — <strong>${m.points ?? 0}</strong> pts</li>`).join('');

  const { data: tbal } = await sb.from('team_balances').select('points').eq('team_id', teamId).maybeSingle();
  text($('team-balance'), tbal?.points ?? 0);
}

$('new-team-form')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = $('team-name').value.trim();
  const klass = ($('team-class').value||'').trim();
  const scope = $('team-scope').value || 'global';
  const parent = parseInt(($('parent-global').value||'0'),10) || null;
  if (!name) return alert('Team name is required.');
  if (scope==='local' && !parent) return alert('Local teams require a parent Global.');

  const row = scope==='local' ? { name, class: klass||null, scope:'local', parent_global_id: parent }
                              : { name, class: klass||null, scope:'global', parent_global_id: null };
  const { error } = await sb.from('teams').insert([row]);
  if (error) return alert(error.message);
  $('team-name').value=''; $('team-class').value='';
  await loadTeamsUI();
});

$('delete-team')?.addEventListener('click', async ()=>{
  const teamId = parseInt(($('team-select').value||'0'),10);
  if (!teamId) return;
  if (!confirm('Delete this team? This removes memberships but not student records or transactions.')) return;
  const { error } = await sb.from('teams').delete().eq('id', teamId);
  if (error) return alert(error.message);
  await loadTeamsUI();
});

$('assign-member')?.addEventListener('click', async ()=>{
  const teamId = parseInt(($('team-select').value||'0'),10);
  const studentId = parseInt(($('student-pool').value||'0'),10);
  if (!teamId || !studentId) return;
  await sb.from('team_members').delete().eq('student_id', studentId);
  const { error } = await sb.from('team_members').insert([{ team_id: teamId, student_id: studentId }]);
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

$('remove-member')?.addEventListener('click', async ()=>{
  const teamId = parseInt(($('team-select').value||'0'),10);
  const li = $('team-members')?.querySelector('li[data-student]');
  if (!teamId) return;
  const studentId = li ? parseInt(li.getAttribute('data-student'),10) : null;
  if (!studentId) return alert('Selecciona un miembro (o implementa selección). Por ahora removerá el primero.');
  const { error } = await sb.from('team_members').delete().match({ team_id: teamId, student_id: studentId });
  if (error) return alert(error.message);
  await refreshTeamDetails();
});

// ---------- Crear cuentas y alta record-only ----------
async function callEdge(fnName, payload){
  const { data:{ session } } = await sb.auth.getSession();
  const resp = await fetch(`${SUPA_URL}/functions/v1/${fnName}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', ...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}) },
    body: JSON.stringify(payload)
  });
  if (!resp.ok){ const t = await resp.text().catch(()=> ''); throw new Error(`${fnName} failed: ${resp.status} ${t}`); }
  return await resp.json();
}

$('create-student-account')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = $('ct-name').value.trim();
  const klass = ($('ct-class').value||'').trim();
  const email = $('ct-email').value.trim();
  const pass = $('ct-pass').value;
  if (!name || !email || pass.length<6) return alert('Completa nombre, email y password ≥6.');
  try{
    const r = await callEdge('admin_create_student',{ name, klass, email, password: pass });
    $('ct-name').value=''; $('ct-class').value=''; $('ct-email').value=''; $('ct-pass').value='';
    await loadTeacher();
    alert(`Account created: ${r?.student?.name || name}`);
  }catch(err){
    const msg = String(err?.message||'');
    if (msg.includes(' 409 ') || /already been registered/i.test(msg)) alert('Ese email ya está registrado.');
    else alert(msg);
  }
});

(function wireRecordOnlyForm(){
  const form = $('new-student-form'); if (!form || form.dataset.wired==='1') return; form.dataset.wired='1';
  let busy=false;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); if (busy) return; busy=true;
    const btn = $('ns-create-btn'); btn?.setAttribute('disabled','disabled');
    const name = ($('ns-name')?.value||'').trim();
    const klass= ($('ns-class')?.value||'').trim();
    const card = normalizeUID(($('ns-card')?.value||'').trim());
    if (!name){ alert('Name is required.'); btn?.removeAttribute('disabled'); busy=false; return; }
    try{
      const { data: ins, error: e1 } = await sb.from('students').insert([{ name, class: klass||null }]).select('id').single();
      if (e1) throw e1;
      if (card){
        const { error: e2 } = await sb.from('cards').upsert(
          { student_id: ins.id, team_id: null, card_role: 'student', card_uid: card, active: true },
          { onConflict: 'card_uid' }
        ); if (e2) throw e2;
      }
      $('ns-name').value=''; $('ns-class').value=''; $('ns-card').value='';
      await loadTeacher();
      alert('Student created.');
    }catch(err){ alert(err?.message || 'Insert failed'); }
    finally{ busy=false; btn?.removeAttribute('disabled'); }
  });
})();

// ---------- Vincular tarjetas ----------
async function loadCardSelects(){
  const { data: students } = await sb.from('students').select('id,name,class').order('name',{ascending:true});
  $('card-student').innerHTML = (students||[]).map(s=>`<option value="${s.id}">${s.name} (${s.class ?? '—'})</option>`).join('');
  await reloadTeamOptionsForCard();
}
async function reloadTeamOptionsForCard(){
  const role = $('card-role').value;
  if (role==='team_earn'){
    const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name',{ascending:true});
    $('card-team').innerHTML = (globals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
  } else {
    const { data: locals } = await sb.from('teams').select('id,name,class').eq('scope','local').order('name',{ascending:true});
    $('card-team').innerHTML = (locals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
  }
}
$('card-role')?.addEventListener('change', reloadTeamOptionsForCard);

$('link-card-student')?.addEventListener('click', async ()=>{
  const studentId = parseInt(($('card-student').value||'0'),10);
  const uid = normalizeUID($('card-uid-stu').value);
  if (!studentId || !uid) return alert('Student + UID required');
  const { error } = await sb.from('cards').upsert(
    { card_uid: uid, student_id: studentId, team_id: null, card_role: 'student', active: true },
    { onConflict: 'card_uid' }
  );
  if (error) return alert(error.message);
  $('card-uid-stu').value=''; alert('Card linked to student.');
});

$('unlink-card-student')?.addEventListener('click', async ()=>{
  const uid = normalizeUID($('card-uid-stu').value); if (!uid) return alert('UID required');
  const { error } = await sb.from('cards').update({ active: false }).eq('card_uid', uid);
  if (error) return alert(error.message);
  $('card-uid-stu').value=''; alert('Card set inactive.');
});

$('link-card-team')?.addEventListener('click', async ()=>{
  const role = $('card-role').value;
  const teamId = parseInt(($('card-team').value||'0'),10);
  const uid = normalizeUID($('card-uid-team').value);
  if (!teamId || !uid) return alert('Team + UID required');
  const { error } = await sb.from('cards').upsert(
    { card_uid: uid, team_id: teamId, student_id: null, card_role: role, active: true },
    { onConflict: 'card_uid' }
  );
  if (error) return alert(error.message);
  $('card-uid-team').value=''; alert('Card linked to team.');
});

$('unlink-card-team')?.addEventListener('click', async ()=>{
  const uid = normalizeUID($('card-uid-team').value); if (!uid) return alert('UID required');
  const { error } = await sb.from('cards').update({ active: false }).eq('card_uid', uid);
  if (error) return alert(error.message);
  $('card-uid-team').value=''; alert('Card set inactive.');
});

// ---------- Ajustes manuales ----------
async function loadTeamAdjustOptions(){
  const { data: globals } = await sb.from('teams').select('id,name,class').eq('scope','global').order('name',{ascending:true});
  $('adjust-pool-team').innerHTML = (globals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
  const { data: locals } = await sb.from('teams').select('id,name,class').eq('scope','local').order('name',{ascending:true});
  $('adjust-local-team').innerHTML = (locals||[]).map(t=>`<option value="${t.id}">${t.name} (${t.class ?? '—'})</option>`).join('');
}
$('adjust-pool-form')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const teamId = parseInt(($('adjust-pool-team').value||'0'),10);
  const delta = parseInt($('adjust-pool-delta').value,10);
  const reason = ($('adjust-pool-reason').value||'').trim() || null;
  if (!teamId || !Number.isFinite(delta) || delta===0) return alert('Team + non-zero Δ required');
  const { data, error } = await sb.rpc('team_pool_adjust', { _pool_team_id: teamId, _delta: delta, _reason: reason, _device_id: 'web-teacher' });
  if (error) return alert(error.message);
  alert(`Pool adjusted. Remaining: ${data?.remaining ?? 'n/a'}`);
  await refreshTeamOverview();
});
$('adjust-local-form')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const localId = parseInt(($('adjust-local-team').value||'0'),10);
  const amt = parseInt($('adjust-local-amount').value,10);
  const reason = ($('adjust-local-reason').value||'').trim() || null;
  if (!localId || !Number.isFinite(amt) || amt<=0) return alert('Local team + positive amount required');
  const { data, error } = await sb.rpc('team_local_spend_adjust', { _local_team_id: localId, _amount: amt, _reason: reason, _device_id: 'web-teacher' });
  if (error) return alert(error.message);
  alert(`Local spend applied. Pool remaining: ${data?.pool_remaining ?? 'n/a'}`);
  await refreshTeamOverview();
});

// ---------- Overview ----------
let _selectedPoolId = null;
async function refreshTeamOverview(){
  const { data: pools, status } = await sb.from('team_pool_balances').select('pool_team_id,points');
  const tbody = document.querySelector('#pool-table tbody');
  if (status===404){ tbody.innerHTML = `<tr><td colspan="2">Views missing.</td></tr>`; return; }
  tbody.innerHTML = (pools||[]).map(p=>`<tr data-pool="${p.pool_team_id}"><td>${p.pool_team_id}</td><td><strong>${p.points ?? 0}</strong></td></tr>`).join('');
  if (!_selectedPoolId && pools && pools.length) _selectedPoolId = pools[0].pool_team_id;
  Array.from(tbody.querySelectorAll('tr[data-pool]')).forEach(tr=>{
    tr.addEventListener('click', ()=>{ _selectedPoolId = parseInt(tr.getAttribute('data-pool'),10); loadLocalSummary(); });
  });
  await loadLocalSummary();
}
async function loadLocalSummary(){
  if (!_selectedPoolId){ document.querySelector('#local-table tbody').innerHTML=''; text($('local-title'),'—'); return; }
  const { data: locals } = await sb.from('team_local_remaining')
    .select('local_team_id,pool_team_id,spent_by_local,pool_remaining')
    .eq('pool_team_id', _selectedPoolId).order('local_team_id',{ascending:true});
  text($('local-title'), `Pool ${_selectedPoolId}`);
  document.querySelector('#local-table tbody').innerHTML = (locals||[]).map(r=>
    `<tr><td>${r.local_team_id}</td><td>${r.spent_by_local ?? 0}</td><td><strong>${r.pool_remaining ?? 0}</strong></td></tr>`).join('');
}

// ---------- Asignar por alumno ----------
$('reload-students')?.addEventListener('click', loadStudentsList);
$('class-filter')?.addEventListener('change', loadStudentsList);
$('search-name')?.addEventListener('input', ()=>{ clearTimeout(loadStudentsList._t); loadStudentsList._t=setTimeout(loadStudentsList,200); });

async function loadStudentsList(){
  const cls = ($('class-filter')?.value||'').trim();
  const q   = ($('search-name')?.value||'').trim().toLowerCase();
  let query = sb.from('students').select('id,name,class');
  if (cls) query = query.ilike('class', `${cls}%`);
  if (q)   query = query.ilike('name', `%${q}%`);
  query = query.order('class',{ascending:true}).order('name',{ascending:true});
  const { data: sts, error } = await query;
  if (error) return console.error(error);
  const container = $('students-list');
  if (!sts || !sts.length){ container.innerHTML='<p class="muted">No students found for this filter.</p>'; return; }

  const ids = sts.map(s=>s.id); const balances={};
  if (ids.length){ const { data: bals } = await sb.from('balances').select('student_id,points').in('student_id', ids); (bals||[]).forEach(b=>balances[b.student_id]=b.points); }

  container.innerHTML = sts.map(s=>{
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

  container.querySelectorAll('button[data-award]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const studentId = parseInt(btn.getAttribute('data-student'),10);
      let delta; const t = btn.getAttribute('data-award');
      if (t==='custom'){ const v = prompt('Δ points (e.g., 2 or -3):'); if(!v) return; delta = parseInt(v,10); if (isNaN(delta)) return alert('Invalid number'); }
      else { delta = parseInt(t,10); }
      const reason = prompt('Reason (optional):') || null;
      const { error } = await sb.rpc('award_points_by_student',{ _student_id: studentId, _delta: delta, _reason: reason, _device_id: 'web-teacher' });
      if (error) return alert(error.message);
      await loadLatestTransactions(); await loadStudentsList();
    });
  });

  container.querySelectorAll('button[data-link-card]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const studentId = parseInt(btn.getAttribute('data-link-card'),10);
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

  container.querySelectorAll('button[data-delete]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const studentId = parseInt(btn.getAttribute('data-delete'),10);
      const name = btn.getAttribute('data-name') || 'this student';
      const ok = prompt(`Type DELETE to remove ${name} (Auth account + cards + transactions). This cannot be undone.`)==='DELETE';
      if (!ok) return;
      try { await callEdge('admin_delete_student',{ student_id: studentId }); await loadLatestTransactions(); await loadStudentsList(); alert('Student deleted (Auth + data).'); }
      catch(err){ alert(err?.message || 'Delete failed'); }
    });
  });
}

// ---------- Boot ----------
handleRecoveryFromHash().finally(async ()=>{
  await refreshUI();
  await loadCardSelects().catch(()=>{});
  await reloadTeamOptionsForCard().catch(()=>{});
});

