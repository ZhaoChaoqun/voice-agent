// Canvas renderers: a neon wireframe voice orb that follows the Agent's state and the real voice
// spectrum, and the hero's Microsoft logo built from points of light. Orb colours come from the
// page theme's CSS variables and are re-read on 'ignite:theme'; the logo keeps Microsoft's colours.
const TAU = Math.PI * 2;
const WHITE = [255, 255, 255];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const css = ([r, g, b], alpha = 1) => `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
const blend = (from, to, amount) => from.map((value, index) => value + (to[index] - value) * amount);
const cssColor = name => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? rgb(value) : [128, 128, 255];
};

// Top, middle and bottom colours of the orb for each Agent state, from the current theme.
export function stateColors() {
  const [bg, c1, c2, c3, c4, warm, ok] = ['--bg', '--c1', '--c2', '--c3', '--c4', '--warm', '--ok'].map(cssColor);
  const dim = color => blend(color, bg, .45);
  return {
    offline: [dim(c3), dim(c2), dim(c1)],
    connecting: [c2, c2, c1],
    listening: [c3, c2, c1],
    hearing: [c2, c1, blend(c1, WHITE, .45)],
    thinking: [c4, c3, c2],
    acting: [warm, ok, c1],
    speaking: [blend(c3, WHITE, .15), c2, c1],
  };
}
const MOTION = {
  offline: {spin: .12, amp: .015, glow: .35},
  connecting: {spin: .9, amp: .04, glow: .6},
  listening: {spin: .22, amp: .03, glow: .7},
  hearing: {spin: .32, amp: .04, glow: .95},
  thinking: {spin: 1.15, amp: .06, glow: .85},
  acting: {spin: .75, amp: .07, glow: 1},
  speaking: {spin: .3, amp: .035, glow: 1},
};

class Canvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.width = this.height = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    addEventListener('ignite:theme', () => { this.theme(); this.dirty = true; });
    this.resize();
  }

  theme() {}

  resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.width * ratio));
    this.canvas.height = Math.max(1, Math.round(this.height * ratio));
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.dirty = true;
  }

  visible() {
    return this.canvas.isConnected && this.canvas.offsetParent !== null && this.width > 0 && this.height > 0 && !document.hidden;
  }

  loop(draw) {
    const frame = now => {
      requestAnimationFrame(frame);
      if (!this.visible()) return;
      if (reducedMotion.matches && !this.dirty) return;
      this.dirty = false;
      draw(reducedMotion.matches ? 0 : now / 1000);
    };
    requestAnimationFrame(frame);
  }

  // Splits each projected polyline into front and back halves so depth reads as brightness.
  strokeLines(lines, gradient, {front = .95, back = .16, width = 1.1, glow = .14}) {
    const context = this.context;
    for (const [alpha, lineWidth, wantFront] of [[back, width, false], [glow, width * 4, true], [front, width, true]]) {
      if (!alpha) continue;
      context.beginPath();
      for (const line of lines) {
        for (let index = 1; index < line.length; index++) {
          const a = line[index - 1], b = line[index];
          if ((a[2] + b[2] > 0) !== wantFront) continue;
          context.moveTo(a[0], a[1]);
          context.lineTo(b[0], b[1]);
        }
      }
      context.globalAlpha = alpha;
      context.lineWidth = lineWidth;
      context.strokeStyle = gradient;
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}

function rotate([x, y, z], yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

// read() returns {state, input, output, spectrum}; spectrum is {bands, low, mid, high, centroid}
// for whoever is talking (the Agent's voice or the microphone), or null when nobody is.
// radius is the sphere's radius as a share of the canvas's shorter side.
export class WireOrb extends Canvas {
  constructor(canvas, {read, detail = 1, hud = true, radius = hud ? .27 : .36}) {
    super(canvas);
    Object.assign(this, {read, detail, hud, size: radius});
    this.theme();
    this.colors = this.palette.offline.map(color => [...color]);
    this.bands = new Float32Array(40);
    this.low = this.mid = this.high = this.centroid = this.bassAverage = 0;
    this.ripples = [];
    this.lastKick = 0;
    this.phase = 0;
    this.motion = {...MOTION.offline};
    this.state = 'offline';
    this.burst = -1;
    this.last = 0;
    this.loop(time => this.draw(time));
  }

  theme() {
    this.palette = stateColors();
    this.warm = cssColor('--warm');
  }

  // Fast attack, slow release: syllables pop out and then settle like a real VU meter.
  listen(spectrum, step) {
    const follow = (value, target) => value + (target - value) * (target > value ? .55 : .14);
    const bands = spectrum?.bands, last = this.bands.length - 1;
    // A light blur across neighbouring bands keeps the surface fluid instead of spiky.
    for (let index = 0; index <= last; index++) {
      const target = bands ? (bands[Math.max(0, index - 1)] + 2 * bands[index] + bands[Math.min(last, index + 1)]) / 4 : 0;
      this.bands[index] = follow(this.bands[index], target);
    }
    this.low = follow(this.low, spectrum?.low || 0);
    this.mid = follow(this.mid, spectrum?.mid || 0);
    this.high = follow(this.high, spectrum?.high || 0);
    this.centroid += ((spectrum ? spectrum.centroid : .5) - this.centroid) * Math.min(1, step * 6);
    this.bassAverage += (this.low - this.bassAverage) * Math.min(1, step * 1.5);
  }

  // Band energy at a height of the sphere: bass at the bottom, treble at the top.
  band(position) {
    const scaled = position * (this.bands.length - 1), index = Math.floor(scaled), fraction = scaled - index;
    return this.bands[index] * (1 - fraction) + this.bands[Math.min(this.bands.length - 1, index + 1)] * fraction;
  }

  draw(time) {
    const {context: g, width: w, height: h} = this;
    const step = Math.min(.05, Math.max(0, time - this.last)) || .016;
    this.last = time;
    const {state = 'offline', spectrum = null} = this.read();
    if (state !== this.state) {
      if (state === 'acting') this.burst = time;
      this.state = state;
    }
    const target = MOTION[state] || MOTION.offline;
    for (const key of Object.keys(target)) this.motion[key] += (target[key] - this.motion[key]) * Math.min(1, step * 5);
    const goal = this.palette[state] || this.palette.offline;
    this.colors = this.colors.map((color, index) => blend(color, goal[index], Math.min(1, step * 4)));
    this.listen(spectrum, step);
    // A bass hit well above its recent average sends a shockwave ring out of the orb.
    if (this.hud && this.low > .32 && this.low > this.bassAverage * 1.35 && time - this.lastKick > .22) {
      this.ripples.push(time);
      this.lastKick = time;
    }
    this.phase += step * this.motion.spin * (1 + this.mid * 1.5);

    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * this.size;
    // Bright (high-pitched) speech lifts the top colour towards white; deep speech warms the bottom glow.
    const [top, middle, bottom] = [blend(this.colors[0], WHITE, Math.max(0, this.centroid - .45) * .9 + this.high * .25),
      this.colors[1], this.colors[2]];
    g.globalCompositeOperation = 'lighter';

    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, radius * (2 + this.low * .6));
    halo.addColorStop(0, css(middle, .24 * this.motion.glow + this.low * .35));
    halo.addColorStop(.45, css(top, .08 * this.motion.glow + this.high * .12));
    halo.addColorStop(1, css(top, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);

    const gradient = g.createLinearGradient(0, cy - radius * 1.35, 0, cy + radius * 1.35);
    gradient.addColorStop(0, css(top));
    gradient.addColorStop(.5, css(middle));
    gradient.addColorStop(1, css(bottom));
    const yaw = this.phase, pitch = .42 + Math.sin(time * .4) * .08, twist = state === 'thinking' ? .6 : .15 + this.mid * .5;
    const rings = Math.round(13 * this.detail), meridians = Math.round(22 * this.detail), segments = Math.round(56 * this.detail);
    const point = (lat, lon) => {
      const position = (Math.PI / 2 - lat) / Math.PI; // 0 = bottom (bass) … 1 = top (treble)
      const energy = this.band(position);
      const idle = Math.sin(3 * lon + time * 2.3 + lat * 2) * Math.cos(2 * lat - time * 1.6) + .6 * Math.sin(5 * lat + lon * 2 - time * 3.1);
      // Ripple count rises with height: smooth swells for bass, fine shimmer for treble.
      const ripple = Math.sin(lon * Math.round(3 + position * 5) - time * (2.5 + position * 6));
      const r = radius * (1 + this.motion.amp * idle + this.low * .13 + energy * .24 * (.72 + .28 * ripple));
      const turned = lon + twist * Math.sin(lat * 2 + time);
      const [x, y, z] = rotate([r * Math.cos(lat) * Math.cos(turned), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(turned)], yaw, pitch);
      const perspective = 3.2 * radius / (3.2 * radius - z);
      return [cx + x * perspective, cy + y * perspective, z];
    };
    const lines = [];
    for (let ring = 1; ring < rings; ring++) {
      const lat = -Math.PI / 2 + Math.PI * ring / rings, line = [];
      for (let index = 0; index <= segments; index++) line.push(point(lat, TAU * index / segments));
      lines.push(line);
    }
    for (let meridian = 0; meridian < meridians; meridian++) {
      const lon = TAU * meridian / meridians, line = [];
      for (let index = 0; index <= segments / 2; index++) line.push(point(-Math.PI / 2 + Math.PI * index / (segments / 2), lon));
      lines.push(line);
    }
    const level = Math.max(this.low, this.mid, this.high);
    this.strokeLines(lines, gradient, {front: .55 + .4 * this.motion.glow, width: this.hud ? 1.05 : .9, glow: this.hud ? .12 + level * .22 : .1});

    if (this.hud) this.drawHud(time, cx, cy, radius, [top, middle, bottom]);
    g.globalCompositeOperation = 'source-over';
  }

  drawHud(time, cx, cy, radius, [top, middle, bottom]) {
    const g = this.context;
    const outer = radius * 1.58;
    g.lineWidth = 1;
    g.strokeStyle = css(middle, .22);
    g.beginPath();
    g.arc(cx, cy, outer, 0, TAU);
    g.stroke();
    // A mirrored circular equalizer: bass at the bottom of the ring, treble at the top.
    const ticks = 96;
    for (let index = 0; index < ticks; index++) {
      const angle = TAU * index / ticks;
      let fromBottom = Math.abs(((angle - Math.PI / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI) / Math.PI;
      const energy = this.band(fromBottom);
      const idle = 1.5 + Math.sin(index * .9 + time * 2) * .8;
      const length = idle + (index % 8 === 0 ? 3 : 0) + energy * radius * .47;
      g.beginPath();
      g.moveTo(cx + Math.cos(angle) * (outer + 4), cy + Math.sin(angle) * (outer + 4));
      g.lineTo(cx + Math.cos(angle) * (outer + 4 + length), cy + Math.sin(angle) * (outer + 4 + length));
      g.lineWidth = 1.6;
      g.strokeStyle = css(blend(bottom, top, fromBottom), .45 + energy * .55);
      g.stroke();
    }
    // Two counter-rotating arcs; they race while the Agent is thinking or connecting.
    for (const [offset, direction, color, span] of [[0, 1, top, 1.1], [Math.PI, -1, bottom, .7]]) {
      const start = offset + direction * this.phase * 2.2;
      g.beginPath();
      g.arc(cx, cy, outer - 10, start, start + span);
      g.lineWidth = 2;
      g.strokeStyle = css(color, .85);
      g.stroke();
    }
    this.ripples = this.ripples.filter(start => time - start < .8);
    for (const start of this.ripples) {
      const progress = (time - start) / .8;
      g.beginPath();
      g.arc(cx, cy, radius * (1.08 + progress * .9), 0, TAU);
      g.lineWidth = 2.5 * (1 - progress);
      g.strokeStyle = css(bottom, .7 * (1 - progress));
      g.stroke();
    }
    if (this.burst >= 0) {
      const progress = (time - this.burst) / .9;
      if (progress >= 1 || progress < 0) this.burst = -1;
      else {
        g.beginPath();
        g.arc(cx, cy, radius * (1.05 + progress * 1.3), 0, TAU);
        g.lineWidth = 3 * (1 - progress);
        g.strokeStyle = css(this.warm, .9 * (1 - progress));
        g.stroke();
      }
    }
  }
}

// Microsoft's four squares built from points of light, for the hero. The points spiral in and
// assemble the logo, which then turns slowly in 3D, breathes apart and back, carries a travelling
// wave and a light sweep, and swerves around the pointer. While someone is talking, each square
// swells with its quarter of the voice spectrum (red bass … yellow treble); a click on the logo or
// an Agent page action sends a shock wave through the points.
const LOGO = [[-1, -1, '#f25022'], [1, -1, '#7fba00'], [-1, 1, '#00a4ef'], [1, 1, '#ffb900']];
const GRID = 24, SIDE = 20 / 21, CENTER = 11 / 21; // the logo's 10:1 square-to-gap proportion
const LEVELS = 8; // brightness steps per square; points are drawn in one path per step

export class LogoField extends Canvas {
  constructor(canvas, {read = () => ({})} = {}) {
    super(canvas);
    const count = LOGO.length * GRID * GRID;
    Object.assign(this, {read, count, pointer: null, tilt: [0, 0], energy: [0, 0, 0, 0], started: null, last: 0, state: 'offline', onscreen: true});
    this.square = new Uint8Array(count);
    this.home = new Float32Array(count * 3); // u, v inside the square (-.5 … .5) and 1 on its border
    this.from = new Float32Array(count * 3); // where each point starts its flight into the logo
    this.delay = new Float32Array(count);
    this.offset = new Float32Array(count * 2); // screen-space spring displacement and its velocity
    this.velocity = new Float32Array(count * 2);
    this.screen = new Float32Array(count * 3); // projected x, y and dot size
    this.level = new Uint8Array(count);
    this.used = new Uint8Array(LOGO.length * LEVELS);
    let index = 0;
    for (let square = 0; square < LOGO.length; square++) {
      for (let row = 0; row < GRID; row++) {
        for (let column = 0; column < GRID; column++, index++) {
          const u = column / (GRID - 1) - .5, v = row / (GRID - 1) - .5;
          this.square[index] = square;
          this.home.set([u, v, Math.max(Math.abs(u), Math.abs(v)) > .47 ? 1 : 0], index * 3);
          const angle = Math.random() * TAU, distance = 2.2 + Math.random() * 1.6;
          this.from.set([Math.cos(angle) * distance, Math.sin(angle) * distance * .7, (Math.random() - .5) * 2], index * 3);
          this.delay[index] = Math.random() * .5 + (Math.abs(u) + Math.abs(v)) * .3;
        }
      }
    }
    // Dim to full colour, then towards white for the border and the light sweep.
    this.colors = LOGO.map(([, , hex]) => Array.from({length: LEVELS}, (_, level) =>
      level < 5 ? css(rgb(hex), .22 + level * .17) : css(blend(rgb(hex), WHITE, (level - 4) * .2))));
    new IntersectionObserver(([entry]) => { this.onscreen = entry.isIntersecting; this.dirty = true; }).observe(canvas);
    const area = canvas.parentElement;
    const local = event => {
      const box = canvas.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top];
    };
    area.addEventListener('pointermove', event => { this.pointer = local(event); }, {passive: true});
    area.addEventListener('pointerleave', () => { this.pointer = null; });
    area.addEventListener('pointerdown', event => {
      if (event.target.closest('a, button, input') || !this.center) return;
      const [x, y] = local(event), [cx, cy, size] = this.center;
      if (Math.hypot(x - cx, y - cy) < size * 1.5) this.shock(1);
    });
    this.loop(time => this.draw(time));
  }

  visible() {
    return this.onscreen && super.visible();
  }

  // Pushes every point away from the logo's centre; the springs pull them back.
  shock(strength) {
    if (reducedMotion.matches || !this.center) return;
    const [cx, cy] = this.center;
    for (let index = 0; index < this.count; index++) {
      const dx = this.screen[index * 3] - cx, dy = this.screen[index * 3 + 1] - cy, distance = Math.hypot(dx, dy) || 1;
      const push = strength * (260 + Math.random() * 420);
      this.velocity[index * 2] += dx / distance * push;
      this.velocity[index * 2 + 1] += dy / distance * push;
    }
  }

  // Average band energy per square, with the same fast attack and slow release as the orb.
  listen(spectrum) {
    const bands = spectrum?.bands, width = bands ? bands.length / LOGO.length : 0;
    for (let square = 0; square < LOGO.length; square++) {
      let target = 0;
      for (let band = square * width; band < (square + 1) * width; band++) target += bands[band] / width;
      const value = this.energy[square];
      this.energy[square] = value + (target - value) * (target > value ? .5 : .12);
    }
  }

  draw(time) {
    const {context: g, width: w, height: h} = this;
    const still = reducedMotion.matches;
    const step = Math.min(.05, Math.max(0, time - this.last)) || .016;
    this.last = time;
    this.started ??= time;
    const age = still ? Infinity : time - this.started;
    const {state = 'offline', spectrum = null} = this.read() || {};
    if (state === 'acting' && this.state !== 'acting') this.shock(.45);
    this.state = state;
    this.listen(spectrum);

    // Right half of the hero on desktop; a small mark in the top-right corner on phones.
    const narrow = w < 720;
    const size = narrow ? Math.min(w * .15, h * .2) : Math.min(h * .34, w * .15);
    const cx = narrow ? w - size * 1.6 : w * .76, cy = narrow ? size * 1.7 : h * .5;
    this.center = [cx, cy, size];
    const aim = this.pointer && !still ? [(this.pointer[0] - cx) / w, (this.pointer[1] - cy) / h] : [0, 0];
    this.tilt = this.tilt.map((value, axis) => value + (aim[axis] - value) * Math.min(1, step * 2.5));
    // The logo turns to face the pointer.
    const yaw = Math.sin(time * .23) * .42 + this.tilt[0] * 1.1, pitch = Math.sin(time * .17) * .14 - this.tilt[1] * .8;
    const breathe = still ? .3 : .5 - .5 * Math.cos(time * TAU / 8);
    const spread = CENTER * (1 + .14 * breathe), focal = 3.4, fade = Math.min(1, age / 2);
    const sweep = time * .2 % 1.8 - .4; // the light sweep's position along the top-left → bottom-right diagonal
    const squares = LOGO.map(([x, y], square) => {
      const energy = this.energy[square];
      return {x: x * spread, y: y * spread, z: Math.sin(time * .6 + square * 1.9) * .09 * (.3 + breathe) + energy * .35,
        scale: 1 + energy * .12, energy};
    });

    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    squares.forEach(({x, y, z, energy}, square) => {
      const [px, py, pz] = rotate([x, y, z], yaw, pitch), p = focal / (focal - pz);
      const gx = cx + px * size * p, gy = cy + py * size * p, color = rgb(LOGO[square][2]);
      const glow = g.createRadialGradient(gx, gy, 0, gx, gy, size * .9 * p);
      glow.addColorStop(0, css(color, (.16 + energy * .3) * fade));
      glow.addColorStop(1, css(color, 0));
      g.fillStyle = glow;
      g.fillRect(gx - size, gy - size, size * 2, size * 2);
    });

    const dot = size / GRID * .5, radius = size * .55, pointer = !still && this.pointer;
    this.used.fill(0);
    for (let index = 0; index < this.count; index++) {
      const base = squares[this.square[index]], at = index * 3;
      const u = this.home[at], v = this.home[at + 1], edge = this.home[at + 2], r = Math.hypot(u, v) * 2;
      let x = base.x + u * SIDE * base.scale, y = base.y + v * SIDE * base.scale;
      // A travelling wave across the surface; speech adds a ripple from each square's centre.
      let z = base.z + .045 * Math.sin((x * 1.3 + y * .8) * 3.2 - time * 2.1)
        + base.energy * .22 * Math.sin(r * 9 - time * 11) * Math.max(0, 1 - r * .6);
      let shown = 1;
      const flight = Math.min(1, Math.max(0, (age - this.delay[index]) / 1.8));
      if (flight < 1) {
        const eased = 1 - (1 - flight) ** 3, twist = (1 - eased) * 2.4;
        const fx = this.from[at] + (x - this.from[at]) * eased, fy = this.from[at + 1] + (y - this.from[at + 1]) * eased;
        z = this.from[at + 2] + (z - this.from[at + 2]) * eased;
        x = fx * Math.cos(twist) - fy * Math.sin(twist);
        y = fx * Math.sin(twist) + fy * Math.cos(twist);
        shown = Math.min(1, flight * 2.5);
      }
      const [px, py, pz] = rotate([x, y, z], yaw, pitch), p = focal / (focal - pz);
      let sx = cx + px * size * p, sy = cy + py * size * p;
      if (!still) {
        const o = index * 2;
        if (pointer) {
          const dx = sx + this.offset[o] - pointer[0], dy = sy + this.offset[o + 1] - pointer[1], distance = Math.hypot(dx, dy);
          if (distance < radius && distance > .01) {
            const push = (1 - distance / radius) ** 2 * 2600 * step;
            this.velocity[o] += dx / distance * push;
            this.velocity[o + 1] += dy / distance * push;
          }
        }
        this.velocity[o] += (-38 * this.offset[o] - 7.5 * this.velocity[o]) * step;
        this.velocity[o + 1] += (-38 * this.offset[o + 1] - 7.5 * this.velocity[o + 1]) * step;
        this.offset[o] += this.velocity[o] * step;
        this.offset[o + 1] += this.velocity[o + 1] * step;
        sx += this.offset[o];
        sy += this.offset[o + 1];
      }
      const glint = Math.exp(-((((x + y) / 4 + .5 - sweep) / .07) ** 2));
      const bright = (.55 + pz * .9 + edge * .3 + glint * 1.1 + base.energy * .8) * shown;
      const level = this.square[index] * LEVELS + Math.max(0, Math.min(LEVELS - 1, Math.floor(bright * 4)));
      this.level[index] = level;
      this.used[level] = 1;
      this.screen[at] = sx;
      this.screen[at + 1] = sy;
      this.screen[at + 2] = dot * p * (1 + glint * .5);
    }
    for (let level = 0; level < this.used.length; level++) {
      if (!this.used[level]) continue;
      g.fillStyle = this.colors[level / LEVELS | 0][level % LEVELS];
      g.beginPath();
      for (let index = 0; index < this.count; index++) {
        if (this.level[index] !== level) continue;
        const at = index * 3, s = this.screen[at + 2];
        g.rect(this.screen[at] - s / 2, this.screen[at + 1] - s / 2, s, s);
      }
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
