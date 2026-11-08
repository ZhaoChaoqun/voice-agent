// The ranked-feed page function added to the copied PageController.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PageController, narratedStep} from '../web/page-tools.mjs';
import {agendaCalendar} from '../web/ics.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url)));
const tools = JSON.parse(readFileSync(new URL('../agent/tools.json', import.meta.url)));
const id = code => catalog.sessions.find(session => session.code === code).id;

test('show_ranked_sessions keeps the exact order, returns ranks and never touches the agenda', () => {
  assert.deepEqual(tools.map(tool => tool.name), ['highlight_session', 'add_to_agenda', 'remove_from_agenda', 'overview_agenda',
    'show_ranked_sessions', 'open_session_details', 'find_speaker', 'fill_free_time', 'compare_sessions', 'show_how_it_works']);
  const page = new PageController(catalog);
  page.execute('add_to_agenda', {instance_ids: [id('BRK241')]});
  const ids = [id('BRK244'), id('BRK243'), id('BRK245')];
  const result = page.execute('show_ranked_sessions', {instance_ids: ids, interests: ['voice agents']});
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'ranked');
  assert.deepEqual(result.shown.map(row => [row.rank, row.code]), [[1, 'BRK244'], [2, 'BRK243'], [3, 'BRK245']]);
  assert.deepEqual(page.context().ranking, {instance_ids: ids, interests: ['voice agents']});
  assert.deepEqual(page.state.agenda, [id('BRK241')]);
  assert.equal(page.execute('show_ranked_sessions', {instance_ids: [], interests: []}).mode, 'catalog');
  assert.equal(page.state.ranking, null);
});

test('show_how_it_works walks the five steps in order, validates the step and closes', () => {
  const page = new PageController(catalog);
  const steps = ['connect', 'register', 'call', 'execute', 'together'].map(step => page.execute('show_how_it_works', {step}));
  assert.deepEqual(steps.map(result => [result.ok, result.position, result.next]),
    [[true, '1 of 5', 'register'], [true, '2 of 5', 'call'], [true, '3 of 5', 'execute'], [true, '4 of 5', 'together'], [true, '5 of 5', null]]);
  assert.equal(page.state.explainer, 'together');
  assert.equal(page.execute('show_how_it_works', {step: 'dance'}).error.code, 'invalid_arguments');
  assert.equal(page.execute('show_how_it_works', {steps: 'all'}).error.code, 'invalid_arguments');
  assert.deepEqual(page.execute('show_how_it_works', {}), {ok: true, step: 'connect', open: true, walkthrough: true});
  // In a walkthrough the board follows the Agent's sentences that open with First … Fifth (or Finally).
  assert.deepEqual(['', "Here's how I control this page.", "Here's how. First, we connect", 'First, a. Second, b. Third',
    'First, a. Second, b. Third, c. Fourth, d. Finally, e. Would you like to see it?', 'The first function. Second, b.',
    'First, a.\nThird, c. Second, d.'].map(narratedStep), ['connect', 'connect', 'connect', 'call', 'together', 'register', 'call']);
  assert.deepEqual(page.execute('show_how_it_works', {step: 'close'}), {ok: true, step: 'close', open: false});
  assert.equal(page.state.explainer, null);
});

test('highlighting outside the shortlist returns to the full catalog; inside keeps it', () => {
  const page = new PageController(catalog);
  page.execute('show_ranked_sessions', {instance_ids: [id('BRK244'), id('BRK243')], interests: ['agents']});
  assert.equal(page.execute('highlight_session', {instance_id: id('BRK243')}).ranking_cleared, undefined);
  assert.notEqual(page.state.ranking, null);
  assert.equal(page.execute('highlight_session', {instance_id: id('BRK101')}).ranking_cleared, true);
  assert.equal(page.state.ranking, null);
});

test('invalid shortlists are rejected without changing the feed', () => {
  const page = new PageController(catalog);
  for (const args of [
    {instance_ids: ['missing'], interests: ['x']}, {instance_ids: [id('BRK244'), id('BRK244')], interests: ['x']},
    {instance_ids: Array(21).fill(id('BRK244')), interests: ['x']}, {instance_ids: [id('BRK244')], interests: ['']},
    {instance_ids: [id('BRK244')]}, {instance_ids: [id('BRK244')], interests: ['x'], extra: 1},
  ]) {
    assert.equal(page.execute('show_ranked_sessions', args).ok, false, JSON.stringify(args).slice(0, 80));
    assert.equal(page.state.ranking, null);
  }
});

test('open_session_details spotlights the session; another highlight or a new shortlist closes it', () => {
  const page = new PageController(catalog);
  const opened = page.execute('open_session_details', {instance_id: id('BRK244')});
  assert.deepEqual([opened.ok, opened.opened.code], [true, 'BRK244']);
  assert.deepEqual([page.state.highlighted, page.state.detail], [id('BRK244'), id('BRK244')]);
  page.execute('highlight_session', {instance_id: id('BRK244')});
  assert.equal(page.state.detail, id('BRK244'), 'highlighting the open session keeps it open');
  page.execute('highlight_session', {instance_id: id('BRK243')});
  assert.equal(page.state.detail, null);
  page.execute('open_session_details', {instance_id: id('BRK243')});
  page.execute('show_ranked_sessions', {instance_ids: [id('BRK244')], interests: ['voice']});
  assert.equal(page.state.detail, null);
  assert.equal(page.execute('open_session_details', {instance_id: 'missing'}).ok, false);
  assert.equal(page.execute('open_session_details', {instance_id: id('BRK101')}).ranking_cleared, true);
});

// The three functions that need the knowledge index, the speaker directory and the name matcher.
import {SessionIndex} from '../web/session-index.mjs';
import {EVENT_FILLER, NameSearch} from '../web/name-search.mjs';
import {buildSessionDetails} from '../data/session-details.mjs';
const details = buildSessionDetails();
const nameData = JSON.parse(readFileSync(new URL('../data/name-search-data.json', import.meta.url)));
const names = new NameSearch(nameData, details.people.map(({id, name, aliases}) => ({id, name, aliases})), {extraStrongFiller: EVENT_FILLER});
const smart = () => new PageController(catalog, {knowledge: new SessionIndex(catalog), details, names});

test('find_speaker acts only on one_match and puts doubtful or shared names to the attendee', () => {
  const page = smart();
  const found = page.execute('find_speaker', {name: 'yiwen rong'});
  assert.deepEqual([found.status, found.speaker.name, found.speaker.company], ['one_match', 'Yiwen Rong', 'Microsoft']);
  assert.equal(page.state.ranking.label, 'speaker');
  assert.ok(page.state.ranking.instance_ids.includes(id('BRK244')));
  const before = JSON.stringify(page.state.ranking);
  const unsure = page.execute('find_speaker', {name: 'e when wrong'});
  assert.equal(unsure.status, 'no_match');
  assert.equal(unsure.did_you_mean[0].name, 'Yiwen Rong');
  assert.equal(page.state.speakerChoice.people[0].name, 'Yiwen Rong');
  assert.equal(JSON.stringify(page.state.ranking), before, 'a guess never replaces the list');
  const shared = page.execute('find_speaker', {name: 'shah'});
  assert.equal(shared.status, 'multiple_matches');
  assert.ok(shared.matches.length >= 2 && shared.matches.length <= 3 && shared.matches.every(person => person.name.endsWith('Shah')));
  const fused = page.execute('find_speaker', {name: 'mark russ in ovich', alternatives: ['mark russinovich']});
  assert.equal(fused.speaker?.name, 'Mark Russinovich');
  assert.equal(page.execute('find_speaker', {name: ''}).ok, false);
  assert.equal(page.execute('find_speaker', {name: 'x', alternatives: Array(5).fill('y')}).ok, false);
  assert.equal(page.execute('find_speaker', {name: 'x', extra: 1}).ok, false);
});

test('fill_free_time finds 30-minute windows between saved sessions and only suggests what fits inside them', () => {
  const page = smart();
  page.execute('add_to_agenda', {instance_ids: [id('BRK241'), id('BRK246')]});
  const result = page.execute('fill_free_time', {date: '2026-11-18'});
  assert.deepEqual(result.free_windows.map(window => `${window.start}-${window.end}`), ['09:00-10:15', '11:00-13:45', '14:30-18:00']);
  assert.equal(result.interests_source, 'your agenda');
  for (const window of result.free_windows) {
    assert.ok(window.suggestions.length <= 3);
    for (const suggestion of window.suggestions) {
      const session = catalog.sessions.find(row => row.id === suggestion.id);
      assert.ok(session.local_start.startsWith('2026-11-18') && session.local_start.slice(11, 16) >= window.start
        && session.local_end.slice(11, 16) <= window.end, suggestion.code);
      assert.ok(![id('BRK241'), id('BRK246')].includes(suggestion.id));
    }
  }
  assert.equal(page.state.ranking.label, 'free-time');
  assert.equal(page.state.gaps.windows.length, 3);
  const asked = page.execute('fill_free_time', {date: '2026-11-18', interests: ['voice agents']});
  assert.equal(asked.interests_source, 'attendee');
  assert.equal(page.execute('fill_free_time', {date: '2026-12-01'}).ok, false);
  page.execute('show_ranked_sessions', {instance_ids: [], interests: []});
  assert.equal(page.state.gaps, null, 'returning to the catalog clears the free-time marks');
});

test('compare_sessions lines up the facts and names what differs', () => {
  const page = smart();
  const result = page.execute('compare_sessions', {instance_ids: [id('BRK241'), id('BRK248')]});
  assert.equal(result.ok, true);
  assert.equal(result.same_time, true, 'BRK241 and BRK248 overlap');
  assert.deepEqual(result.sessions.map(row => row.code), ['BRK241', 'BRK248']);
  assert.ok(result.sessions.every(row => row.speakers.length && row.day && row.time && row.venue));
  assert.ok(!result.differences.includes('day') && !result.differences.includes('time'));
  assert.deepEqual(page.state.compare, [id('BRK241'), id('BRK248')]);
  for (const ids of [[id('BRK241')], [id('BRK241'), id('BRK241')], [id('BRK241'), 'missing'], [id('BRK241'), id('BRK248'), id('BRK246'), id('BRK244')]])
    assert.equal(page.execute('compare_sessions', {instance_ids: ids}).ok, false);
});

test('the exported agenda is a valid iCalendar file that calendars import', () => {
  const sessions = [catalog.sessions.find(session => session.code === 'BRK244'),
    {...catalog.sessions.find(session => session.code === 'BRK241'), description: 'Line one; a, b\\c\nLine two ' + 'é'.repeat(60)}];
  const text = agendaCalendar(sessions, {stamp: '2026-10-30T08:00:00Z',
    details: {[sessions[0].id]: {speakers: [{name: 'Yiwen Rong', job_title: 'Principal Product Manager', company: 'Microsoft'}]}}});
  const lines = text.split('\r\n');
  assert.equal(lines.at(-1), '');
  assert.ok(lines.every(line => new TextEncoder().encode(line).length <= 75), 'lines are folded at 75 octets');
  assert.ok(!/(?<!\r)\n/.test(text), 'only CRLF line ends');
  const unfolded = text.replace(/\r\n /g, '');
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(unfolded, /\r\nDTSTART:20261120T011500Z\r\nDTEND:20261120T020000Z\r\n/);
  assert.match(unfolded, new RegExp(`UID:${sessions[0].id}@ignite-2026-voice-planner`));
  assert.match(unfolded, /SUMMARY:BRK244 · Voice agents in Microsoft Foundry: Prototype to production in 45 mins/);
  assert.match(unfolded, /Speakers: Yiwen Rong\\, Principal Product Manager\\, Microsoft/);
  assert.match(unfolded, /DESCRIPTION:Line one\\; a\\, b\\\\c\\nLine two é/);
  assert.match(unfolded, /LOCATION:AMC Metreon \| Level 3\\, Theater 12/);
  assert.equal(agendaCalendar([]).includes('BEGIN:VEVENT'), false);
});
