// Browser port of the Python phonetic-name-search matcher (`namesearch`): find a person from what the
// speech recogniser wrote, which for an unfamiliar name is often ordinary English words
// ("Raghavan" -> "rug of on"). Names are compared by sound, not spelling: both sides become
// phonemes, aligned with accent-aware costs, and adjacent transcript words may be joined back
// into one name. The data tables come from the Python package (build_name_search_data.py) and
// every function below mirrors its Python namesake; test_name_search.mjs checks parity.
//
// The result's status is what a caller must obey: one_match may be acted on, multiple_matches
// must be disambiguated, no_match must be admitted (candidates are still returned).

// Conference words that are never part of a person's name. The reference lists were written for
// mortgage calls; without these, "what is on thursday" matches Charles Tostain. They break word
// runs like the reference's strong filler ("please", "transfer") and are dropped from the query.
export const EVENT_FILLER = `monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight morning
  afternoon evening session sessions speaker speakers talk talks keynote keynotes presenting presenter presenters
  presents present presentation panel panels breakout breakouts lab labs workshop workshops demo demos theater
  ignite microsoft find show list agenda calendar schedule who whos`.split(/\s+/);

const memo = (cache, key, compute) => {
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  return value;
};
const pairKey = (left, right) => (left < right ? `${left}|${right}` : `${right}|${left}`);

// ---- normalize.py ------------------------------------------------------------------------------
const PUNCT = /[^\p{L}\p{N}_\s'-]/gu;
const APOSTROPHE = /['’]/g;
const COMBINING = /\p{M}/gu;

export function stripAccents(text) {
  return String(text).normalize('NFKD').replace(COMBINING, '');
}

// Python casefold for the characters names use, then the same punctuation rules.
export function normalizeText(text) {
  const folded = stripAccents(text).toLowerCase().replaceAll('ß', 'ss');
  return folded.replace(APOSTROPHE, '').replace(PUNCT, ' ').replace(/[-_]+/g, ' ').trim();
}

// ---- jaro-winkler (rapidfuzz.distance.JaroWinkler.similarity, prefix_weight 0.1) --------------
export function jaroWinkler(left, right) {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatched = new Array(left.length).fill(false), rightMatched = new Array(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i++) {
    const from = Math.max(0, i - window), to = Math.min(right.length - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (rightMatched[j] || left[i] !== right[j]) continue;
      leftMatched[i] = rightMatched[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < left.length; i++) {
    if (!leftMatched[i]) continue;
    while (!rightMatched[k]) k++;
    if (left[i] !== right[k]) transpositions++;
    k++;
  }
  // rapidfuzz halves the transposition count with integer division.
  const jaro = (matches / left.length + matches / right.length + (matches - Math.floor(transpositions / 2)) / matches) / 3;
  if (jaro <= .7) return jaro;
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  return jaro + prefix * .1 * (1 - jaro);
}

export class NameSearch {
  // people: [{id, name, aliases?: [..], ...extra}] — extra fields are returned with matches.
  constructor(data, people, {extraStrongFiller = [], maxCandidates = 400} = {}) {
    this.data = data;
    this.maxCandidates = maxCandidates;
    const {normalize, g2p, phonemes, search} = data;
    this.strong = new Set([...normalize.strong_filler, ...extraStrongFiller]);
    this.weak = new Set(normalize.weak_filler);
    this.particles = new Set(normalize.particles);
    this.spelledMarkers = new Set(normalize.spelled_markers);
    this.exceptions = new Map(Object.entries(g2p.exceptions).map(([word, entries]) =>
      [word, entries.map(entry => collapse(entry.split(' ').filter(Boolean)))]));
    this.rules = g2p.rules.map(([pattern, alternatives]) =>
      [new RegExp(pattern, 'y'), alternatives.map(alternative => alternative.split(' ').filter(Boolean))]);
    this.consonants = phonemes.consonants;
    this.vowels = phonemes.vowels;
    this.placeIndex = Object.fromEntries(phonemes.place_order.map((place, index) => [place, index]));
    this.manner = new Map(phonemes.manner_distance.map(([a, b, cost]) => [pairKey(a, b), cost]));
    this.confusion = new Map(phonemes.confusion_pairs.map(([a, b, cost]) => [pairKey(a, b), cost]));
    this.classes = data.keys.classes;
    this.nicknames = new Map();
    for (const group of data.nicknames) {
      const members = group.split(/\s+/).filter(Boolean);
      for (const member of members) {
        if (!this.nicknames.has(member)) this.nicknames.set(member, new Set());
        for (const other of members) this.nicknames.get(member).add(other);
      }
    }
    this.commonWords = new Set(data.common_words);
    this.c = search;
    this.caches = {pronounce: new Map(), run: new Map(), sub: new Map(), gap: new Map(), keys: new Map(), token: new Map()};
    this.buildIndex(people);
  }

  // ---- normalize.py --------------------------------------------------------------------------
  mergeSpelledLetters(tokens) {
    const out = [], buffer = [];
    const flush = () => {
      if (buffer.length >= 2) out.push(buffer.join(''));
      else if (buffer.length) out.push(buffer[0]);
      buffer.length = 0;
    };
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.length === 1 && /^\p{L}$/u.test(token)) {
        buffer.push(token);
        let after = index + 1;
        while (after < tokens.length && this.spelledMarkers.has(tokens[after])) after++;
        index = after > index + 1 && after < tokens.length ? after + 1 : index + 1;
        continue;
      }
      flush();
      out.push(token);
      index++;
    }
    flush();
    return out;
  }

  mergeParticles(tokens) {
    const out = [];
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (this.particles.has(token) && index + 1 < tokens.length) {
        let merged = token;
        index++;
        while (index < tokens.length && this.particles.has(tokens[index]) && index + 1 < tokens.length) merged += tokens[index++];
        out.push(merged + tokens[index]);
        index++;
        continue;
      }
      out.push(token);
      index++;
    }
    return out;
  }

  analyze(text) {
    let words = normalizeText(text).split(/\s+/).filter(Boolean);
    words = this.mergeParticles(this.mergeSpelledLetters(words)).filter(word => word && !/^\d+$/.test(word));
    const isFiller = words.map(word => this.strong.has(word) || this.weak.has(word));
    const isBarrier = words.map(word => this.strong.has(word));
    const segments = [];
    let start = 0;
    isBarrier.forEach((barrier, position) => {
      if (!barrier) return;
      if (position > start) segments.push([start, position]);
      start = position + 1;
    });
    if (start < words.length) segments.push([start, words.length]);
    return {words, isFiller, isBarrier, segments, tokens: words.filter((word, index) => !isFiller[index])};
  }

  indexTokens(text) {
    const merged = this.analyze(text).words;
    const plain = this.mergeSpelledLetters(normalizeText(text).split(/\s+/).filter(Boolean)).filter(token => token && !this.particles.has(token));
    return [...new Set([...merged, ...plain])];
  }

  // ---- g2p.py --------------------------------------------------------------------------------
  expand(word) {
    let states = [[0, []]];
    const finished = [], finishedKeys = new Set();
    while (states.length) {
      const next = [], seen = new Set();
      for (const [position, phones] of states) {
        if (position >= word.length) {
          const key = phones.join(' ');
          if (!finishedKeys.has(key)) { finishedKeys.add(key); finished.push(phones); }
          continue;
        }
        let matched = false;
        for (const [pattern, alternatives] of this.rules) {
          pattern.lastIndex = position;
          const match = pattern.exec(word);
          if (!match || match.index + match[0].length === position) continue;
          const end = match.index + match[0].length;
          for (const alternative of alternatives) {
            const state = [end, [...phones, ...alternative]], key = `${end}|${state[1].join(' ')}`;
            if (!seen.has(key)) { seen.add(key); next.push(state); }
          }
          matched = true;
          break;
        }
        if (!matched) {
          const key = `${position + 1}|${phones.join(' ')}`;
          if (!seen.has(key)) { seen.add(key); next.push([position + 1, phones]); }
        }
      }
      states = next.slice(0, this.data.g2p.max_states);
    }
    return finished;
  }

  pronounce(token) {
    return memo(this.caches.pronounce, token, () => {
      const word = token.toLowerCase().replace(/[^a-z]/g, '');
      if (!word) return [];
      if (this.exceptions.has(word)) return this.exceptions.get(word);
      const variants = [], keys = new Set();
      for (const phones of this.expand(word)) {
        const collapsed = collapse(phones), key = collapsed.join(' ');
        if (collapsed.length && !keys.has(key)) { keys.add(key); variants.push(collapsed); }
        if (variants.length >= this.data.g2p.max_variants) break;
      }
      return variants;
    });
  }

  pronounceRun(key) {
    return memo(this.caches.run, key, () => {
      const words = key.split('|').filter(Boolean);
      if (!words.length) return [];
      if (words.length === 1) return this.pronounce(words[0]);
      let sequences = [[]];
      for (const word of words) {
        const variants = this.pronounce(word).slice(0, 2);
        const options = variants.length ? variants : [[]];
        sequences = sequences.flatMap(prefix => options.map(variant => [...prefix, ...variant])).slice(0, 6);
      }
      const out = [], seen = new Set();
      for (const sequence of [...sequences, ...this.pronounce(words.join('')).slice(0, 1)]) {
        const collapsed = collapse(sequence), id = collapsed.join(' ');
        if (collapsed.length && !seen.has(id)) { seen.add(id); out.push(collapsed); }
      }
      return out.slice(0, this.data.g2p.max_variants);
    });
  }

  // ---- phonemes.py ---------------------------------------------------------------------------
  isVowel(phoneme) { return Object.hasOwn(this.vowels, phoneme); }

  subCost(left, right, reduced = true) {
    if (left === right) return 0;
    return memo(this.caches.sub, `${left}|${right}|${reduced}`, () => {
      const explicit = this.confusion.get(pairKey(left, right));
      if (explicit !== undefined) return explicit;
      const leftVowel = this.isVowel(left), rightVowel = this.isVowel(right);
      if (leftVowel !== rightVowel) return 1;
      const p = this.data.phonemes;
      if (leftVowel) {
        if (reduced) {
          const costs = [left, right].filter(vowel => Object.hasOwn(p.reduced_vowel_cost, vowel)).map(vowel => p.reduced_vowel_cost[vowel]);
          if (costs.length) return Math.min(...costs);
        }
        const [lh, lb, lr, lt] = this.vowels[left], [rh, rb, rr, rt] = this.vowels[right];
        const cost = .08 + .10 * Math.abs(lh - rh) + .12 * Math.abs(lb - rb) + .05 * Math.abs(lr - rr) + .03 * Math.abs(lt - rt);
        return Math.min(cost, p.max_vowel_sub_cost);
      }
      const [leftPlace, leftManner, leftVoice] = this.consonants[left];
      const [rightPlace, rightManner, rightVoice] = this.consonants[right];
      const placeDistance = Math.abs(this.placeIndex[leftPlace] - this.placeIndex[rightPlace]) / 7;
      const mannerDistance = leftManner === rightManner ? 0 : this.manner.get(pairKey(leftManner, rightManner)) ?? .85;
      const cost = .30 * placeDistance + .55 * mannerDistance + .15 * Math.abs(leftVoice - rightVoice);
      return Math.max(p.min_consonant_sub_cost, Math.min(1, cost));
    });
  }

  gapCost(phoneme, final = false) {
    return memo(this.caches.gap, `${phoneme}|${final}`, () => {
      const p = this.data.phonemes;
      let base = p.cheap_to_drop[phoneme];
      if (base === undefined) {
        if (this.isVowel(phoneme)) base = .40;
        else {
          const manner = (this.consonants[phoneme] || ['alveolar', 'stop', 0])[1];
          base = ['nasal', 'liquid', 'glide'].includes(manner) ? .55 : .72;
        }
      }
      return base * (final ? p.final_deletion_discount : 1);
    });
  }

  distance(left, right, reduced = true) {
    if (sameSequence(left, right)) return 0;
    const leftLength = left.length, rightLength = right.length;
    if (!leftLength) return right.reduce((sum, phoneme, j) => sum + this.gapCost(phoneme, j === rightLength - 1), 0);
    if (!rightLength) return left.reduce((sum, phoneme, i) => sum + this.gapCost(phoneme, i === leftLength - 1), 0);
    let previous = new Array(rightLength + 1).fill(0);
    for (let j = 1; j <= rightLength; j++) previous[j] = previous[j - 1] + this.gapCost(right[j - 1], j === rightLength);
    for (let i = 1; i <= leftLength; i++) {
      const leftPhoneme = left[i - 1], remove = this.gapCost(leftPhoneme, i === leftLength);
      const current = [previous[0] + remove];
      for (let j = 1; j <= rightLength; j++) {
        const rightPhoneme = right[j - 1];
        current.push(Math.min(
          previous[j - 1] + this.subCost(leftPhoneme, rightPhoneme, reduced),
          previous[j] + remove,
          current[j - 1] + this.gapCost(rightPhoneme, j === rightLength)));
      }
      previous = current;
    }
    return previous[rightLength];
  }

  similarity(left, right) {
    if (!left.length && !right.length) return 1;
    if (!left.length || !right.length) return 0;
    if (sameSequence(left, right)) return 1;
    const span = Math.max(left.length, right.length), short = span < 5;
    let score = 1 - this.distance(left, right, !short) / (short ? span - .5 : span);
    const onset = this.subCost(left[0], right[0]);
    if (onset === 0) score += .03;
    else if (onset > .55) score -= .08;
    return Math.max(0, Math.min(1, score));
  }

  // ---- keys.py -------------------------------------------------------------------------------
  skeleton(phones) {
    const out = phones.length && this.isVowel(phones[0]) ? ['V'] : [];
    for (const phone of phones) out.push(this.classes[phone] ?? '');
    return out.join('');
  }

  blockingKeys(phones) {
    return memo(this.caches.keys, phones.join(' '), () => {
      const shape = this.skeleton(phones);
      if (!shape) return ['full:'];
      const keys = [`full:${shape}`];
      if (shape.length >= 4) for (let index = 0; index < shape.length; index++) keys.push(`full:${shape.slice(0, index)}${shape.slice(index + 1)}`);
      if (shape.length >= 3) keys.push(`pre:${shape.slice(0, 3)}`, `end:${shape.slice(-3)}`);
      if (shape.length >= 2) {
        for (let index = 0; index < shape.length - 1; index++) keys.push(`bg:${shape.slice(index, index + 2)}`);
        keys.push(`rim:${shape[0]}${shape.at(-1)}`);
      } else keys.push(`bg:${shape}`);
      return [...new Set(keys)];
    });
  }

  // ---- index.py ------------------------------------------------------------------------------
  buildIndex(people) {
    this.people = people;
    this.forms = people.map(person => [[person.name, false], ...(person.aliases || []).map(alias => [alias, true])].flatMap(([text, isAlias]) => {
      const tokens = this.analyze(text).words;
      if (!tokens.length) return [];
      const roles = tokens.length === 1 ? ['last'] : ['first', ...Array(tokens.length - 2).fill('middle'), 'last'];
      return [{text, tokens, roles, isAlias}];
    }));
    this.exactIndex = new Map();
    this.tokenOwners = new Map();
    people.forEach((person, position) => {
      for (const form of this.forms[position]) {
        const key = form.tokens.join(' ');
        if (!this.exactIndex.has(key)) this.exactIndex.set(key, []);
        this.exactIndex.get(key).push(position);
      }
      for (const text of new Set([person.name, ...(person.aliases || [])])) {
        for (const token of this.indexTokens(text)) {
          if (!this.tokenOwners.has(token)) this.tokenOwners.set(token, new Set());
          this.tokenOwners.get(token).add(position);
        }
      }
    });
    this.keyTokens = new Map();
    for (const token of this.tokenOwners.keys()) {
      for (const variant of this.pronounce(token)) {
        for (const key of this.blockingKeys(variant)) {
          if (!this.keyTokens.has(key)) this.keyTokens.set(key, new Set());
          this.keyTokens.get(key).add(token);
        }
      }
    }
    const totalTokens = Math.max(1, this.tokenOwners.size);
    this.bucketCap = Math.max(64, Math.floor(totalTokens * .20));
    this.idf = new Map([...this.keyTokens].map(([key, tokens]) => [key, Math.log(totalTokens / tokens.size)]));
    this.vocabulary = new Set(this.tokenOwners.keys());
  }

  candidates(queryTokens, maxCandidates) {
    if (!queryTokens.length) return [];
    const tokenScores = new Map();
    for (const queryToken of queryTokens) {
      const seenKeys = new Set();
      for (const variant of this.pronounceRun(queryToken)) {
        for (const key of this.blockingKeys(variant)) {
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const bucket = this.keyTokens.get(key);
          if (!bucket || bucket.size > this.bucketCap) continue;
          const weight = this.idf.get(key) * (key.startsWith('full:') ? 2.5 : 1);
          for (const token of bucket) tokenScores.set(token, (tokenScores.get(token) || 0) + weight);
        }
      }
    }
    const personScores = new Map();
    for (const [token, score] of tokenScores) {
      for (const position of this.tokenOwners.get(token)) {
        if (score > (personScores.get(position) ?? 0)) personScores.set(position, score);
      }
    }
    return [...personScores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, maxCandidates).map(([position]) => position);
  }

  // ---- search.py -----------------------------------------------------------------------------
  areEquivalent(left, right) {
    return left === right || Boolean(this.nicknames.get(left)?.has(right));
  }

  tokenSimilarity(spoken, name) {
    return memo(this.caches.token, `${spoken}\u0000${name}`, () => {
      const text = spoken.replaceAll('|', '');
      if (text === name) return [1, 'exact'];
      if (!spoken.includes('|') && this.areEquivalent(spoken, name)) return [.96, 'nickname'];
      if (text.length === 1 || name.length === 1) return text[0] === name[0] ? [.60, 'initial'] : [0, 'none'];
      let phonetic = 0;
      const limit = this.c.MAX_SCORING_VARIANTS;
      for (const spokenPhones of this.pronounceRun(spoken).slice(0, limit)) {
        for (const namePhones of this.pronounce(name).slice(0, limit)) {
          const score = this.similarity(spokenPhones, namePhones);
          if (score > phonetic) phonetic = score;
        }
        if (phonetic >= .999) break;
      }
      const spelled = jaroWinkler(text, name) * .92;
      return phonetic >= spelled ? [phonetic, 'phonetic'] : [spelled, 'spelling'];
    });
  }

  evidence(word) {
    if (this.vocabulary.has(word)) return 1;
    return this.commonWords.has(word) ? this.c.COMMON_WORD_EVIDENCE : 1;
  }

  singleUnits(utterance) {
    const units = [];
    utterance.segments.forEach(([start, end], segment) => {
      for (let position = start; position < end; position++) {
        if (utterance.isFiller[position]) continue;
        const word = utterance.words[position];
        units.push({key: word, start: position, end: position + 1, segment, evidence: this.evidence(word)});
      }
    });
    return units;
  }

  joinedUnits(utterance) {
    const units = [];
    utterance.segments.forEach(([start, end], segment) => {
      for (let width = 2; width <= this.c.MAX_JOIN_SPAN; width++) {
        for (let first = start; first <= end - width; first++) {
          const run = utterance.words.slice(first, first + width);
          if (run.some(word => word.length > this.c.MAX_JOIN_WORD_LENGTH)) continue;
          const joined = run.join('');
          if (joined.length > 18) continue;
          units.push({key: run.join('|'), start: first, end: first + width, segment, evidence: this.evidence(joined)});
        }
      }
    });
    return units;
  }

  assign(units, form) {
    const scored = [];
    units.forEach((unit, i) => {
      form.tokens.forEach((nameToken, j) => {
        const [raw, basis] = this.tokenSimilarity(unit.key, nameToken);
        const score = raw * unit.evidence;
        if (score < this.c.MIN_PAIR_SIMILARITY) return;
        if (unit.end - unit.start > 1 && score < this.c.MIN_JOINED_SIMILARITY) return;
        scored.push([score, i, j, basis]);
      });
    });
    const width = unit => unit.end - unit.start;
    scored.sort((a, b) => b[0] - a[0] || width(units[b[1]]) - width(units[a[1]]) || a[1] - b[1] || a[2] - b[2]);
    const covered = new Set(), usedName = new Set(), pairs = [];
    let chosenSegment = null;
    for (const [score, i, j, basis] of scored) {
      const unit = units[i];
      if (chosenSegment !== null && unit.segment !== chosenSegment) continue;
      let overlap = usedName.has(j);
      for (let position = unit.start; position < unit.end && !overlap; position++) overlap = covered.has(position);
      if (overlap) continue;
      chosenSegment = unit.segment;
      for (let position = unit.start; position < unit.end; position++) covered.add(position);
      usedName.add(j);
      pairs.push({unit, nameToken: form.tokens[j], role: form.roles[j], similarity: score, basis});
    }
    return pairs;
  }

  scoreForm(utterance, units, form) {
    if (!units.length) return [0, {}];
    if (utterance.tokens.length === form.tokens.length && utterance.tokens.every((token, index) => token === form.tokens[index])) {
      return [form.isAlias ? this.c.ALIAS_PENALTY : 1, {form: form.text, is_alias: form.isAlias, quality: 1, complete: true,
        penalties: {}, pairs: [], reason: 'exact_name'}];
    }
    const pairs = this.assign(units, form);
    if (!pairs.length) return [0, {}];
    const weight = role => this.c.ROLE_WEIGHT[role];
    const weightTotal = pairs.reduce((sum, pair) => sum + weight(pair.role), 0);
    const quality = pairs.reduce((sum, pair) => sum + pair.similarity * weight(pair.role), 0) / weightTotal;
    const penalties = {};
    if (!pairs.some(pair => pair.role === 'last')) penalties.no_surname = this.c.NO_SURNAME_PENALTY;
    const covered = new Set();
    for (const pair of pairs) for (let position = pair.unit.start; position < pair.unit.end; position++) covered.add(position);
    let unmatched = 0;
    utterance.words.forEach((word, position) => { if (!utterance.isFiller[position] && !covered.has(position)) unmatched++; });
    if (unmatched > 0) penalties.unmatched_words = this.c.UNMATCHED_TOKEN_PENALTY ** unmatched;
    if (form.isAlias) penalties.alias = this.c.ALIAS_PENALTY;
    let score = quality;
    for (const factor of Object.values(penalties)) score *= factor;
    score = Math.max(0, Math.min(1, score));
    return [score, {
      form: form.text, is_alias: form.isAlias, quality: round(quality, 4),
      complete: pairs.length === form.tokens.length && unmatched === 0,
      penalties: Object.fromEntries(Object.entries(penalties).map(([key, value]) => [key, round(value, 3)])),
      pairs: pairs.map(pair => ({spoken: pair.unit.key.replaceAll('|', ''), name: pair.nameToken, role: pair.role,
        similarity: round(pair.similarity, 3), basis: pair.basis, words: pair.unit.end - pair.unit.start, evidence: round(pair.unit.evidence, 3)})),
    }];
  }

  scorePerson(utterance, units, position) {
    let best = [0, {}];
    for (const form of this.forms[position]) {
      const scored = this.scoreForm(utterance, units, form);
      if (scored[0] > best[0]) best = scored;
    }
    return best;
  }

  rank(utterance, units, maxCandidates) {
    const ranked = new Map();
    for (const position of this.candidates(units.map(unit => unit.key), maxCandidates)) {
      const scored = this.scorePerson(utterance, units, position);
      if (scored[0] >= this.c.SCORE_FLOOR) ranked.set(position, scored);
    }
    return ranked;
  }

  payload(position, score, detail, explain) {
    const {id, name, aliases, ...extra} = this.people[position];
    return {id, name, ...extra, confidence: round(score, 3), ...(explain ? {explain: detail} : {})};
  }

  search(spokenName, {topK = 5, explain = false, maxCandidates = this.maxCandidates} = {}) {
    const started = performance.now();
    const utterance = this.analyze(spokenName);
    const tokens = utterance.tokens;
    const base = {query: spokenName, normalized_query: tokens.join(' '), query_tokens: tokens, joined_words: false};
    const finish = payload => ({...payload, elapsed_ms: round(performance.now() - started, 2)});
    if (!tokens.length) return finish({...base, status: 'no_match', reason: 'no_name_heard', matches: [], candidates: []});

    const units = this.singleUnits(utterance);
    const exact = this.exactIndex.get(tokens.join(' ')) || [];
    let ranked;
    if (exact.length) {
      ranked = new Map(exact.map(position => [position, this.scorePerson(utterance, units, position)]));
    } else {
      ranked = this.rank(utterance, units, maxCandidates);
      const joined = this.joinedUnits(utterance);
      if (joined.length) {
        for (const [position, scored] of this.rank(utterance, [...units, ...joined], maxCandidates)) {
          if (scored[0] > (ranked.get(position)?.[0] ?? 0)) ranked.set(position, scored);
        }
      }
    }
    const scored = [...ranked].map(([position, [score, detail]]) => [score, position, detail]).sort((a, b) =>
      b[0] - a[0] || (a[2].complete ? 0 : 1) - (b[2].complete ? 0 : 1) || compareText(this.people[a[1]].name, this.people[b[1]].name));
    if (scored.length) base.joined_words = (scored[0][2].pairs || []).some(pair => pair.words > 1);
    const candidates = scored.slice(0, topK).map(([score, position, detail]) => this.payload(position, score, detail, explain));
    if (!scored.length || scored[0][0] < this.c.MATCH_FLOOR) {
      return finish({...base, status: 'no_match', reason: scored.length ? 'below_confidence_floor' : 'not_in_directory', matches: [], candidates});
    }
    const best = scored[0][0];
    let close = best >= .995 && scored[0][2].complete ? scored.slice(0, 1)
      : scored.slice(0, topK).filter(item => best - item[0] <= this.c.AMBIGUITY_MARGIN);
    const status = close.length === 1 ? 'one_match' : 'multiple_matches';
    close = close.filter(item => item[0] >= this.c.MATCH_FLOOR);
    return finish({...base, status, matches: close.map(([score, position, detail]) => this.payload(position, score, detail, explain)), candidates});
  }

  // Several transcriptions of one spoken name, fused by reciprocal rank (search.py search_many).
  searchMany(spokenNames, {topK = 3, explain = false, maxCandidates = this.maxCandidates} = {}) {
    const queries = [];
    for (const name of spokenNames || []) {
      const text = (name || '').trim();
      if (text && !queries.some(query => query.toLowerCase() === text.toLowerCase())) queries.push(text);
    }
    if (!queries.length) return {status: 'no_match', reason: 'no_name_heard', query: '', normalized_query: '', queries: [], matches: [], candidates: [], elapsed_ms: 0};
    if (queries.length === 1) return {...this.search(queries[0], {topK, explain, maxCandidates}), queries};
    const started = performance.now();
    const runs = queries.map(query => this.search(query, {topK: Math.max(topK, 5), explain, maxCandidates}));
    const fused = new Map(), best = new Map();
    for (const run of runs) {
      run.candidates.forEach((candidate, index) => {
        fused.set(candidate.id, (fused.get(candidate.id) || 0) + 1 / (this.c.RRF_K + index + 1));
        if (candidate.confidence > (best.get(candidate.id)?.confidence ?? -1)) best.set(candidate.id, candidate);
      });
    }
    const order = [...fused.keys()].sort((a, b) => fused.get(b) - fused.get(a) || best.get(b).confidence - best.get(a).confidence
      || compareText(best.get(a).name, best.get(b).name));
    const byConfidence = ids => [...ids].sort((a, b) => best.get(b).confidence - best.get(a).confidence || fused.get(b) - fused.get(a)
      || compareText(best.get(a).name, best.get(b).name));
    const candidates = byConfidence(order.slice(0, topK)).map(id => ({...best.get(id), fusion: round(fused.get(id), 5)}));
    const payload = {query: queries[0], queries, normalized_query: runs[0].normalized_query, candidates, elapsed_ms: round(performance.now() - started, 2)};
    const agreed = new Set(runs.filter(run => run.status === 'one_match').map(run => run.matches[0].id));
    const overFloor = order.filter(id => best.get(id).confidence >= this.c.MATCH_FLOOR);
    const leader = Math.max(0, ...overFloor.map(id => best.get(id).confidence));
    const contenders = order.filter(id => leader - best.get(id).confidence <= this.c.AMBIGUITY_MARGIN);
    const plausible = byConfidence(contenders.filter(id => best.get(id).confidence >= this.c.MATCH_FLOOR));
    if (agreed.size === 1 && contenders.length <= 1 && plausible.length) return {...payload, status: 'one_match', matches: [best.get([...agreed][0])]};
    if (!plausible.length) return {...payload, status: 'no_match', reason: candidates.length ? 'below_confidence_floor' : 'not_in_directory', matches: []};
    if (contenders.length === 1) return {...payload, status: 'one_match', matches: [best.get(plausible[0])]};
    return {...payload, status: 'multiple_matches', matches: plausible.slice(0, topK).map(id => best.get(id))};
  }
}

function collapse(phones) {
  const out = [];
  for (const phone of phones) if (!out.length || out.at(-1) !== phone) out.push(phone);
  return out;
}
function sameSequence(left, right) {
  return left.length === right.length && left.every((phone, index) => phone === right[index]);
}
// Python round(): the nearest decimal to the exact binary value, and an exact half goes to the even
// digit (round(0.8125, 3) == 0.812), where toFixed would round it up.
function round(value, digits) {
  const exact = value.toFixed(Math.min(100, digits + 80));
  const dot = exact.indexOf('.'), kept = exact.slice(0, dot + 1 + digits);
  if (/^50*$/.test(exact.slice(dot + 1 + digits)) && Number(kept.at(-1)) % 2 === 0) return Number(kept);
  return Number(value.toFixed(digits));
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
