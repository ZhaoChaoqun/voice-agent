// Offline accuracy of name-search.mjs on the real Ignite speaker directory, with queries perturbed
// the way a recogniser mangles names (phonetic-name-search eval/perturb.py: spelling
// rewrites, word splits, dropped final consonants; seeded). Needs the reference and its venv for
// perturb.py, located as in tests/test_name_search.mjs:
//
//   NAMESEARCH_REFERENCE=/path/to/phonetic-name-search node tools/eval_name_search.mjs
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {EVENT_FILLER, NameSearch} from '../web/name-search.mjs';
import {buildSessionDetails} from '../data/session-details.mjs';

const PYTHON = process.env.NAMESEARCH_PYTHON || new URL('../artifacts/venv-namesearch/bin/python', import.meta.url).pathname;
const REFERENCE = process.env.NAMESEARCH_REFERENCE;
if (!REFERENCE) throw new Error('Set NAMESEARCH_REFERENCE to the phonetic-name-search directory.');
const data = JSON.parse(readFileSync(new URL('../data/name-search-data.json', import.meta.url)));
const people = buildSessionDetails().people.map(({id, name, aliases}) => ({id, name, aliases}));
const names = new NameSearch(data, people, {extraStrongFiller: EVENT_FILLER});

const cases = JSON.parse(execFileSync(PYTHON, ['-c', `
import json, random, sys
sys.path.insert(0, sys.argv[1])
from eval.perturb import perturb_name
people = json.load(sys.stdin)
rng = random.Random(17)
out = []
for p in people:
    out.append({"kind": "full name, 2 ASR edits", "id": p["id"], "query": perturb_name(p["name"], rng, edits=2)})
    out.append({"kind": "in a sentence, 2 edits", "id": p["id"], "query": perturb_name(p["name"], rng, edits=2, carrier=True)})
    out.append({"kind": "surname only, 1 edit", "id": p["id"], "query": perturb_name(p["name"], rng, edits=1, surname_only=True)})
print(json.dumps(out))`, REFERENCE], {input: JSON.stringify(people), maxBuffer: 64 * 1024 * 1024}));

const byKind = new Map();
const started = performance.now();
for (const {kind, id, query} of cases) {
  const result = names.search(query, {topK: 5});
  const ids = result.candidates.map(candidate => candidate.id);
  const stats = byKind.get(kind) || {n: 0, top1: 0, top3: 0, one: 0, oneWrong: 0, multiple: 0, none: 0};
  stats.n++;
  if (ids[0] === id) stats.top1++;
  if (ids.slice(0, 3).includes(id)) stats.top3++;
  if (result.status === 'one_match') { stats.one++; if (result.matches[0].id !== id) stats.oneWrong++; }
  else if (result.status === 'multiple_matches') stats.multiple++;
  else stats.none++;
  byKind.set(kind, stats);
}
const pct = (part, whole) => `${(100 * part / whole).toFixed(1)}%`;
console.log(`${people.length} people, ${cases.length} queries, ${((performance.now() - started) / cases.length).toFixed(1)} ms per search\n`);
console.log('kind                      top-1   top-3   one_match  confidently wrong  ask (multiple)  no_match');
for (const [kind, s] of byKind) {
  console.log(`${kind.padEnd(25)} ${pct(s.top1, s.n).padStart(6)}  ${pct(s.top3, s.n).padStart(6)}  ${pct(s.one, s.n).padStart(9)}  ${pct(s.oneWrong, s.n).padStart(17)}  ${pct(s.multiple, s.n).padStart(14)}  ${pct(s.none, s.n).padStart(8)}`);
}
