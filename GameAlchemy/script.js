// script.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.87.1';

const dataPath = 'alchemy-recipes.json';
const SUPA_URL = String(window?.SUPABASE_URL || '').trim();
const SUPA_KEY = String(window?.SUPABASE_ANON_KEY || '').trim();
const sb = (SUPA_URL && SUPA_KEY) ? createClient(SUPA_URL, SUPA_KEY) : null;
const THEME_KEY = 'alchemy-theme';
const sessionState = {
  loading: false,
  ready: false,
  user: null,
  student: null,
  points: 0,
  combosTotal: 0,
  combosLeft: 0,
  role: 'student',
  teacherUseTop: false,
  teacherTopTeam: null,
  teacherTopPoints: 0,
  messageKey: null,
  messageRaw: ''
};
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};
const computeCombosFromPoints = (pts) => Math.max(0, Math.ceil(Math.max(0, pts) / 2));

// ===== Estado de juego y datos =====
const FALLBACK_BASE = ["Singularidad", "Expansión"];
let discoveredElements = loadGame() || { base: [...FALLBACK_BASE], combined: [] };

let recipesRaw = [];
let recipeMap = new Map();        // "A|B" -> outputs[]
let producers = new Map();        // output -> Array<[A,B]>
let allPossibleElements = [];
let definitions = {};
let kidDefinitions = {};
let enDefinitions = {};
let enKidDefinitions = {};
let enNames = {};
let justificationsRaw = {};
let enJustificationsRaw = {};
let justMap = new Map();          // canon "A|B" -> texto
let enJustMap = new Map();
let aliases = {};
let storySegments = [];
let storySegmentsEn = [];
let updateNonCombinableElements = () => {};
let addElementToNonCombinableSection = () => {};

let lang = localStorage.getItem('lang') || 'es';
const ARROW = '→';

// ===== Utilidades =====
const garbleMap = {
  'Expansi�n': 'Expansión',
  'Nucleos�ntesis estelar': 'Nucleosíntesis estelar',
  'Nucleos�ntesis primordial': 'Nucleosíntesis primordial',
  'Hidr�geno': 'Hidrógeno',
  'Hidr�geno molecular (H2)': 'Hidrógeno molecular (H2)',
  'N�cleos ligeros': 'Núcleos ligeros',
  'N�cleo at�mico': 'Núcleo atómico',
  'Espacio-Tiempo': 'Espacio-Tiempo'
};
function repairEncoding(name) {
  const s = String(name || '').trim();
  if (garbleMap[s]) return garbleMap[s];
  try {
    const fixed = decodeURIComponent(escape(s));
    if (fixed && fixed !== s) return garbleMap[fixed] || fixed;
  } catch { /* ignore */ }
  return s;
}
const norm = s => String(s).trim();
function resolveAlias(name) {
  const n = norm(name);
  return aliases[n] || n;
}
function displayName(name) {
  const canon = resolveAlias(name);
  if (lang === 'en' && enNames[canon]) return enNames[canon];
  return canon;
}
function getDef(name) {
  if (lang === 'en') {
    return enDefinitions[name] || definitions[name] || '-';
  }
  return definitions[name] || '-';
}
function getKidDef(name) {
  if (lang === 'en') {
    return enKidDefinitions[name] || kidDefinitions[name] || '(no translation - showing ES) ' + (kidDefinitions[name] || '-');
  }
  return kidDefinitions[name] || '-';
}
function getJustification(canonKey) {
  if (lang === 'en') {
    const en = enJustMap.get(canonKey);
    if (en) return en;
    const es = justMap.get(canonKey);
    if (es) return '(no translation - showing ES) ' + es;
    return '';
  }
  return justMap.get(canonKey) || '';
}
function refreshElementLabels() {
  document.querySelectorAll('.element').forEach(el => {
    const name = el.getAttribute('data-element');
    el.textContent = displayName(name);
    el.title = getDef(name);
  });
}
const keyFor = (a, b) => [norm(a), norm(b)]
  .map(resolveAlias)
  .sort((x, y) => x.localeCompare(y, 'es'))
  .join('|');

function loadGame() {
  const saved = localStorage.getItem('discoveredElements');
  try {
    if (!saved) return { base: [...FALLBACK_BASE], combined: [] };
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.base) || !Array.isArray(parsed.combined))
      throw new Error('Invalid save');
    const normalizeList = (arr) => (Array.isArray(arr) ? arr.map(repairEncoding) : []);
    return { base: normalizeList(parsed.base), combined: normalizeList(parsed.combined) };
  } catch {
    localStorage.removeItem('discoveredElements');
    return { base: [...FALLBACK_BASE], combined: [] };
  }
}
function saveGame(state) {
  localStorage.setItem('discoveredElements', JSON.stringify(state));
}

// ===== UI strings =====
const UI = {
  es: {
    glossaryTitle: 'Glosario',
    pediaIntro: 'Haz clic en un elemento para ver su definición rigurosa y su explicación en palabras sencillas. Al crear una combinación, se mostrará su justificación.',
    craftingHint: 'Arrastra aquí dos elementos para combinarlos',
    nonCombHeader: 'Elementos no combinables por ahora',
    nonCombBadge: 'Sin combos',
    nonCombBlocked: 'Este elemento ya no crea combinaciones nuevas.',
    reset: 'Reiniciar juego',
    diagram: 'Ver diagrama',
    story: 'Ver relato',
    langBtn: 'English',
    sessionTitle: 'Turno de combinaciones',
    sessionPointsLabel: 'Puntos',
    sessionCombosLabel: 'Combos por sesión',
    sessionRemainingLabel: 'Restantes',
    sessionLoading: 'Cargando tus puntos...',
    sessionNeedConfig: 'Falta configurar SUPABASE_URL/KEY (config.js o localStorage).',
    sessionNeedLogin: 'Inicia sesión en Points Panel para usar tus puntos en Alchemy.',
    sessionNoStudent: 'Tu usuario no está vinculado a un estudiante.',
    sessionError: 'No se pudieron leer tus puntos.',
    sessionNoCombos: 'Sin combinaciones disponibles. Vuelve cuando tengas más puntos.',
    sessionOffline: 'Modo offline: combinaciones ilimitadas (sin Supabase).',
    sessionReady: 'Listo: los intentos disponibles reflejan tus puntos (no se consumen).',
    sessionBlocked: 'Necesitas puntos para habilitar combinaciones.',
    sessionTeacherUnlimited: 'Profesor: combinaciones ilimitadas habilitadas.',
    sessionTeacherToggle: 'Simular puntos del mejor equipo',
    sessionTeacherTopLoading: 'Buscando el equipo con más puntos...',
    sessionTeacherTopError: 'No se pudo cargar el mejor equipo. Manteniendo modo ilimitado.',
    sessionTeacherTopSim: (team, pts, combos) => `Simulando mejor equipo (${team || 'N/A'}): ${pts} puntos -> ${combos} combos.`,
    themeNeon: 'Tema: Neón',
    themeLight: 'Tema: Claro',
    sessionUnlimited: 'ilimitado',
    created: 'Has creado',
    nothing: 'No ha pasado nada...',
    rigorous: 'Rigurosa',
    simple: 'En palabras sencillas',
    directPrecursors: 'Precursores directos',
    pathHeader: 'Ruta de elaboración (resumen)',
    storyUnlocksWith: 'Se desbloquea con:',
    storyLockedMsg: 'Sigue combinando para desbloquear este capítulo.'
  },
  en: {
    glossaryTitle: 'Glossary',
    pediaIntro: 'Click any element to see its rigorous definition and a plain-language explanation. When you create a combo, its justification will appear here.',
    craftingHint: 'Drag two elements here to combine',
    nonCombHeader: 'Currently Non-combinable Elements',
    nonCombBadge: 'No combos',
    nonCombBlocked: 'This element no longer creates new combinations.',
    reset: 'Reset Game',
    diagram: 'View Diagram',
    story: 'View Story',
    langBtn: 'Español',
    sessionTitle: 'Combination turn',
    sessionPointsLabel: 'Points',
    sessionCombosLabel: 'Combos per session',
    sessionRemainingLabel: 'Remaining',
    sessionLoading: 'Loading your points...',
    sessionNeedConfig: 'Missing SUPABASE_URL/KEY (config.js or localStorage).',
    sessionNeedLogin: 'Sign in on Points Panel to use your points in Alchemy.',
    sessionNoStudent: 'Your user is not linked to a student record.',
    sessionError: 'Could not read your points.',
    sessionNoCombos: 'No combinations available. Come back with more points.',
    sessionOffline: 'Offline mode: unlimited combinations (no Supabase).',
    sessionReady: 'Ready: available attempts mirror your points (they are not consumed).',
    sessionBlocked: 'You need points to enable combinations.',
    sessionTeacherUnlimited: 'Teacher: unlimited combinations enabled.',
    sessionTeacherToggle: 'Simulate top team points',
    sessionTeacherTopLoading: 'Looking up the top-scoring team...',
    sessionTeacherTopError: 'Could not load the top team. Staying on unlimited.',
    sessionTeacherTopSim: (team, pts, combos) => `Simulating top team (${team || 'N/A'}): ${pts} points -> ${combos} combos.`,
    themeNeon: 'Theme: Neon',
    themeLight: 'Theme: Light',
    sessionUnlimited: 'unlimited',
    created: 'You created',
    nothing: 'Nothing happened...',
    rigorous: 'Rigorous',
    simple: 'In plain words',
    directPrecursors: 'Direct precursors',
    pathHeader: 'Build route (summary)',
    storyUnlocksWith: 'Unlocks with:',
    storyLockedMsg: 'Keep combining to unlock this chapter.'
  }
};


function applyUILanguage() {
  const t = UI[lang];
  document.documentElement.setAttribute('lang', lang);
  const rb = document.getElementById('reset-button');
  if (rb) rb.textContent = t.reset;
  const db = document.getElementById('diagram-toggle-button');
  if (db) db.textContent = t.diagram;
  const sb = document.getElementById('story-toggle-button');
  if (sb) sb.textContent = t.story;
  const lb = document.getElementById('lang-toggle-button');
  if (lb) lb.textContent = t.langBtn;

  const ca = document.getElementById('crafting-area');
  if (ca && ca.children.length === 0) ca.textContent = t.craftingHint;

  const nonCombH2 = document.querySelector('#non-combinable-section h2');
  if (nonCombH2) nonCombH2.textContent = t.nonCombHeader;

  const gTitle = document.getElementById('glossary-title');
  if (gTitle) gTitle.textContent = t.glossaryTitle;

  const pIntro = document.getElementById('pedia-intro');
  if (pIntro) pIntro.textContent = t.pediaIntro;

  updateSessionUI();
  updateThemeToggleLabel();
  refreshElementLabels();
  updateNonCombinableElements();
}

// ===== Tema (neón / claro) =====
function applyTheme(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('theme-dark', m === 'dark');
  document.body.classList.toggle('theme-light', m === 'light');
  localStorage.setItem(THEME_KEY, m);
  updateThemeToggleLabel();
}

function updateThemeToggleLabel() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.body.classList.contains('theme-dark');
  btn.textContent = isDark ? UI[lang].themeNeon : UI[lang].themeLight;
}

function initThemeToggle() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const isDark = document.body.classList.contains('theme-dark');
    applyTheme(isDark ? 'light' : 'dark');
  });
}

// ===== Estado de sesiA3n / Supabase (lA-mite de combinaciones) =====
function getSessionMessageText() {
  if (sessionState.messageKey && UI[lang][sessionState.messageKey]) {
    return UI[lang][sessionState.messageKey];
  }
  return sessionState.messageRaw || '';
}

function refreshSessionMessage() {
  setText('session-message', getSessionMessageText());
}

function enableOfflineFreePlay(messageKey = 'sessionOffline', rawMessage) {
  sessionState.loading = false;
  sessionState.ready = true;
  sessionState.role = 'student';
  sessionState.points = 0;
  sessionState.combosTotal = Infinity;
  sessionState.combosLeft = Infinity;
  sessionState.teacherUseTop = false;
  setSessionMessage(messageKey, rawMessage);
  updateSessionUI();
}

function setSessionMessage(keyOrText, rawText) {
  if (keyOrText && UI[lang][keyOrText]) {
    sessionState.messageKey = keyOrText;
    sessionState.messageRaw = '';
  } else {
    sessionState.messageKey = null;
    sessionState.messageRaw = rawText || (keyOrText || '');
  }
  refreshSessionMessage();
}

function updateSessionUI() {
  const t = UI[lang];
  setText('session-title', t.sessionTitle);
  setText('session-label-points', t.sessionPointsLabel);
  setText('session-label-total', t.sessionCombosLabel);
  setText('session-label-remaining', t.sessionRemainingLabel);
  const formatCombos = (v) => v === Infinity ? t.sessionUnlimited : String(v);
  setText('session-points', sessionState.ready ? sessionState.points : '-');
  setText('session-combos', sessionState.ready ? formatCombos(sessionState.combosTotal) : '-');
  setText('session-remaining', sessionState.ready ? formatCombos(sessionState.combosLeft) : '-');
  const tRow = document.getElementById('session-teacher-row');
  if (tRow) tRow.style.display = sessionState.role === 'teacher' ? 'block' : 'none';
  const toggleLabel = document.getElementById('session-teacher-toggle-label');
  if (toggleLabel) toggleLabel.textContent = t.sessionTeacherToggle;
  const toggle = document.getElementById('session-use-top');
  if (toggle) toggle.checked = !!sessionState.teacherUseTop;
  const note = document.getElementById('session-teacher-note');
  if (note) {
    if (sessionState.teacherUseTop && sessionState.teacherTopTeam) {
      const comboLabel = sessionState.combosTotal === Infinity ? t.sessionUnlimited : sessionState.combosTotal;
      note.textContent = UI[lang].sessionTeacherTopSim(sessionState.teacherTopTeam, sessionState.teacherTopPoints, comboLabel);
    } else {
      note.textContent = UI[lang].sessionTeacherUnlimited;
    }
  }
  if (sessionState.role !== 'teacher') setSessionMessage(sessionState.messageKey, sessionState.messageRaw);
  refreshSessionMessage();
}

async function initSessionFromSupabase() {
  sessionState.loading = true;
  sessionState.ready = false;
  sessionState.combosTotal = 0;
  sessionState.combosLeft = 0;
  setSessionMessage('sessionLoading');
  updateSessionUI();

  if (!sb) {
    // Modo sin Supabase: juego libre para todos
    enableOfflineFreePlay();
    return;
  }

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) {
      // Si no hay sesión Supabase, degradamos a modo offline
      enableOfflineFreePlay();
      return;
    }

    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role || 'student';
    sessionState.role = role;

    if (role === 'teacher') {
      sessionState.user = user;
      sessionState.loading = false;
      await applyTeacherSessionMode();
      return;
    }

    const { data: stu, error: stuErr } = await sb.from('students')
      .select('id,name')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (stuErr || !stu) return enableOfflineFreePlay('sessionOffline', UI[lang].sessionNeedLogin);

    const { data: bal, error: balErr } = await sb.from('balances')
      .select('points')
      .eq('student_id', stu.id)
      .maybeSingle();
    if (balErr) {
      console.warn('balances read error', balErr);
      return enableOfflineFreePlay('sessionOffline', UI[lang].sessionError);
    }

    const pts = Math.max(0, bal?.points || 0);
    const combos = computeCombosFromPoints(pts);

    sessionState.user = user;
    sessionState.student = stu;
    sessionState.points = pts;
    sessionState.combosTotal = combos;
    sessionState.combosLeft = combos;
    sessionState.ready = true;
    sessionState.loading = false;

    setSessionMessage(combos > 0 ? 'sessionReady' : 'sessionBlocked');
    updateSessionUI();
  } catch (err) {
    console.warn('session load error', err);
    enableOfflineFreePlay('sessionOffline', UI[lang].sessionError);
  }
}

function spendCombinationAttempt() {
  if (!sessionState.ready) {
    const key = sessionState.loading ? 'sessionLoading' : (sb ? 'sessionNeedLogin' : 'sessionNeedConfig');
    setSessionMessage(key);
    updateSessionUI();
    return { ok: false, reason: getSessionMessageText() || UI[lang].sessionNoCombos };
  }
  if (sessionState.combosLeft === Infinity) {
    return { ok: true, remaining: Infinity };
  }
  if (sessionState.combosLeft <= 0) {
    setSessionMessage('sessionNoCombos');
    updateSessionUI();
    return { ok: false, reason: UI[lang].sessionNoCombos };
  }
  sessionState.combosLeft = Math.max(0, sessionState.combosLeft - 1);
  updateSessionUI();
  return { ok: true, remaining: sessionState.combosLeft };
}

async function loadTopTeamSnapshot() {
  try {
    const { data, error } = await sb.rpc('top_local_leaderboard', { _limit: 1 });
    if (error || !data || !data.length) return { error: true };
    const top = data[0];
    const ptsRaw = Number(top.pool_points);
    const pts = Number.isFinite(ptsRaw) ? ptsRaw : Math.max(0, (top.total_local ?? 0) + (top.spent ?? 0));
    const localName = top.local_name || (top.local_team_id ? `#${top.local_team_id}` : 'N/A');
    return { points: Math.max(0, pts), teamLabel: localName };
  } catch (e) {
    console.warn('top_local_leaderboard error', e);
    return { error: true };
  }
}

async function applyTeacherSessionMode(forceUseTop) {
  if (typeof forceUseTop === 'boolean') sessionState.teacherUseTop = forceUseTop;
  if (sessionState.role !== 'teacher') return;

  if (!sessionState.teacherUseTop) {
    sessionState.points = 0;
    sessionState.combosTotal = Infinity;
    sessionState.combosLeft = Infinity;
    sessionState.ready = true;
    setSessionMessage('sessionTeacherUnlimited');
    updateSessionUI();
    return;
  }

  sessionState.loading = true;
  setSessionMessage('sessionTeacherTopLoading');
  updateSessionUI();

  const snap = await loadTopTeamSnapshot();
  sessionState.loading = false;
  if (snap.error) {
    sessionState.teacherUseTop = false;
    sessionState.combosTotal = Infinity;
    sessionState.combosLeft = Infinity;
    setSessionMessage('sessionTeacherTopError');
    updateSessionUI();
    return;
  }

  const combos = computeCombosFromPoints(snap.points);
  sessionState.points = snap.points;
  sessionState.combosTotal = combos;
  sessionState.combosLeft = combos;
  sessionState.teacherTopTeam = snap.teamLabel;
  sessionState.teacherTopPoints = snap.points;
  sessionState.ready = true;
  const msg = UI[lang].sessionTeacherTopSim(snap.teamLabel, snap.points, combos);
  setSessionMessage(null, msg);
  updateSessionUI();
}

// ===== Sanitizador de JSON (permite comentarios y comas colgantes) =====
function sanitizeJson(input) {
  let s = input || '';
  // quita BOM
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  // /* ... */ comentarios
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // // ... comentarios (evita http://)
  s = s.replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  // comas finales antes de } o ]
  s = s.replace(/,(\s*[}\]])/g, '$1');
  return s;
}

// ===== Normalizador de claves de justificación =====
function normalizeJustificationsMap(obj, aliasesRef) {
  const out = new Map();
  if (!obj || typeof obj !== 'object') return out;

  const stripParen = s => s.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  const _resolveAlias = (name) => {
    const n = String(name).trim();
    return aliasesRef[n] || n;
  };

  for (const [rawKey, text] of Object.entries(obj)) {
    const parts = String(rawKey).split('|').map(p => _resolveAlias(stripParen(p)));
    if (parts.length === 2) {
      const canonKey = [parts[0], parts[1]].sort((x, y) => x.localeCompare(y, 'es')).join('|');
      if (!out.has(canonKey)) out.set(canonKey, text);
    }
  }
  return out;
}

// ===== Touch helpers =====
let lastTapTime = 0;
let lastTapElement = null;

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  const elementsContainer = document.getElementById('elements');
  const craftingArea = document.getElementById('crafting-area');
  const resultsArea = document.getElementById('combination-results');
  const pedia = document.getElementById('pedia-content');

  initThemeToggle();
  updateSessionUI();
  initSessionFromSupabase();
  document.getElementById('session-use-top')?.addEventListener('change', (e) => {
    applyTeacherSessionMode(!!e.target.checked);
  });

  // Crear botón de idioma si no existe
  (function ensureLangButton() {
    if (!document.getElementById('lang-toggle-button')) {
      const btn = document.createElement('button');
      btn.id = 'lang-toggle-button';
      btn.textContent = UI[lang].langBtn;
      btn.style.padding = '10px 16px';
      btn.style.fontSize = '14px';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '6px';
      btn.style.cursor = 'pointer';
      btn.style.transition = 'background-color .2s';
      btn.style.backgroundColor = '#00897b';
      btn.addEventListener('mouseenter', () => btn.style.backgroundColor = '#00695c');
      btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '#00897b');

      const controls = document.getElementById('controls');
      if (controls) controls.appendChild(btn);
    }
  })();

  // Modales
  const diagramButton = document.getElementById('diagram-toggle-button');
  const diagramModal = document.getElementById('diagram-modal');
  const diagramCloseBtn = document.getElementById('diagram-close-button');

  const storyButton = document.getElementById('story-toggle-button');
  const storyModal = document.getElementById('story-modal');
  const storyCloseBtn = document.getElementById('story-close-button');
  const storyContainer = document.getElementById('story-container');

  // Idioma
  const langBtn = document.getElementById('lang-toggle-button');
  langBtn?.addEventListener('click', () => {
    lang = (lang === 'es') ? 'en' : 'es';
    localStorage.setItem('lang', lang);
    applyUILanguage();
    // Tooltips
    document.querySelectorAll('.element').forEach(el => {
      const name = el.getAttribute('data-element');
      el.title = getDef(name);
    });
    // Reescribir panel si había selección
    const selected = document.querySelector('.element.selected');
    if (selected) showDefinition(selected.getAttribute('data-element'));
  });

  // Carga tolerante del JSON
  fetch(dataPath)
    .then(async r => {
      const txt = await r.text();
      try {
        return JSON.parse(txt);
      } catch {
        return JSON.parse(sanitizeJson(txt));
      }
    })
    .then(data => {
      const fixStr = (s) => repairEncoding(s);
      const fixList = (arr) => Array.isArray(arr) ? arr.map(fixStr) : [];
      const fixObj = (obj) => {
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => { out[fixStr(k)] = typeof v === 'string' ? fixStr(v) : v; });
        return out;
      };
      const fixRecipes = (recs) => Array.isArray(recs) ? recs.map(r => ({
        inputs: fixList(r.inputs || []),
        outputs: fixList(r.outputs || [])
      })) : [];
      const fixStory = (st) => {
        const segs = (st && st.segments) ? st.segments : [];
        return segs.map(seg => ({
          ...seg,
          title: fixStr(seg.title || ''),
          text: fixStr(seg.text || ''),
          requires: fixList(seg.requires || [])
        }));
      };

      data.elements = data.elements || {};
      data.elements.base = fixList(data.elements.base || []);
      data.elements.combined = fixList(data.elements.combined || []);

      allPossibleElements = (data.elements.base || []).concat(data.elements.combined || []);
      definitions = fixObj(data.definitions || {});
      kidDefinitions = fixObj(data.kid_definitions || {});
      enDefinitions = fixObj(data.en_definitions || {});
      enKidDefinitions = fixObj(data.en_kid_definitions || {});
      enNames = fixObj(data.en_names || {});

      aliases = fixObj(data.aliases || {});
      storySegments = fixStory(data.story);
      storySegmentsEn = fixStory(data.story_en);

      // Guardamos justificaciones RAW para normalizar luego de tener aliases
      justificationsRaw = fixObj(data.justifications || {});
      enJustificationsRaw = fixObj(data.en_justifications || {});

      // Recetas
      if (data.combinations && !data.recipes) {
        recipesRaw = migrateOldCombinations(data.combinations);
      } else {
        recipesRaw = fixRecipes(data.recipes || []);
      }

      // Mapa canónico de recetas + índice inverso
      recipeMap.clear();
      producers.clear();
      for (const { inputs, outputs } of recipesRaw) {
        if (!Array.isArray(inputs) || inputs.length !== 2) continue;
        const a = resolveAlias(inputs[0]);
        const b = resolveAlias(inputs[1]);
        const k = keyFor(a, b);
        const outs = (outputs || []).map(o => resolveAlias(o));

        recipeMap.set(k, Array.from(new Set([...(recipeMap.get(k) || []), ...outs])));

        // Índice inverso: out -> [[a,b], ...]
        for (const out of outs) {
          const arr = producers.get(out) || [];
          arr.push([a, b]);
          producers.set(out, arr);
        }
      }

      // Normalizar justificaciones con aliases (corrige claves como "Hidrógeno|Hidrógeno (molecular)")
      justMap = normalizeJustificationsMap(justificationsRaw, aliases);
      enJustMap = normalizeJustificationsMap(enJustificationsRaw, aliases);

      initGame();
      applyUILanguage();
    })
    .catch(err => {
      console.error('Error loading game data:', err);
      if (pedia) {
        pedia.innerHTML = `<p style="color:#b00020"><strong>Error al cargar datos.</strong> Revisa que el JSON sea válido o deja los comentarios/comas y usa este script que los tolera.</p>`;
      }
    });

  function migrateOldCombinations(combos) {
    const migrated = [];
    const names = new Set(allPossibleElements.map(n => resolveAlias(n)));
    function trySplit(concatKey) {
      const canonKey = resolveAlias(concatKey);
      for (const e1 of names) {
        if (canonKey.startsWith(e1)) {
          const rest = canonKey.slice(e1.length);
          if (names.has(rest)) return [e1, rest];
        }
      }
      return null;
    }
    Object.entries(combos).forEach(([k, outs]) => {
      const pair = trySplit(norm(k));
      if (pair) migrated.push({ inputs: pair, outputs: outs.map(o => resolveAlias(o)) });
    });
    return migrated;
  }

  function initGame() {
    elementsContainer.innerHTML = '';
    (discoveredElements.base || []).forEach(createElementDiv);
    (discoveredElements.combined || []).forEach(createElementDiv);
    updateNonCombinableElements();
  }

  function createElementDiv(elementName) {
    const name = resolveAlias(elementName);
    const elDiv = document.createElement('div');
    elDiv.textContent = displayName(name);
    elDiv.className = 'element';
    elDiv.setAttribute('data-element', name);
    elDiv.setAttribute('draggable', true);
    elDiv.title = getDef(name);

    // drag desktop
    elDiv.ondragstart = (e) => e.dataTransfer.setData('text', name);

    // selección + panel
    elDiv.addEventListener('click', () => {
      document.querySelectorAll('.element.selected').forEach(n => n.classList.remove('selected'));
      elDiv.classList.add('selected');
      showDefinition(name);
    });

    // doble clic desktop: enviar a no combinables si aplica
    elDiv.ondblclick = (e) => {
      if (e.currentTarget.classList.contains('non-combinable')) {
        addElementToNonCombinableSection(e.currentTarget);
      }
    };

    // táctil
    handleMobileDoubleTap(elDiv);
    handleTouchDrag(elDiv, document.getElementById('crafting-area'));

    elementsContainer.appendChild(elDiv);
  }

    function showDefinition(name) {
    const t = UI[lang];
    const canon = resolveAlias(name);
    const def = getDef(canon) || (lang === 'en' ? '(no translation - showing ES)' : 'Definici?n no disponible.');
    const kid = getKidDef(canon) || (lang === 'en' ? '(no translation - showing ES)' : 'Explicaci?n en palabras sencillas no disponible.');

    const direct = (producers.get(canon) || []).map(([a, b]) => `${displayName(a)} + ${displayName(b)} ${ARROW} ${displayName(canon)}`);
    const path = buildOnePathSummary(canon); // Array de pasos "A + B ? OUT"

    const directHTML = direct.length
      ? `<ul>${direct.map(s => `<li>${s}</li>`).join('')}</ul>`
      : `<p style="opacity:.8">-</p>`;

    const pathHTML = path.length
      ? `<ol>${path.map(s => `<li>${s}</li>`).join('')}</ol>`
      : `<p style="opacity:.8">-</p>`;

    const html = `
      <h3>${displayName(canon)}</h3>
      <p><strong>${t.rigorous}:</strong> ${def}</p>
      <p><strong>${t.simple}:</strong> ${kid}</p>
      <hr/>
      <h4>${t.directPrecursors}</h4>
      ${directHTML}
      <h4>${t.pathHeader}</h4>
      ${pathHTML}
    `;
    document.getElementById('pedia-content').innerHTML = html;
  }

// ===== Drag & Drop =====
  craftingArea.ondragover = e => e.preventDefault();
  craftingArea.ondrop = e => {
    e.preventDefault();
    const elementName = e.dataTransfer.getData('text');
    handleElementDrop(elementName);
  };

  function handleElementDrop(elementName) {
    const t = UI[lang];
    const current = [...craftingArea.querySelectorAll('.element')];
    if (current.length >= 2) return;

    const canon = resolveAlias(elementName);
    const original = document.querySelector(`.element[data-element="${CSS.escape(canon)}"]`);
    if (!original) return;
    if (original.classList.contains('non-combinable')) {
      resultsArea.textContent = t.nonCombBlocked;
      return;
    }

    const clone = original.cloneNode(true);
    clone.textContent = displayName(canon);
    clone.classList.add('in-crafting-area');
    clone.removeAttribute('draggable');
    // Solo limpia el texto de ayuda si no hay elementos previos; evita borrar el primero.
    if (current.length === 0) craftingArea.textContent = '';
    craftingArea.appendChild(clone);

    const totalNow = craftingArea.querySelectorAll('.element').length;
    if (totalNow === 2) checkCombination();
  }

  function combineElements(a, b) {
    const k = keyFor(a, b);
    return recipeMap.get(k) || null;
  }

  function checkCombination() {
    const t = UI[lang];
    const names = [...craftingArea.querySelectorAll('.element')].map(el => el.getAttribute('data-element'));
    if (names.length !== 2) return;

    const spend = spendCombinationAttempt();
    craftingArea.innerHTML = '';
    craftingArea.textContent = UI[lang].craftingHint;
    if (!spend.ok) {
      resultsArea.textContent = spend.reason || t.sessionNoCombos;
      return;
    }

    const results = combineElements(names[0], names[1]);

    if (results && results.length) {
      const created = [];
      for (const r0 of results.slice(0, 6)) {
        const r = resolveAlias(r0);
        if (!discoveredElements.combined.includes(r) && !discoveredElements.base.includes(r)) {
          discoveredElements.combined.push(r);
          createElementDiv(r);
        }
        created.push(r);
      }
      const remaining = typeof spend.remaining === 'number' ? spend.remaining : sessionState.combosLeft;
      const pairLabel = `${displayName(names[0])} + ${displayName(names[1])} ${ARROW}`;
      const createdLabel = created.map(displayName).join(', ');
      const remainingLabel = remaining === Infinity ? t.sessionUnlimited : remaining;
      resultsArea.textContent = `${t.created}: ${pairLabel} ${createdLabel} (${t.sessionRemainingLabel}: ${remainingLabel})`;
      saveGame(discoveredElements);
      updateNonCombinableElements();

      const k = keyFor(names[0], names[1]);
      const just = getJustification(k);
      if (just) appendExplanation(`<h3>${displayName(names[0])} + ${displayName(names[1])}</h3><p>${just}</p>`);
    } else {
      resultsArea.textContent = t.nothing;
    }
  }

  function appendExplanation(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    document.getElementById('pedia-content').prepend(box);
  }

  // ===== No combinables =====
  updateNonCombinableElements = function () {
    const disc = new Set(discoveredElements.base.concat(discoveredElements.combined).map(resolveAlias));
    const container = document.getElementById('non-combinable-elements');
    if (container) container.innerHTML = '';
    const badge = UI[lang].nonCombBadge || 'No combos';

    for (const name of disc) {
      const could = canProduceUndiscovered(name, disc);
      const el = document.querySelector(`.element[data-element="${CSS.escape(name)}"]`);
      if (!el) continue;
      el.textContent = displayName(name);
      if (!could) {
        el.classList.add('non-combinable');
        el.setAttribute('data-label-noncomb', badge);
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('draggable', 'false');
        addElementToNonCombinableSection(el);
      } else {
        el.classList.remove('non-combinable');
        el.removeAttribute('data-label-noncomb');
        el.removeAttribute('aria-disabled');
        el.setAttribute('draggable', 'true');
      }
    }
  };

  function canProduceUndiscovered(elementName, discoveredSet) {
    for (const [k, outs] of recipeMap.entries()) {
      const [a, b] = k.split('|');
      if (a === elementName || b === elementName) {
        const other = a === elementName ? b : a;
        if (discoveredSet.has(other)) {
          if (outs.some(o => !discoveredSet.has(resolveAlias(o)))) return true;
        }
      }
    }
    return false;
  }

  addElementToNonCombinableSection = function (element) {
    const container = document.getElementById('non-combinable-elements');
    if (!container) return;
    const clone = element.cloneNode(true);
    const canon = clone.getAttribute('data-element');
    clone.textContent = displayName(canon);
    clone.classList.add('in-menu');
    clone.removeAttribute('draggable');
    clone.setAttribute('aria-disabled', 'true');
    clone.setAttribute('data-label-noncomb', UI[lang].nonCombBadge || 'No combos');
    clone.addEventListener('click', () => showDefinition(clone.getAttribute('data-element')));
    container.appendChild(clone);
  };

  async function resetGame() {
    discoveredElements = { base: [...FALLBACK_BASE], combined: [] };
    localStorage.removeItem('discoveredElements');

    const el = document.getElementById('elements');
    if (el) el.innerHTML = '';
    const ca = document.getElementById('crafting-area');
    if (ca) ca.innerHTML = '';
    const cr = document.getElementById('combination-results');
    if (cr) cr.textContent = '';
    const nc = document.getElementById('non-combinable-elements');
    if (nc) nc.innerHTML = '';

    const intro = UI[lang].pediaIntro;
    const pc = document.getElementById('pedia-content');
    if (pc) pc.innerHTML = `<p id="pedia-intro">${intro}</p>`;

    initGame();
    await initSessionFromSupabase();
  }
  document.getElementById('reset-button')?.addEventListener('click', resetGame);

  // ===== Diagrama jerárquico con Vis.js =====
  function renderDiagram() {
    const container = document.getElementById('network-container');
    if (!container) return;
    container.innerHTML = '';

    const discovered = discoveredElements.base.concat(discoveredElements.combined).map(resolveAlias);
    const nodeSet = new Set(discovered);

    const nodesArray = [...nodeSet].map(name => ({ id: name, label: displayName(name) }));
    const edgesArray = [];

    for (const [k, outs] of recipeMap.entries()) {
      const [a, b] = k.split('|');
      for (const r of outs) {
        const res = resolveAlias(r);
        if (nodeSet.has(res)) {
          if (nodeSet.has(a)) edgesArray.push({ from: a, to: res, arrows: 'to' });
          if (nodeSet.has(b)) edgesArray.push({ from: b, to: res, arrows: 'to' });
        }
      }
    }

    const nodes = new vis.DataSet(nodesArray);
    const edges = new vis.DataSet(edgesArray);

    const options = {
      layout: {
        hierarchical: {
          enabled: true,
          direction: 'LR',
          sortMethod: 'directed',
          nodeSpacing: 180,
          levelSeparation: 160
        }
      },
      physics: { enabled: false },
      interaction: { dragNodes: true, zoomView: true, dragView: true }
    };

    new vis.Network(container, { nodes, edges }, options);
  }

  diagramButton?.addEventListener('click', () => {
    if (!diagramModal) return;
    diagramModal.classList.add('visible');
    diagramModal.setAttribute('aria-hidden', 'false');
    renderDiagram();
  });
  diagramCloseBtn?.addEventListener('click', () => {
    if (!diagramModal) return;
    diagramModal.classList.remove('visible');
    diagramModal.setAttribute('aria-hidden', 'true');
  });
  diagramModal?.addEventListener('click', (e) => {
    if (e.target === diagramModal) {
      diagramModal.classList.remove('visible');
      diagramModal.setAttribute('aria-hidden', 'true');
    }
  });

  // ===== Relato =====
  function renderStory() {
    const t = UI[lang];
    if (!storyContainer) return;
    storyContainer.innerHTML = '';
    const disc = new Set(discoveredElements.base.concat(discoveredElements.combined).map(resolveAlias));
    const segments = (lang === 'en' && storySegmentsEn.length) ? storySegmentsEn : storySegments;

    segments.forEach(seg => {
      const unlocked = (seg.requires || []).every(r => disc.has(resolveAlias(r)));
      const card = document.createElement('div');
      card.className = 'story-segment' + (unlocked ? '' : ' story-locked');
      const reqs = (seg.requires || []).map(r => displayName(resolveAlias(r))).join(', ');
      const lock = unlocked ? '' : '🔒 ';
      card.innerHTML = `
        <h3 class="story-title">${lock}${seg.title}</h3>
        <div class="story-requires"><strong>${t.storyUnlocksWith}</strong> ${reqs || '-'}</div>
        <p>${unlocked ? seg.text : t.storyLockedMsg}</p>
      `;
      storyContainer.appendChild(card);
    });
  }

  storyButton?.addEventListener('click', () => {
    if (!storyModal) return;
    storyModal.classList.add('visible');
    storyModal.setAttribute('aria-hidden', 'false');
    renderStory();
  });
  storyCloseBtn?.addEventListener('click', () => {
    if (!storyModal) return;
    storyModal.classList.remove('visible');
    storyModal.setAttribute('aria-hidden', 'true');
  });
  storyModal?.addEventListener('click', (e) => {
    if (e.target === storyModal) {
      storyModal.classList.remove('visible');
      storyModal.setAttribute('aria-hidden', 'true');
    }
  });

  // ===== Soporte móvil =====
  function handleMobileDoubleTap(element) {
    element.addEventListener('touchstart', function (e) {
      const t = Date.now();
      const dt = t - lastTapTime;
      if (dt < 300 && dt > 0 && lastTapElement === e.target) {
        if (e.target.classList.contains('non-combinable')) {
          addElementToNonCombinableSection(e.target);
        }
      }
      lastTapTime = t;
      lastTapElement = e.target;
    }, { passive: true });
  }

  function handleTouchDrag(element, craftingAreaEl) {
    let offsetX = 0, offsetY = 0;
    let moving = false;

    element.addEventListener('touchstart', (e) => {
      if (element.classList.contains('non-combinable')) return;
      const rect = element.getBoundingClientRect();
      const touch = e.touches[0];
      offsetX = touch.clientX - rect.left;
      offsetY = touch.clientY - rect.top;
      moving = true;
      element.style.position = 'absolute';
      element.style.zIndex = 1000;
      moveAt(touch.clientX, touch.clientY);
      e.preventDefault();
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      if (!moving) return;
      const touch = e.touches[0];
      moveAt(touch.clientX, touch.clientY);
      e.preventDefault();
    }, { passive: false });

    element.addEventListener('touchend', () => {
      moving = false;
      const craftRect = craftingAreaEl.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const inside =
        rect.left > craftRect.left &&
        rect.right < craftRect.right &&
        rect.top > craftRect.top &&
        rect.bottom < craftRect.bottom;

      element.style.position = '';
      element.style.left = '';
      element.style.top = '';
      element.style.zIndex = '';

      if (inside) {
        handleElementDrop(element.getAttribute('data-element'));
      }
    });

    function moveAt(x, y) {
      element.style.left = x - offsetX + 'px';
      element.style.top = y - offsetY + 'px';
    }
  }

  // ===== Ruta resumida (proveniencia) =====
  // Genera UNA ruta compacta hacia 'target' (preferencia por insumos ya descubiertos o base)
  function buildOnePathSummary(target) {
    const MAX_DEPTH = 8;
    const MAX_STEPS = 22;
    const baseSet = new Set((discoveredElements.base || []).map(resolveAlias));
    const visited = new Set();
    const steps = [];

    function choosePairsFor(tgt) {
      const arr = producers.get(tgt) || [];
      const discSet = new Set(discoveredElements.base.concat(discoveredElements.combined).map(resolveAlias));
      return arr
        .map(([a, b]) => [a, b])
        .sort((p, q) => {
          const score = ([x, y]) =>
            (discSet.has(x) ? 1 : 0) + (discSet.has(y) ? 1 : 0) + (baseSet.has(x) ? 1 : 0) + (baseSet.has(y) ? 1 : 0);
          return score(q) - score(p);
        });
    }

    function dfs(tgt, depth) {
      if (depth > MAX_DEPTH || steps.length > MAX_STEPS) return false;
      if (baseSet.has(tgt)) return true;
      if (visited.has(tgt)) return false;
      visited.add(tgt);

      const options = choosePairsFor(tgt);
      if (!options.length) return baseSet.has(tgt);

      for (const [a, b] of options) {
        const okA = baseSet.has(a) || dfs(a, depth + 1);
        const okB = baseSet.has(b) || dfs(b, depth + 1);
        if (okA && okB) {
          steps.push(`${displayName(a)} + ${displayName(b)} ${ARROW} ${displayName(tgt)}`);
          return true;
        }
      }
      return false;
    }

    const success = dfs(resolveAlias(target), 0);
    return success ? steps.reverse() : [];
  }

});
