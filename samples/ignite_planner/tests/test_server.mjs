// Local helper boundaries, Agent definition and control-plane calls, without Azure.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {after, before, test} from 'node:test';
import {AzureCliToken, agentDefinition, agentInstructions, agentName, ensureAgent, validateEndpoint, websocketUrl} from '../agent/agent.mjs';
import {ASSETS, createApp, settingsFromEnv} from '../server.mjs';
import {buildSessionDetails, cleanSpeakerName} from '../data/session-details.mjs';

const ENDPOINT = 'https://example-resource.services.ai.azure.com/api/projects/demo';
const settings = {endpoint: ENDPOINT, model: 'gpt-realtime', voice: 'en-US-AvaNeural'};
let live, preview;

function listen(app) {
  return new Promise(resolve => app.listen(0, '127.0.0.1', () => resolve({app, port: app.address().port})));
}
function fetchRaw(port, path, {method = 'GET', headers = {}} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({host: '127.0.0.1', port, path, method, headers}, incoming => {
      let body = '';
      incoming.on('data', chunk => { body += chunk; });
      incoming.on('end', () => resolve({status: incoming.statusCode, headers: incoming.headers, body}));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

before(async () => {
  const tokens = {get: async () => ({token: 'page-token', expires_on: 4102444800})};
  live = await listen(createApp({settings, agent: {name: 'ignite-web-demo-js-test'}, tokens, log: () => {}}));
  preview = await listen(createApp({settings: settingsFromEnv({}, true), log: () => {}}));
});
after(() => { live.app.close(); preview.app.close(); });

test('the token goes only to a same-origin loopback page', async () => {
  const origin = `http://127.0.0.1:${live.port}`;
  const ok = await fetchRaw(live.port, '/api/token', {method: 'POST', headers: {origin}});
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).token, 'page-token');
  for (const headers of [{}, {origin: 'https://evil.example'}, {origin: `http://localhost:${live.port}`}])
    assert.equal((await fetchRaw(live.port, '/api/token', {method: 'POST', headers})).status, 403, JSON.stringify(headers));
  const rebound = await fetchRaw(live.port, '/api/token', {method: 'POST', headers: {host: 'evil.example', origin: 'http://evil.example'}});
  assert.equal(rebound.status, 403);
  const previewToken = await fetchRaw(preview.port, '/api/token', {method: 'POST', headers: {origin: `http://127.0.0.1:${preview.port}`}});
  assert.equal(previewToken.status, 503);
});

test('only the listed page files are served, from web/, agent/ and data/ under flat URLs', async () => {
  for (const path of ['/', '/app.mjs', '/voice-session.mjs', '/page-tools.mjs', '/catalog.json', '/tools.json', '/knowledge-tools.json',
    '/styles.css', '/audio.mjs', '/wireframe.mjs', '/effects.mjs', '/explainer.mjs', '/ics.mjs', '/pcm-capture.js', '/name-search.mjs', '/name-search-data.json'])
    assert.equal((await fetchRaw(live.port, path)).status, 200, path);
  for (const path of ['/server.mjs', '/agent.mjs', '/agent/agent.mjs', '/prompt.txt', '/agent/prompt.txt', '/web/app.mjs',
    '/sessions.json', '/data/sessions.json', '/catalog.mjs', '/tools/session_catalog.py', '/%2e%2e/.env', '/.env'])
    assert.equal((await fetchRaw(live.port, path)).status, 404, path);
  const page = await fetchRaw(live.port, '/');
  assert.match(page.headers['content-security-policy'], /connect-src 'self' wss:\/\/example-resource\.services\.ai\.azure\.com;/);
});

test('config gives the page the direct Azure WebSocket and never a credential', async () => {
  const config = JSON.parse((await fetchRaw(live.port, '/api/config')).body);
  assert.equal(config.voice_available, true);
  assert.equal(config.websocket_url,
    'wss://example-resource.services.ai.azure.com/api/projects/demo/agents/ignite-web-demo-js-test/endpoint/protocols/voice?api-version=2025-11-15-preview');
  assert.doesNotMatch(JSON.stringify(config), /token/i);
  assert.equal(JSON.parse((await fetchRaw(preview.port, '/api/config')).body).voice_available, false);
});

test('inherited asset names return 404 and leave the server available', async () => {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const result = await fetchRaw(preview.port, `/${name}`);
    assert.equal(result.status, 404, name);
    assert.equal(result.body, 'Not found.');
    assert.equal((await fetchRaw(preview.port, '/')).status, 200);
  }
});

test('malformed URLs return 400 and leave the server available', async () => {
  for (const [path, headers] of [['//[', {}], ['http://[', {}], ['/', {host: 'localhost:invalid'}]]) {
    const result = await fetchRaw(preview.port, path, {headers});
    assert.equal(result.status, 400, path);
    assert.equal(result.body, 'Bad request.');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal((await fetchRaw(preview.port, '/api/config')).status, 200);
  }
});

test('asset read failures are logged and contained without exposing filesystem details', async t => {
  const errors = [];
  const server = await listen(createApp({settings: settingsFromEnv({}, true), log: (...args) => errors.push(args)}));
  t.after(() => server.app.close());
  const original = ASSETS['index.html'];
  t.after(() => { ASSETS['index.html'] = original; });
  ASSETS['index.html'] = new URL('./missing-page.html', import.meta.url);
  const result = await fetchRaw(server.port, '/');
  assert.equal(result.status, 500);
  assert.equal(result.body, 'Unable to serve request. See server log.');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'Planner request failed:');
  assert.equal(errors[0][1].code, 'ENOENT');
  assert.equal((await fetchRaw(server.port, '/api/config')).status, 200);
  ASSETS['index.html'] = original;
  assert.equal((await fetchRaw(server.port, '/')).status, 200);
});

test('the Agent keeps client-owned turns and exposes fourteen page-executed functions', () => {
  const definition = agentDefinition();
  assert.equal(definition.audio.input.turn_detection.create_response, false);
  assert.equal(definition.audio.input.turn_detection.interrupt_response, false);
  assert.deepEqual(definition.tools.map(tool => tool.name), ['highlight_session', 'add_to_agenda', 'remove_from_agenda',
    'overview_agenda', 'show_ranked_sessions', 'open_session_details', 'find_speaker', 'fill_free_time', 'compare_sessions',
    'show_how_it_works', 'ignite_search_sessions', 'ignite_validate_agenda', 'ignite_get_session', 'ignite_rank_sessions']);
  assert.match(definition.instructions, /FINDING A SPEAKER[\s\S]*exactly as it reached you/);
  assert.match(definition.instructions, /HOW YOU WORK[\s\S]*show_how_it_works with no step[\s\S]*exactly five short sentences/);
  assert.ok(definition.tools.every(tool => tool.type === 'function'));
  assert.match(definition.instructions, /ignite_rank_sessions[\s\S]*show_ranked_sessions[\s\S]*top three/);
  assert.match(definition.instructions, /Catalog version: [0-9a-f]{64}/);
  assert.equal(agentName(definition), agentName(agentDefinition()));
  assert.notEqual(agentName(definition), agentName(agentDefinition({voice: 'en-US-AndrewNeural'})));
  assert.match(websocketUrl(ENDPOINT, 'a b'), /\/agents\/a%20b\/endpoint\/protocols\/voice\?api-version=2025-11-15-preview$/);
});

test('ensureAgent reuses an existing Agent, creates a missing one and reports failures', async () => {
  const calls = [];
  const fake = statuses => async (url, options) => {
    calls.push(`${options.method} ${new URL(url).pathname.split('/agents/')[1]}`);
    assert.equal(options.headers['Foundry-Features'], 'VoiceAgents=V1Preview');
    const status = statuses.shift();
    return {status, ok: status < 300, text: async () => 'detail'};
  };
  assert.deepEqual(await ensureAgent({endpoint: ENDPOINT, definition: {}, name: 'n', token: 't', fetchImpl: fake([200, 200])}),
    {name: 'n', created: false});
  assert.deepEqual(calls.splice(0), ['GET n', 'POST n:enable']);
  assert.deepEqual(await ensureAgent({endpoint: ENDPOINT, definition: {}, name: 'n', token: 't', fetchImpl: fake([404, 200, 200])}),
    {name: 'n', created: true});
  assert.deepEqual(calls.splice(0), ['GET n', 'POST n/versions', 'POST n:enable']);
  await assert.rejects(ensureAgent({endpoint: ENDPOINT, definition: {}, name: 'n', token: 't', fetchImpl: fake([403])}), /HTTP 403/);
});

test('endpoint validation and token caching', async () => {
  assert.equal(validateEndpoint(`${ENDPOINT}/`), ENDPOINT);
  for (const bad of ['http://example-resource.services.ai.azure.com/api/projects/demo', 'https://example.com/api/projects/demo',
    `${ENDPOINT}?x=1`, 'https://example-resource.services.ai.azure.com/api/projects'])
    assert.throws(() => validateEndpoint(bad), /Foundry project endpoint/, bad);
  let runs = 0;
  const cli = new AzureCliToken(async () => { runs++; return {stdout: JSON.stringify({token: 'a', expires_on: Date.now() / 1000 + 3600})}; });
  await Promise.all([cli.get(), cli.get()]);
  await cli.get();
  assert.equal(runs, 1);
});

test('session details join speaker roles by ID only and count IDs missing from the directory', async () => {
  const {sessions: details, people} = buildSessionDetails();
  const catalog = JSON.parse((await fetchRaw(live.port, '/catalog.json')).body);
  const brk244 = catalog.sessions.find(session => session.code === 'BRK244');
  // The served catalog carries the official descriptions, and the Agent is told its exact version.
  assert.match(brk244.description, /Voice-first agents in Microsoft Foundry/);
  assert.ok(catalog.descriptions_count > 1400 && catalog.sessions.every(session => 'description' in session));
  assert.ok(agentInstructions().includes(`Catalog version: ${catalog.version}.`));
  assert.deepEqual(details[brk244.id].speakers.map(speaker => speaker.name), brk244.speakers);
  assert.deepEqual(details[brk244.id].speakers[0], {name: 'Yiwen Rong', job_title: 'Principal Product Manager', company: 'Microsoft',
    person: people.find(person => person.name === 'Yiwen Rong').id});
  assert.equal(Object.keys(details).length, catalog.sessions.length);
  assert.equal(Object.values(details).reduce((total, row) => total + row.unresolved_speakers, 0), 26);
  const served = await fetchRaw(live.port, '/session-details.json');
  assert.equal(served.status, 200);
  assert.deepEqual(JSON.parse(served.body).sessions[brk244.id], details[brk244.id]);
  const fake = buildSessionDetails(name => name === 'speakers.json'
    ? {speakers: [{speaker_id: 'a', name: 'A Person', job_title: 'T', company: 'C'}, {speaker_id: 'a', name: 'A duplicate'},
      {speaker_id: 'b', name: 'a person​', job_title: null, company: 'D'}]}
    : {sessions: [{instance_id: 'x', speaker_ids: ['a', 'missing'], start_utc: '2026-11-18T18:00:00Z', seating_experience: null, target_audience: null, source_last_updated_at: null},
      {instance_id: 'y', speaker_ids: ['b'], start_utc: '2026-11-17T18:00:00Z', seating_experience: null, target_audience: null, source_last_updated_at: null}]});
  assert.deepEqual(fake.sessions.x.speakers, [{name: 'A Person', job_title: 'T', company: 'C', person: 'a'}]);
  assert.equal(fake.sessions.x.unresolved_speakers, 1);
  assert.deepEqual(fake.people, [{id: 'a', name: 'A Person', aliases: [], job_title: 'T', company: 'C', speaker_ids: ['a', 'b'], sessions: ['y', 'x']}],
    'one spoken name is one person, with sessions in time order');
});

test('speaker names are cleaned for speech: suffixes, notes, repeats and invisible characters', () => {
  assert.deepEqual(cleanSpeakerName('Srikumar (Sri) Nair'), {name: 'Srikumar Nair', aliases: ['Sri Nair']});
  assert.deepEqual(cleanSpeakerName('Tina Schrepfer (LI)'), {name: 'Tina Schrepfer', aliases: []});
  assert.deepEqual(cleanSpeakerName('Amy Curley, PhD'), {name: 'Amy Curley', aliases: []});
  assert.deepEqual(cleanSpeakerName('RAJESH SETLEM Setlem'), {name: 'Rajesh Setlem', aliases: []});
  assert.deepEqual(cleanSpeakerName('Travis Payne\u200b'), {name: 'Travis Payne', aliases: []});
});
