// The Python prototype's PageController plus the page functions added for this planner: an interest-ranked
// shortlist, the detail sheet, finding a speaker by how their name sounded, filling free time and
// comparing sessions. Facts shared by the page and the Agent (speaker roles, how a session fits the
// agenda) are computed here once.
export function layoutCalendarSessions(sessions, timezone) {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const days = new Map(), layout = new Map();
  for (const session of sessions) {
    const key = day.format(new Date(session.start));
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(session);
  }
  const place = cluster => {
    const ends = [];
    for (const session of cluster) {
      let column = ends.findIndex(end => end <= Date.parse(session.start));
      if (column < 0) column = ends.length;
      ends[column] = Date.parse(session.end);
      layout.set(session.id, {column, columns: 0});
    }
    for (const session of cluster) layout.get(session.id).columns = ends.length;
  };
  for (const items of days.values()) {
    items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    let cluster = [], end = 0;
    for (const session of items) {
      if (cluster.length && Date.parse(session.start) >= end) { place(cluster); cluster = []; end = 0; }
      cluster.push(session);
      end = Math.max(end, Date.parse(session.end));
    }
    if (cluster.length) place(cluster);
  }
  return layout;
}

const EVENT_DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
const DAY_START = 9 * 60, DAY_END = 18 * 60, MIN_FREE_MINUTES = 30;
const venueOf = session => (session?.location || '').split(/[|,]/)[0].trim();
const clockOf = local => local.slice(11, 16);
const toMinutes = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const toClock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
// Argument names per page function: [required, optional].
const SPECS = {
  highlight_session: [['instance_id'], []], add_to_agenda: [['instance_ids'], []], remove_from_agenda: [['instance_id'], []],
  overview_agenda: [[], []], show_ranked_sessions: [['instance_ids', 'interests'], []], open_session_details: [['instance_id'], []],
  find_speaker: [['name'], ['alternatives']], fill_free_time: [['date'], ['interests']], compare_sessions: [['instance_ids'], []],
  show_how_it_works: [[], ['step']],
};
// The explanation board's steps, in the order the Agent walks through them.
export const EXPLAINER_STEPS = ['connect', 'register', 'call', 'execute', 'together'];
// During the walkthrough the board follows the Agent's voice: a sentence that starts with "First",
// "Second" … "Fifth" (or "Finally") lights its step. Other sentences, such as an introduction, do not
// move it, and it never goes back.
const MARKERS = {first: 0, second: 1, third: 2, fourth: 3, fifth: 4, finally: 4, lastly: 4};
export function narratedStep(text) {
  const marked = [...text.matchAll(/(?:^|[.!?:]\s+|\n\s*)(first|second|third|fourth|fifth|finally|lastly)\b/gi)]
    .map(match => MARKERS[match[1].toLowerCase()]);
  return EXPLAINER_STEPS[Math.max(0, ...marked)];
}

export class PageController {
  // knowledge: SessionIndex; details: {sessions, people} from /session-details.json; names: NameSearch.
  constructor(catalog, {knowledge = null, details = null, names = null} = {}) {
    this.catalog = catalog;
    this.sessions = new Map(catalog.sessions.map(session => [session.id, session]));
    if (this.sessions.size !== catalog.sessions.length) throw new Error('Catalog contains duplicate instance IDs.');
    this.state = {view: 'sessions', highlighted: null, detail: null, agenda: [], ranking: null, speakerChoice: null, gaps: null, compare: null,
      explainer: null};
    this.day = new Intl.DateTimeFormat('en-US', {timeZone: catalog.timezone, weekday: 'short', month: 'short', day: 'numeric'});
    this.attach({knowledge, details, names});
  }

  attach({knowledge = this.knowledge, details = this.details, names = this.names} = {}) {
    this.knowledge = knowledge;
    this.details = details;
    this.names = names;
    this.people = new Map((details?.people || []).map(person => [person.id, person]));
  }

  summary(session) {
    const {id, code, title, location} = session;
    return {id, code, title, day: session.start ? this.day.format(new Date(session.start)) : null,
      time: session.local_start ? `${clockOf(session.local_start)}–${clockOf(session.local_end)}` : null, location};
  }

  // How a session fits the saved agenda: overlaps and venue changes next to it (read-only review).
  agendaFit(session) {
    const agenda = this.state.agenda, saved = agenda.includes(session.id);
    if (!session.start || !this.knowledge) return {saved, overlaps: [], transfers: []};
    const review = this.knowledge.validateAgenda([...new Set([...agenda, session.id])]);
    return {
      saved,
      overlaps: review.conflicts.filter(conflict => conflict.sessions.some(row => row.id === session.id)).map(conflict => ({
        ...conflict.sessions.find(row => row.id !== session.id), overlap_minutes: conflict.overlap_minutes})),
      transfers: review.transfers.filter(transfer => transfer.to.id === session.id || transfer.from.id === session.id).map(transfer => ({
        direction: transfer.to.id === session.id ? 'after' : 'before', other: transfer.to.id === session.id ? transfer.from : transfer.to,
        gap_minutes: transfer.gap_minutes, from_venue: transfer.from_venue, to_venue: transfer.to_venue})),
    };
  }

  // What the detail sheet and the comparison show, in the form the Agent talks about.
  sessionFacts(id) {
    const session = this.sessions.get(id), extra = this.details?.sessions?.[id], fit = this.agendaFit(session);
    return {
      speakers: extra ? extra.speakers.map(({name, job_title: jobTitle, company}) => ({name, job_title: jobTitle, company}))
        : session.speakers.map(name => ({name})),
      description: session.description ?? null,
      levels: session.levels, delivery_types: session.delivery_types, viewing_options: session.viewing_options,
      seating_experience: extra?.seating_experience ?? null,
      agenda_fit: {saved: fit.saved, overlaps: fit.overlaps.map(row => ({code: row.code, title: row.title, overlap_minutes: row.overlap_minutes})),
        transfers: fit.transfers.map(row => ({direction: row.direction, code: row.other.code, gap_minutes: row.gap_minutes,
          from_venue: row.from_venue, to_venue: row.to_venue}))},
    };
  }

  agenda() {
    const localDate = new Intl.DateTimeFormat('en-CA', {timeZone: this.catalog.timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
    const sessions = this.state.agenda.map(id => this.sessions.get(id))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const transfers = [];
    for (let index = 1; index < sessions.length; index++) {
      const previous = sessions[index - 1], current = sessions[index];
      if (localDate.format(new Date(previous.start)) !== localDate.format(new Date(current.start))) continue;
      const fromVenue = previous.location?.split(/[|,]/)[0].trim();
      const toVenue = current.location?.split(/[|,]/)[0].trim();
      const gap = (Date.parse(current.start) - Date.parse(previous.end)) / 60000;
      if (fromVenue && toVenue && fromVenue !== toVenue && gap >= 0) transfers.push({
        from: previous.id, to: current.id, from_venue: fromVenue, to_venue: toVenue,
        gap_minutes: gap,
        note: 'Venue change. Walking time and route are not verified; allow time to transfer.',
      });
    }
    return {sessions, instance_ids: sessions.map(session => session.id), transfers, timezone: this.catalog.timezone, notice: this.catalog.notice};
  }

  context() {
    return {
      view: this.state.view, highlighted: this.state.highlighted, detail: this.state.detail,
      ranking: this.state.ranking && {...this.state.ranking, instance_ids: [...this.state.ranking.instance_ids]},
      agenda: [...this.state.agenda], ...this.agenda(),
    };
  }

  execute(name, args) {
    const fail = (code, message, extra = {}) => ({ok: false, error: {code, message}, ...extra});
    if (!Object.hasOwn(SPECS, name)) return fail('unknown_tool', `Unsupported page action: ${name}`);
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return fail('invalid_arguments', 'Arguments must be an object.');
    // A single manual add may still pass the legacy instance_id.
    const [required, optional] = name === 'add_to_agenda' && !Object.hasOwn(args, 'instance_ids') ? [['instance_id'], []] : SPECS[name];
    if (required.some(key => !Object.hasOwn(args, key)) || Object.keys(args).some(key => !required.includes(key) && !optional.includes(key)))
      return fail('invalid_arguments', `Expected: ${[...required, ...optional.map(key => `${key} (optional)`)].join(', ') || 'no arguments'}.`);
    if (name === 'show_ranked_sessions') return this.showRanked(args);
    if (name === 'find_speaker') return this.findSpeaker(args);
    if (name === 'fill_free_time') return this.fillFreeTime(args);
    if (name === 'compare_sessions') return this.compareSessions(args);
    if (name === 'show_how_it_works') return this.showHowItWorks(args);
    if (name === 'overview_agenda') {
      this.state.view = 'agenda';
      return {ok: true, agenda: this.agenda()};
    }
    if (name === 'add_to_agenda') {
      const ids = Object.hasOwn(args, 'instance_ids') ? args.instance_ids : [args.instance_id];
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
          ids.some(id => typeof id !== 'string' || !id || id.length > 150))
        return fail('invalid_arguments', 'Provide 1 to 100 exact instance_ids.');
      const added = [], alreadyPresent = [], rejected = [];
      for (const id of new Set(ids)) {
        const session = this.sessions.get(id);
        if (!session) { rejected.push({instance_id: id, reason: 'Unknown meeting instance.'}); continue; }
        if (!session.start || !session.end || !Number.isFinite(Date.parse(session.start)) ||
            !Number.isFinite(Date.parse(session.end)) || Date.parse(session.start) >= Date.parse(session.end)) {
          rejected.push({instance_id: id, reason: 'No valid published time; cannot place this item on the calendar.'});
          continue;
        }
        if (this.state.agenda.includes(id)) alreadyPresent.push(session);
        else { this.state.agenda.push(id); added.push(session); }
      }
      if (!added.length && !alreadyPresent.length)
        return fail('no_addable_sessions', 'None of the requested meetings can be placed on the calendar.', {rejected, agenda: this.agenda()});
      return {
        ok: true, added, added_count: added.length, already_present: alreadyPresent, rejected,
        partial_success: rejected.length > 0, agenda: this.agenda(), validation_pending: true,
        next_step: 'The valid requested meetings are already added, including overlaps. Acknowledge the additions, then run ignite_validate_agenda with agenda.instance_ids. Do not remove or move anything without the attendee asking.',
      };
    }
    if (typeof args.instance_id !== 'string' || !args.instance_id || args.instance_id.length > 150)
      return fail('invalid_arguments', 'Provide the exact instance_id returned by MCP or the current agenda.');
    const session = this.sessions.get(args.instance_id);
    if (!session) return fail('unknown_session', 'That instance is not in this catalog version. Search again.');
    if (name === 'open_session_details') {
      this.state.highlighted = this.state.detail = session.id;
      this.state.view = 'sessions';
      const leftRanking = Boolean(this.state.ranking && !this.state.ranking.instance_ids.includes(session.id));
      if (leftRanking) this.state.ranking = this.state.gaps = null;
      const {id, code, title, start, location} = session;
      return {ok: true, opened: {id, code, title, start, location}, ...(leftRanking ? {ranking_cleared: true} : {})};
    }
    if (name === 'highlight_session') {
      this.state.highlighted = session.id;
      if (this.state.detail !== session.id) this.state.detail = null;
      this.state.view = 'sessions';
      // A session outside the shortlist can only be shown by returning to the full catalog.
      const leftRanking = Boolean(this.state.ranking && !this.state.ranking.instance_ids.includes(session.id));
      if (leftRanking) this.state.ranking = this.state.gaps = null;
      return {ok: true, highlighted: session, ...(leftRanking ? {ranking_cleared: true} : {})};
    }
    if (name === 'remove_from_agenda') {
      const wasPresent = this.state.agenda.includes(session.id);
      this.state.agenda = this.state.agenda.filter(id => id !== session.id);
      return {ok: true, removed: session, was_present: wasPresent, agenda: this.agenda()};
    }
  }

  // Replaces the feed with up to 20 exact instances in the given rank order; [] restores the catalog.
  showRanked({instance_ids: ids, interests}) {
    const fail = message => ({ok: false, error: {code: 'invalid_arguments', message}});
    if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !id || id.length > 150))
      return fail('Provide 0 to 20 exact instance_ids in rank order.');
    if (!Array.isArray(interests) || interests.length > 8 ||
        interests.some(value => typeof value !== 'string' || !value.trim() || value.length > 80))
      return fail('Provide up to 8 nonempty interest phrases.');
    if (new Set(ids).size !== ids.length) return fail('Each instance_id may appear only once.');
    const unknown = ids.filter(id => !this.sessions.has(id));
    if (unknown.length) return {...fail('Some IDs are not in this catalog version. Rank again.'), unknown_instance_ids: unknown};
    this.state.view = 'sessions';
    this.state.detail = null;
    this.state.speakerChoice = null;
    this.state.gaps = null;
    if (!ids.length) {
      this.state.ranking = null;
      return {ok: true, mode: 'catalog', shown_count: this.sessions.size};
    }
    this.state.ranking = {instance_ids: [...ids], interests: interests.map(value => value.trim())};
    if (!ids.includes(this.state.highlighted)) this.state.highlighted = null;
    return {
      ok: true, mode: 'ranked', shown_count: ids.length,
      shown: ids.map((id, index) => {
        const {code, title, start, location} = this.sessions.get(id);
        return {rank: index + 1, id, code, title, start, location};
      }),
      next_step: 'The page now lists only these sessions in this order. Introduce the top three briefly; the attendee can click the rest.',
    };
  }

  // Find a speaker by how the name sounded (NameSearch, ported from the UMW phonetic matcher). Only a
  // one_match changes the feed; ambiguous or uncertain results are put to the attendee to choose.
  findSpeaker({name, alternatives = []}) {
    const fail = (code, message) => ({ok: false, error: {code, message}});
    if (!this.names) return fail('speakers_unavailable', 'The speaker directory has not loaded yet.');
    const text = value => typeof value === 'string' && value.trim() && value.length <= 120;
    if (!text(name)) return fail('invalid_arguments', 'Provide the name as heard, 1 to 120 characters.');
    if (!Array.isArray(alternatives) || alternatives.length > 4 || !alternatives.every(text))
      return fail('invalid_arguments', 'Provide up to 4 alternative spellings.');
    const result = alternatives.length ? this.names.searchMany([name, ...alternatives], {topK: 3}) : this.names.search(name, {topK: 3});
    // Show the name exactly as the Agent heard it; the matcher's normalized form drops filler words.
    const heard = name.trim();
    const describe = row => {
      const person = this.people.get(row.id);
      return {id: person.id, name: person.name, job_title: person.job_title, company: person.company,
        confidence: row.confidence, session_count: person.sessions.length};
    };
    this.state.view = 'sessions';
    this.state.detail = null;
    if (result.status === 'one_match') {
      const speaker = describe(result.matches[0]);
      const ids = this.people.get(speaker.id).sessions.filter(id => this.sessions.has(id)).slice(0, 20);
      this.state.ranking = {instance_ids: ids, interests: [], label: 'speaker', speaker: {...speaker, heard}};
      this.state.speakerChoice = this.state.gaps = null;
      if (!ids.includes(this.state.highlighted)) this.state.highlighted = null;
      // Repeated time slots of one session are not separate sessions; say how many different ones there are.
      const codes = [...new Set(ids.map(id => this.sessions.get(id).code))];
      return {ok: true, status: 'one_match', heard, speaker, session_count: codes.length, time_slot_count: ids.length,
        sessions: ids.map(id => this.summary(this.sessions.get(id))),
        next_step: `The page lists their sessions: ${codes.length} different session${codes.length === 1 ? '' : 's'}` +
          `${ids.length > codes.length ? ` in ${ids.length} time slots (some repeat)` : ''}. Say who they are (title, company), ` +
          'how many different sessions they give, and name them briefly.'};
    }
    // The rows the status counted as plausible: within the ambiguity margin of the leader.
    const leader = result.candidates[0]?.confidence ?? 0;
    const options = result.candidates.filter(row => leader - row.confidence <= this.names.c.AMBIGUITY_MARGIN).slice(0, 3).map(describe);
    this.state.speakerChoice = options.length ? {query: name, heard, status: result.status, people: options} : null;
    if (result.status === 'multiple_matches') return {ok: true, status: 'multiple_matches', heard, matches: options,
      next_step: 'Several people fit. Ask which one, naming each with their title or company. The page shows them to choose from.'};
    return {ok: true, status: 'no_match', heard, did_you_mean: options, next_step: options.length
      ? 'Nobody matched confidently. Ask whether they meant one of these (the page shows them); never act on a guess.'
      : 'No speaker sounds like that. Say so and ask them to repeat or spell the name.'};
  }

  // Free windows of 30+ minutes between 9 AM and 6 PM on one day, each with the sessions that fit
  // entirely inside it, ranked by the attendee's interests (or, without any, the topics already saved).
  fillFreeTime({date, interests = []}) {
    const fail = message => ({ok: false, error: {code: 'invalid_arguments', message}});
    if (!EVENT_DAYS.includes(date)) return fail(`date must be one of ${EVENT_DAYS.join(', ')}.`);
    if (!Array.isArray(interests) || interests.length > 6 || interests.some(value => typeof value !== 'string' || !value.trim() || value.length > 80))
      return fail('Provide up to 6 interest phrases.');
    const agenda = this.state.agenda.map(id => this.sessions.get(id));
    const busy = agenda.filter(session => session.local_start?.startsWith(date))
      .map(session => [toMinutes(clockOf(session.local_start)), toMinutes(clockOf(session.local_end)), session]).sort((a, b) => a[0] - b[0]);
    const windows = [];
    let cursor = DAY_START, before = null;
    for (const [start, end, session] of busy) {
      if (Math.min(start, DAY_END) - cursor >= MIN_FREE_MINUTES) windows.push({start: cursor, end: Math.min(start, DAY_END), before, after: session});
      if (end > cursor) { cursor = end; before = session; }
    }
    if (DAY_END - cursor >= MIN_FREE_MINUTES) windows.push({start: cursor, end: DAY_END, before, after: null});
    let used = interests.map(value => value.trim()), source = used.length ? 'attendee' : 'none';
    if (!used.length && agenda.length) {
      const counts = new Map();
      for (const session of agenda) for (const tag of session.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
      used = [...counts].filter(([tag]) => tag !== 'Other').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([tag]) => tag);
      if (used.length) source = 'your agenda';
    }
    const saved = new Set(this.state.agenda);
    const free = windows.map(window => {
      const from = toClock(window.start), to = toClock(window.end);
      const fits = this.catalog.sessions.filter(session => session.local_start?.startsWith(date) && !saved.has(session.id)
        && clockOf(session.local_start) >= from && clockOf(session.local_end) <= to).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
      let picks = [];
      if (used.length && this.knowledge) {
        const ranked = this.knowledge.rank({interests: used, date, start_after: from, end_before: to, limit: 20}).sessions;
        picks = ranked.filter(row => !saved.has(row.id)).map(row => [this.sessions.get(row.id), row.matched_interests]);
      }
      if (!picks.length) picks = fits.map(session => [session, []]);
      const neighbours = [venueOf(window.before), venueOf(window.after)].filter(Boolean);
      return {start: from, end: to, minutes: window.end - window.start, before: window.before?.code ?? null, after: window.after?.code ?? null,
        fitting_sessions: fits.length,
        suggestions: picks.slice(0, 3).map(([session, matched], index) => ({rank: index + 1, ...this.summary(session),
          matched_interests: matched, same_venue_as_neighbour: neighbours.includes(venueOf(session))}))};
    });
    this.state.view = 'sessions';
    this.state.detail = this.state.speakerChoice = null;
    this.state.gaps = {date, windows: free.map(({start, end, fitting_sessions: count}) => ({start, end, count}))};
    const ids = [...new Set(free.flatMap(window => window.suggestions.map(row => row.id)))].slice(0, 12);
    if (ids.length) {
      this.state.ranking = {instance_ids: ids, interests: used, label: 'free-time', date,
        windows: free.filter(window => window.suggestions.length).map(window => `${window.start}–${window.end}`)};
      if (!ids.includes(this.state.highlighted)) this.state.highlighted = null;
    }
    return {ok: true, date, day_bounds: '09:00–18:00', interests_used: used, interests_source: source, free_windows: free,
      next_step: free.length ? 'The calendar marks the free windows and the list shows what fits. Name the windows and the best fit for each in a sentence or two.'
        : 'That day is full between 9 AM and 6 PM. Say so.'};
  }

  // The "how I drive this page" board: no step starts the walkthrough at the first step (the page then
  // follows the Agent's sentences); a step lights only that step; close hides it. The page adds the facts.
  showHowItWorks({step}) {
    if (step === undefined) {
      this.state.explainer = EXPLAINER_STEPS[0];
      return {ok: true, step: EXPLAINER_STEPS[0], open: true, walkthrough: true};
    }
    if (step === 'close') {
      this.state.explainer = null;
      return {ok: true, step, open: false};
    }
    const index = EXPLAINER_STEPS.indexOf(step);
    if (index < 0) return {ok: false, error: {code: 'invalid_arguments', message: `step must be one of: ${[...EXPLAINER_STEPS, 'close'].join(', ')}.`}};
    this.state.explainer = step;
    return {ok: true, step, open: true, position: `${index + 1} of ${EXPLAINER_STEPS.length}`, next: EXPLAINER_STEPS[index + 1] ?? null};
  }

  // Two or three sessions side by side, with the fields that differ named for the Agent.
  compareSessions({instance_ids: ids}) {
    const fail = message => ({ok: false, error: {code: 'invalid_arguments', message}});
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => !this.sessions.has(id)))
      return fail('Provide 2 or 3 different exact instance_ids.');
    this.state.compare = [...ids];
    this.state.detail = null;
    const interests = this.state.ranking?.interests || [];
    const sessions = ids.map(id => {
      const session = this.sessions.get(id), facts = this.sessionFacts(id);
      const about = session.description && session.description.length > 240 ? `${session.description.slice(0, 240).replace(/\s+\S*$/, '')}…` : session.description ?? null;
      return {...this.summary(session), about, venue: venueOf(session), session_type: session.session_type, levels: session.levels,
        duration_minutes: session.duration_minutes, topics: session.tags, delivery: session.delivery_types,
        recorded: session.viewing_options.some(option => /record/i.test(option)), speakers: facts.speakers, agenda_fit: facts.agenda_fit,
        interest_match: interests.length && this.knowledge ? this.knowledge.matchedInterests(id, interests) : []};
    });
    const differs = field => new Set(sessions.map(row => JSON.stringify(row[field]))).size > 1;
    const overlap = this.knowledge?.validateAgenda(ids).conflicts.length > 0;
    return {ok: true, sessions, differences: ['day', 'time', 'venue', 'session_type', 'levels', 'duration_minutes', 'delivery', 'recorded', 'topics'].filter(differs),
      same_time: Boolean(overlap), interests,
      next_step: 'The page shows them side by side. Recommend one in two sentences from the attendee\'s interests and agenda; mention a recording if the other is recorded.'};
  }
}
