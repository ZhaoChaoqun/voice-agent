// Visual effects for Agent actions. They only decorate: page state never depends on them, they
// add their own overlay nodes (so the tested calendar animations stay the last ones on an
// element), and they are skipped entirely when the attendee prefers reduced motion.
// Colours are CSS colour strings, normally theme variables such as 'var(--c1)'.
const SVG = 'http://www.w3.org/2000/svg';
let layer = null, svg = null, beams = 0;

export const motionAllowed = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const center = rect => ({x: rect.left + rect.width / 2, y: rect.top + rect.height / 2});
const rectOf = target => target instanceof Element ? target.getBoundingClientRect() : target;
const onScreen = rect => rect && rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;

function overlay() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  svg = document.createElementNS(SVG, 'svg');
  svg.append(document.createElementNS(SVG, 'defs'));
  layer.append(svg);
  document.body.append(layer);
  return layer;
}

function spawn(className, {x, y}, properties = {}) {
  const node = document.createElement('div');
  node.className = className;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  for (const [name, value] of Object.entries(properties)) node.style.setProperty(name, value);
  overlay().append(node);
  node.addEventListener('animationend', () => node.remove(), {once: true});
  setTimeout(() => node.remove(), 3000);
  return node;
}

// A neon arc from the voice orb to the element the Agent just acted on, with a travelling spark.
export function beam(from, target, {colors = ['var(--c1)', 'var(--c2)', 'var(--c3)'], impact = true} = {}) {
  const to = rectOf(target);
  if (!motionAllowed() || !from || !onScreen(to)) return;
  overlay();
  const end = center(to);
  const lift = Math.min(180, Math.hypot(end.x - from.x, end.y - from.y) * .35);
  const control = {x: (from.x + end.x) / 2, y: Math.min(from.y, end.y) - lift};
  const d = `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  const id = `fx-beam-${++beams}`;
  const gradient = document.createElementNS(SVG, 'linearGradient');
  gradient.id = id;
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  for (const [name, value] of [['x1', from.x], ['y1', from.y], ['x2', end.x], ['y2', end.y]]) gradient.setAttribute(name, value);
  colors.forEach((color, index) => {
    const stop = document.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', `${index / (colors.length - 1)}`);
    stop.style.setProperty('stop-color', color);
    gradient.append(stop);
  });
  svg.firstChild.append(gradient);
  const paths = [['fx-beam-glow', 7], ['fx-beam', 1.6]].map(([className, width]) => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', className);
    path.setAttribute('stroke', `url(#${id})`);
    path.setAttribute('stroke-width', width);
    svg.append(path);
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.animate([{strokeDashoffset: length, opacity: 1}, {strokeDashoffset: 0, opacity: 1, offset: .45},
      {strokeDashoffset: 0, opacity: 1, offset: .7}, {strokeDashoffset: -length, opacity: 0}],
    {duration: 1150, easing: 'cubic-bezier(.4,0,.2,1)'});
    return path;
  });
  const spark = document.createElement('div');
  spark.className = 'fx-spark';
  spark.style.offsetPath = `path("${d}")`;
  layer.append(spark);
  spark.animate([{offsetDistance: '0%', opacity: 0}, {opacity: 1, offset: .1}, {offsetDistance: '100%', opacity: 1}],
    {duration: 520, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards'});
  setTimeout(() => {
    spark.remove();
    if (impact) ping(to, colors.at(-1));
  }, 520);
  setTimeout(() => { paths.forEach(path => path.remove()); gradient.remove(); }, 1200);
}

export function ping(target, color = 'var(--c1)') {
  const rect = rectOf(target);
  if (!motionAllowed() || !onScreen(rect)) return;
  spawn('fx-ping', center(rect), {'--fx-color': color});
}

// Ring plus radiating sparks: something new materialised (an added calendar event).
export function burst(target, color = 'var(--ok)') {
  const rect = rectOf(target);
  if (!motionAllowed() || !onScreen(rect)) return;
  const point = center(rect);
  spawn('fx-ring', point, {'--fx-color': color});
  for (let index = 0; index < 12; index++) {
    const angle = Math.PI * 2 * index / 12 + Math.random() * .3, distance = 28 + Math.random() * 30;
    spawn('fx-particle', point, {'--fx-color': color, '--dx': `${Math.cos(angle) * distance}px`, '--dy': `${Math.sin(angle) * distance}px`});
  }
}

// Fragments drifting away from a removed calendar event.
export function shatter(rect, color = 'var(--danger)') {
  if (!motionAllowed() || !onScreen(rect)) return;
  for (let index = 0; index < 14; index++) {
    spawn('fx-fragment', {x: rect.left + Math.random() * rect.width, y: rect.top + Math.random() * rect.height}, {
      '--fx-color': color, '--dx': `${(Math.random() - .5) * 90}px`, '--dy': `${-20 - Math.random() * 50}px`,
      '--spin': `${(Math.random() - .5) * 260}deg`,
    });
  }
}

// Corner brackets that close in on a card the Agent is focusing on.
export function lockOn(card) {
  if (!motionAllowed() || !card) return;
  card.querySelector('.lock-reticle')?.remove();
  const reticle = document.createElement('span');
  reticle.className = 'lock-reticle';
  reticle.setAttribute('aria-hidden', 'true');
  reticle.append(...['tl', 'tr', 'bl', 'br'].map(corner => {
    const node = document.createElement('i');
    node.className = corner;
    return node;
  }));
  card.append(reticle);
  setTimeout(() => reticle.remove(), 1500);
}

// Restarts a one-shot CSS sequence driven by an attribute (calendar scan, conflict review).
export function pulseAttribute(element, attribute, ms) {
  if (!element) return;
  element.removeAttribute(attribute);
  if (!motionAllowed()) return;
  void element.offsetWidth;
  element.setAttribute(attribute, 'true');
  clearTimeout(element[`_${attribute}`]);
  element[`_${attribute}`] = setTimeout(() => element.removeAttribute(attribute), ms);
}

// FLIP: measure cards, let render() reorder them, then glide each card from its old position.
// Cards that were not on screen before are dealt in from below with a stagger.
export function reflow(container, render) {
  const before = new Map([...container.children].map(card => [card.dataset.sessionId, card.getBoundingClientRect()]));
  render();
  if (!motionAllowed()) return;
  [...container.children].forEach((card, index) => {
    const after = card.getBoundingClientRect(), previous = before.get(card.dataset.sessionId);
    const delay = Math.min(index, 12) * 55;
    if (previous) {
      const dx = previous.left - after.left, dy = previous.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      card.animate([{transform: `translate(${dx}px,${dy}px)`}, {transform: 'none'}],
        {duration: 620, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards'});
    } else {
      card.animate([{opacity: 0, transform: 'translateY(46px) scale(.94) rotateX(18deg)', filter: 'blur(6px)'},
        {opacity: 1, transform: 'none', filter: 'blur(0)'}],
      {duration: 560, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'});
    }
  });
}

// Types text into an element one character at a time; resolves when done or superseded.
export function typeInto(element, text, perCharacter = 22) {
  clearInterval(element._typing);
  if (!motionAllowed()) { element.textContent = text; return Promise.resolve(); }
  element.textContent = '';
  return new Promise(resolve => {
    let index = 0;
    element._typing = setInterval(() => {
      element.textContent = text.slice(0, ++index);
      if (index >= text.length) { clearInterval(element._typing); resolve(); }
    }, perCharacter);
  });
}

// Exporting the agenda: the calendar blocks fly into the export button, a calendar file is packed
// there (its bar fills, a tick, sparks) and then flies off to the top-right corner, where browsers
// show downloads. flights: [{element, code, color}]; fallback: where off-screen blocks start from.
export async function exportShow(flights, button, {count, fallback}) {
  if (!motionAllowed()) return;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const target = center(button.getBoundingClientRect());
  const pulse = () => button.animate([{transform: 'scale(1)'}, {transform: 'scale(1.14)'}, {transform: 'scale(1)'}], {duration: 240});
  await Promise.all(flights.slice(0, 12).map(({element, code, color}, index) => {
    const own = element.getBoundingClientRect(), rect = onScreen(own) ? own : fallback.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'fx-export-ghost';
    ghost.textContent = code;
    Object.assign(ghost.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${Math.max(56, rect.width)}px`,
      height: `${Math.min(Math.max(26, rect.height), 60)}px`});
    ghost.style.setProperty('--fx-color', color);
    overlay().append(ghost);
    const dx = target.x - (rect.left + rect.width / 2), dy = target.y - (rect.top + Math.min(rect.height, 60) / 2);
    return ghost.animate([
      {transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1},
      {transform: `translate(${dx * .4}px, ${dy * .4 - 140}px) scale(.8) rotate(-10deg)`, opacity: 1, offset: .5},
      {transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(14deg)`, opacity: .3},
    ], {duration: 820, delay: index * 85, easing: 'cubic-bezier(.55, 0, .25, 1)', fill: 'forwards'})
      .finished.then(() => { ghost.remove(); pulse(); });
  }));
  spawn('fx-ring', target, {'--fx-color': 'var(--ok)'});
  const file = document.createElement('div');
  file.className = 'fx-export-file';
  Object.assign(file.style, {left: `${target.x}px`, top: `${target.y}px`});
  const bar = document.createElement('b');
  file.append(Object.assign(document.createElement('small'), {textContent: '.ICS'}),
    Object.assign(document.createElement('strong'), {textContent: String(count)}),
    Object.assign(document.createElement('span'), {textContent: count === 1 ? 'SESSION' : 'SESSIONS'}),
    Object.assign(document.createElement('i'), {className: 'fx-export-bar'}), Object.assign(document.createElement('em'), {textContent: '✓'}));
  file.querySelector('.fx-export-bar').append(bar);
  overlay().append(file);
  const at = 'translate(-50%, 46px) scale(1)';
  await file.animate([{transform: 'translate(-50%, -50%) scale(.15) rotate(-20deg)', opacity: 0}, {transform: at, opacity: 1}],
    {duration: 420, easing: 'cubic-bezier(.16, 1.4, .3, 1)', fill: 'forwards'}).finished;
  await bar.animate([{transform: 'scaleX(0)'}, {transform: 'scaleX(1)'}], {duration: 700, easing: 'cubic-bezier(.6, 0, .3, 1)', fill: 'forwards'}).finished;
  file.classList.add('done');
  burst(file, 'var(--ok)');
  await wait(420);
  const box = file.getBoundingClientRect();
  await file.animate([{transform: at, opacity: 1},
    {transform: `translate(calc(-50% + ${(innerWidth - 36 - (box.left + box.width / 2)) * .5}px), ${-box.top * .35}px) scale(.7) rotate(8deg)`, opacity: 1, offset: .4},
    {transform: `translate(calc(-50% + ${innerWidth - 36 - (box.left + box.width / 2)}px), ${-box.top - 30}px) scale(.18) rotate(20deg)`, opacity: 0},
  ], {duration: 760, easing: 'cubic-bezier(.5, 0, .7, .4)', fill: 'forwards'}).finished;
  file.remove();
}
