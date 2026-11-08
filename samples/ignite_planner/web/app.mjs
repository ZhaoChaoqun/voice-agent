// Ignite planner page. It opens the Foundry voice WebSocket itself (straight to Azure locally, through
// the Playground's relay when hosted), runs every page and knowledge function locally, and visualises
// each Agent action (orb state, beams, ranked feed).
import {EXPLAINER_STEPS, PageController, layoutCalendarSessions, narratedStep} from './page-tools.mjs';
import {HowBoard} from './explainer.mjs';
import {agendaCalendar} from './ics.mjs';
import {VoiceAudio} from './audio.mjs';
import {VoiceSession} from './voice-session.mjs';
import {KNOWLEDGE_TOOLS, SessionIndex, tokens} from './session-index.mjs';
import {ConversationLog} from './conversation-log.mjs';
import {EVENT_FILLER, NameSearch} from './name-search.mjs';
import {LogoField, WireOrb} from './wireframe.mjs';
import * as fx from './effects.mjs';

const $ = id => document.getElementById(id);
let controller, knowledge, config, socket, session, audio, stream, ready = false, connecting = false;
let responding = false, speaking = false, userSpeaking = false, day = 'all', actionCount = 0, audioChunks = 0, toastTimer;
let connectionGeneration = 0, watchdog = null, conversation = null, completedCalls = new Map();
let actingUntil = 0, captionResponse = null, captionText = '', queryTimer = null;
let shownHighlight = null, pendingVisuals = [], visualCache = {at: -1, value: null};
let shownDetail = null, sessionDetails = null, dragging = null, pendingAsk = null, compareData = null, compareSelection = [];
let lastAudioState = null, board = null, lastAgentCall = null, narration = null;
const functionCalls = new Map(), schemas = {page: [], knowledge: []};
let query = '', visibleCount = 24, promotedSessionId = null, scrollObserver;
const batchSize = 24;
const mcpCalls = new Map();
const PAGE_TOOLS = new Set(['highlight_session', 'add_to_agenda', 'remove_from_agenda', 'overview_agenda', 'show_ranked_sessions',
  'open_session_details', 'find_speaker', 'fill_free_time', 'compare_sessions', 'show_how_it_works']);
const TOOL_UI = {
  highlight_session: ['◎', 'var(--c1)', 'Focusing a session'],
  add_to_agenda: ['＋', 'var(--ok)', 'Adding to your agenda'],
  remove_from_agenda: ['−', 'var(--danger)', 'Removing from your agenda'],
  overview_agenda: ['▦', 'var(--sky)', 'Opening your calendar'],
  show_ranked_sessions: ['✦', 'var(--warm)', 'Re-ranking the session list'],
  ignite_search_sessions: ['⌕', 'var(--c3)', 'Searching the catalog'],
  ignite_rank_sessions: ['⇅', 'var(--c4)', 'Ranking by your interests'],
  ignite_get_session: ['ⓘ', 'var(--c3)', 'Reading session details'],
  ignite_validate_agenda: ['✓', 'var(--alert)', 'Checking for conflicts'],
  open_session_details: ['☰', 'var(--sky)', 'Opening session details'],
  find_speaker: ['◍', 'var(--c4)', 'Matching the name by sound'],
  fill_free_time: ['◔', 'var(--ok)', 'Finding your free time'],
  compare_sessions: ['⇄', 'var(--c2)', 'Comparing sessions'],
  show_how_it_works: ['◈', 'var(--c3)', 'Explaining how it drives the page'],
  export_agenda: ['⇩', 'var(--ok)', 'Exporting your agenda'],
};
const BEAMS = {
  rank: ['var(--c1)', 'var(--warm)', 'var(--c4)'], add: ['var(--c1)', 'var(--ok)', 'var(--warm)'],
  remove: ['var(--c3)', 'var(--c4)', 'var(--danger)'], calendar: ['var(--c1)', 'var(--sky)', 'var(--c2)'],
  review: ['var(--warm)', 'var(--alert)', 'var(--danger)'], query: ['var(--c3)', 'var(--c2)', 'var(--c1)'],
};
// Page themes and calendar-only palettes (styles.css). Neon is the original look, kept as backup.
const THEMES = [
  {id: 'aurora', label: 'Aurora', swatch: ['#3ff2c8', '#2ec7e8', '#b7e86a', '#ffd36e']},
  {id: 'ember', label: 'Ember', swatch: ['#ffb347', '#ff6b4a', '#ff3d7f', '#c05cff']},
  {id: 'fluent', label: 'Fluent', swatch: ['#50e6ff', '#3a96ff', '#9b7bff', '#ffb900']},
  {id: 'neon', label: 'Ignite Neon', swatch: ['#46e0d4', '#4c8dff', '#a86bff', '#ff7ad9']},
];
const CALENDARS = [
  {id: 'match', label: 'Match theme', swatch: []},
  {id: 'sunrise', label: 'Sunrise', swatch: ['#ffb347', '#ff6b8a', '#ffe066']},
  {id: 'mint', label: 'Mint', swatch: ['#3ff2c8', '#b7e86a', '#ff8a7a']},
  {id: 'classic', label: 'Microsoft', swatch: ['#00a4ef', '#7fba00', '#f25022']},
];
const DEFAULT_THEME = 'aurora';
const STATE_LABELS = {offline: 'OFFLINE', connecting: 'CONNECTING', listening: 'LISTENING', hearing: 'HEARING YOU',
  thinking: 'THINKING', acting: 'ACTING', speaking: 'SPEAKING'};
// How this page reaches the Voice Agent, named by /api/config. Locally (server.mjs) the browser connects
// straight to Foundry with the developer's az-login token. In the Playground the same socket goes to the
// Playground, which signs in to Foundry with its managed identity and relays every event unchanged.
const TRANSPORTS = {
  'browser-direct': {
    label: 'Browser ⇄ Azure', mode: 'BROWSER-DIRECT VOICE · ALL FUNCTIONS RUN IN THIS PAGE',
    summary: 'This page talks to Azure directly; session search and calendar functions run here.',
    connected: 'Connected directly to Azure. The guide will welcome you. You can interrupt at any time.',
    fact: 'One WebSocket from this browser tab straight to the Foundry Voice Agent, audio both ways, no relay server.',
    step: null,
    failed: 'Voice connection failed. Check az login, the agent and network access to Azure.',
  },
  'playground-bridge': {
    label: 'Browser ⇄ Playground ⇄ Azure', mode: 'PLAYGROUND VOICE · ALL FUNCTIONS RUN IN THIS PAGE',
    summary: 'This page talks to Azure through the Playground, which only relays; session search and calendar functions run here.',
    connected: 'Connected to Azure through the Playground. The guide will welcome you. You can interrupt at any time.',
    fact: 'One WebSocket from this browser tab to the Playground, which relays audio and events to the Foundry Voice Agent unchanged; every function still runs in this page.',
    step: 'This page opens one WebSocket to the Foundry Voice Agent through the Playground, which only relays: your voice streams up, its voice streams back.',
    failed: 'Voice connection failed. Reload the page, sign in again if asked, and retry.',
  },
};
const transport = () => TRANSPORTS[config?.transport] || TRANSPORTS['browser-direct'];
const zone = 'America/Los_Angeles';
const date = new Intl.DateTimeFormat('en-US', {timeZone: zone, month: 'short', day: 'numeric'});
const time = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour: 'numeric', minute: '2-digit'});
const dayNumber = new Intl.DateTimeFormat('en-US', {timeZone: zone, day: '2-digit'});
const clock = new Intl.DateTimeFormat('en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
const timing = session => session.start
  ? `${date.format(new Date(session.start))} · ${time.format(new Date(session.start))}–${time.format(new Date(session.end))} PST`
  : 'No fixed time · On-demand / digital content';
const longDay = new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'long', month: 'short', day: 'numeric'});
const slotParts = new Intl.DateTimeFormat('en-US', {timeZone: zone, day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
// Where a scheduled session sits on the 8 AM–8 PM week grid (64 px per hour).
function slotFor(session) {
  if (!session?.start) return null;
  const parts = slotParts.formatToParts(new Date(session.start));
  const part = type => Number(parts.find(item => item.type === type).value);
  return {day: part('day'), top: ((part('hour') - 8) * 60 + part('minute')) * 64 / 60,
    height: (Date.parse(session.end) - Date.parse(session.start)) / 60000 * 64 / 60};
}
const weekdayOf = new Intl.DateTimeFormat('en-US', {weekday: 'short', timeZone: 'UTC'});
const shortDay = value => `${weekdayOf.format(new Date(`${value}T12:00:00Z`))} ${Number(value.slice(8, 10))}`;
const sortedSessions = () => [...controller.catalog.sessions].sort((a, b) =>
  Number(!a.start) - Number(!b.start) || (a.start || '').localeCompare(b.start || '') || a.id.localeCompare(b.id));
function matchingSessions() {
  const ranking = controller.state.ranking;
  if (ranking) return ranking.instance_ids.map(id => controller.sessions.get(id));
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return sortedSessions().filter(session => {
    if (day === 'untimed' && session.start) return false;
    if (day !== 'all' && day !== 'untimed'
        && (!session.start || dayNumber.format(new Date(session.start)) !== day)) return false;
    const text = `${session.code} ${session.title} ${session.speaker_names_text || ''} ${session.tags.join(' ')} ${session.description || ''}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
}
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function notify(text, failed = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.toggle('failed', failed);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function showError(text) {
  $('error').textContent = text;
  $('error').hidden = false;
  if ($('assistant-panel').hidden) notify(text, true);
}
// The conversation for screen readers; on screen, the live caption shows what is being said.
function message(role, text, metadata = {}) {
  const row = node('p');
  row.dataset.role = role;
  if (metadata.response_id) row.dataset.responseId = metadata.response_id;
  if (metadata.item_id) row.dataset.itemId = metadata.item_id;
  row.append(node('small', '', `${role.toUpperCase()}: `), document.createTextNode(text));
  $('transcript').append(row);
  while ($('transcript').children.length > 30) $('transcript').firstElementChild.remove();
}
// The caption box shows its last three lines; older words scroll out of the top.
function caption(text, role = 'agent') {
  $('live-caption').dataset.role = role;
  $('live-caption').textContent = text.length > 360 ? `…${text.slice(-358)}` : text;
}
function showTyping(open = $('message-form').hidden) {
  $('message-form').hidden = !open;
  $('type-toggle').setAttribute('aria-expanded', String(open));
  if (open && !$('message').disabled) $('message').focus();
}
function showMore(open = $('island-more').hidden) {
  $('island-more').hidden = !open;
  $('more-toggle').setAttribute('aria-expanded', String(open));
}
// The island floats over the page: scroll targets and the detail sheets keep clear of it.
function syncGuideSpace() {
  const root = document.documentElement.style;
  if ($('assistant-panel').hidden) {
    root.removeProperty('--guide-bottom');
    root.removeProperty('--guide-space');
    return;
  }
  const bottom = $('assistant-panel').offsetTop + $('assistant-panel').querySelector('.island').offsetHeight;
  root.setProperty('--guide-bottom', `${bottom}px`);
  root.setProperty('--guide-space', `${Math.max(0, bottom - document.querySelector('.site-header').offsetHeight)}px`);
}
async function openGuide() {
  $('assistant-panel').hidden = false;
  $('guide-launcher').setAttribute('aria-expanded', 'true');
  document.body.classList.add('guide-open');
  syncGuideSpace();
  refreshAgentState();
  if (config.voice_available && !ready && !connecting && !socket) await connect();
}
async function closeGuide() {
  await disconnect();
  $('assistant-panel').hidden = true;
  $('guide-launcher').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('guide-open');
  syncGuideSpace();
  $('guide-launcher').focus();
}
const motionAllowed = fx.motionAllowed;
function finishAnimation(animation, finish) {
  animation.finished.then(finish, error => {
    if (error.name !== 'AbortError') showError(`Calendar animation failed: ${error.message}`);
  });
}

// Where Agent beams start: the island's orb when it is open, otherwise the header launcher's orb.
function orbAnchor() {
  const rect = $($('assistant-panel').hidden ? 'launcher-orb' : 'agent-orb').getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}
// One reading per animation frame for both orbs and the meters: state, levels and the spectrum
// of whoever is talking (the Agent while it speaks, otherwise the open microphone).
function agentVisual() {
  const now = performance.now();
  if (now - visualCache.at < 8) return visualCache.value;
  const live = audio && !audio.disposed;
  const levels = live ? audio.levels() : {input: 0, output: 0};
  let state = 'offline';
  if (Date.now() < actingUntil) state = 'acting';
  else if (connecting && !ready) state = 'connecting';
  else if (ready) state = speaking ? 'speaking' : userSpeaking ? 'hearing' : responding ? 'thinking' : 'listening';
  const source = speaking ? 'output' : ready && ['hearing', 'listening'].includes(state) ? 'input' : null;
  const spectrum = live && source ? audio.spectrum(source) : null;
  visualCache = {at: now, value: {state, ...levels, spectrum}};
  return visualCache.value;
}
// Agent page actions arrive when the reply is generated, usually seconds before its audio has
// played. Spotlight moves wait until the speech queued ahead of them has been heard, so the
// focus reaches session #2 just as the guide starts talking about it.
function whenSpoken(apply) {
  const wait = audio && !audio.disposed && speaking ? audio.snapshot().bufferedSeconds * 1000 - 120 : 0;
  if (wait < 150) { apply(); return; }
  const entry = {apply, timer: setTimeout(() => {
    pendingVisuals = pendingVisuals.filter(item => item !== entry);
    apply();
  }, wait)};
  pendingVisuals.push(entry);
}
function flushVisuals() {
  const pending = pendingVisuals;
  pendingVisuals = [];
  for (const entry of pending) { clearTimeout(entry.timer); entry.apply(); }
}
function applyTheme(theme, calendar, remember = true) {
  if (!THEMES.some(item => item.id === theme)) theme = DEFAULT_THEME;
  if (!CALENDARS.some(item => item.id === calendar)) calendar = 'match';
  document.documentElement.dataset.theme = theme;
  if (calendar === 'match') delete document.documentElement.dataset.calendar;
  else document.documentElement.dataset.calendar = calendar;
  for (const button of document.querySelectorAll('[data-theme-option]'))
    button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
  for (const button of document.querySelectorAll('[data-calendar-option]'))
    button.setAttribute('aria-pressed', String(button.dataset.calendarOption === calendar));
  if (remember) {
    localStorage.setItem('ignite-theme', theme);
    localStorage.setItem('ignite-calendar', calendar);
  }
  dispatchEvent(new Event('ignite:theme'));
}
function buildThemeMenu() {
  const option = (item, kind) => {
    const button = node('button', 'theme-option');
    button.type = 'button';
    button.dataset[`${kind}Option`] = item.id;
    const swatch = node('span', 'swatch');
    for (const color of item.swatch) {
      const dot = node('b');
      dot.style.background = color;
      swatch.append(dot);
    }
    button.append(swatch, document.createTextNode(item.label));
    button.onclick = () => applyTheme(kind === 'theme' ? item.id : document.documentElement.dataset.theme,
      kind === 'calendar' ? item.id : document.documentElement.dataset.calendar || 'match');
    return button;
  };
  $('theme-options').replaceChildren(...THEMES.map(item => option(item, 'theme')));
  $('calendar-options').replaceChildren(...CALENDARS.map(item => option(item, 'calendar')));
  $('theme-toggle').onclick = event => {
    event.stopPropagation();
    $('theme-menu').hidden = !$('theme-menu').hidden;
    $('theme-toggle').setAttribute('aria-expanded', String(!$('theme-menu').hidden));
  };
  document.addEventListener('click', event => {
    if (!$('theme-menu').hidden && !event.target.closest('.theme-picker')) $('theme-menu').hidden = true;
  });
  const params = new URLSearchParams(location.search);
  applyTheme(params.get('theme') || localStorage.getItem('ignite-theme') || DEFAULT_THEME,
    params.get('calendar') || localStorage.getItem('ignite-calendar') || 'match', !params.has('theme'));
}
function refreshAgentState() {
  const {state} = agentVisual();
  const label = $('agent-state');
  if (label.dataset.state !== state) {
    label.dataset.state = state;
    label.textContent = STATE_LABELS[state];
  }
}
function startHud() {
  const frame = () => {
    requestAnimationFrame(frame);
    if (!$('assistant-panel').hidden) refreshAgentState();
  };
  requestAnimationFrame(frame);
}
// The island's function list: the 13 functions exactly as the Agent sees them, with live call counts.
function buildFunctionList(groups) {
  $('function-groups').replaceChildren(...groups.map(({title, note, tools}) => {
    const group = node('section', 'function-group');
    const head = node('div', 'function-group-head');
    head.append(node('span', 'eyebrow', `${title} · ${tools.length}`), node('small', '', note));
    group.append(head);
    for (const tool of tools) {
      const [icon, tone, label] = TOOL_UI[tool.name] || ['•', 'var(--muted)', tool.name];
      const row = node('details', 'function-row');
      row.dataset.tool = tool.name;
      row.style.setProperty('--tone', tone);
      const summary = node('summary');
      const name = node('span', 'function-name');
      name.append(node('code', '', tool.name), node('small', '', label));
      const play = node('button', 'function-run', '▶');
      play.type = 'button';
      play.title = `Run ${tool.name} with example arguments`;
      play.setAttribute('aria-label', `Run ${tool.name}`);
      // The drawer closes first, so the change on the page is visible.
      play.onclick = event => { event.preventDefault(); event.stopPropagation(); showMore(false); runDemo(tool.name); };
      summary.append(node('span', 'activity-icon', icon), name, node('span', 'function-calls', '—'), play);
      const {properties = {}, required = []} = tool.parameters || {};
      const params = node('div', 'function-params');
      for (const key of Object.keys(properties)) {
        const param = node('span', '', required.includes(key) ? key : `${key}?`);
        param.dataset.optional = String(!required.includes(key));
        params.append(param);
      }
      if (!params.children.length) params.append(node('span', '', 'no parameters'));
      const body = node('div', 'function-body');
      body.append(params, node('p', '', tool.description), node('div', 'function-demo', '▶ runs it with example arguments.'));
      row.append(summary, body);
      group.append(row);
    }
    return group;
  }));
  const total = groups.reduce((sum, group) => sum + group.tools.length, 0);
  $('function-count').textContent = total;
  $('functions-total').textContent = total;
}
// What the Agent learns about each explanation step, from this page's real setup, and what to do next.
function howFacts({step, walkthrough}) {
  if (step === 'close') return {};
  const names = tools => tools.map(tool => tool.name);
  const facts = {
    connect: {transport: transport().fact,
      agent: config.agent_name, model: config.model, voice: config.voice},
    register: {knowledge_functions: names(schemas.knowledge), page_functions: names(schemas.page),
      how: 'Each function is registered with the Agent (in its Agent definition) as a name, a description and JSON parameters; the JavaScript that runs it lives in this page.'},
    call: {how: 'From the conversation the Agent chooses a function and sends a function_call with JSON arguments; it has no other way to touch the page.',
      last_call: lastAgentCall},
    execute: {how: 'The page checks the arguments, runs the JavaScript, animates the change and returns function_call_output with a JSON result that the Agent then talks about.'},
    together: {how: 'Clicks, drags and the function list run the very same functions; the page reports them to the Agent as page events, so either of you can act next.'},
  };
  if (!walkthrough) return {...facts[step], next_step: 'The board shows this step. Explain it in one or two short sentences.'};
  return {steps: EXPLAINER_STEPS.map(id => ({step: id, ...facts[id]})),
    next_step: 'Explain it now in exactly five short sentences (at most 25 words each), one per step and in this order: connect, ' +
      'register, call, execute, together, starting them with "First,", "Second,", "Third,", "Fourth," and "Finally,". The board ' +
      'lights each step when you say that word, so do not call any function in this reply. Then ask whether they want to see it live.'};
}
// "Export my agenda": the saved sessions as one .ics file for Outlook, Google or Apple Calendar. The
// download starts on the click itself (so the browser treats it as the attendee's); the show is extra.
function exportAgenda() {
  const sessions = controller.state.agenda.map(id => controller.sessions.get(id)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const button = $('export-agenda');
  if (!sessions.length) {
    notify('Your agenda is empty. Add sessions first, then export them to your calendar.', true);
    if (motionAllowed()) button.animate([0, -7, 7, -5, 5, 0].map(x => ({transform: `translateX(${x}px)`})), {duration: 420});
    return;
  }
  const file = 'ignite-2026-my-agenda.ics';
  const link = node('a');
  link.href = URL.createObjectURL(new Blob([agendaCalendar(sessions, {details: sessionDetails?.sessions})], {type: 'text/calendar;charset=utf-8'}));
  link.download = file;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  const flights = sessions.map(session => {
    const element = $('calendar-events').querySelector(`[data-session-id="${CSS.escape(session.id)}"]`);
    return element && {element, code: session.code, color: element.classList.contains('venue-moscone') ? 'var(--cal-a)' : 'var(--cal-b)'};
  }).filter(Boolean);
  void fx.exportShow(flights, button, {count: sessions.length, fallback: $('calendar-count')});
  notify(`Exported ${sessions.length} session${sessions.length === 1 ? '' : 's'} to ${file}. Open it, or import it in Outlook or Google Calendar.`);
  logActivity('export_agenda', {}, {ok: true, count: sessions.length, file}, 'click');
  if (session && ready) session.note(`[Page event] The attendee exported their agenda (${sessions.map(row => row.code).join(', ')}) ` +
    'as a calendar file (.ics) to import into Outlook or Google Calendar.');
}
// Example arguments for running each function from the function list or the board.
function demoArgs(name) {
  const id = code => controller.catalog.sessions.find(session => session.code === code)?.id;
  const agenda = controller.state.agenda;
  const ranked = () => knowledge.rank({interests: ['voice agents', 'Microsoft Foundry'], date: '2026-11-19'});
  const step = !controller.state.explainer ? undefined : EXPLAINER_STEPS[EXPLAINER_STEPS.indexOf(controller.state.explainer) + 1] ?? 'close';
  return {
    ignite_search_sessions: {keywords: ['voice agents'], related_terms: ['speech', 'telephony'], limit: 5},
    ignite_rank_sessions: {interests: ['voice agents', 'Microsoft Foundry'], related_terms: ['speech', 'telephony', 'real-time'], date: '2026-11-19'},
    ignite_get_session: {instance_id: id('BRK244')},
    ignite_validate_agenda: {instance_ids: agenda.length ? agenda : [id('BRK241'), id('BRK248')]},
    show_ranked_sessions: () => { const result = ranked(); return {instance_ids: result.sessions.map(row => row.id), interests: result.interests}; },
    highlight_session: {instance_id: id('BRK244')},
    open_session_details: {instance_id: id('BRK244')},
    add_to_agenda: {instance_ids: [id('BRK244')]},
    remove_from_agenda: {instance_id: agenda.at(-1) || id('BRK244')},
    overview_agenda: {},
    find_speaker: {name: 'ding ding lou'},
    fill_free_time: {date: '2026-11-18'},
    compare_sessions: {instance_ids: [id('BRK241'), id('BRK248')]},
    show_how_it_works: step ? {step} : {},
  }[name];
}
// Runs one function with example arguments through the same dispatchers the Agent's calls use,
// shows what went in and what came out, and tells the Agent what the presenter just ran.
function runDemo(name) {
  let args = demoArgs(name);
  if (typeof args === 'function') args = args();
  let result;
  if (KNOWLEDGE_TOOLS.has(name)) {
    result = knowledge.execute(name, args);
    showKnowledgeResult(`demo-${crypto.randomUUID()}`, name, args, result, 'demo');
  } else result = execute(name, args, 'demo');
  const ok = result.ok !== false && !result.isError;
  if (session && ready && name !== 'show_how_it_works')
    session.note(`[Page event] The presenter ran ${name} from the function list with ${JSON.stringify(args)}; it ${ok ? 'succeeded' : 'failed'}.`);
  const box = $('function-groups').querySelector(`[data-tool="${CSS.escape(name)}"] .function-demo`);
  if (box) {
    const json = JSON.stringify(result);
    box.replaceChildren(node('code', '', `→ ${name}(${JSON.stringify(args)})`),
      node('code', ok ? '' : 'failed', `← ${json.length > 420 ? `${json.slice(0, 420)}…` : json}`));
  }
  return result;
}
function countFunctionCall(name) {
  const calls = (functionCalls.get(name) || 0) + 1;
  functionCalls.set(name, calls);
  const row = $('function-groups').querySelector(`[data-tool="${CSS.escape(name)}"]`);
  if (!row) return;
  row.querySelector('.function-calls').textContent = `×${calls}`;
  row.dataset.called = 'true';
  row.dataset.flash = 'false';
  void row.offsetWidth;
  row.dataset.flash = 'true';
}
function markActing(name) {
  actingUntil = Date.now() + 1400;
  refreshAgentState();
  setTimeout(refreshAgentState, 1450);
}

function removeCalendarEvent(event) {
  if (event.dataset.exiting === 'true') return;
  if (!motionAllowed()) { event.remove(); return; }
  event.dataset.exiting = 'true';
  event.disabled = true;
  event.setAttribute('aria-hidden', 'true');
  const animation = event.animate([
    {opacity: 1, transform: 'translateX(0) scale(1)', filter: 'blur(0) brightness(1)'},
    {opacity: .9, transform: 'translateX(-3px) scale(1.04)', filter: 'blur(0) brightness(2)', offset: .25},
    {opacity: 0, transform: 'translateX(6px) scale(.7)', filter: 'blur(3px) brightness(2.5)'},
  ], {duration: 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards'});
  finishAnimation(animation, () => {
    if (!controller.state.agenda.includes(event.dataset.sessionId)) event.remove();
  });
}
function animateCalendarAddition(id, origin, reveal = true, stagger = 0) {
  if (!motionAllowed()) return;
  const target = $('calendar-events').querySelector(`[data-session-id="${id}"]`);
  const sidebar = $('agenda-view');
  let destination = target.getBoundingClientRect();
  const bounds = sidebar.getBoundingClientRect();
  if (reveal && destination.bottom > bounds.bottom - 20) sidebar.scrollTop += destination.bottom - bounds.bottom + 35;
  if (reveal && destination.top < bounds.top + 20) sidebar.scrollTop -= bounds.top + 35 - destination.top;
  destination = target.getBoundingClientRect();
  const visibleOrigin = origin && origin.bottom > 0 && origin.top < innerHeight && origin.right > 0 && origin.left < innerWidth;
  const delay = (visibleOrigin ? 450 : 0) + stagger;
  const arrival = target.animate([
    {opacity: 0, transform: 'scale(.72) translateY(8px)', filter: 'brightness(3)'},
    {opacity: 1, transform: 'scale(1.055) translateY(-2px)', filter: 'brightness(1.6)', offset: .7},
    {opacity: 1, transform: 'scale(1) translateY(0)', filter: 'brightness(1)'},
  ], {delay, duration: 380, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'});
  finishAnimation(arrival, () => {});
  setTimeout(() => fx.burst(target, target.classList.contains('venue-moscone') ? 'var(--cal-a)' : 'var(--cal-b)'), delay + 180);
  if (!visibleOrigin) return;
  const ghost = node('div', 'agenda-flight', `${controller.sessions.get(id).code}  →  Your agenda`);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.left = `${origin.left + origin.width / 2 - 86}px`;
  ghost.style.top = `${origin.top + origin.height / 2 - 22}px`;
  document.body.append(ghost);
  const start = ghost.getBoundingClientRect();
  const dx = destination.left + destination.width / 2 - start.left - start.width / 2;
  const dy = destination.top + destination.height / 2 - start.top - start.height / 2;
  const flight = ghost.animate([
    {opacity: 0, transform: 'translate(0,0) scale(.85) rotate(-3deg)'},
    {opacity: 1, transform: 'translate(0,-6px) scale(1) rotate(-3deg)', offset: .12},
    {opacity: 1, transform: `translate(${dx * .55}px,${dy * .5 - 55}px) scale(.95) rotate(4deg)`, offset: .6},
    {opacity: 0, transform: `translate(${dx}px,${dy}px) scale(.55) rotate(0)`},
  ], {duration: 720, easing: 'cubic-bezier(.4,0,.2,1)'});
  finishAnimation(flight, () => ghost.remove());
}
function createSessionCard(session) {
  const card = $('session-template').content.firstElementChild.cloneNode(true);
  card.dataset.sessionId = session.id;
  card.querySelector('.session-code').textContent = session.code;
  card.querySelector('.session-format').textContent = `${session.session_type || 'SESSION'}${session.duration_minutes ? ` / ${session.duration_minutes} MIN` : ''}`;
  const title = card.querySelector('.session-title');
  title.textContent = session.title;
  // A click anywhere on the card (except its own buttons and link) opens the detail sheet.
  card.onclick = event => {
    if (event.target.closest('.add-session, .session-source, .compare-toggle')) return;
    execute('open_session_details', {instance_id: session.id}, 'click');
  };
  card.querySelector('.compare-toggle').onclick = () => toggleCompare(session.id);
  card.draggable = Boolean(session.start);
  card.ondragstart = event => startDrag(event, 'add', session, card);
  card.querySelector('.session-summary').textContent = session.description || session.summary;
  card.querySelector('.session-takeaway').textContent = session.takeaway;
  card.querySelector('.session-takeaway').hidden = !session.takeaway;
  card.querySelector('.speaker-names').textContent = session.speaker_names_text || 'Speakers not published';
  for (const speaker of session.speakers.slice(0, 3)) {
    const initials = speaker.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('');
    card.querySelector('.speaker-avatars').append(node('span', 'speaker-avatar', initials));
  }
  if (session.speakers.length > 3)
    card.querySelector('.speaker-avatars').append(node('span', 'speaker-avatar more-speakers', `+${session.speakers.length - 3}`));
  for (const tag of session.tags) card.querySelector('.card-tags').append(node('span', 'tag', tag));
  card.querySelector('.session-time').textContent = timing(session);
  card.querySelector('.session-location').textContent = session.location || 'Location not published';
  card.querySelector('.session-source').href = session.url;
  const add = card.querySelector('.add-session');
  add.disabled = !session.start;
  add.onclick = () => {
    const saved = controller.state.agenda.includes(session.id);
    execute(saved ? 'remove_from_agenda' : 'add_to_agenda',
      saved ? {instance_id: session.id} : {instance_ids: [session.id]}, 'click');
  };
  return card;
}
function renderSessions() {
  const {state} = controller;
  const ranking = state.ranking;
  const matching = matchingSessions();
  const promoted = matching.find(session => session.id === promotedSessionId);
  const visible = matching.slice(0, visibleCount).filter(session => session !== promoted);
  if (promoted) visible.unshift(promoted);
  const more = visible.length < matching.length;
  $('session-count').textContent = `${controller.catalog.sessions.length.toLocaleString()} SESSIONS`;
  $('all-count').textContent = controller.catalog.sessions.length.toLocaleString();
  const mode = ranking?.label || 'ranked';
  $('section-title').textContent = !ranking ? 'Find your next breakthrough.' : mode === 'speaker' ? `Sessions with ${ranking.speaker.name}.`
    : mode === 'free-time' ? 'Made for your free time.' : 'Ranked for your interests.';
  $('ranking-banner').hidden = !ranking;
  if (ranking) renderBanner(ranking);
  renderSpeakerChoice();
  $('result-count').textContent = ranking
    ? mode === 'speaker' ? `${matching.length} session${matching.length === 1 ? '' : 's'} with ${ranking.speaker.name} · matched by sound`
      : mode === 'free-time' ? `${matching.length} sessions fit your free time on ${shortDay(ranking.date)}`
        : `Top ${matching.length} of ${controller.catalog.sessions.length.toLocaleString()} · ranked by the voice agent`
    : matching.length
      ? `${visible.length.toLocaleString()} of ${matching.length.toLocaleString()} sessions shown`
      : 'No matching sessions. Try another keyword or day.';
  $('load-more').hidden = !more;
  $('scroll-status').textContent = ranking ? 'Ranked shortlist. Choose “Show all sessions” to browse the full catalog.'
    : more ? 'Keep scrolling — more sessions load automatically.'
      : matching.length ? 'All matching sessions loaded.' : 'No matching sessions.';
  $('scroll-sentinel').dataset.complete = String(!more);
  const container = $('sessions');
  container.setAttribute('aria-busy', 'true');
  const existing = new Map([...container.children].map(card => [card.dataset.sessionId, card]));
  let cursor = container.firstElementChild;
  for (const [index, session] of visible.entries()) {
    const card = existing.get(session.id) || createSessionCard(session);
    existing.delete(session.id);
    card.dataset.highlighted = String(shownHighlight === session.id);
    card.querySelector('.discussion-label').hidden = shownHighlight !== session.id;
    card.setAttribute('aria-posinset', String(index + 1));
    card.setAttribute('aria-setsize', String(matching.length));
    const badge = card.querySelector('.rank-badge'), chips = card.querySelector('.interest-chips');
    const ranked = ranking && mode !== 'speaker';
    badge.hidden = !ranked;
    chips.hidden = !ranking?.interests.length;
    if (ranking?.interests.length) {
      // Sessions added only to reach five (partial or related matches) say so instead of claiming a match.
      const matched = knowledge.matchedInterests(session.id, ranking.interests);
      chips.replaceChildren(...(matched.length ? matched.map(interest => node('span', '', interest)) : [node('span', 'looser', 'looser match')]));
    }
    if (ranked) {
      card.dataset.rank = String(index + 1);
      card.dataset.topPick = String(mode === 'ranked' && index < 3);
      badge.replaceChildren(document.createTextNode(`#${index + 1}`), ...(mode === 'ranked' && index < 3 ? [node('small', '', 'TOP PICK')] : []));
    } else {
      delete card.dataset.rank;
      delete card.dataset.topPick;
    }
    card.querySelector('.compare-toggle').setAttribute('aria-pressed', String(compareSelection.includes(session.id)));
    const add = card.querySelector('.add-session');
    const saved = state.agenda.includes(session.id);
    add.textContent = saved ? 'Added ✓ · Remove' : session.start ? 'Add to agenda +' : 'No fixed time';
    add.classList.toggle('saved', saved);
    if (card === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(card, cursor);
  }
  for (const card of existing.values()) card.remove();
  container.setAttribute('aria-busy', 'false');
}
const initialsOf = name => name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
// The banner above a shortlist says why it is shown: interests, one speaker, or free time.
function renderBanner(ranking) {
  const mode = ranking.label || 'ranked';
  $('ranking-banner').dataset.mode = mode;
  if (mode === 'speaker') {
    const {speaker} = ranking;
    $('ranking-glyph').textContent = initialsOf(speaker.name);
    $('ranking-eyebrow').textContent = 'SESSIONS WITH THIS SPEAKER · MATCHED BY SOUND';
    const who = node('b', '', speaker.name), role = node('span', 'banner-role', [speaker.job_title, speaker.company].filter(Boolean).join(' · '));
    const heard = node('span', 'banner-heard', `heard “${speaker.heard}” · ${Math.round(speaker.confidence * 100)}%`);
    $('ranking-interests').replaceChildren(who, role, heard);
  } else if (mode === 'free-time') {
    $('ranking-glyph').textContent = '◔';
    $('ranking-eyebrow').textContent = `FITS YOUR FREE TIME · ${shortDay(ranking.date).toUpperCase()}`;
    $('ranking-interests').replaceChildren(...ranking.windows.map(window => node('b', 'banner-window', window)),
      ...(ranking.interests.length ? [node('span', 'banner-role', `ranked for ${ranking.interests.join(' · ')}`)] : []));
  } else {
    $('ranking-glyph').textContent = '✦';
    // When the list had to be filled with looser matches, the banner says so, like the Agent does.
    const looser = ranking.instance_ids.filter(id => !knowledge.matchedInterests(id, ranking.interests).length).length;
    $('ranking-eyebrow').textContent = looser === ranking.instance_ids.length ? 'NO DIRECT MATCHES · CLOSEST SESSIONS'
      : looser ? `RANKED FOR YOU · ${looser} LOOSER MATCH${looser === 1 ? '' : 'ES'} ADDED` : 'RANKED FOR YOU BY THE VOICE AGENT';
    $('ranking-interests').replaceChildren(...ranking.interests.map(interest => node('b', '', interest)));
  }
}
// "Did you mean…?": the people a doubtful or shared name could be. Never resolved by guessing.
function renderSpeakerChoice() {
  const choice = controller.state.speakerChoice;
  $('speaker-choice').hidden = !choice;
  if (!choice) return;
  $('speaker-choice-eyebrow').textContent = choice.status === 'multiple_matches' ? 'SEVERAL SPEAKERS FIT — WHICH ONE?' : 'NOT SURE — DID YOU MEAN…?';
  $('speaker-choice-heard').textContent = `Heard “${choice.heard}”`;
  $('speaker-choice-list').replaceChildren(...choice.people.map(person => {
    const button = node('button', 'speaker-option');
    button.type = 'button';
    const meter = node('i');
    meter.style.setProperty('--score', String(person.confidence));
    const text = node('div');
    text.append(node('strong', '', person.name), node('small', '', [person.job_title, person.company].filter(Boolean).join(' · ')),
      node('small', 'speaker-option-meta', `${person.session_count} session${person.session_count === 1 ? '' : 's'} · sounds ${Math.round(person.confidence * 100)}% alike`));
    button.append(node('span', 'speaker-avatar', initialsOf(person.name)), text, meter);
    button.onclick = () => execute('find_speaker', {name: person.name}, 'click');
    return button;
  }));
}
function renderGaps() {
  for (const gap of document.querySelectorAll('.calendar-gap')) gap.remove();
  for (const button of document.querySelectorAll('.day-free')) button.dataset.active = String(controller.state.gaps?.date === button.dataset.freeDate);
  const gaps = controller.state.gaps;
  if (!gaps) return;
  const column = $('calendar-events').querySelector(`[data-calendar-day="${Number(gaps.date.slice(8, 10))}"]`);
  if (!column) return;
  gaps.windows.forEach((window, index) => {
    const minutes = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
    const block = node('div', 'calendar-gap');
    block.style.top = `${(minutes(window.start) - 8 * 60) * 64 / 60}px`;
    block.style.height = `${(minutes(window.end) - minutes(window.start)) * 64 / 60}px`;
    block.style.animationDelay = `${index * 120}ms`;
    block.append(node('strong', '', 'FREE'), node('span', '', `${window.start}–${window.end}`), node('small', '', `${window.count} fit`));
    column.append(block);
  });
}
// Side-by-side comparison. Rows whose values differ are marked; the facts come from PageController.
function renderCompare() {
  if (!compareData) return;
  const {sessions, differences, same_time: sameTime, interests} = compareData;
  const grid = $('compare-grid');
  grid.style.setProperty('--columns', String(sessions.length));
  const cell = (content, className = 'compare-cell') => {
    const element = node('div', className);
    element.setAttribute('role', 'cell');
    if (typeof content === 'string') element.textContent = content;
    else element.append(...[content].flat().filter(Boolean));
    return element;
  };
  const rows = [];
  // A row is marked when any of the facts it shows differs between the sessions.
  const row = (label, fields, values) => {
    const line = node('div', 'compare-row');
    line.setAttribute('role', 'row');
    if (fields) line.dataset.differs = String(fields.some(field => differences.includes(field)));
    line.append(cell(label, 'compare-label'), ...values.map(value => cell(value)));
    rows.push(line);
  };
  const header = node('div', 'compare-row compare-head');
  header.setAttribute('role', 'row');
  header.append(cell('', 'compare-label'), ...sessions.map(session => {
    const title = node('button', 'compare-title', session.title);
    title.type = 'button';
    title.onclick = () => { closeCompare(); execute('open_session_details', {instance_id: session.id}, 'click'); };
    return cell([node('span', 'compare-code', session.code), title]);
  }));
  rows.push(header);
  row('When', ['day', 'time'], sessions.map(session => `${session.day ?? 'On-demand'} · ${session.time ?? ''}`));
  row('Where', ['venue'], sessions.map(session => session.location || 'Not published'));
  row('Format', ['session_type', 'levels', 'duration_minutes'], sessions.map(session => [session.session_type, ...session.levels.map(level => level.replace(/^\((\d+)\)\s*/, '$1 · ')),
    session.duration_minutes && `${session.duration_minutes} min`].filter(Boolean).join(' · ')));
  row('Speakers', null, sessions.map(session => session.speakers.length ? session.speakers.map(person =>
    node('span', 'compare-person', [person.name, person.job_title, person.company].filter(Boolean).join(' · '))) : 'Not published'));
  row('Topics', ['topics'], sessions.map(session => session.topics.join(' · ') || '—'));
  row('Watch', ['delivery', 'recorded'], sessions.map(session => [...session.delivery, session.recorded ? 'Recorded' : 'Not recorded'].join(' · ')));
  row('Your agenda', null, sessions.map(session => {
    const fit = session.agenda_fit;
    const parts = [fit.saved ? '✓ Saved' : 'Not saved', ...fit.overlaps.map(other => `⚠ overlaps ${other.code}`),
      ...fit.transfers.map(transfer => `⇢ ${transfer.gap_minutes} min ${transfer.direction} ${transfer.code}`)];
    return parts.join(' · ');
  }));
  if (interests.length) row('Your interests', null, sessions.map(session => session.interest_match.length ? `✓ ${session.interest_match.join(' · ')}` : '—'));
  const actions = node('div', 'compare-row compare-actions');
  actions.append(cell('', 'compare-label'), ...sessions.map(session => {
    const saved = controller.state.agenda.includes(session.id);
    const add = node('button', `button ${saved ? 'ghost-button' : 'button-primary'}`, saved ? 'Remove' : 'Add to agenda +');
    add.type = 'button';
    add.disabled = !session.time;
    add.onclick = () => execute(saved ? 'remove_from_agenda' : 'add_to_agenda', saved ? {instance_id: session.id} : {instance_ids: [session.id]}, 'click',
      saved ? {} : {origin: add.getBoundingClientRect()});
    return cell(add);
  }));
  rows.push(actions);
  grid.replaceChildren(...rows);
  const recorded = sessions.filter(session => session.recorded).map(session => session.code);
  $('compare-note').hidden = !sameTime;
  $('compare-note').textContent = sameTime
    ? `⚠ These run at the same time, so you can attend only one live.${recorded.length ? ` Recorded: ${recorded.join(', ')}.` : ''}` : '';
}
function openCompare({fromAgent = false} = {}) {
  const wasOpen = !$('compare-layer').hidden;
  closeDetail();
  renderCompare();
  showMore(false);
  $('compare-layer').hidden = false;
  if (motionAllowed()) {
    $('compare-sheet').animate([{opacity: 0, transform: 'translateY(24px) scale(.97)'}, {opacity: 1, transform: 'none'}],
      {duration: wasOpen ? 260 : 460, easing: 'cubic-bezier(.16,1,.3,1)'});
    for (const [index, column] of [...$('compare-grid').querySelectorAll('.compare-row')].entries())
      column.animate([{opacity: 0, transform: 'translateX(-12px)'}, {opacity: 1, transform: 'none'}], {duration: 360, delay: 60 + index * 45, fill: 'backwards'});
  }
  if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('compare-sheet'), {colors: BEAMS.query}), motionAllowed() ? 380 : 0);
  $('close-compare').focus({preventScroll: true});
}
function closeCompare() {
  if ($('compare-layer').hidden) return;
  $('compare-layer').hidden = true;
  controller.state.compare = null;
  compareData = null;
}
function refreshCompare() {
  if (compareData && controller.state.compare) {
    compareData = controller.execute('compare_sessions', {instance_ids: controller.state.compare});
    renderCompare();
  }
}
// The compare tray collects cards the attendee toggles with ⇄; two or three can be compared.
function toggleCompare(id) {
  compareSelection = compareSelection.includes(id) ? compareSelection.filter(item => item !== id) : [...compareSelection, id].slice(-3);
  renderCompareTray();
  renderSessions();
}
function renderCompareTray() {
  $('compare-tray').hidden = !compareSelection.length;
  const codes = compareSelection.map(id => controller.sessions.get(id).code);
  $('compare-tray-text').textContent = compareSelection.length < 2 ? `${codes[0]} · pick one or two more to compare` : `Compare ${codes.join(' vs ')}`;
  $('compare-go').disabled = compareSelection.length < 2;
}
function loadMoreSessions() {
  const total = matchingSessions().length;
  if (visibleCount >= total) return;
  visibleCount = Math.min(total, visibleCount + batchSize);
  renderSessions();
}
function resetSessionFeed() {
  visibleCount = batchSize;
  promotedSessionId = null;
}
function syncDayFilters() {
  for (const filter of document.querySelectorAll('[data-day]')) {
    filter.classList.toggle('active', filter.dataset.day === day);
    filter.setAttribute('aria-pressed', String(filter.dataset.day === day));
  }
}
function render() {
  const {state} = controller;
  const isAgenda = state.view === 'agenda';
  $('agenda-count').textContent = state.agenda.length;
  $('calendar-count').textContent = `${state.agenda.length} saved`;
  $('sessions-tab').classList.toggle('active', !isAgenda);
  $('sessions-tab').setAttribute('aria-pressed', String(!isAgenda));
  renderSessions();
  const agenda = controller.agenda();
  const placement = layoutCalendarSessions(agenda.sessions, zone);
  const savedIds = new Set(state.agenda);
  for (const event of $('calendar-events').querySelectorAll('.calendar-event')) {
    if (!savedIds.has(event.dataset.sessionId)) removeCalendarEvent(event);
  }
  if (!$('calendar-events').children.length) {
    for (let day = 16; day <= 20; day++) {
      const column = node('div', 'calendar-day-events');
      column.dataset.calendarDay = day;
      $('calendar-events').append(column);
    }
  }
  if (!$('calendar-hours').children.length) {
    for (let hour = 8; hour < 20; hour++) {
      const label = node('span', '', `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'p' : 'a'}`);
      label.style.top = `${(hour - 8) * 64}px`;
      $('calendar-hours').append(label);
    }
  }
  $('agenda-list').replaceChildren();
  $('empty-agenda').hidden = agenda.sessions.length > 0;
  for (const session of agenda.sessions) {
    const slot = slotFor(session);
    let event = $('calendar-events').querySelector(`[data-session-id="${session.id}"]`);
    if (!event) {
      event = node('button', `calendar-event ${session.location?.startsWith('Moscone') ? 'venue-moscone' : 'venue-amc'}`);
      $('calendar-events').querySelector(`[data-calendar-day="${slot.day}"]`).append(event);
    } else if (event.dataset.exiting === 'true') {
      for (const animation of event.getAnimations()) animation.cancel();
      delete event.dataset.exiting;
      event.disabled = false;
      event.removeAttribute('aria-hidden');
    }
    event.dataset.sessionId = session.id;
    const lane = placement.get(session.id);
    const {top} = slot;
    event.style.left = `calc(${lane.column * 100 / lane.columns}% + 2px)`;
    event.style.width = `max(1px, calc(${100 / lane.columns}% - 4px))`;
    event.dataset.overlap = String(lane.columns > 1);
    event.style.top = `${top}px`;
    event.style.height = `${slot.height}px`;
    event.style.setProperty('--scan-delay', `${(top / 768 * 1.1).toFixed(2)}s`);
    event.title = `${session.title}\n${timing(session)}\n${session.location}`;
    event.setAttribute('aria-label', `${session.code}, ${timing(session)}, ${session.title}, ${session.location}`);
    event.replaceChildren(node('strong', '', session.code), node('span', '', session.title));
    event.onclick = () => execute('open_session_details', {instance_id: session.id}, 'click');
    event.draggable = true;
    event.ondragstart = drag => startDrag(drag, 'remove', session, event);
    const transfer = agenda.transfers.find(item => item.to === session.id);
    if (transfer) {
      const notice = node('div', 'transfer-note');
      notice.append(node('strong', '', `${transfer.gap_minutes} min transfer window`),
        node('span', '', `${transfer.from_venue} → ${transfer.to_venue}. Route and walking time not verified.`));
      $('agenda-list').append(notice);
    }
    const row = node('article', 'agenda-item');
    row.dataset.sessionId = session.id;
    const clockCell = node('div', 'agenda-time');
    clockCell.append(node('strong', '', date.format(new Date(session.start))),
      document.createTextNode(`${time.format(new Date(session.start))}–${time.format(new Date(session.end))} PST`));
    const description = node('div');
    description.append(node('div', 'eyebrow', session.code), node('h3', '', session.title),
      node('div', 'agenda-location', session.location));
    const remove = node('button', 'remove-session', '×');
    remove.setAttribute('aria-label', `Remove ${session.code} from agenda`);
    remove.onclick = () => execute('remove_from_agenda', {instance_id: session.id}, 'click');
    row.append(clockCell, description, remove);
    $('agenda-list').append(row);
  }
  renderGaps();
}

// One readable line per Agent (or attendee) action in the panel's activity feed.
function describe(name, args, result) {
  if (result.ok === false || result.isError)
    return [`${TOOL_UI[name]?.[2] || name} failed`, result.error?.message || result.error || 'No change was made.'];
  if (name === 'highlight_session') return [`Focused ${result.highlighted.code}`, result.highlighted.title];
  if (name === 'open_session_details') return [`Opened ${result.opened.code} details`, result.opened.title];
  if (name === 'find_speaker') {
    if (result.status === 'one_match') return [`Found ${result.speaker.name}`, `heard “${result.heard}” · ${[result.speaker.job_title, result.speaker.company].filter(Boolean).join(' · ')}`];
    const options = result.matches || result.did_you_mean || [];
    if (result.status === 'multiple_matches') return [`${options.length} speakers fit “${result.heard}”`, options.map(person => person.name).join(' · ')];
    return options.length ? [`Not sure who “${result.heard}” is`, `Did you mean ${options.map(person => person.name).join(' or ')}?`]
      : [`No speaker sounds like “${result.heard}”`, 'Asking to spell it'];
  }
  if (name === 'fill_free_time') return [`${result.free_windows.length} free window${result.free_windows.length === 1 ? '' : 's'} on ${shortDay(result.date)}`,
    result.free_windows.map(window => `${window.start}–${window.end}`).join(' · ') || 'No free time between 9 and 6'];
  if (name === 'export_agenda') return [`Exported ${result.count} session${result.count === 1 ? '' : 's'} to your calendar file`, result.file];
  if (name === 'show_how_it_works') return [result.open ? `How it works · step ${result.position}` : 'Closed the how-it-works board', result.step];
  if (name === 'compare_sessions') return [`Compared ${result.sessions.map(row => row.code).join(' vs ')}`,
    result.same_time ? 'same time slot' : `differ in ${result.differences.join(', ') || 'nothing listed'}`];
  if (name === 'add_to_agenda') return [`Added ${result.added_count} to your agenda`,
    [...result.added.map(item => item.code), ...(result.rejected.length ? [`${result.rejected.length} rejected`] : [])].join(' · ') || 'Already saved'];
  if (name === 'remove_from_agenda') return [`Removed ${result.removed.code}`, result.removed.title];
  if (name === 'overview_agenda') return ['Opened your calendar', `${result.agenda.sessions.length} saved · ${result.agenda.transfers.length} venue changes`];
  if (name === 'show_ranked_sessions') return result.mode === 'ranked'
    ? [`Re-ranked the list · top ${result.shown_count}`, args.interests.join(' · ')] : ['Restored the full catalog', `${result.shown_count.toLocaleString()} sessions`];
  if (name === 'ignite_search_sessions') return [`Searched “${args.keywords.join(', ') || 'all'}”`, `${result.sessions.length} of ${result.total} matches${args.date ? ` · ${shortDay(args.date)}` : ''}`];
  if (name === 'ignite_rank_sessions') return [result.looser_matches_added
    ? `Ranked ${result.total_matches} matches + ${result.looser_matches_added} looser` : `Ranked ${result.total_matches} matching sessions`,
  `for ${result.interests.join(' · ')}`];
  if (name === 'ignite_get_session') return [`Read ${result.session.code}`, result.session.title];
  if (name === 'ignite_validate_agenda') return ['Checked your agenda', `${result.conflict_count} overlaps · ${result.transfer_count} venue changes · nothing changed`];
  return [name, ''];
}
function logActivity(name, args, result, source) {
  const [icon, tone] = TOOL_UI[name] || ['•', 'var(--muted)'];
  const [title, detail] = describe(name, args, result);
  const row = node('li');
  row.dataset.tool = name;
  row.dataset.source = source;
  row.dataset.ok = String(result.ok !== false && !result.isError);
  row.style.setProperty('--tone', tone);
  const text = node('div', 'activity-text');
  text.append(node('strong', '', title), node('small', '', detail));
  const who = source === 'agent' || source === 'knowledge' ? 'AGENT' : source === 'click' || source === 'drag' ? 'YOU' : source.toUpperCase();
  row.append(node('span', 'activity-icon', icon), text, node('span', 'activity-meta', `${who}\n${clock.format(new Date())}`));
  $('tool-log').prepend(row);
  while ($('tool-log').children.length > 25) $('tool-log').lastElementChild.remove();
  actionCount++;
  $('action-count').textContent = actionCount;
  // The latest action also shows on the island itself, next to the Agent's state.
  const last = $('last-action');
  last.replaceChildren(node('span', 'activity-icon', icon), node('span', '', detail ? `${title} · ${detail}` : title));
  last.style.setProperty('--tone', tone);
  last.dataset.source = who;
  last.hidden = false;
  last.style.animation = 'none';
  void last.offsetWidth;
  last.style.animation = '';
  if (who === 'AGENT') countFunctionCall(name);
}

// Tell the Agent what the attendee just did by hand, so "this one" works. Never starts a reply.
function notePageEvent(name, result) {
  if (!session || !ready || !result.ok) return;
  const item = result.highlighted || result.opened || result.removed || result.added?.[0];
  const text = name === 'highlight_session' ? `selected ${item.code} “${item.title}” (instance_id ${item.id})`
    : name === 'open_session_details' ? `opened the details of ${item.code} “${item.title}” (instance_id ${item.id})`
    : name === 'add_to_agenda' && item ? `added ${result.added.map(added => `${added.code} (instance_id ${added.id})`).join(', ')} to the agenda`
      : name === 'remove_from_agenda' ? `removed ${item.code} (instance_id ${item.id}) from the agenda`
        : name === 'overview_agenda' ? 'opened the calendar'
          : name === 'show_ranked_sessions' ? 'cleared the ranked shortlist and returned to the full catalog'
            : name === 'find_speaker' && result.status === 'one_match' ? `chose speaker ${result.speaker.name} (${[result.speaker.job_title, result.speaker.company].filter(Boolean).join(', ')}); their sessions are listed`
              : name === 'fill_free_time' ? `asked for sessions that fit their free time on ${result.date}; free windows ${result.free_windows.map(window => `${window.start}-${window.end}`).join(', ') || 'none'}`
                : name === 'compare_sessions' ? `opened a side-by-side comparison of ${result.sessions.map(row => `${row.code} (instance_id ${row.id})`).join(' and ')}` : null;
  if (text) session.note(`[Page event] The attendee ${text}.`);
}
function execute(name, args, source = 'agent', options = {}) {
  const removing = name === 'remove_from_agenda' && typeof args?.instance_id === 'string'
    ? $('calendar-events').querySelector(`[data-session-id="${CSS.escape(args.instance_id)}"]`) : null;
  // Bring the Agent's removal into view first, so the block is seen breaking apart.
  if (removing && source === 'agent') removing.scrollIntoView({block: 'nearest', behavior: 'instant'});
  const removedRect = removing?.getBoundingClientRect() ?? null;
  const result = controller.execute(name, args);
  if (name === 'open_session_details' && result.ok) Object.assign(result, controller.sessionFacts(result.opened.id));
  if (name === 'show_how_it_works' && result.ok) Object.assign(result, howFacts(result));
  const fromAgent = source === 'agent';
  if (fromAgent && name !== 'show_how_it_works') lastAgentCall = {name, arguments: args, ok: result.ok};
  if (result.ok) {
    const origins = new Map(name === 'add_to_agenda' ? result.added.map(session => [
      session.id, $('sessions').querySelector(`[data-session-id="${session.id}"] .add-session`)?.getBoundingClientRect(),
    ]) : []);
    if (name === 'highlight_session') {
      const id = result.highlighted.id;
      const show = () => {
        shownHighlight = id;
        day = 'all'; query = ''; $('catalog-search').value = '';
        if (controller.state.ranking) promotedSessionId = null;
        else if (promotedSessionId !== id)
          promotedSessionId = sortedSessions().slice(0, visibleCount).some(session => session.id === id) ? null : id;
        if (shownDetail && shownDetail !== id) closeDetail();
        render();
        syncDayFilters();
        const card = $('sessions').querySelector('[data-highlighted="true"]');
        card?.scrollIntoView({block: 'center', behavior: 'instant'});
        fx.lockOn(card);
        if (fromAgent) fx.beam(orbAnchor(), card);
      };
      if (fromAgent) whenSpoken(show);
      else show();
    } else if (name === 'open_session_details') {
      const id = result.opened.id;
      const show = () => {
        shownHighlight = id;
        if (result.ranking_cleared) { day = 'all'; query = ''; $('catalog-search').value = ''; resetSessionFeed(); syncDayFilters(); }
        render();
        openDetail(id, {fromAgent});
      };
      if (fromAgent) whenSpoken(show);
      else show();
    } else if (name === 'find_speaker') {
      closeDetail();
      if (fromAgent) showSpeakerQuery(args, result);
      if (result.status === 'one_match') {
        day = 'all'; query = ''; $('catalog-search').value = '';
        resetSessionFeed();
        syncDayFilters();
        fx.reflow($('sessions'), render);
        $('program').scrollIntoView({block: 'start', behavior: motionAllowed() ? 'smooth' : 'instant'});
        if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('ranking-banner'), {colors: BEAMS.rank}), motionAllowed() ? 450 : 0);
      } else {
        render();
        if (!$('speaker-choice').hidden) {
          $('speaker-choice').scrollIntoView({block: 'center', behavior: motionAllowed() ? 'smooth' : 'instant'});
          if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('speaker-choice'), {colors: BEAMS.query}), motionAllowed() ? 450 : 0);
        }
      }
    } else if (name === 'fill_free_time') {
      closeDetail();
      day = 'all'; query = ''; $('catalog-search').value = '';
      resetSessionFeed();
      syncDayFilters();
      fx.reflow($('sessions'), render);
      $('program').scrollIntoView({block: 'start', behavior: motionAllowed() ? 'smooth' : 'instant'});
      if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('calendar-grid'), {colors: BEAMS.add}), motionAllowed() ? 450 : 0);
    } else if (name === 'compare_sessions') {
      compareData = result;
      compareSelection = [];
      renderCompareTray();
      render();
      openCompare({fromAgent});
    } else if (name === 'show_ranked_sessions') {
      closeDetail();
      if (!controller.state.highlighted) shownHighlight = null;
      day = 'all'; query = ''; $('catalog-search').value = '';
      resetSessionFeed();
      syncDayFilters();
      fx.reflow($('sessions'), render);
      $('program').scrollIntoView({block: 'start', behavior: motionAllowed() ? 'smooth' : 'instant'});
      if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('ranking-banner').hidden ? $('sessions') : $('ranking-banner'),
        {colors: BEAMS.rank}), motionAllowed() ? 450 : 0);
    } else render();
    if (name === 'add_to_agenda') {
      notify(result.added_count
        ? `${result.added_count} session${result.added_count === 1 ? '' : 's'} added to your demo agenda.`
        : 'The requested sessions are already in your agenda.');
      result.added.forEach((session, index) =>
        animateCalendarAddition(session.id, options.origin ?? (index < 3 ? origins.get(session.id) : null), index === 0, Math.min(index * 45, 300)));
      if (fromAgent) result.added.slice(0, 6).forEach((session, index) => setTimeout(() =>
        fx.beam(orbAnchor(), $('calendar-events').querySelector(`[data-session-id="${session.id}"]`), {colors: BEAMS.add}),
      120 + index * 140));
      if (result.rejected.length) showError(
        `${result.added_count} added; ${result.rejected.length} could not be added: ${result.rejected.map(item => item.reason).join(' ')}`);
    }
    if (name === 'remove_from_agenda') {
      notify(result.was_present
        ? `${result.removed.code} removed from your demo agenda.` : 'This session is already absent from your agenda.');
      if (removedRect && result.was_present) {
        if (fromAgent) fx.beam(orbAnchor(), removedRect, {colors: BEAMS.remove, impact: false});
        setTimeout(() => fx.shatter(removedRect), fromAgent ? 480 : 60);
      }
    }
    if (name === 'overview_agenda') {
      $('agenda-view').scrollIntoView({block: 'start', behavior: 'instant'});
      fx.pulseAttribute($('calendar-grid'), 'data-scan', 1600);
      if (fromAgent) fx.beam(orbAnchor(), $('calendar-grid'), {colors: BEAMS.calendar});
    }
    if (name === 'show_how_it_works') {
      // Like the spotlight, the board appears when the Agent starts talking about it. In a walkthrough
      // it then follows the Agent's sentences (see receive()).
      // Sheets and the drawer sit above the board, so opening it closes them first.
      const apply = () => {
        if (!result.open) { board.hide(); return; }
        closeCompare();
        closeDetail();
        showMore(false);
        board.show(result.step);
      };
      narration = fromAgent && result.walkthrough ? {text: '', shown: result.step} : null;
      if (fromAgent) whenSpoken(apply); else apply();
    }
    if (['add_to_agenda', 'remove_from_agenda'].includes(name)) { refreshDetailPlan(); refreshCompare(); }
    if (source === 'click' || source === 'drag') notePageEvent(name, result);
  } else showError(result.error.message);
  logActivity(name, args, result, source);
  window.dispatchEvent(new CustomEvent('ignite:tool-result', {detail: {name, args, result, source}}));
  return result;
}
// Shows the Agent's query being typed into the search box; the catalog filters stay untouched.
function showAgentQuery(kind, text, filters, outcome) {
  const box = $('agent-query');
  box.hidden = false;
  box.dataset.done = 'false';
  box.querySelector('.agent-query-badge').textContent = kind;
  $('agent-query-filters').replaceChildren(...filters.map(filter => node('span', '', filter)));
  $('agent-query-result').textContent = '';
  fx.beam(orbAnchor(), box, {colors: BEAMS.query, impact: false});
  void fx.typeInto($('agent-query-text'), text).then(() => {
    box.dataset.done = 'true';
    $('agent-query-result').textContent = outcome;
  });
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { box.hidden = true; }, 5200);
}
// The name as the recogniser wrote it, typed into the search box, then who it sounded like.
function showSpeakerQuery(args, result) {
  const outcome = !result.ok ? 'ERROR' : result.status === 'one_match' ? `→ ${result.speaker.name.toUpperCase()} ${Math.round(result.speaker.confidence * 100)}%`
    : result.status === 'multiple_matches' ? `${result.matches.length} POSSIBLE` : result.did_you_mean?.length ? 'NOT SURE · ASKING' : 'NO MATCH';
  showAgentQuery('NAME BY SOUND', `“${args.name}”`, (args.alternatives || []).map(alternative => `or “${alternative}”`), outcome);
}
function showKnowledgeResult(callId, name, args, result, source = 'knowledge') {
  const isError = Boolean(result.isError);
  const summary = Object.fromEntries(['agenda_count', 'checked_count', 'checked_all', 'conflict_count', 'transfer_count',
    'conflicts_truncated', 'transfers_truncated', 'mutates_calendar'].filter(key => key in result).map(key => [key, result[key]]));
  const item = {id: `page:${callId}`, name, arguments: JSON.stringify(args), summary,
    error: isError ? result.error : null, executor: 'browser', source};
  if (source === 'knowledge') lastAgentCall = {name, arguments: args, ok: !isError};
  const who = source === 'demo' ? 'DEMO' : 'AGENT';
  mcpCalls.set(item.id, item);
  logActivity(name, args, result, source);
  if (!isError) {
    const filters = [args.date && shortDay(args.date), args.start_after && `after ${args.start_after}`,
      args.end_before && `before ${args.end_before}`, args.speaker, args.delivery].filter(Boolean);
    if (name === 'ignite_search_sessions')
      showAgentQuery(`${who} SEARCH`, args.keywords.join(' ') || 'all sessions', filters, `${result.total} MATCHES`);
    if (name === 'ignite_rank_sessions')
      showAgentQuery(`${who} RANKING`, result.interests.join(' + '), filters,
        result.looser_matches_added ? `${result.total_matches} MATCH · +${result.looser_matches_added} LOOSER` : `${result.total_matches} RANKED`);
    if (name === 'ignite_validate_agenda') {
      fx.pulseAttribute($('calendar-grid'), 'data-review', 2400);
      fx.beam(orbAnchor(), $('calendar-grid'), {colors: BEAMS.review});
    }
    if (name === 'ignite_get_session') fx.lockOn($('sessions').querySelector(`[data-session-id="${CSS.escape(result.session.id)}"]`));
  }
  window.dispatchEvent(new CustomEvent('ignite:mcp-result', {detail: item}));
  if (isError) message('System', `The page's session search rejected ${name}; the guide will explain or refine the search.`);
}
// Session detail sheet. It expands from the card, covers the page but never the voice panel, and
// adds what the card cannot show: speakers' roles, how the session fits the saved agenda, other
// times and related sessions.
const STOP_WORDS = new Set(('a an and are as at be by can for from how in into is it its of on or our the their this to ' +
  'what when where who why will with you your build microsoft new using use').split(' '));
const titleKey = title => tokens(title).join(' ');
function relatedSessions(session) {
  const keywords = [...new Set([...tokens(session.title).filter(word => word.length > 2 && !STOP_WORDS.has(word)), ...session.tags])].slice(0, 12);
  if (!keywords.length) return [];
  const seen = new Set([titleKey(session.title)]);
  return knowledge.search({keywords, limit: 20}).sessions.filter(row => {
    const key = titleKey(row.title);
    if (row.code === session.code || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}
const sessionButton = (target, label) => {
  const button = node('button');
  button.type = 'button';
  button.append(node('small', '', label), document.createTextNode(target.title));
  button.onclick = () => execute('open_session_details', {instance_id: target.id}, 'click');
  return button;
};
function refreshDetailPlan() {
  if (!shownDetail) return;
  const session = controller.sessions.get(shownDetail);
  const agenda = controller.state.agenda, fit = controller.agendaFit(session), saved = fit.saved;
  const status = node('p', 'plan-status', saved ? '✓ In your agenda' : session.start ? 'Not in your agenda yet' : 'On-demand · has no calendar slot');
  status.dataset.saved = String(saved);
  const items = [status];
  if (session.start) {
    const span = row => `${time.format(new Date(row.start))}–${time.format(new Date(row.end))}`;
    for (const other of fit.overlaps) {
      const item = node('div', 'plan-item');
      item.dataset.kind = 'overlap';
      const link = node('button', '', other.code);
      link.type = 'button';
      link.onclick = () => execute('open_session_details', {instance_id: other.id}, 'click');
      const compare = node('button', 'plan-compare', '⇄ Compare');
      compare.type = 'button';
      compare.onclick = () => execute('compare_sessions', {instance_ids: [session.id, other.id]}, 'click');
      item.append(document.createTextNode('⚠ Overlaps '), link, document.createTextNode(` (${span(other)}) by ${other.overlap_minutes} min`), compare);
      items.push(item);
    }
    for (const transfer of fit.transfers) {
      const item = node('div', 'plan-item');
      item.dataset.kind = 'transfer';
      item.textContent = transfer.direction === 'after'
        ? `⇢ ${transfer.gap_minutes} min after ${transfer.other.code} — move from ${transfer.from_venue} to ${transfer.to_venue}`
        : `⇢ ${transfer.gap_minutes} min before ${transfer.other.code} — then move to ${transfer.to_venue}`;
      items.push(item);
    }
    if (!fit.overlaps.length) {
      const item = node('div', 'plan-item', saved ? '✓ No overlap with your other sessions'
        : agenda.length ? '✓ Fits: no overlap with your saved sessions' : 'Your agenda is empty — this would be your first session.');
      item.dataset.kind = 'clear';
      items.push(item);
    }
  }
  $('detail-plan').replaceChildren(...items);
  $('detail-add').disabled = !session.start;
  $('detail-add').textContent = saved ? 'Remove from agenda' : session.start ? 'Add to agenda +' : 'No fixed time';
  $('detail-add').dataset.connected = String(saved);
}
function fillDetail(session) {
  const chips = [node('span', 'chip-type', session.session_type || 'Session'),
    ...session.levels.map(level => node('span', '', level.replace(/^\((\d+)\)\s*/, '$1 · '))),
    ...(session.duration_minutes ? [node('span', '', `${session.duration_minutes} min`)] : []),
    ...session.tags.map(tag => node('span', '', tag))];
  $('detail-chips').replaceChildren(...chips);
  $('detail-code').textContent = session.code;
  $('detail-focus').hidden = shownHighlight !== session.id;
  $('detail-title').textContent = session.title;
  $('detail-time').textContent = session.start
    ? `${longDay.format(new Date(session.start))} · ${time.format(new Date(session.start))} – ${time.format(new Date(session.end))} PST`
    : 'On-demand · no fixed time';
  const [venue, ...room] = (session.location || 'Location not published').split('|');
  $('detail-venue').replaceChildren(node('b', '', venue.trim()), document.createTextNode(room.join(' · ').trim()));
  const extra = sessionDetails?.sessions?.[session.id];
  $('detail-delivery').replaceChildren(...[...session.delivery_types, ...session.viewing_options,
    extra?.seating_experience, extra?.target_audience].filter(Boolean).map(value => node('span', '', value)));
  $('detail-summary').textContent = session.description || session.summary;
  $('detail-takeaway').textContent = session.takeaway || '';
  $('detail-note').textContent = session.description
    ? `Official description from the Ignite catalog.${session.takeaway ? ' The highlighted line is a demo-written note.' : ''}`
    : 'No official description in the catalog snapshot. The official session page may have more.';
  const people = extra ? extra.speakers : session.speakers.map(name => ({name}));
  $('detail-speakers').replaceChildren(...people.map((person, index) => {
    // A speaker in the directory is a button: it lists all of that person's sessions.
    const known = person.person && controller.people.get(person.person);
    const card = node(known ? 'button' : 'div', 'speaker-card');
    if (known) {
      card.type = 'button';
      card.title = `All sessions with ${known.name}`;
      card.onclick = () => { closeDetail(); execute('find_speaker', {name: known.name}, 'click'); };
    }
    card.style.animationDelay = `${index * 60}ms`;
    const initials = person.name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('');
    const text = node('div');
    text.append(node('strong', '', person.name), node('small', '', [person.job_title, person.company].filter(Boolean).join(' · ')));
    card.append(node('span', 'speaker-avatar', initials), text);
    return card;
  }), ...(extra?.unresolved_speakers ? [node('p', 'detail-note', `${extra.unresolved_speakers} more speaker(s) listed on the official page.`)] : []),
  ...(!people.length && !extra?.unresolved_speakers ? [node('p', 'detail-note', 'Speakers not published.')] : []));
  const others = controller.catalog.sessions.filter(row => row.code === session.code && row.id !== session.id)
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  $('detail-other').replaceChildren(...others.slice(0, 4).map(row => sessionButton(row,
    row.start ? `${shortDay(row.local_start.slice(0, 10))} · ${time.format(new Date(row.start))} · ${(row.location || '').split('|')[0].trim()}` : 'On-demand')));
  $('detail-related').replaceChildren(...relatedSessions(session).map(row => sessionButton(row,
    `${row.code}${row.start ? ` · ${shortDay(row.local_start.slice(0, 10))} ${time.format(new Date(row.start))}` : ''}`)));
  $('detail-source').href = session.url;
  refreshDetailPlan();
}
function openDetail(id, {fromAgent = false} = {}) {
  const session = controller.sessions.get(id);
  const card = $('sessions').querySelector(`[data-session-id="${CSS.escape(id)}"]`)
    || $('calendar-events').querySelector(`[data-session-id="${CSS.escape(id)}"]`);
  const origin = card?.getBoundingClientRect();
  const wasOpen = !$('detail-layer').hidden;
  shownDetail = id;
  controller.state.detail = id;
  fillDetail(session);
  showMore(false);
  $('detail-layer').hidden = false;
  $('detail-sheet').scrollTop = 0;
  if (motionAllowed()) {
    const sheet = $('detail-sheet').getBoundingClientRect();
    const visible = origin && origin.width && origin.bottom > 0 && origin.top < innerHeight;
    if (!wasOpen && visible) {
      const dx = origin.left + origin.width / 2 - (sheet.left + sheet.width / 2), dy = origin.top + origin.height / 2 - (sheet.top + sheet.height / 2);
      $('detail-sheet').animate([
        {transform: `translate(${dx}px,${dy}px) scale(${origin.width / sheet.width},${origin.height / sheet.height})`, opacity: .35},
        {transform: 'none', opacity: 1},
      ], {duration: 480, easing: 'cubic-bezier(.16,1,.3,1)'});
    } else {
      $('detail-sheet').animate([{opacity: .2, transform: 'translateY(14px) scale(.98)'}, {opacity: 1, transform: 'none'}],
        {duration: 320, easing: 'cubic-bezier(.16,1,.3,1)'});
    }
    if (!wasOpen) $('detail-layer').querySelector('.detail-backdrop').animate([{opacity: 0}, {opacity: 1}], {duration: 300});
  }
  if (fromAgent) setTimeout(() => fx.beam(orbAnchor(), $('detail-sheet'), {colors: BEAMS.query}), motionAllowed() ? 380 : 0);
  $('close-detail').focus({preventScroll: true});
}
function closeDetail() {
  if ($('detail-layer').hidden) return;
  shownDetail = null;
  controller.state.detail = null;
  if (!motionAllowed()) { $('detail-layer').hidden = true; return; }
  const animation = $('detail-sheet').animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(12px) scale(.96)'}],
    {duration: 200, easing: 'ease-in'});
  animation.finished.then(() => { if (!shownDetail) $('detail-layer').hidden = true; }, () => {});
}
function askAboutDetail() {
  const session = controller.sessions.get(shownDetail);
  if (!session) return;
  const text = `Tell me more about ${session.code}, "${session.title}". Is it a good fit for me?`;
  if (ready) { sendText(text); return; }
  pendingAsk = text;
  void openGuide().catch(error => showError(error.message));
}

// Drag and drop: a card dropped on the calendar is added (it snaps to its scheduled slot, shown as a
// dashed preview while dragging); a calendar block dropped back on the session list is removed.
function startDrag(event, kind, session, element) {
  if (kind === 'add' && !session.start) { event.preventDefault(); return; }
  dragging = {kind, id: session.id};
  event.dataTransfer.effectAllowed = kind === 'add' ? 'copy' : 'move';
  event.dataTransfer.setData('text/plain', session.code);
  const chip = node('div', 'drag-chip', kind === 'add' ? `${session.code}  →  your agenda` : `${session.code}  →  remove`);
  document.body.append(chip);
  event.dataTransfer.setDragImage(chip, 24, 20);
  setTimeout(() => chip.remove(), 0);
  element.dataset.dragging = 'true';
  document.body.dataset.dragging = kind;
}
function endDrag() {
  dragging = null;
  delete document.body.dataset.dragging;
  for (const element of document.querySelectorAll('.session-card[data-dragging], .calendar-event[data-dragging]')) delete element.dataset.dragging;
  for (const element of document.querySelectorAll('[data-drop-over]')) delete element.dataset.dropOver;
  document.querySelector('.calendar-preview')?.remove();
}
function showPreview(session) {
  if (document.querySelector(`.calendar-preview[data-session-id="${CSS.escape(session.id)}"]`)) return;
  document.querySelector('.calendar-preview')?.remove();
  const slot = slotFor(session);
  const column = slot && $('calendar-events').querySelector(`[data-calendar-day="${slot.day}"]`);
  if (!column) return;
  const preview = node('div', 'calendar-preview');
  preview.dataset.sessionId = session.id;
  preview.style.top = `${slot.top}px`;
  preview.style.height = `${Math.max(slot.height, 34)}px`;
  preview.append(document.createTextNode(session.code), node('small', '', controller.state.agenda.includes(session.id)
    ? 'Already in your agenda' : `${time.format(new Date(session.start))}–${time.format(new Date(session.end))}`));
  column.append(preview);
  const sidebar = $('agenda-view'), bounds = sidebar.getBoundingClientRect(), rect = preview.getBoundingClientRect();
  if (rect.bottom > bounds.bottom - 20) sidebar.scrollTop += rect.bottom - bounds.bottom + 40;
  if (rect.top < bounds.top + 20) sidebar.scrollTop -= bounds.top + 40 - rect.top;
}
function enableDragAndDrop() {
  const calendar = $('agenda-view'), list = document.querySelector('.session-column');
  // dragenter must be cancelled too, or the browser sends the rest of the drag to <body>.
  const accept = (zone, kind, effect) => event => {
    if (dragging?.kind !== kind) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = effect;
    zone.dataset.dropOver = 'true';
    if (kind === 'add') showPreview(controller.sessions.get(dragging.id));
  };
  calendar.addEventListener('dragenter', accept(calendar, 'add', 'copy'));
  list.addEventListener('dragenter', accept(list, 'remove', 'move'));
  calendar.addEventListener('dragover', event => {
    if (dragging?.kind !== 'add') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    calendar.dataset.dropOver = 'true';
    showPreview(controller.sessions.get(dragging.id));
  });
  calendar.addEventListener('dragleave', event => {
    if (dragging?.kind !== 'add' || calendar.contains(event.relatedTarget)) return;
    delete calendar.dataset.dropOver;
    document.querySelector('.calendar-preview')?.remove();
  });
  calendar.addEventListener('drop', event => {
    if (dragging?.kind !== 'add') return;
    event.preventDefault();
    const id = dragging.id, {clientX: x, clientY: y} = event;
    endDrag();
    execute('add_to_agenda', {instance_ids: [id]}, 'drag', {origin: {left: x - 20, top: y - 20, right: x + 20, bottom: y + 20, width: 40, height: 40}});
  });
  list.addEventListener('dragover', event => {
    if (dragging?.kind !== 'remove') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    list.dataset.dropOver = 'true';
  });
  list.addEventListener('dragleave', event => {
    if (dragging?.kind === 'remove' && !list.contains(event.relatedTarget)) delete list.dataset.dropOver;
  });
  list.addEventListener('drop', event => {
    if (dragging?.kind !== 'remove') return;
    event.preventDefault();
    const id = dragging.id;
    endDrag();
    execute('remove_from_agenda', {instance_id: id}, 'drag');
  });
  document.addEventListener('dragend', endDrag);
}
function audioStatus(snapshot) {
  lastAudioState = snapshot;
  if (snapshot.state === 'closed') return;
  $('audio-status').textContent = snapshot.state !== 'running'
    ? `Browser audio is paused; ${snapshot.bufferedSeconds.toFixed(1)}s buffered. Click ♪ to resume without reconnecting.`
    : snapshot.receivedChunks
      ? `Received ${snapshot.receivedSeconds.toFixed(1)}s · rendered ${snapshot.renderedSeconds.toFixed(1)}s · buffered ${snapshot.bufferedSeconds.toFixed(1)}s.`
      : 'Audio is ready. Waiting for the guide to speak.';
  if (ready) updateSpeaking(speaking);
}
function updateSpeaking(value) {
  speaking = value;
  $('send').disabled = !ready;
  $('test-greeting').disabled = !ready || responding || speaking;
  const paused = audio && audio.context.state !== 'running' && audio.snapshot().bufferedSeconds > 0;
  if (ready) $('voice-status').textContent = paused ? 'Browser paused the sound. Click ♪ to resume.'
    : speaking ? 'Guide speaking — you can interrupt.'
    : responding ? 'Planning your sessions — you can interrupt.' : 'Listening. Just talk, or press ⌨ to type.';
  refreshAgentState();
}
function send(packet) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Connect the session guide first.');
  if (socket.bufferedAmount > 512 * 1024) throw new Error('Voice upload is falling behind. Please reconnect.');
  socket.send(JSON.stringify(packet));
}
function sendText(text) {
  if (!session || !ready) throw new Error('Connect the session guide first.');
  session.sendText(text);
  message('You', text);
  caption(`“${text}”`, 'you');
}
function fail(error) {
  showError(error.message);
  void disconnect().catch(other => showError(other.message));
}
// Port of BrowserTools.execute in the Python prototype's server.py: one validated, idempotent function call.
function executeCall(call) {
  const {call_id: callId, name, arguments: raw} = call;
  if (typeof callId !== 'string' || !callId || typeof name !== 'string' || typeof raw !== 'string')
    throw new Error('Function call is missing its ID, name or JSON arguments.');
  if (completedCalls.has(callId)) {
    const previous = completedCalls.get(callId);
    if (previous.name !== name || previous.raw !== raw) throw new Error('A function call ID was reused with different arguments.');
    conversation?.record('tool.cached_result', {call_id: callId, name, result: previous.result});
    return previous.result;
  }
  if (completedCalls.size >= 128) throw new Error('Demo tool-call limit reached. Reconnect.');
  let args;
  try { args = JSON.parse(raw); }
  catch { return {ok: false, error: {code: 'invalid_json', message: 'Tool arguments were not valid JSON.'}}; }
  const isKnowledge = KNOWLEDGE_TOOLS.has(name);
  if ((!PAGE_TOOLS.has(name) && !isKnowledge) || !args || typeof args !== 'object' || Array.isArray(args))
    return {ok: false, error: {code: 'unsupported_tool', message: 'Only the documented page tools are allowed.'}};
  conversation?.record('tool.call', {call_id: callId, name, arguments: args, executor: isKnowledge ? 'page_knowledge' : 'page_action'});
  responding = true;
  markActing(name);
  updateSpeaking(speaking);
  const result = isKnowledge ? knowledge.execute(name, args) : execute(name, args);
  if (isKnowledge) showKnowledgeResult(callId, name, args, result);
  completedCalls.set(callId, {name, raw, result});
  conversation?.record('tool.result', {call_id: callId, name, result});
  return result;
}
async function disconnect() {
  connectionGeneration++;
  flushVisuals();
  ready = false; connecting = false; responding = false; speaking = false; userSpeaking = false;
  clearInterval(watchdog);
  watchdog = null;
  const previous = socket;
  socket = null;
  session = null;
  previous?.close();
  if (conversation && conversation.records.at(-1).type !== 'session.closed') conversation.record('session.closed', {});
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  const previousAudio = audio;
  if (previousAudio) lastAudioState = previousAudio.snapshot();
  audio = null;
  if (previousAudio) await previousAudio.dispose();
  $('connect').textContent = 'Start voice ↗';
  delete $('connect').dataset.connected;
  $('agent-live').dataset.live = 'false';
  $('agent-live').textContent = 'OFFLINE';
  $('use-mic').disabled = false;
  $('message').disabled = true;
  $('send').disabled = true;
  $('test-greeting').disabled = true;
  $('voice-status').textContent = 'Disconnected. Your agenda is still here.';
  caption('');
  refreshAgentState();
}
// Page-facing events from VoiceSession: Azure events it accepted plus its own interruptions.
function receive(event) {
  if (['input.text', 'playback.interrupted'].includes(event.type)) conversation?.protocol(event);
  if (event.type === 'page.note') conversation?.record('page.note', {text: event.text});
  if (event.type === 'session.ready') {
    ready = true; connecting = false;
    $('connect').textContent = 'End conversation ×';
    $('connect').dataset.connected = 'true';
    $('agent-live').dataset.live = 'true';
    $('agent-live').textContent = 'LIVE';
    $('message').disabled = false;
    if (!$('use-mic').checked) showTyping(true);
    updateSpeaking(false);
    message('System', transport().connected);
    $('conversation-log').textContent = `Conversation log: kept in this tab as ${conversation.name}.`;
    $('conversation-log').hidden = false;
  } else if (event.type === 'tool.output_sent') {
    conversation?.record('tool.output_sent', {call_id: event.call_id, name: event.name, result: event.result});
  } else if (event.type === 'response.created') {
    responding = true; audioChunks = 0; updateSpeaking(speaking);
    captionResponse = event.response?.id;
    captionText = '';
  } else if (event.type === 'response.done') {
    responding = false; updateSpeaking(speaking);
    // The walkthrough reply is complete: make sure the board ends on the last step it reached.
    if (narration?.text) {
      const step = narratedStep(narration.text);
      whenSpoken(() => { if (board.open) board.show(step, {forward: true}); });
      narration = null;
    }
    if (pendingAsk) {
      const text = pendingAsk;
      pendingAsk = null;
      setTimeout(() => { if (ready) sendText(text); }, 0);
    }
    if (['failed', 'incomplete'].includes(event.response?.status))
      showError(`The guide's response was ${event.response.status}. No successful action should be assumed.`);
    const expectedAudio = event.response?.output?.some(item =>
      item.content?.some(part => ['output_audio', 'audio'].includes(part.type)));
    if (event.response?.status === 'completed' && expectedAudio && !audioChunks && !audio.blockedResponses.has(event.response?.id))
      showError('The guide returned text but no speech. Check that the selected voice supports the response language.');
  } else if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) {
    if (event.played) audioChunks++;
  } else if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(event.type)) {
    if (event.response_id === captionResponse && !audio?.blockedResponses.has(event.response_id)) {
      captionText += event.delta || '';
      caption(captionText);
      // Walkthrough: "First", "Second" … light their step as the Agent starts that sentence aloud.
      if (narration) {
        narration.text += event.delta || '';
        const step = narratedStep(narration.text);
        if (step !== narration.shown) {
          narration.shown = step;
          controller.state.explainer = step;
          whenSpoken(() => { if (board.open) board.show(step, {forward: true}); });
        }
      }
    }
  } else if (event.type === 'playback.interrupted') {
    narration = null;
    flushVisuals();
    if (event.cut_audio) {
      caption('');
      for (const row of document.querySelectorAll('#transcript p[data-role="Guide"]')) {
        if (row.dataset.responseId === event.response_id || event.items.some(item => item.item_id === row.dataset.itemId))
          row.replaceChildren(node('small', '', 'GUIDE · INTERRUPTED'), document.createTextNode('Reply interrupted. Listening to your new request.'));
      }
    }
    $('voice-status').textContent = event.cut_audio ? 'Reply interrupted. Listening to you…' : 'Listening to you…';
  } else if (event.type === 'input_audio_buffer.speech_started') {
    userSpeaking = true;
    $('voice-status').textContent = 'Listening to you…';
    refreshAgentState();
  } else if (event.type === 'input_audio_buffer.committed') {
    userSpeaking = false;
    refreshAgentState();
  } else if (['response.output_audio_transcript.done', 'response.audio_transcript.done', 'response.output_text.done', 'response.text.done'].includes(event.type)) {
    const text = event.transcript || event.text;
    if (text) message('Guide', text, event);
  } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
    message('You', event.transcript);
    caption(`“${event.transcript}”`, 'you');
  } else if (event.type === 'error') {
    throw new Error(event.error?.message || 'The voice service reported an error.');
  }
}
async function enableMicrophone(candidateAudio, generation) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS or localhost.');
  const captured = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
  if (generation !== connectionGeneration) { captured.getTracks().forEach(track => track.stop()); return; }
  stream = captured;
  await candidateAudio.capture(stream, chunk => {
    if (!ready) return;
    try { send({type: 'input_audio_buffer.append', audio: chunk}); }
    catch (error) { fail(error); }
  });
}
// The relay's path from /api/config, as an absolute ws(s) URL on this page's origin.
function socketUrl(path) {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}
async function connect() {
  if (connecting) return;
  if (socket) return disconnect();
  const generation = ++connectionGeneration;
  $('error').hidden = true;
  connecting = true;
  refreshAgentState();
  $('use-mic').disabled = true;
  $('voice-status').textContent = 'Connecting to the session guide…';
  try {
    const candidateAudio = new VoiceAudio(updateSpeaking, audioStatus, fail);
    audio = candidateAudio;
    const bridged = config.transport === 'playground-bridge';
    let token = null;
    if (!bridged) {
      const response = await fetch('api/token', {method: 'POST', cache: 'no-store'});
      if (!response.ok) throw new Error(`The local server could not provide an Azure token: ${await response.text()}`);
      ({token} = await response.json());
      if (generation !== connectionGeneration) return;
    }
    await candidateAudio.resumed;
    if (generation !== connectionGeneration) return;
    conversation = new ConversationLog({transport: config.transport, agent_name: config.agent_name});
    completedCalls = new Map();
    // A browser cannot set an Authorization header on a WebSocket. Foundry accepts the bearer
    // token as a second subprotocol offer and echoes only "realtime" back. Through the Playground
    // the page sends no credential: its sign-in cookie goes with the same-origin handshake.
    const current = bridged ? new WebSocket(socketUrl(config.websocket_url))
      : new WebSocket(config.websocket_url, ['realtime', `authorization.bearer.${token}`]);
    const currentSession = new VoiceSession({send, audio: candidateAudio, execute: executeCall, emit: receive, fail});
    socket = current;
    session = currentSession;
    setTimeout(() => {
      if (session === currentSession && !ready) fail(new Error('The voice session did not become ready within 45 seconds.'));
    }, 45000);
    watchdog = setInterval(() => {
      if (session === currentSession && currentSession.expired()) fail(new Error('The guide did not finish its response within 120 seconds.'));
    }, 1000);
    current.onopen = () => { $('voice-status').textContent = 'Preparing your Ignite session guide…'; };
    current.onmessage = event => {
      if (socket !== current) return;
      try {
        const packet = JSON.parse(event.data);
        conversation.protocol(packet);
        currentSession.handle(packet);
      } catch (error) { fail(error); }
    };
    current.onerror = () => showError(transport().failed);
    current.onclose = event => {
      if (socket === current) fail(new Error(`The voice connection closed unexpectedly (code ${event.code}). Please reconnect.`));
    };
    if ($('use-mic').checked) {
      void enableMicrophone(candidateAudio, generation).catch(error => {
        if (generation !== connectionGeneration) return;
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        $('use-mic').checked = false;
        showTyping(true);
        showError(`Microphone unavailable: ${error.message} You can still hear the guide and type. End the conversation to retry microphone access.`);
      });
    }
  } catch (error) {
    if (generation !== connectionGeneration) return;
    showError(error.message);
    await disconnect();
  }
}
async function initialize() {
  // Relative to the page, so the planner works at the site root and under a sub-path (/ignite/).
  const responses = await Promise.all(['catalog.json', 'tools.json', 'api/config', 'session-details.json', 'name-search-data.json',
    'knowledge-tools.json'].map(url => fetch(url)));
  if (responses.some(response => !response.ok)) throw new Error('Could not load the session catalog or server configuration.');
  const [catalog, tools, settings, details, nameData, knowledgeTools] = await Promise.all(responses.map(response => response.json()));
  config = settings;
  sessionDetails = details;
  knowledge = new SessionIndex(catalog);
  const names = new NameSearch(nameData, details.people.map(({id, name, aliases}) => ({id, name, aliases})), {extraStrongFiller: EVENT_FILLER});
  controller = new PageController(catalog, {knowledge, details, names});
  window.igniteDemo = {
    executeTool: execute, getState: () => controller.context(), tools, knowledgeTools, config, runDemo,
    getFunctionCalls: () => Object.fromEntries(functionCalls),
    executeKnowledge: (name, args) => knowledge.execute(name, args),
    // Runs a function call through the same path as a real Agent call (effects, activity, log),
    // without Azure: used by test_ui_browser.py and for rehearsing the demo choreography.
    simulateAgentCall: (name, args) => {
      const result = executeCall({call_id: `local-${crypto.randomUUID()}`, name, arguments: JSON.stringify(args)});
      if (!session) { responding = false; updateSpeaking(speaking); }
      return result;
    },
    getAudioState: () => audio?.snapshot() || {state: 'disconnected', receivedChunks: 0, lastPlayback: lastAudioState},
    getVoiceState: () => ({ready, responding, speaking, connecting}),
    getMcpCalls: () => [...mcpCalls.values()],
    getConversationLog: () => conversation?.records || [],
  };
  $('stat-sessions').textContent = catalog.sessions.length.toLocaleString();
  buildFunctionList([
    {title: 'KNOWLEDGE', note: 'read-only catalog lookups', tools: knowledgeTools},
    {title: 'PAGE ACTIONS', note: 'change what you see', tools},
  ]);
  buildThemeMenu();
  enableDragAndDrop();
  $('close-detail').onclick = closeDetail;
  $('close-compare').onclick = closeCompare;
  $('compare-layer').querySelector('.detail-backdrop').onclick = closeCompare;
  $('compare-go').onclick = () => execute('compare_sessions', {instance_ids: compareSelection}, 'click');
  $('compare-cancel').onclick = () => { compareSelection = []; renderCompareTray(); renderSessions(); };
  $('speaker-choice-dismiss').onclick = () => { controller.state.speakerChoice = null; renderSessions(); };
  for (const button of document.querySelectorAll('.day-free'))
    button.onclick = () => execute('fill_free_time', {date: button.dataset.freeDate}, 'click');
  $('detail-layer').querySelector('.detail-backdrop').onclick = closeDetail;
  $('detail-ask').onclick = askAboutDetail;
  $('detail-add').onclick = () => {
    const id = shownDetail, saved = controller.state.agenda.includes(id);
    execute(saved ? 'remove_from_agenda' : 'add_to_agenda', saved ? {instance_id: id} : {instance_ids: [id]}, 'click',
      saved ? {} : {origin: $('detail-add').getBoundingClientRect()});
  };
  render();
  new LogoField($('hero-art'), {read: agentVisual});
  new WireOrb($('agent-orb'), {read: agentVisual, radius: .21});
  new WireOrb($('launcher-orb'), {read: agentVisual, detail: .55, hud: false});
  new ResizeObserver(syncGuideSpace).observe($('assistant-panel').querySelector('.island'));
  Object.assign(schemas, {page: tools, knowledge: knowledgeTools});
  board = new HowBoard($('how-board'), {groups: [{kind: 'knowledge', tools: knowledgeTools}, {kind: 'page', tools}],
    run: runDemo, onClose: () => { controller.state.explainer = null; }, connectText: transport().step});
  // Every function that runs, whoever started it, travels across the board's diagram.
  addEventListener('ignite:tool-result', ({detail}) => void board.trace({...detail, ok: detail.result.ok !== false}));
  addEventListener('ignite:mcp-result', ({detail}) => void board.trace({name: detail.name, args: JSON.parse(detail.arguments),
    ok: !detail.error, source: detail.source}));
  $('open-how').onclick = () => {
    showMore(false);
    controller.state.explainer = 'connect';
    board.show('connect');
  };
  startHud();
  refreshAgentState();
  scrollObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadMoreSessions();
  }, {rootMargin: '0px 0px 800px 0px'});
  scrollObserver.observe($('scroll-sentinel'));
  $('connect').disabled = !config.voice_available;
  $('voice-status').textContent = config.voice_available ? 'Opening the guide starts your conversation.'
    : 'Preview mode. Configure Azure to talk to the guide.';
  $('voice-name').textContent = `Voice: ${config.voice}. English only. ${config.voice_available
    ? `Agent ${config.agent_name}. ${transport().summary}`
    : 'Voice is not configured.'}`;
  $('knowledge-mode').textContent = config.voice_available
    ? transport().mode : 'PREVIEW · VOICE NOT CONNECTED';
  $('transport-label').textContent = transport().label;
  $('download-log').onclick = () => {
    if (!conversation) { notify('No conversation has started in this tab.'); return; }
    const link = node('a');
    link.href = URL.createObjectURL(new Blob([conversation.jsonl()], {type: 'application/x-ndjson'}));
    link.download = conversation.name;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const launchGuide = () => { void openGuide().catch(error => showError(error.message)); };
  $('guide-launcher').onclick = launchGuide;
  $('open-guide-inline').onclick = launchGuide;
  $('close-guide').onclick = () => { void closeGuide().catch(error => showError(error.message)); };
  $('type-toggle').onclick = () => showTyping();
  $('more-toggle').onclick = () => showMore();
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('compare-layer').hidden) closeCompare();
    else if (!$('detail-layer').hidden) closeDetail();
    else if (!$('island-more').hidden) showMore(false);
    else if (board.open) { board.hide(); controller.state.explainer = null; }
    else if (!$('assistant-panel').hidden) void closeGuide().catch(error => showError(error.message));
  });
  const showSessions = () => { controller.state.view = 'sessions'; render(); };
  $('sessions-tab').onclick = showSessions;
  $('browse-sessions').onclick = showSessions;
  $('clear-ranking').onclick = () => execute('show_ranked_sessions', {instance_ids: [], interests: []}, 'click');
  $('catalog-search').oninput = event => {
    controller.state.ranking = null;
    query = event.target.value; resetSessionFeed(); renderSessions();
  };
  $('load-more').onclick = loadMoreSessions;
  $('export-agenda').onclick = exportAgenda;
  for (const filter of document.querySelectorAll('[data-day]')) {
    filter.onclick = () => {
      controller.state.ranking = null;
      day = filter.dataset.day;
      resetSessionFeed();
      syncDayFilters();
      renderSessions();
    };
  }
  $('connect').onclick = () => { void connect().catch(error => showError(error.message)); };
  $('test-speaker').onclick = async () => {
    const player = audio || new VoiceAudio(() => {}, audioStatus);
    try {
      await player.testSpeaker();
      if (player !== audio) await player.dispose();
      $('audio-status').textContent = 'Local test tone played, not an Agent reply. If silent, check tab mute and your output device.';
      notify('Speaker test played a short local tone.');
    } catch (error) {
      showError(error.message);
      if (player !== audio && !player.disposed) await player.dispose();
    }
  };
  $('test-greeting').onclick = () => {
    try { sendText('Please say a short English welcome to Microsoft Ignite. Do not call tools.'); }
    catch (error) { showError(error.message); }
  };
  $('message-form').onsubmit = event => {
    event.preventDefault();
    const text = $('message').value.trim();
    if (!text) return;
    try { sendText(text); $('message').value = ''; }
    catch (error) { showError(error.message); }
  };
}
window.addEventListener('beforeunload', () => { scrollObserver?.disconnect(); stream?.getTracks().forEach(track => track.stop()); socket?.close(); });
initialize().catch(error => { showError(error.message); $('voice-status').textContent = 'The session guide could not initialize.'; });
