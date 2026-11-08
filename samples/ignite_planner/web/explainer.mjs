// The "how the voice agent drives this page" board: an animated diagram of you, this page (its UI
// and the functions it exposes) and the Foundry Voice Agent, five explanation steps that the Agent
// or the presenter lights up, and a live trace in which every real function call travels across the
// diagram: from the Agent (function_call) or from you (a click), to the function, to the UI, and
// back to the Agent (function_call_output or a page event). Clicking a function runs it.
const NS = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export const STEPS = [
  ['connect', 'Connect', 'This page opens one WebSocket straight to the Foundry Voice Agent: your voice streams up, its voice streams back. No server in between.'],
  ['register', 'Register', 'The page’s functions are registered with the Agent: a name, what it does, and JSON parameters. The JavaScript that runs them stays in this page.'],
  ['call', 'Call', 'From what you say, the Agent decides which function to use and sends a function call with JSON arguments. It has no other way to touch the page.'],
  ['execute', 'Execute', 'The page checks the arguments, runs the JavaScript, the screen changes, and a JSON result goes back for the Agent to talk about.'],
  ['together', 'Together', 'Your clicks run the very same functions, and the page tells the Agent what you did. You and the Agent drive one page.'],
];

// Diagram geometry (viewBox 600 × 380): you above the page on the left, the Agent on the right,
// and the traffic between the page and the Agent as horizontal lanes.
const YOU = {x: 120, y: 4, w: 150, h: 40};
const PAGE = {x: 4, y: 78, w: 332, h: 298};
const UI = {x: 18, y: 108, w: 304, h: 30};
const AGENT = {x: 456, y: 150, w: 140, h: 126};
const EDGE = PAGE.x + PAGE.w;
// Vertical lanes between you and the page, horizontal lanes between the page and the Agent.
const LANES = {
  voice: {points: [[170, YOU.y + YOU.h], [170, PAGE.y]], label: 'voice', steps: 'connect', ends: 'both'},
  clicks: {points: [[222, YOU.y + YOU.h], [222, PAGE.y]], label: 'clicks', steps: 'together', ends: 'end'},
  audio: {points: [[EDGE, 172], [AGENT.x, 172]], label: 'audio', steps: 'connect', ends: 'both'},
  register: {points: [[EDGE, 200], [AGENT.x, 200]], label: 'functions', steps: 'register', ends: 'end'},
  call: {points: [[EDGE, 228], [AGENT.x, 228]], label: 'function_call', steps: 'call', ends: 'start'},
  result: {points: [[EDGE, 256], [AGENT.x, 256]], label: 'result', steps: 'execute together', ends: 'end'},
};
const CHIP = {w: 150, h: 24, columns: [18, 172], top: 166, row: 29};

const svg = (tag, attributes = {}, text) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
};
const pick = list => list[Math.floor(Math.random() * list.length)];

export class HowBoard {
  // root: the board element; groups: [{kind, tools}] in display order; run(name): run a function;
  // connectText: the Connect step's wording when the page reaches the Agent through a relay.
  constructor(root, {groups, run, onClose, connectText = null}) {
    Object.assign(this, {root, run, onClose, connectText, chips: new Map(), timer: null, step: null});
    this.diagram = root.querySelector('.how-diagram');
    this.packets = svg('g', {class: 'how-packets'});
    this.draw(groups);
    root.querySelector('.how-close').onclick = () => { this.hide(); onClose?.(); };
    this.dots = root.querySelector('.how-dots');
    this.dots.replaceChildren(...STEPS.map(([id, label], index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.step = id;
      dot.textContent = `${index + 1} ${label}`;
      dot.onclick = () => this.show(id);
      return dot;
    }));
  }

  draw(groups) {
    const g = this.diagram;
    const defs = svg('defs');
    const marker = svg('marker', {id: 'how-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'});
    marker.append(svg('path', {d: 'M0 0 L8 4 L0 8 z', class: 'how-arrowhead'}));
    defs.append(marker);
    g.append(defs);
    const box = ({x, y, w, h}, className, steps, rx = 16) => svg('rect', {x, y, width: w, height: h, rx, class: className, 'data-steps': steps});
    const centre = (rect, dy) => ({x: rect.x + rect.w / 2, y: rect.y + dy, 'text-anchor': 'middle'});
    g.append(box(YOU, 'how-node', 'connect together', 14),
      svg('text', {...centre(YOU, 18), class: 'how-title'}, 'You'),
      svg('text', {...centre(YOU, 33), class: 'how-sub'}, 'voice · clicks'));
    g.append(box(PAGE, 'how-node how-page', 'register execute together', 18),
      svg('text', {x: PAGE.x + 14, y: PAGE.y + 20, class: 'how-title'}, 'This page · browser JavaScript'),
      box(UI, 'how-ui', 'execute together', 10),
      svg('text', {x: UI.x + 12, y: UI.y + 19, class: 'how-sub'}, 'UI · session cards · calendar · detail sheets'),
      svg('text', {x: PAGE.x + 14, y: CHIP.top - 8, class: 'how-label'}, 'FUNCTIONS THE AGENT CAN CALL · CLICK ONE TO RUN IT'));
    g.append(box(AGENT, 'how-node how-agent', 'connect register call execute', 16),
      svg('text', {...centre(AGENT, 34), class: 'how-title'}, 'Foundry'),
      svg('text', {...centre(AGENT, 52), class: 'how-title'}, 'Voice Agent'),
      svg('text', {...centre(AGENT, 76), class: 'how-sub'}, 'gpt-realtime'),
      svg('text', {...centre(AGENT, 92), class: 'how-sub'}, 'decides which'),
      svg('text', {...centre(AGENT, 106), class: 'how-sub'}, 'function to call'));
    for (const [id, lane] of Object.entries(LANES)) {
      const [[x1, y1], [x2, y2]] = lane.points, vertical = x1 === x2;
      g.append(svg('line', {x1, y1: y1 + (vertical ? 2 : 0), x2: x2 - (vertical ? 0 : 2), y2: y2 - (vertical ? 2 : 0),
        class: `how-lane how-lane-${id}`, 'data-steps': lane.steps,
        'marker-end': lane.ends !== 'start' ? 'url(#how-arrow)' : '', 'marker-start': lane.ends !== 'end' ? 'url(#how-arrow)' : ''}),
      svg('text', vertical ? {x: x1 + 5, y: (y1 + y2) / 2 + 3, class: 'how-lane-label', 'data-steps': lane.steps}
        : {x: x1 + 10, y: y1 - 5, class: 'how-lane-label', 'data-steps': lane.steps}, lane.label));
    }
    let index = 0;
    for (const {kind, tools} of groups) {
      for (const tool of tools) {
        const x = CHIP.columns[index % 2], y = CHIP.top + Math.floor(index / 2) * CHIP.row;
        const chip = svg('g', {class: `how-chip how-chip-${kind}`, tabindex: '0', role: 'button', 'data-tool': tool.name,
          'aria-label': `Run ${tool.name}`, 'data-steps': 'register'});
        chip.append(svg('title', {}, `${tool.name}: ${tool.description.split('\n')[0]}`),
          svg('rect', {x, y, width: CHIP.w, height: CHIP.h, rx: 8}),
          svg('text', {x: x + CHIP.w / 2, y: y + 16, 'text-anchor': 'middle'}, tool.name.replace(/^ignite_/, '')));
        chip.onclick = () => this.run(tool.name);
        chip.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.run(tool.name); } };
        this.chips.set(tool.name, {element: chip, x: x + CHIP.w / 2, y: y + CHIP.h / 2});
        g.append(chip);
        index++;
      }
    }
    g.append(this.packets);
  }

  get open() {
    return !this.root.hidden;
  }

  // forward: during a walkthrough, never go back to an earlier step (timers can fire out of order).
  show(step = 'connect', {forward = false} = {}) {
    const order = id => STEPS.findIndex(([name]) => name === id);
    if (forward && this.open && order(step) <= order(this.step)) return;
    this.root.hidden = false;
    this.step = step;
    this.root.dataset.step = step;
    const [id, label, text] = STEPS.find(([name]) => name === step) || STEPS[0];
    const caption = id === 'connect' && this.connectText ? this.connectText : text;
    this.root.querySelector('.how-caption').replaceChildren(Object.assign(document.createElement('b'), {textContent: `${label}. `}), caption);
    for (const dot of this.dots.children) dot.setAttribute('aria-pressed', String(dot.dataset.step === step));
    clearInterval(this.timer);
    if (!reducedMotion.matches) {
      this.ambient(step);
      this.timer = setInterval(() => this.ambient(step), 900);
    }
  }

  hide() {
    this.root.hidden = true;
    this.step = null;
    clearInterval(this.timer);
    this.packets.replaceChildren();
  }

  // Paths from a chip out along a lane to the Agent, and from the Agent (or you) in to a chip.
  out(chip, lane) {
    const [[x, y], end] = LANES[lane].points;
    return [[chip.x, chip.y], [chip.x + (x - chip.x) * .6, y], [x, y], end];
  }

  in(chip, lane) {
    return this.out(chip, lane).reverse();
  }

  toUi(chip) {
    return [[chip.x, chip.y], [chip.x, UI.y + UI.h]];
  }

  // The step's own traffic, so each lit part of the diagram visibly carries something.
  ambient(step) {
    const chip = pick([...this.chips.values()]), lane = id => LANES[id].points;
    const ui = () => this.glow(this.diagram.querySelector('.how-ui'));
    if (step === 'connect') {
      this.fly(lane('voice'), 'var(--c1)');
      this.fly([...lane('audio')].reverse(), 'var(--c3)').then(() => this.fly(lane('audio'), 'var(--c1)'));
    }
    if (step === 'register') this.fly(this.out(chip, 'register'), 'var(--c3)');
    if (step === 'call') this.fly(this.in(chip, 'call'), 'var(--warm)').then(() => this.glow(chip.element));
    if (step === 'execute') {
      this.glow(chip.element);
      this.fly(this.toUi(chip), 'var(--ok)').then(ui);
      this.fly(this.out(chip, 'result'), 'var(--c1)');
    }
    if (step === 'together') {
      this.fly([...lane('clicks'), [chip.x, chip.y]], 'var(--c4)')
        .then(() => { this.glow(chip.element); this.fly(this.toUi(chip), 'var(--ok)').then(ui); return this.fly(this.out(chip, 'result'), 'var(--c4)'); });
    }
  }

  // One real function call: where it came from, the function, the UI, and back to the Agent.
  async trace({name, args, ok, source}) {
    const list = this.root.querySelector('.how-trace');
    const row = document.createElement('li');
    const who = source === 'agent' || source === 'knowledge' ? 'AGENT' : source === 'demo' ? 'DEMO' : 'YOU';
    row.dataset.source = who.toLowerCase();
    row.dataset.ok = String(ok);
    const call = document.createElement('code');
    call.textContent = `${name}(${JSON.stringify(args)})`;
    const badge = document.createElement('b');
    badge.textContent = who;
    const outcome = document.createElement('span');
    outcome.textContent = ok ? '→ ok' : '→ error';
    row.append(badge, call, outcome);
    list.prepend(row);
    while (list.children.length > 4) list.lastElementChild.remove();
    const chip = this.chips.get(name);
    if (!chip || !this.open) return;
    if (reducedMotion.matches) { this.glow(chip.element); return; }
    const fromAgent = who === 'AGENT';
    await this.fly(fromAgent ? this.in(chip, 'call') : [...LANES.clicks.points, [chip.x, chip.y]], fromAgent ? 'var(--warm)' : 'var(--c4)', 6);
    this.glow(chip.element);
    this.fly(this.toUi(chip), 'var(--ok)', 6).then(() => this.glow(this.diagram.querySelector('.how-ui')));
    await this.fly(this.out(chip, 'result'), ok ? 'var(--c1)' : 'var(--danger)', 6);
    this.glow(this.diagram.querySelector('.how-agent'));
  }

  glow(element) {
    element.classList.remove('how-glow');
    void element.getBoundingClientRect();
    element.classList.add('how-glow');
  }

  // A dot travelling along a polyline at a steady speed.
  fly(points, color, radius = 4) {
    const dot = svg('circle', {r: radius, class: 'how-packet'});
    // Set through the style object: the page's CSP rejects inline style attributes.
    dot.style.fill = dot.style.color = color;
    this.packets.append(dot);
    const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
    const total = lengths.reduce((sum, value) => sum + value, 0) || 1;
    const duration = Math.max(350, total / .42);
    return new Promise(resolve => {
      const begin = performance.now();
      const frame = now => {
        let travelled = Math.min(1, (now - begin) / duration) * total, index = 0;
        while (index < lengths.length - 1 && travelled > lengths[index]) travelled -= lengths[index++];
        const [x1, y1] = points[index], [x2, y2] = points[index + 1], share = lengths[index] ? travelled / lengths[index] : 1;
        dot.setAttribute('cx', x1 + (x2 - x1) * share);
        dot.setAttribute('cy', y1 + (y2 - y1) * share);
        if (now - begin < duration && dot.isConnected) requestAnimationFrame(frame);
        else { dot.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }
}
