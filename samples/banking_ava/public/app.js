const $ = id => document.getElementById(id);
let call = null;
const captions = new Map();
const emptyInbox = $('inbox').innerHTML;

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function status(title, detail, phase = '') {
  $('status').textContent = title;
  $('status-detail').textContent = detail;
  $('voice-stage').className = `voice-stage ${phase}`;
}
function authenticated(yes) {
  $('access-form').hidden = yes;
  $('controls').hidden = !yes;
  $('sign-out').hidden = !yes;
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) authenticated(false);
    const data = await response.json();
    throw new Error(data.error || 'The demo could not complete that request.');
  }
  return response.json();
}
$('access-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('access-form').querySelector('button');
  button.disabled = true;
  try {
    await api('/api/login', {code: $('access-code').value});
    $('access-code').value = '';
    authenticated(true);
    notice('');
    $('start').focus();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
});
$('sign-out').onclick = async () => {
  stop();
  try {
    await api('/api/logout', {});
    authenticated(false);
    resetContent();
  } catch (error) { notice(error.message); }
};

function resetContent() {
  captions.clear();
  $('transcript').replaceChildren();
  $('inbox').innerHTML = emptyInbox;
  $('inbox-count').textContent = '0 items';
}
function caption(id, role, text, append = false) {
  if (!text) return;
  $('empty-transcript')?.remove();
  const container = $('transcript');
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
  let node = captions.get(id);
  if (!node) {
    const row = document.createElement('p');
    row.className = `message ${role}`;
    const label = document.createElement('strong');
    label.textContent = role === 'user' ? 'YOU' : 'AVA';
    node = document.createElement('span');
    row.append(label, node);
    container.append(row);
    captions.set(id, node);
    if (captions.size > 200) {
      const first = captions.keys().next().value;
      captions.get(first).parentElement.remove();
      captions.delete(first);
    }
  }
  node.textContent = append ? node.textContent + text : text;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}
function renderState(state) {
  if (!Array.isArray(state?.inbox)) return;
  $('inbox-count').textContent = `${state.inbox.length} ${state.inbox.length === 1 ? 'item' : 'items'}`;
  if (!state.inbox.length) return;
  $('inbox').replaceChildren();
  for (const item of state.inbox) {
    const card = document.createElement('article');
    card.className = 'inbox-item';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const detail = document.createElement('p');
    detail.textContent = item.detail;
    card.append(title, detail);
    if (item.comparison) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Read your comparison checklist';
      details.append(summary);
      for (const row of item.comparison.items) {
        const element = document.createElement('div');
        element.className = 'comparison-row';
        const label = document.createElement('strong');
        label.textContent = row.label;
        const text = document.createElement('p');
        text.textContent = row.detail;
        element.append(label, text);
        details.append(element);
      }
      const note = document.createElement('p');
      note.textContent = item.comparison.note;
      details.append(note);
      card.append(details);
    }
    $('inbox').append(card);
  }
}
function updateInput(session) {
  const enabled = call === session && session.ready && !session.busy;
  $('message').disabled = !enabled;
  $('send').disabled = !enabled || !$('message').value.trim();
}
function markReady(session) {
  if (call !== session || !session.configured ||
      (session.mode === 'webrtc' && session.peer.connectionState !== 'connected')) return;
  session.ready = true;
  clearTimeout(session.timeout);
  clearTimeout(session.disconnected);
  session.mic?.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
  $('connection').textContent = 'Connected to AVA';
  $('connection').className = 'connection active';
  status(session.busy ? 'AVA is here with you.' : 'Go ahead, I’m listening.',
    session.mode === 'webrtc' ? 'Speak naturally. You can interrupt at any time.' :
      session.audio ? 'Type below. AVA will reply out loud.' : 'Type below. Audio is unavailable in this browser.',
    session.busy ? 'speaking' : 'listening');
  updateInput(session);
}
function stop(message) {
  const session = call;
  call = null;
  if (session) {
    clearTimeout(session.timeout);
    clearTimeout(session.disconnected);
    clearInterval(session.clock);
    session.abort.abort();
    session.mic?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    session.peer?.close();
    session.channel?.close();
    if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({type: 'session.close'}));
    session.ws?.close();
    for (const node of session.audioNodes || []) { node.onended = null; node.stop(); node.disconnect(); }
    session.audio?.close().catch(error => console.warn('Audio cleanup:', error.name));
  }
  $('remote-audio').pause();
  $('remote-audio').srcObject = null;
  $('enable-audio').hidden = true;
  $('start-controls').hidden = false;
  $('call-controls').hidden = true;
  $('text-form').hidden = true;
  $('session-meta').hidden = true;
  $('mute').setAttribute('aria-pressed', 'false');
  $('mute').querySelector('span').textContent = 'Mute';
  $('connection').textContent = session ? 'Conversation ended' : 'Ready when you are';
  $('connection').className = 'connection';
  document.body.classList.remove('in-call');
  status(session ? 'A little clearer, hopefully.' : "Let's talk it through.",
    session ? 'Your demo notes stay here until your next conversation.' : 'No menus. No waiting music. Just a conversation.');
  if (message) notice(message);
}
function fail(session, error) {
  if (call !== session) return;
  stop(error.message || 'The connection ended. Please try again.');
}
async function playRemote(session) {
  try {
    await $('remote-audio').play();
    if (call === session) $('enable-audio').hidden = true;
  } catch (error) {
    if (call === session) {
      console.warn('Playback needs a gesture:', error.name);
      $('enable-audio').hidden = false;
    }
  }
}
function pcm(session, base64) {
  if (!session.audio) return;
  const binary = atob(base64);
  if (binary.length % 2) throw new Error('Incomplete audio was received. Please reconnect.');
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = binary.charCodeAt(2 * i) | binary.charCodeAt(2 * i + 1) << 8;
    samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  const buffer = session.audio.createBuffer(1, samples.length, 24000);
  buffer.copyToChannel(samples, 0);
  const node = session.audio.createBufferSource();
  node.buffer = buffer;
  node.connect(session.audio.destination);
  session.audioNodes.add(node);
  node.onended = () => { session.audioNodes.delete(node); node.disconnect(); };
  const start = Math.max(session.audio.currentTime + 0.03, session.nextAudio || 0);
  if (start - session.audio.currentTime > 60) throw new Error('Audio playback fell behind. Please reconnect.');
  node.start(start);
  session.nextAudio = start + buffer.duration;
}
async function handle(session, event) {
  if (call !== session) return;
  const kind = event.type;
  if (kind === 'demo.error') throw new Error(event.message);
  if (kind === 'demo.notice') { notice(event.message); return; }
  if (kind === 'demo.ready') {
    session.configured = true;
    renderState(event.state);
    markReady(session);
  } else if (kind === 'rtc.call.sdp.created') {
    await session.peer.setRemoteDescription({type: 'answer', sdp: event.sdp_answer});
  } else if (kind === 'demo.state') {
    renderState(event.state);
  } else if (kind === 'demo.busy') {
    session.busy = true;
    status('AVA is thinking with you.', 'One moment while we work through that.', 'speaking');
    updateInput(session);
  } else if (kind === 'demo.idle') {
    session.busy = false;
    markReady(session);
  } else if (kind === 'input_audio_buffer.speech_started') {
    status('Go ahead, I’m listening.', 'Take your time. I’m here.', 'listening');
  } else if (kind === 'input_audio_buffer.speech_stopped') {
    status('Let’s work through that.', 'AVA is preparing a response.', 'speaking');
  } else if (kind === 'demo.user_text') {
    caption(`user-${crypto.randomUUID()}`, 'user', event.text);
  } else if (kind === 'conversation.item.input_audio_transcription.completed') {
    caption(event.item_id, 'user', event.transcript);
  } else if (kind === 'conversation.item.input_audio_transcription.failed') {
    notice('A spoken turn could not be captioned. Please repeat any important amount.');
  } else if (kind.endsWith('transcript.delta') || kind === 'response.text.delta' || kind === 'response.output_text.delta') {
    caption(event.item_id || event.response_id, 'assistant', event.delta, true);
    status('AVA is speaking.', 'You can interrupt or ask a follow-up.', 'speaking');
  } else if (kind.endsWith('transcript.done') || kind === 'response.text.done' || kind === 'response.output_text.done') {
    caption(event.item_id || event.response_id, 'assistant', event.transcript || event.text);
  } else if (kind === 'response.audio.delta' || kind === 'response.output_audio.delta') {
    pcm(session, event.delta);
  }
}
function waitIce(session) {
  const peer = session.peer;
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', change);
      session.abort.signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const abort = () => finish(new Error('Conversation cancelled.'));
    const timer = setTimeout(() => finish(new Error('Audio connection timed out. Try another network or use text.')), 12000);
    peer.addEventListener('icegatheringstatechange', change);
    session.abort.signal.addEventListener('abort', abort, {once: true});
    if (session.abort.signal.aborted) abort();
  });
}
function socket(session) {
  const url = new URL('/api/voice', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('transport', session.mode);
  const ws = session.ws = new WebSocket(url);
  let events = Promise.resolve();
  ws.onmessage = event => {
    events = events.then(() => handle(session, JSON.parse(event.data))).catch(error => fail(session, error));
  };
  ws.onerror = () => fail(session, new Error('Could not connect. Your access may have expired, or the demo may be busy. Reload and try again.'));
  ws.onclose = () => {
    events.finally(() => {
      if (call === session) fail(session, new Error('The connection ended. Your notes are still here. Start again when ready.'));
    });
  };
  return new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.addEventListener('error', () => reject(new Error('Could not open the voice connection.')), {once: true});
    ws.addEventListener('close', () => reject(new Error('The voice connection closed.')), {once: true});
  });
}
async function start(mode) {
  if (call) return;
  const session = {mode, ready: false, configured: false, busy: true, muted: false,
    abort: new AbortController(), audioNodes: new Set(), started: Date.now()};
  call = session;
  resetContent();
  notice('');
  document.body.classList.add('in-call');
  $('start-controls').hidden = true;
  $('call-controls').hidden = false;
  $('mute').hidden = mode === 'text';
  $('text-form').hidden = false;
  $('session-meta').hidden = false;
  $('mode-label').textContent = mode === 'text' ? 'TEXT + VOICE' : 'LIVE VOICE';
  $('timer').textContent = '00:00';
  $('connection').textContent = 'Connecting';
  $('message').value = '';
  updateInput(session);
  status('Hello starts here.', mode === 'webrtc' ? 'Allow microphone access when your browser asks.' : 'Connecting your conversation.');
  session.timeout = setTimeout(() => fail(session, new Error('Connection timed out. Check microphone permissions, or try text.')), 60000);
  session.clock = setInterval(() => {
    const seconds = Math.floor((Date.now() - session.started) / 1000);
    $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);
  try {
    if (mode === 'text') {
      // The context is unlocked in the click gesture; browser resamples 24 kHz output.
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) {
        session.audio = new Audio();
        await session.audio.resume();
        if (call !== session) return;
        session.audio.onstatechange = () => {
          if (call === session && session.audio.state === 'suspended') $('enable-audio').hidden = false;
        };
      } else {
        notice('This browser does not support audio playback. You can continue with text replies.');
        $('mode-label').textContent = 'TEXT ONLY';
      }
      await socket(session);
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error('Voice needs Safari or Chrome on HTTPS, with microphone access. You can still try text.');
    const mic = await navigator.mediaDevices.getUserMedia({audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }});
    if (call !== session) { mic.getTracks().forEach(track => track.stop()); return; }
    session.mic = mic;
    mic.getTracks().forEach(track => {
      track.enabled = false;
      track.onended = () => fail(session, new Error('Microphone access ended. Please start again.'));
    });
    const peer = session.peer = new RTCPeerConnection();
    mic.getTracks().forEach(track => peer.addTrack(track, mic));
    session.channel = peer.createDataChannel('voice-live-events');
    peer.ontrack = event => {
      if (call !== session) return;
      $('remote-audio').srcObject = event.streams[0] || new MediaStream([event.track]);
      playRemote(session);
    };
    peer.onconnectionstatechange = () => {
      if (call !== session) return;
      if (peer.connectionState === 'connected') markReady(session);
      if (peer.connectionState === 'failed') fail(session, new Error('Audio could not connect on this network. Try Wi-Fi/mobile data or use text.'));
      if (peer.connectionState === 'disconnected') {
        session.ready = false;
        mic.getTracks().forEach(track => { track.enabled = false; });
        updateInput(session);
        status('Reconnecting...', 'Your audio connection was interrupted.');
        clearTimeout(session.disconnected);
        session.disconnected = setTimeout(() => fail(session, new Error('Audio connection lost. Please start again.')), 10000);
      }
    };
    await socket(session);
    if (call !== session) return;
    await peer.setLocalDescription(await peer.createOffer());
    await waitIce(session);
    if (call === session) session.ws.send(JSON.stringify({type: 'rtc.call.sdp.create', sdp_offer: peer.localDescription.sdp}));
  } catch (error) {
    if (error.name === 'NotAllowedError') error = new Error('Microphone permission was denied. Allow it in Safari’s website settings, or use text.');
    fail(session, error);
  }
}
$('start').onclick = () => start('webrtc');
$('start-text').onclick = () => start('text');
$('end').onclick = () => stop();
$('enable-audio').onclick = async () => {
  const session = call;
  if (!session) return;
  if (session.mode === 'webrtc') return playRemote(session);
  try { await session.audio.resume(); $('enable-audio').hidden = true; }
  catch (error) { fail(session, error); }
};
$('mute').onclick = () => {
  if (!call) return;
  call.muted = !call.muted;
  call.mic?.getAudioTracks().forEach(track => { track.enabled = call.ready && !call.muted; });
  $('mute').setAttribute('aria-pressed', String(call.muted));
  $('mute').querySelector('span').textContent = call.muted ? 'Unmute' : 'Mute';
};
$('message').oninput = () => { if (call) updateInput(call); };
$('text-form').onsubmit = event => {
  event.preventDefault();
  if (!call?.ready || call.busy || call.ws.readyState !== WebSocket.OPEN) return;
  const text = $('message').value.trim();
  if (!text) return;
  if (call.mode === 'text' && call.audio && call.nextAudio > call.audio.currentTime) {
    notice('Let AVA finish speaking before sending your next message.');
    return;
  }
  notice('');
  call.ws.send(JSON.stringify({type: 'demo.text', text}));
  call.busy = true;
  $('message').value = '';
  updateInput(call);
};
window.addEventListener('pagehide', () => stop());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && call) stop('Conversation paused for privacy when you left the page. Tap Talk to AVA to start again.');
});
api('/api/config').then(() => authenticated(true)).catch(error => {
  authenticated(false);
  if (!error.message.includes('presenter access code')) notice(error.message);
});
