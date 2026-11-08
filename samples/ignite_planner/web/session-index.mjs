// Browser port of tools/session_catalog.py SessionIndex and the three read-only knowledge tools
// the Python prototype exposed over MCP. Same snapshot, same weighted BM25 ranking and same
// agenda review; tests/test_session_index.mjs checks parity with the Python index on
// data/catalog.json. Only this version adds: official descriptions in the index (when the
// catalog has them), interest ranking, and the five-result minimum for the Agent's lookups.

const PLURALS = {agents: 'agent', models: 'model', sessions: 'session',
  developers: 'developer', tools: 'tool', applications: 'application'};
const FIELDS = ['id', 'code', 'title', 'start', 'end', 'local_start', 'local_end', 'location'];
const LIMIT = 100;
// The Agent always gets at least this many sessions to talk about, looser matches labeled as such.
export const MINIMUM = 5;
const EXCERPT = 320;
const excerpt = text => !text ? null : text.length > EXCERPT ? `${text.slice(0, EXCERPT).replace(/\s+\S*$/, '')}…` : text;
const STOP = new Set(['a', 'an', 'and', 'the', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 'from', 'your', 'you', 'how', 'what']);

export const KNOWLEDGE_TOOLS = new Set(['ignite_search_sessions', 'ignite_get_session', 'ignite_validate_agenda', 'ignite_rank_sessions']);

// Python str.casefold() for the characters this ASCII-only tokenizer can observe.
const fold = text => text.toLowerCase().replaceAll('ß', 'ss');
export const tokens = text => (fold(text).match(/[a-z0-9]+/g) || []).map(word => PLURALS[word] || word);
const round6 = value => Number(value.toFixed(6));
const iso = ms => new Date(ms).toISOString().replace(/\.000Z$/, '+00:00');
const venue = row => (row.location || '').split(/[|,]/, 1)[0].trim();
const pick = row => Object.fromEntries(FIELDS.map(field => [field, row[field]]));

// The Agent's related terms: broader or adjacent words, used only to fill a short result list.
function relatedTerms(values) {
  if (!Array.isArray(values) || values.length > 12 || values.some(value => typeof value !== 'string' || value.length > 40))
    throw invalid('related_terms must be at most 12 short English words or phrases');
  return [...new Set(tokens(values.join(' ')))].filter(term => term.length > 1 && !STOP.has(term));
}

function invalid(message) {
  const error = new Error(message);
  error.invalidArguments = true;
  return error;
}

function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export class SessionIndex {
  constructor(catalog) {
    this.catalog = catalog;
    this.rows = catalog.sessions;
    this.byId = new Map(this.rows.map(row => [row.id, row]));
    if (!this.rows.length || this.byId.size !== this.rows.length)
      throw new Error('Catalog must contain unique session instance IDs');
    this.documents = [];
    this.frequencies = new Map();
    let total = 0;
    for (const row of this.rows) {
      const document = new Map();
      for (const [value, weight] of [[row.code, 10], [row.title, 5], [row.tags.join(' '), 3],
        [row.speaker_names_text || '', 3], [row.summary, 1], [row.description || '', 1]]) {
        for (const term of tokens(value)) document.set(term, (document.get(term) || 0) + weight);
      }
      this.documents.push(document);
      for (const term of document.keys()) this.frequencies.set(term, (this.frequencies.get(term) || 0) + 1);
      for (const count of document.values()) total += count;
    }
    this.averageLength = total / this.rows.length;
  }

  header() {
    return {catalog_version: this.catalog.version, snapshot_at: this.catalog.snapshot_at};
  }

  search({keywords = [], date = null, start_after: startAfter = null, end_before: endBefore = null,
    speaker = null, delivery = null, scheduled_only: scheduledOnly = true, limit = 5, offset = 0} = {}) {
    keywords = keywords ?? [];
    if (!Array.isArray(keywords) || keywords.length > 12 ||
        keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 80))
      throw invalid('Supply at most 12 nonempty English keywords or phrases, each at most 80 characters');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw invalid('limit must be 1–50 and offset must be 0–10000');
    if (typeof scheduledOnly !== 'boolean') throw invalid('scheduled_only must be boolean');
    if (date !== null && (typeof date !== 'string' || !validDate(date)))
      throw invalid('date must be YYYY-MM-DD in Pacific time');
    for (const value of [startAfter, endBefore]) {
      if (value !== null && (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))
        throw invalid('Time filters must be HH:MM in Pacific time');
    }
    if (startAfter && endBefore && startAfter >= endBefore) throw invalid('start_after must be earlier than end_before');
    if (speaker !== null && (typeof speaker !== 'string' || !speaker.trim() || speaker.length > 120))
      throw invalid('speaker must contain 1–120 characters');
    if (![null, 'In-person', 'Online'].includes(delivery)) throw invalid('delivery must be In-person or Online');
    const terms = new Set(tokens(keywords.join(' ')));
    if (keywords.length && !terms.size) throw invalid('Use searchable English words or session codes');
    const codes = new Set(keywords.map(fold));
    const candidates = [];
    this.rows.forEach((row, index) => {
      const document = this.documents[index];
      if ((scheduledOnly || date || startAfter || endBefore) && !row.start) return;
      if (date && row.local_start.slice(0, 10) !== date) return;
      if (startAfter && row.local_start.slice(11, 16) < startAfter) return;
      if (endBefore && row.local_end.slice(11, 16) > endBefore) return;
      if (speaker && !fold(row.speaker_names_text || '').includes(fold(speaker))) return;
      if (delivery && !row.delivery_types.includes(delivery)) return;
      const matched = [...terms].filter(term => document.has(term)).sort();
      if (terms.size && !matched.length) return;
      let score = 0, length = 0;
      for (const count of document.values()) length += count;
      for (const term of matched) {
        const frequency = document.get(term), seen = this.frequencies.get(term);
        const idf = Math.log(1 + (this.rows.length - seen + .5) / (seen + .5));
        score += idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * length / this.averageLength));
      }
      if (codes.has(fold(row.code))) score += 30;
      candidates.push({...row, lexical_score: round6(score),
        relevance_score: terms.size ? round6(score / (1 + score)) : null, matched_terms: matched});
    });
    candidates.sort((a, b) => b.lexical_score - a.lexical_score
      || Number(a.start === null) - Number(b.start === null)
      || ((a.start || '') < (b.start || '') ? -1 : (a.start || '') > (b.start || '') ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const selected = candidates.slice(offset, offset + limit);
    const more = offset + selected.length < candidates.length;
    return {
      ...this.header(), timezone: this.catalog.timezone, total: candidates.length,
      offset, has_more: more, next_offset: more ? offset + selected.length : null,
      ranking: terms.size ? 'weighted_bm25' : 'chronological',
      score_notice: 'Lexical ranking score, not correctness, confidence or a probability. ' +
                    'Scores from different keyword queries are not directly comparable.',
      notice: this.catalog.notice, sessions: selected,
    };
  }

  validateAgenda(instanceIds) {
    if (!Array.isArray(instanceIds) || instanceIds.length > 2000 ||
        instanceIds.some(value => typeof value !== 'string' || !value || value.length > 150))
      throw invalid('Supply at most 2000 exact instance IDs.');
    const ids = [...new Set(instanceIds)];
    const unknown = ids.filter(value => !this.byId.has(value));
    const untimed = [], scheduled = [];
    for (const value of ids) {
      const row = this.byId.get(value);
      if (!row) continue;
      if (!row.start || !row.end) { untimed.push(value); continue; }
      const start = Date.parse(row.start), end = Date.parse(row.end);
      if (end <= start) { untimed.push(value); continue; }
      scheduled.push({start, end, row: pick(row)});
    }
    scheduled.sort((a, b) => a.start - b.start || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
    const conflicts = [], transfers = [];
    let conflictCount = 0, transferCount = 0;
    scheduled.forEach(({start, end, row}, index) => {
      for (const other of scheduled.slice(index + 1)) {
        if (other.start >= end) break;
        conflictCount++;
        if (conflicts.length < LIMIT) {
          const overlapStart = Math.max(start, other.start), overlapEnd = Math.min(end, other.end);
          conflicts.push({sessions: [row, other.row], overlap_start: iso(overlapStart), overlap_end: iso(overlapEnd),
            overlap_minutes: (overlapEnd - overlapStart) / 60000});
        }
      }
    });
    for (let index = 1; index < scheduled.length; index++) {
      const previous = scheduled[index - 1], current = scheduled[index];
      if (previous.row.local_start.slice(0, 10) !== current.row.local_start.slice(0, 10) || current.start < previous.end) continue;
      const origin = venue(previous.row), destination = venue(current.row);
      if (origin && destination && origin !== destination) {
        transferCount++;
        if (transfers.length < LIMIT) transfers.push({
          from: previous.row, to: current.row, from_venue: origin, to_venue: destination,
          gap_minutes: (current.start - previous.end) / 60000,
          note: 'Time between meetings, not a verified walking time or guaranteed connection.',
        });
      }
    }
    return {
      ...this.header(), timezone: this.catalog.timezone, agenda_count: ids.length, checked_count: scheduled.length,
      unknown_instance_ids: unknown, unscheduled_instance_ids: untimed,
      checked_all: !unknown.length && !untimed.length, has_time_conflicts: conflictCount > 0,
      conflict_count: conflictCount, conflicts, transfer_count: transferCount, transfers, findings_limit: LIMIT,
      conflicts_truncated: conflictCount > LIMIT, transfers_truncated: transferCount > LIMIT,
      mutates_calendar: false,
      notice: 'Read-only review of the submitted Ignite draft. This tool does not save, block, remove or move meetings; calendar state belongs to the browser.',
    };
  }

  // Interest ranking (JS version only): weighted BM25 per interest phrase plus a bonus when the
  // whole phrase is in the title or topics. A session matches an interest strongly when the phrase
  // appears or at least two thirds of its words do, so a lone common word such as "agent" does not
  // qualify it. When fewer than five sessions match strongly, the list is filled to five with
  // looser matches, labeled: "partial" shares at least one interest word; "related" only matches
  // one of the Agent's related_terms (for "movie": video, media, streaming). Repeats of the same
  // title (other times or codes) collapse into one row.
  rank({interests, related_terms: related = [], date = null, start_after: startAfter = null, end_before: endBefore = null,
    delivery = null, limit = 10} = {}) {
    if (!Array.isArray(interests) || !interests.length || interests.length > 8 ||
        interests.some(value => typeof value !== 'string' || !value.trim() || value.length > 80))
      throw invalid('Supply 1 to 8 interest phrases, each at most 80 characters');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw invalid('limit must be 1–20');
    if (date !== null && (typeof date !== 'string' || !validDate(date))) throw invalid('date must be YYYY-MM-DD in Pacific time');
    for (const value of [startAfter, endBefore]) {
      if (value !== null && (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))
        throw invalid('Time filters must be HH:MM in Pacific time');
    }
    if (![null, 'In-person', 'Online'].includes(delivery)) throw invalid('delivery must be In-person or Online');
    const wanted = interests.map((text, index) => ({
      text: text.trim(), phrase: fold(text.trim()), terms: [...new Set(tokens(text))], weight: 1 / (1 + .15 * index),
    }));
    if (wanted.some(interest => !interest.terms.length)) throw invalid('Use searchable English words for every interest');
    const extra = relatedTerms(related).filter(term => !wanted.some(interest => interest.terms.includes(term)));
    const best = new Map();
    this.rows.forEach((row, index) => {
      if (!row.start) return;
      if (date && row.local_start.slice(0, 10) !== date) return;
      if (startAfter && row.local_start.slice(11, 16) < startAfter) return;
      if (endBefore && row.local_end.slice(11, 16) > endBefore) return;
      if (delivery && !row.delivery_types.includes(delivery)) return;
      const document = this.documents[index];
      let length = 0;
      for (const count of document.values()) length += count;
      const bm25 = term => {
        const frequency = document.get(term), seen = this.frequencies.get(term);
        const idf = Math.log(1 + (this.rows.length - seen + .5) / (seen + .5));
        return idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * length / this.averageLength));
      };
      const visible = fold(`${row.title} ${row.tags.join(' ')}`);
      const matched = [], words = new Set();
      let strong = 0, loose = 0;
      for (const interest of wanted) {
        const hits = interest.terms.filter(term => document.has(term));
        const phrase = visible.includes(interest.phrase);
        const score = hits.reduce((sum, term) => sum + bm25(term), 0);
        hits.forEach(term => words.add(term));
        if (phrase || hits.length >= Math.ceil(interest.terms.length * 2 / 3)) {
          strong += interest.weight * (score * (.5 + .5 * hits.length / interest.terms.length) + (phrase ? 6 : 0));
          matched.push(interest.text);
        } else loose += interest.weight * score * (hits.length / interest.terms.length) ** 2;
      }
      const via = extra.filter(term => document.has(term));
      const match = strong ? 'strong' : loose ? 'partial' : via.length ? 'related' : null;
      if (!match) return;
      via.forEach(term => words.add(term));
      // Looser matches add up both kinds of evidence. One word of a two-word interest ("computer" of
      // "computer vision") counts a quarter, so it does not outrank sessions on several related terms.
      const entry = {row, match, matched, terms: [...words].sort(),
        score: strong || loose + .7 * via.reduce((sum, term) => sum + bm25(term), 0)};
      const key = tokens(row.title).join(' ');
      const previous = best.get(key);
      const rank = entry => [Number(entry.match === 'strong'), entry.score];
      const [tier, score] = rank(entry), [previousTier, previousScore] = previous ? rank(previous) : [-1, 0];
      const better = !previous || tier > previousTier || (tier === previousTier
        && (score > previousScore || (score === previousScore && row.start < previous.row.start)));
      best.set(key, {...(better ? entry : previous), occurrences: (previous?.occurrences || 0) + 1});
    });
    const ranked = [...best.values()].sort((a, b) => Number(b.match === 'strong') - Number(a.match === 'strong') || b.score - a.score
      || (a.row.start < b.row.start ? -1 : a.row.start > b.row.start ? 1 : 0) || (a.row.id < b.row.id ? -1 : 1));
    const strong = ranked.filter(entry => entry.match === 'strong').length;
    const shown = ranked.slice(0, Math.min(limit, Math.max(strong, MINIMUM)));
    const added = shown.filter(entry => entry.match !== 'strong').length;
    const top = ranked[0]?.score || 1;
    return {
      ...this.header(), timezone: this.catalog.timezone, interests: wanted.map(interest => interest.text), related_terms: extra,
      total_matches: strong, returned: shown.length, looser_matches_added: added, ranking: 'interest_weighted_bm25',
      score_notice: 'match_score is relative to the best match in this ranking (1.0), not a probability.',
      ...(added ? {fill_notice: `Only ${strong} session${strong === 1 ? ' matches' : 's match'} these interests directly; ` +
        `${added} looser match${added === 1 ? ' was' : 'es were'} added so the attendee sees at least ${MINIMUM}. ` +
        'Their match is "partial" (shares an interest word) or "related" (matches a related term). Say briefly that they are looser matches.'} : {}),
      sessions: shown.map(({row, match, matched, terms, score, occurrences}, index) => ({
        rank: index + 1, id: row.id, code: row.code, title: row.title, session_type: row.session_type,
        local_start: row.local_start, local_end: row.local_end, location: row.location,
        speaker_names_text: row.speaker_names_text, tags: row.tags, description: excerpt(row.description),
        match, matched_interests: matched, matched_terms: terms, match_score: Number(Math.min(1, score / top).toFixed(3)),
        other_occurrences: occurrences - 1,
      })),
      next_step: !shown.length ? 'Nothing matched. Rank again with broader interests and related_terms.'
        : 'Call show_ranked_sessions with these instance ids in this order and the same interests, then introduce only the top three.' +
          (added ? ` Before the first one, say in one short clause that Ignite has ${strong ? 'only a few sessions' : 'no sessions'} directly on ` +
            `${wanted.map(interest => interest.text).join(' or ')}, so these are the closest matches.` : ''),
    };
  }

  // The Agent's keyword search: when the first page has fewer than five different sessions, more
  // keyword matches are added, then sessions matching the Agent's related_terms (same filters),
  // each labeled with how it matched. search() itself stays identical to the Python index.
  searchAtLeast(query, related) {
    const result = this.search(query);
    result.sessions = result.sessions.map(row => ({...row, description: row.description ?? null, match: 'keyword'}));
    if (query.offset || !query.keywords.length) return result;
    const codes = new Set(result.sessions.map(row => row.code));
    const before = result.sessions.length;
    const add = (rows, match) => {
      for (const row of rows) {
        if (codes.size >= MINIMUM) return;
        if (codes.has(row.code)) continue;
        codes.add(row.code);
        result.sessions.push({...row, description: row.description ?? null, match});
      }
    };
    if (codes.size < MINIMUM && result.has_more) add(this.search({...query, limit: 50}).sessions, 'keyword');
    if (codes.size < MINIMUM && related.length) add(this.search({...query, keywords: related, limit: 50}).sessions, 'related');
    result.added_to_reach_minimum = result.sessions.length - before;
    if (codes.size < MINIMUM) result.next_step = related.length
      ? `Only ${codes.size} different sessions match, even with the related terms. Say so and suggest a broader topic.`
      : `Fewer than ${MINIMUM} different sessions match. Search again with related_terms (broader or adjacent English words).`;
    else if (result.sessions.some(row => row.match === 'related'))
      result.fill_notice = 'Sessions with match "related" only match a related term; say briefly that they are looser matches.';
    return result;
  }

  // Which of the attendee's interest phrases a session's indexed text matches (for card chips).
  matchedInterests(instanceId, interests) {
    const index = this.rows.findIndex(row => row.id === instanceId);
    if (index < 0) return [];
    const document = this.documents[index];
    const visible = fold(`${this.rows[index].title} ${this.rows[index].tags.join(' ')}`);
    return interests.filter(text => {
      const terms = [...new Set(tokens(text))];
      return visible.includes(fold(text.trim())) || terms.filter(term => document.has(term)).length >= Math.ceil(terms.length * 2 / 3);
    });
  }

  getSession(instanceId) {
    if (!this.byId.has(instanceId)) throw invalid('Unknown instance ID; search first and copy the returned id exactly');
    return {...this.header(), session: this.byId.get(instanceId)};
  }

  // The tool layer adds the MCP schema limits (search limit 1–10) before calling the index,
  // and reports rejected calls as {isError, error} exactly like the Python local bridge.
  execute(name, args) {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid('Arguments must be an object.');
      if (name === 'ignite_search_sessions') {
        if (!Array.isArray(args.keywords)) throw invalid('keywords must be an array of strings.');
        const {related_terms: related = [], ...query} = args;
        const limit = query.limit ?? 5;
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw invalid('limit must be 1–10.');
        return this.searchAtLeast({...query, limit}, relatedTerms(related));
      }
      if (name === 'ignite_get_session') {
        if (typeof args.instance_id !== 'string' || !args.instance_id || args.instance_id.length > 150)
          throw invalid('instance_id must contain 1–150 characters.');
        return this.getSession(args.instance_id);
      }
      if (name === 'ignite_validate_agenda') return this.validateAgenda(args.instance_ids);
      if (name === 'ignite_rank_sessions') return this.rank({...args, limit: args.limit ?? 10});
      throw invalid(`Unsupported knowledge tool: ${name}`);
    } catch (error) {
      if (!error.invalidArguments) throw error;
      return {isError: true, error: `Error executing tool ${name}: ${error.message}`};
    }
  }
}
