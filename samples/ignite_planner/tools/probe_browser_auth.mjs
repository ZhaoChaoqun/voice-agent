// Probes which credential transports a browser-style WebSocket (no custom headers) can use
// against the Foundry Voice Agent realtime route. Prints outcomes only, never the token.
// Usage: node tools/probe_browser_auth.mjs <project-endpoint> <agent-name>
import {execFileSync} from 'node:child_process';

const [endpoint, agent] = process.argv.slice(2);
if (!endpoint || !agent) throw new Error('Usage: node tools/probe_browser_auth.mjs <project-endpoint> <agent-name>');
const token = execFileSync('az', ['account', 'get-access-token', '--resource', 'https://ai.azure.com',
  '--query', 'accessToken', '-o', 'tsv'], {encoding: 'utf8'}).trim();
const base = `${endpoint.replace(/^https:/, 'wss:').replace(/\/$/, '')}/agents/${encodeURIComponent(agent)}/endpoint/protocols/voice`;

function attempt(label, url, protocols) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = new WebSocket(url, protocols);
    const finish = outcome => { resolve({label, ...outcome, ms: Date.now() - started}); };
    const timer = setTimeout(() => { socket.close(); finish({result: 'timeout'}); }, 20000);
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      clearTimeout(timer);
      socket.close();
      finish({result: 'opened', selected_protocol: socket.protocol, first_event: data.type,
        error: data.type === 'error' ? data.error?.message : undefined});
    };
    socket.onerror = event => { clearTimeout(timer); finish({result: 'error', detail: event.message || String(event.error?.message || '')}); };
  });
}

const cases = [
  ['no credential', `${base}?api-version=v1`, ['realtime']],
  ['no credential, api-version 2025-11-15-preview', `${base}?api-version=2025-11-15-preview`, ['realtime']],
  ['invalid bearer, api-version 2025-11-15-preview', `${base}?api-version=2025-11-15-preview`, ['realtime', 'authorization.bearer.invalid']],
  ['subprotocol bearer, api-version v1', `${base}?api-version=v1`, ['realtime', `authorization.bearer.${token}`]],
  ['subprotocol bearer, api-version 2025-11-15-preview', `${base}?api-version=2025-11-15-preview`, ['realtime', `authorization.bearer.${token}`]],
];
for (const [label, url, protocols] of cases) console.log(JSON.stringify(await attempt(label, url, protocols)));
