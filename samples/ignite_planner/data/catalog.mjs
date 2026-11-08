// The catalog this planner serves to the page and describes to the Agent: catalog.json (built from
// the public snapshot by tools/session_catalog.py) plus the official session descriptions saved in
// descriptions.json by tools/add_descriptions.py. The version hash covers the descriptions, so the
// Agent's catalog version always matches what the page serves.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';

const HERE = new URL('./', import.meta.url);
const readJson = url => JSON.parse(readFileSync(url, 'utf8'));

export function loadCatalog({dir = HERE} = {}) {
  const catalog = readJson(new URL('catalog.json', dir));
  const file = new URL('descriptions.json', dir);
  const descriptions = existsSync(file) ? readJson(file).descriptions : {};
  const sessions = catalog.sessions.map(session => ({...session, description: descriptions[session.id] || null}));
  const version = createHash('sha256').update(catalog.version).update(JSON.stringify(sessions.map(session => session.description)))
    .digest('hex');
  return {...catalog, sessions, version, descriptions_count: sessions.filter(session => session.description).length};
}
