// In-tab version of the Python prototype's conversation_log.py: the same text/tool records, kept in page
// memory and downloadable as JSONL. Raw audio and credentials are never recorded.

const EXCLUDED = new Set(['audio', 'delta', 'authorization', 'api_key', 'api-key', 'access_token', 'client_secret']);
const TEXT_DONE = new Set(['response.output_audio_transcript.done', 'response.audio_transcript.done',
  'response.output_text.done', 'response.text.done']);

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([key]) => !EXCLUDED.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitize(item)]));
  return value;
}

function outputItem(item) {
  const result = Object.fromEntries(['type', 'id', 'role', 'name', 'call_id', 'arguments', 'output', 'error']
    .filter(key => key in item).map(key => [key, item[key]]));
  if (item.content) result.content = item.content.map(part => Object.fromEntries(
    ['type', 'text', 'transcript'].filter(key => key in part).map(key => [key, part[key]])));
  return result;
}

export class ConversationLog {
  constructor(metadata) {
    this.name = `session-${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}-${crypto.randomUUID().slice(0, 12)}.jsonl`;
    this.records = [];
    this.record('session.started', {...metadata, audio_recorded: false, scope: 'in-tab text and tool audit'});
  }

  record(type, data) {
    this.records.push({timestamp: new Date().toISOString(), sequence: this.records.length + 1, type, data: sanitize(data)});
  }

  protocol(event) {
    const kind = event.type || '';
    const common = Object.fromEntries(['response_id', 'item_id', 'content_index', 'call_id']
      .filter(key => key in event).map(key => [key, event[key]]));
    if (kind === 'input.text') this.record('user.text', {text: event.text});
    else if (kind === 'session.created' || kind === 'session.updated')
      this.record(kind, {session_id: event.session?.id, conversation_id: event.conversation_id || event.session?.conversation_id});
    else if (kind.startsWith('conversation.item.input_audio_transcription.') && ['completed', 'failed'].includes(kind.split('.').pop()))
      this.record(kind, {...common, transcript: event.transcript, error: event.error});
    else if (TEXT_DONE.has(kind)) this.record('assistant.generated_text', {...common, text: event.transcript || event.text || ''});
    else if (kind === 'response.created') this.record(kind, {response_id: event.response?.id});
    else if (kind === 'response.done') this.record(kind, {response_id: event.response?.id, status: event.response?.status,
      output: (event.response?.output || []).map(outputItem)});
    else if (['playback.interrupted', 'input_audio_buffer.speech_started', 'input_audio_buffer.committed', 'error'].includes(kind))
      this.record(kind, {...common, items: event.items, error: event.error});
  }

  jsonl() {
    return this.records.map(record => JSON.stringify(record)).join('\n') + '\n';
  }
}
