// Browser port of the Python prototype's voice_session.py: client-owned turn scheduling with immediate,
// position-accurate barge-in. The page now owns the Foundry socket, playback and every tool,
// so the playback acknowledgement that crossed the Python bridge is a synchronous call here.

export const GREETING = 'Speak English. Briefly welcome the attendee to Microsoft Ignite and ask what topics interest them and which day they are attending. Use at most two short sentences. Do not call tools.';
const RATE = 24000;
const RESPONSE_TIMEOUT_MS = 120000;
const AUDIO_DELTAS = new Set(['response.output_audio.delta', 'response.audio.delta']);
const TEXT_DONE = new Set(['response.output_audio_transcript.done', 'response.audio_transcript.done',
  'response.output_text.done', 'response.text.done']);

export class VoiceSession {
  // send(event) writes to Foundry; audio is a VoiceAudio; execute(call) runs one function call
  // synchronously; emit(event) informs the page; defer(fn) yields to already-queued events and
  // fail(error) receives errors raised there, outside the caller of handle().
  constructor({send, audio, execute, emit = () => {}, fail = error => { throw error; },
    defer = fn => setTimeout(fn, 0), now = () => Date.now()}) {
    Object.assign(this, {send, audio, execute, emit, fail, defer, now});
    this.ready = false;
    this.responding = false;
    this.responseId = null;
    this.responseDeadline = null;
    this.speaking = false;
    this.pendingTurns = 0;
    this.continuation = false;
    this.toolRounds = 0;
    this.cancelPending = false;
    this.cancelSent = false;
    this.cancelled = new Set();
    this.cancelRequests = new Set();
  }

  expired() {
    return this.responding && this.responseDeadline !== null && this.now() > this.responseDeadline;
  }

  respond(greeting = false) {
    this.responding = true;
    this.responseId = null;
    this.cancelSent = false;
    this.responseDeadline = this.now() + RESPONSE_TIMEOUT_MS;
    this.send({type: 'response.create', response: greeting
      ? {tool_choice: 'none', instructions: GREETING} : {tool_choice: 'auto'}});
  }

  advance() {
    if (this.responding || this.speaking) return;
    if (this.pendingTurns) {
      this.pendingTurns--;
      this.continuation = false;
      this.toolRounds = 0;
      this.respond();
    } else if (this.continuation) {
      this.continuation = false;
      this.respond();
    }
  }

  cancelResponse() {
    if (!this.cancelPending || !this.responseId || this.cancelSent) return;
    if (this.cancelled.size >= 1000) throw new Error('Interruption limit reached. Reconnect.');
    this.cancelled.add(this.responseId);
    this.cancelSent = true;
    const eventId = crypto.randomUUID().replaceAll('-', '');
    this.cancelRequests.add(eventId);
    this.send({type: 'response.cancel', response_id: this.responseId, event_id: eventId});
  }

  // Stop local playback first, then remove the unheard part of every delivered audio item.
  interrupt() {
    this.cancelPending = this.responding;
    this.continuation = false;
    this.cancelResponse();
    const delivered = new Map([...this.audio.items].map(([id, item]) => [id, item.receivedSamples]));
    const items = [...this.audio.items].map(([id, item]) => ({item_id: id, content_index: item.contentIndex}));
    const reports = this.audio.interrupt({response_id: this.responseId, active_response: this.responding, items});
    for (const report of reports) {
      if (report.audio_end_ms < Math.floor(delivered.get(report.item_id) * 1000 / RATE))
        this.send({type: 'conversation.item.truncate', ...report});
    }
    this.emit({type: 'playback.interrupted', response_id: this.responseId, items: reports,
      cut_audio: this.audio.lastInterruptionCutAudio});
  }

  sendText(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000)
      throw new Error('Text must contain 1 to 1000 characters.');
    if (this.responding || this.audio.items.size) this.interrupt();
    this.send({type: 'conversation.item.create', item: {
      type: 'message', role: 'user', content: [{type: 'input_text', text}],
    }});
    this.emit({type: 'input.text', text});
    this.queueTurn('Too many queued requests. Wait for the guide.');
    this.advance();
  }

  // Context the Agent should see on its next turn, such as a session the attendee clicked.
  // It is a system item without response.create, so it never starts or interrupts a reply.
  note(text) {
    if (!this.ready) return;
    this.send({type: 'conversation.item.create', item: {type: 'message', role: 'system', content: [{type: 'input_text', text}]}});
    this.emit({type: 'page.note', text});
  }

  queueTurn(message) {
    this.pendingTurns++;
    if (this.pendingTurns > 8) throw new Error(message);
  }

  toolOutput(call, result) {
    this.send({type: 'conversation.item.create', item: {
      type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result),
    }});
    this.emit({type: 'tool.output_sent', call_id: call.call_id, name: call.name, result});
  }

  handle(event) {
    const kind = event.type;
    if (!this.ready) {
      if (kind === 'session.updated') {
        const session = event.session || {};
        const vad = session.audio?.input?.turn_detection ?? session.turn_detection;
        if (!vad || vad.create_response !== false) throw new Error('Client-owned turn scheduling was not configured.');
        this.ready = true;
        this.emit(event);
        this.emit({type: 'session.ready'});
        this.respond(true);
        return;
      }
      if (kind === 'error') throw new Error(`Azure rejected the voice session: ${event.error?.message || 'unknown error'}`);
      this.emit(event);
      return;
    }
    if (kind === 'input_audio_buffer.speech_started') {
      this.speaking = true;
      if (this.responding || this.audio.items.size) this.interrupt();
    } else if (kind === 'input_audio_buffer.committed') {
      this.speaking = false;
      this.queueTurn('Too many queued utterances. Wait for the guide.');
      this.emit(event);
      this.advance();
      return;
    } else if (kind === 'response.created') {
      this.responding = true;
      this.responseDeadline = this.now() + RESPONSE_TIMEOUT_MS;
      this.responseId = event.response?.id;
      if (typeof this.responseId !== 'string' || !this.responseId)
        throw new Error('Response creation must identify its response.');
      if (this.speaking) this.cancelPending = true;
      this.cancelResponse();
    } else if (kind === 'error') {
      if (event.error?.code === 'response_cancel_not_active' && this.cancelRequests.has(event.error?.event_id)) return;
    } else if (AUDIO_DELTAS.has(kind)) {
      if (this.cancelPending || this.cancelled.has(event.response_id)) return;
      this.emit({...event, played: this.audio.play(event.delta, event)});
      return;
    } else if (TEXT_DONE.has(kind)) {
      if (this.cancelPending || this.cancelled.has(event.response_id)) return;
    } else if (kind === 'response.done') {
      this.responseDone(event);
      return;
    }
    this.emit(event);
  }

  responseDone(event) {
    const response = event.response || {};
    if (this.cancelled.has(response.id) && !this.cancelPending) return;
    const calls = (response.output || []).filter(item => item.type === 'function_call');
    if (this.cancelPending) {
      if (response.status === 'completed') {
        for (const call of calls) this.toolOutput(call, {ok: false, error: {
          code: 'interrupted', message: 'The user interrupted before this action executed. No action was performed.',
        }});
      }
      if (response.id) this.cancelled.add(response.id);
      this.responding = false;
      this.cancelPending = false;
      this.responseId = null;
      this.emit(event);
      this.advance();
      return;
    }
    this.responding = false;
    if (response.status !== 'completed') throw new Error('The response did not complete; no new action was executed.');
    this.emit(event);
    if (!calls.length) {
      this.advance();
      return;
    }
    this.toolRounds++;
    if (this.toolRounds > 10) throw new Error('Too many consecutive page actions.');
    for (const call of calls) {
      this.toolOutput(call, calls.length === 1 ? this.execute(call) : {
        ok: false, error: {code: 'parallel_tools', message: 'Call one page action at a time. Nothing was executed.'},
      });
    }
    this.continuation = true;
    // Speech already queued during a page action takes priority over the continuation.
    this.defer(() => {
      try { this.advance(); } catch (error) { this.fail(error); }
    });
  }
}
