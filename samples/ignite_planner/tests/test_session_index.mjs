// Parity between the browser SessionIndex and tools/session_catalog.py over the same catalog.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {loadCatalog} from '../data/catalog.mjs';
import {MINIMUM, SessionIndex} from '../web/session-index.mjs';

const TOOLS = new URL('../tools/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url)));
const index = new SessionIndex(catalog);
const id = code => catalog.sessions.find(session => session.code === code).id;

const SEARCHES = [
  {keywords: ['voice', 'agents'], limit: 10},
  {keywords: ['BRK244']},
  {keywords: ['brk244', 'foundry']},
  {keywords: ['foundry'], date: '2026-11-19', limit: 10},
  {keywords: ['security'], start_after: '13:00', end_before: '17:00', limit: 10},
  {keywords: [], limit: 10},
  {keywords: [], scheduled_only: false, offset: 1460, limit: 10},
  {keywords: ['copilot'], delivery: 'Online', limit: 10},
  {keywords: ['agent'], speaker: 'matt', limit: 10},
  {keywords: ['contact center', 'speech'], limit: 10, offset: 3},
  {keywords: ['azure', 'ai', 'data', 'security', 'copilot', 'agents', 'fabric', 'sql', 'github', 'devops', 'windows', 'teams'], limit: 10},
];
const scheduled = catalog.sessions.filter(session => session.start).map(session => session.id);
const AGENDAS = [
  [id('BRK241'), id('BRK248'), id('BRK246')],
  [...scheduled.slice(0, 400), 'unknown-id', catalog.sessions.find(session => !session.start).id, scheduled[0]],
];

function python(payload) {
  const program = `
import json, sys
sys.path.insert(0, sys.argv[1])
from collections import Counter
from session_catalog import SessionIndex
index = SessionIndex.load()
request = json.load(sys.stdin)
def guarded(call):
    try:
        return call()
    except ValueError as error:
        return {"error": str(error)}
print(json.dumps({
    "documents": [dict(document) for document in index.documents],
    "average_length": index.average_length,
    "searches": [guarded(lambda query=query: index.search(query.get("keywords"), query.get("date"),
        query.get("start_after"), query.get("end_before"), query.get("speaker"), query.get("delivery"),
        query.get("scheduled_only", True), query.get("limit", 5), query.get("offset", 0))) for query in request["searches"]],
    "agendas": [guarded(lambda ids=ids: index.validate_agenda(ids)) for ids in request["agendas"]],
}))`;
  return JSON.parse(execFileSync('python3', ['-c', program, TOOLS.pathname],
    {input: JSON.stringify(payload), maxBuffer: 256 * 1024 * 1024}));
}

const expected = python({searches: SEARCHES, agendas: AGENDAS});

test('tokenized weighted documents match the Python index for every catalog row', () => {
  assert.equal(index.documents.length, expected.documents.length);
  index.documents.forEach((document, row) => assert.deepEqual(Object.fromEntries(document), expected.documents[row], catalog.sessions[row].id));
  assert.equal(index.averageLength, expected.average_length);
});

test('search ranking, filters, scores and paging match Python', () => {
  SEARCHES.forEach((query, position) => assert.deepEqual(index.search(query), expected.searches[position], JSON.stringify(query)));
});

test('agenda review matches Python, including truncation, unknown and untimed IDs', () => {
  AGENDAS.forEach((ids, position) => assert.deepEqual(index.validateAgenda(ids), expected.agendas[position]));
  const review = index.validateAgenda(AGENDAS[0]);
  assert.equal(review.conflict_count, 1);
  assert.equal(review.mutates_calendar, false);
  assert.equal(index.validateAgenda(AGENDAS[1]).conflicts_truncated, true);
});

test('tool layer applies the MCP schema limits and reports rejected calls as tool errors', () => {
  assert.equal(index.execute('ignite_search_sessions', {keywords: ['voice'], limit: 11}).isError, true);
  assert.equal(index.execute('ignite_search_sessions', {keywords: ['!!!']}).isError, true);
  assert.equal(index.execute('ignite_search_sessions', {limit: 3}).isError, true);
  assert.equal(index.execute('ignite_search_sessions', {keywords: ['x'], date: '2026-02-30'}).isError, true);
  assert.equal(index.execute('ignite_get_session', {instance_id: 'missing'}).isError, true);
  assert.equal(index.execute('ignite_get_session', {instance_id: id('BRK244')}).session.code, 'BRK244');
  const found = index.execute('ignite_search_sessions', {keywords: ['BRK244']});
  assert.equal(found.sessions[0].code, 'BRK244');
  assert.equal(found.catalog_version, catalog.version);
});

test('interest ranking returns one row per title, strict interest matches and relative scores', () => {
  const ranked = index.execute('ignite_rank_sessions', {interests: ['voice agents', 'contact center'], limit: 10});
  assert.equal(ranked.ranking, 'interest_weighted_bm25');
  assert.ok(ranked.sessions.length > 3 && ranked.sessions.length <= 10);
  assert.deepEqual(ranked.sessions.map(row => row.rank), ranked.sessions.map((row, position) => position + 1));
  assert.equal(ranked.sessions[0].match_score, 1);
  assert.ok(ranked.sessions.every((row, position) => position === 0 || row.match_score <= ranked.sessions[position - 1].match_score));
  const titles = ranked.sessions.map(row => row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  assert.equal(new Set(titles).size, titles.length);
  for (const row of ranked.sessions.filter(row => row.match === 'strong')) {
    assert.ok(row.matched_interests.length > 0, row.code);
    assert.deepEqual(index.matchedInterests(row.id, ranked.interests), row.matched_interests, row.code);
  }
  // A lone common word ("agent") does not count as matching "voice agents".
  const governance = catalog.sessions.find(session => /agent governance/i.test(session.title) && !/voice/i.test(session.title + session.tags.join(' ')));
  assert.deepEqual(index.matchedInterests(governance.id, ['voice agents']), []);
});

test('interest ranking honours day filters and rejects invalid requests as tool errors', () => {
  const thursday = index.execute('ignite_rank_sessions', {interests: ['voice agents'], date: '2026-11-19'});
  assert.ok(thursday.sessions.length > 0);
  assert.ok(thursday.sessions.every(row => row.local_start.startsWith('2026-11-19')));
  assert.ok(thursday.sessions.some(row => row.code === 'BRK244'));
  for (const bad of [{interests: []}, {interests: ['!!!']}, {interests: ['voice'], limit: 21}, {interests: ['voice'], date: 'Thursday'}, {}])
    assert.equal(index.execute('ignite_rank_sessions', bad).isError, true, JSON.stringify(bad));
});

// The page and the Agent use the shared catalog plus official descriptions (catalog.mjs).
const described = new SessionIndex(loadCatalog());

test('official descriptions are indexed and returned by lookups and ranking', () => {
  assert.match(described.execute('ignite_get_session', {instance_id: id('BRK244')}).session.description, /speech-native agent/);
  const vision = described.execute('ignite_rank_sessions', {interests: ['vision']});
  assert.ok(vision.total_matches > index.execute('ignite_rank_sessions', {interests: ['vision']}).total_matches + 10, 'descriptions add matches');
  assert.ok(vision.sessions.every(row => row.description === null || row.description.length <= 321));
  const found = described.execute('ignite_search_sessions', {keywords: ['telephony'], limit: 10});
  assert.ok(found.sessions.some(row => row.code === 'BRK244'), 'a word only in the description finds the session');
  const demo = described.execute('ignite_rank_sessions', {interests: ['voice agents', 'Microsoft Foundry'], date: '2026-11-19'});
  assert.equal(demo.sessions[0].code, 'BRK244');
});

test('the Agent always gets at least five sessions; looser ones are labeled, strong ones never displaced', () => {
  const loose = described.execute('ignite_rank_sessions', {interests: ['computer vision', 'movies']});
  assert.equal(loose.total_matches, 0);
  assert.equal(loose.sessions.length, MINIMUM);
  assert.ok(loose.sessions.every(row => row.match === 'partial' && !row.matched_interests.length && row.matched_terms.length));
  assert.match(loose.fill_notice, /looser/);
  const none = described.execute('ignite_rank_sessions', {interests: ['movie']});
  assert.equal(none.sessions.length, 0);
  assert.match(none.next_step, /related_terms/);
  const related = described.execute('ignite_rank_sessions', {interests: ['movie'], related_terms: ['video', 'media', 'streaming']});
  assert.equal(related.sessions.length, MINIMUM);
  assert.ok(related.sessions.every(row => row.match === 'related' && row.matched_terms.length));
  const strong = described.execute('ignite_rank_sessions', {interests: ['voice agents', 'contact center'], related_terms: ['speech']});
  assert.ok(strong.sessions.length > MINIMUM && strong.sessions.every(row => row.match === 'strong'));
  const search = described.execute('ignite_search_sessions', {keywords: ['movie'], related_terms: ['video', 'media']});
  assert.equal(new Set(search.sessions.map(row => row.code)).size, MINIMUM);
  assert.ok(search.sessions.every(row => row.match === 'related'));
  assert.equal(search.added_to_reach_minimum, search.sessions.length);
  const paged = described.execute('ignite_search_sessions', {keywords: ['BRK244']});
  assert.ok(paged.sessions[0].code === 'BRK244' && paged.sessions[0].match === 'keyword');
  assert.equal(described.execute('ignite_search_sessions', {keywords: ['movie'], related_terms: Array(13).fill('video')}).isError, true);
  assert.equal(described.execute('ignite_rank_sessions', {interests: ['movie'], related_terms: 'video'}).isError, true);
});
