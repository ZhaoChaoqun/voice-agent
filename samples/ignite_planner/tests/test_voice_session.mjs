// Turn-scheduling and barge-in cases ported from the Python prototype's test_voice_session.py.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GREETING, VoiceSession} from '../web/voice-session.mjs';

class FakeAudio {
  constructor() {
    this.items = new Map();
    this.heardMs = new Map();
    this.blocked = new Set();
    this.interruptions = [];
    this.lastInterruptionCutAudio = false;
  }

  play(delta, {item_id: itemId, response_id: responseId, content_index: contentIndex}) {
    if (this.blocked.has(responseId)) return false;
    const item = this.items.get(itemId) || {responseId, contentIndex, receivedSamples: 0};
    item.receivedSamples += Buffer.from(delta, 'base64').length / 2;
    this.items.set(itemId, item);
    return true;
  }

  interrupt(packet) {
    this.interruptions.push(packet);
    assert.equal(packet.items.length, this.items.size, 'every delivered item must be reported');
    if (packet.response_id) this.blocked.add(packet.response_id);
    const reports = packet.items.map(({item_id: itemId, content_index: contentIndex}) => ({
      item_id: itemId, content_index: contentIndex, audio_end_ms: this.heardMs.get(itemId) ?? 0,
    }));
    this.lastInterruptionCutAudio = reports.some(report =>
      report.audio_end_ms < this.items.get(report.item_id).receivedSamples * 1000 / 24000);
    this.items.clear();
    return reports;
  }
}

const pcm = seconds => Buffer.alloc(seconds * 48000).toString('base64');
const delta = (responseId, itemId, seconds) => ({type: 'response.output_audio.delta', response_id: responseId,
  item_id: itemId, content_index: 0, delta: pcm(seconds)});
const done = (status = 'completed', id = 'old', output = []) => ({type: 'response.done', response: {id, status, output}});
const call = (id = 'c1') => ({type: 'function_call', call_id: id, name: 'add_to_agenda', arguments: '{"instance_ids":["x"]}'});
const ready = {type: 'session.updated', session: {audio: {input: {turn_detection: {create_response: false}}}}};

function fixture({start = true} = {}) {
  const sent = [], emitted = [], deferred = [], executed = [];
  const audio = new FakeAudio();
  const session = new VoiceSession({
    send: event => sent.push(event), audio, emit: event => emitted.push(event),
    execute: value => { executed.push(value); return {ok: true}; }, defer: fn => deferred.push(fn),
  });
  if (start) {
    session.handle(ready);
    session.handle({type: 'response.created', response: {id: 'greeting'}});
    session.handle(done('completed', 'greeting'));
    sent.length = 0;
  }
  return {session, sent, emitted, deferred, executed, audio, types: () => sent.map(event => event.type)};
}

test('greeting waits for client-owned turn scheduling and is tool-free', () => {
  const {session, sent} = fixture({start: false});
  session.handle({type: 'session.created', session: {id: 's'}});
  assert.equal(sent.length, 0);
  session.handle(ready);
  assert.deepEqual(sent, [{type: 'response.create', response: {tool_choice: 'none', instructions: GREETING}}]);
  const other = fixture({start: false}).session;
  assert.throws(() => other.handle({type: 'session.updated', session: {turn_detection: {create_response: true}}}), /turn scheduling/);
});

test('a service-scheduled reply is tracked and can be interrupted', () => {
  const {session, sent} = fixture();
  session.handle({type: 'response.created', response: {id: 'follow-up'}});
  session.handle({type: 'input_audio_buffer.speech_started'});
  assert.equal(sent[0].type, 'response.cancel');
  assert.equal(sent[0].response_id, 'follow-up');
});

test('barge-in stops playback, truncates the unheard audio, then answers after cancellation', () => {
  const {session, types, sent, audio} = fixture();
  session.handle({type: 'response.created', response: {id: 'old'}});
  session.handle(delta('old', 'item', 1));
  audio.heardMs.set('item', 400);
  session.handle({type: 'input_audio_buffer.speech_started'});
  assert.deepEqual(types(), ['response.cancel', 'conversation.item.truncate']);
  assert.deepEqual(sent[1], {type: 'conversation.item.truncate', item_id: 'item', content_index: 0, audio_end_ms: 400});
  session.handle({type: 'input_audio_buffer.committed'});
  assert.deepEqual(types(), ['response.cancel', 'conversation.item.truncate']);
  session.handle(done('cancelled'));
  assert.deepEqual(types(), ['response.cancel', 'conversation.item.truncate', 'response.create']);
  assert.equal(session.pendingTurns, 0);
});

test('typing over buffered completed audio truncates it without a duplicate cancel', () => {
  const {session, types, sent, audio} = fixture();
  session.handle({type: 'response.created', response: {id: 'r'}});
  session.handle(delta('r', 'item', 2));
  session.handle(done('completed', 'r'));
  audio.heardMs.set('item', 500);
  session.sendText('Actually, remove that meeting.');
  assert.deepEqual(types(), ['conversation.item.truncate', 'conversation.item.create', 'response.create']);
  assert.equal(sent[0].audio_end_ms, 500);
});

test('fully heard audio is reported but not truncated', () => {
  const {session, types, audio} = fixture();
  session.handle({type: 'response.created', response: {id: 'r'}});
  session.handle(delta('r', 'item', 1));
  session.handle(done('completed', 'r'));
  audio.heardMs.set('item', 1000);
  session.handle({type: 'input_audio_buffer.speech_started'});
  assert.deepEqual(types(), []);
  assert.equal(audio.interruptions.length, 1);
  assert.equal(audio.items.size, 0);
});

test('speech before the response ID arrives cancels exactly once when it arrives', () => {
  const {session, types} = fixture();
  session.sendText('Find voice sessions.');
  session.handle({type: 'input_audio_buffer.speech_started'});
  session.handle({type: 'response.created', response: {id: 'late'}});
  session.handle({type: 'input_audio_buffer.speech_started'});
  assert.equal(types().filter(type => type === 'response.cancel').length, 1);
});

test('late audio and transcripts from a cancelled response are not played or shown', () => {
  const {session, emitted, audio} = fixture();
  session.cancelled.add('old');
  session.handle(delta('old', 'item', 1));
  session.handle({type: 'response.output_audio_transcript.done', response_id: 'old', transcript: 'unheard'});
  assert.equal(audio.items.size, 0);
  assert.equal(emitted.filter(event => event.response_id === 'old').length, 0);
});

test('a tool call completed during cancellation is closed without execution', () => {
  const {session, sent, executed} = fixture();
  session.handle({type: 'response.created', response: {id: 'old'}});
  session.handle({type: 'input_audio_buffer.speech_started'});
  session.handle(done('completed', 'old', [call()]));
  assert.equal(executed.length, 0);
  const output = sent.find(event => event.type === 'conversation.item.create').item;
  assert.equal(output.call_id, 'c1');
  assert.equal(JSON.parse(output.output).error.code, 'interrupted');
});

test('a tool continuation does not jump ahead of speech that arrived meanwhile', () => {
  const {session, types, executed, deferred} = fixture();
  session.sendText('Add it.');
  session.handle({type: 'response.created', response: {id: 'r'}});
  session.handle(done('completed', 'r', [call()]));
  assert.equal(executed.length, 1);
  assert.deepEqual(types().slice(-1), ['conversation.item.create']);
  session.handle({type: 'input_audio_buffer.speech_started'});
  deferred.shift()();
  assert.equal(types().filter(type => type === 'response.create').length, 1);
  session.handle({type: 'input_audio_buffer.committed'});
  assert.equal(types().filter(type => type === 'response.create').length, 2);
});

test('parallel function calls are answered without executing any of them', () => {
  const {session, sent, executed} = fixture();
  session.sendText('Add both.');
  session.handle({type: 'response.created', response: {id: 'r'}});
  session.handle(done('completed', 'r', [call('a'), call('b')]));
  assert.equal(executed.length, 0);
  const outputs = sent.filter(event => event.item?.type === 'function_call_output');
  assert.deepEqual(outputs.map(event => JSON.parse(event.item.output).error.code), ['parallel_tools', 'parallel_tools']);
});

test('runaway tool loops and unfinished responses fail visibly', () => {
  const {session, deferred} = fixture();
  session.sendText('Loop.');
  assert.throws(() => {
    for (let round = 0; round < 11; round++) {
      session.handle({type: 'response.created', response: {id: `r${round}`}});
      session.handle(done('completed', `r${round}`, [call(`c${round}`)]));
      deferred.shift()();
    }
  }, /Too many consecutive page actions/);
  const other = fixture().session;
  other.sendText('Hi.');
  other.handle({type: 'response.created', response: {id: 'x'}});
  assert.throws(() => other.handle(done('incomplete', 'x')), /did not complete/);
});

test('page events become system context without starting or interrupting a reply', () => {
  const {session, sent, emitted} = fixture();
  session.note('[Page event] The attendee selected BRK244.');
  assert.deepEqual(sent, [{type: 'conversation.item.create', item: {type: 'message', role: 'system',
    content: [{type: 'input_text', text: '[Page event] The attendee selected BRK244.'}]}}]);
  assert.equal(emitted.at(-1).type, 'page.note');
  assert.equal(session.responding, false);
  const idle = fixture({start: false});
  idle.session.note('ignored before the session is ready');
  assert.equal(idle.sent.length, 0);
});
