// Export the planner as the static files the Playground serves under /ignite/: the page files that
// server.mjs serves, the catalog and session details that server.mjs builds per process, and the
// Agent definition the Playground creates with its managed identity. Nothing here needs Node at
// run time.
//
//   node tools/export_hosted.mjs <empty-or-missing-directory>
import {copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {agentDefinition, agentName} from '../agent/agent.mjs';
import {loadCatalog} from '../data/catalog.mjs';
import {buildSessionDetails} from '../data/session-details.mjs';
import {ASSETS} from '../server.mjs';

export function exportHosted(destination) {
  if (existsSync(destination) && readdirSync(destination).length) throw new Error(`${destination} is not empty.`);
  mkdirSync(destination, {recursive: true});
  for (const [name, source] of Object.entries(ASSETS)) copyFileSync(source, `${destination}/${name}`);
  const json = (name, value) => writeFileSync(`${destination}/${name}`, JSON.stringify(value));
  json('catalog.json', loadCatalog());
  json('session-details.json', buildSessionDetails());
  const definition = agentDefinition();
  json('agent.json', {name: agentName(definition), definition});
  return readdirSync(destination).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [destination] = process.argv.slice(2);
  if (!destination) throw new Error('Usage: node tools/export_hosted.mjs <directory>');
  console.log(`Exported ${exportHosted(destination).length} files to ${destination}`);
}
