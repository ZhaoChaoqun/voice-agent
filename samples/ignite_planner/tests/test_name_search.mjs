// Parity between web/name-search.mjs and the Python matcher it ports, on the real Ignite speaker
// directory. The Python matcher (phonetic-name-search) is not part of this repository;
// point NAMESEARCH_REFERENCE at a checkout of it. It needs rapidfuzz, installed in a private venv:
// python3 -m venv artifacts/venv-namesearch && artifacts/venv-namesearch/bin/pip install "rapidfuzz>=3.9,<4"
// (or set NAMESEARCH_PYTHON). Without both the parity tests skip.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {EVENT_FILLER, NameSearch, jaroWinkler} from '../web/name-search.mjs';
import {buildSessionDetails} from '../data/session-details.mjs';

const PYTHON = process.env.NAMESEARCH_PYTHON || new URL('../artifacts/venv-namesearch/bin/python', import.meta.url).pathname;
const REFERENCE = process.env.NAMESEARCH_REFERENCE || '';
const data = JSON.parse(readFileSync(new URL('../data/name-search-data.json', import.meta.url)));
const people = buildSessionDetails().people.map(({id, name, aliases}) => ({id, name, aliases}));
const names = new NameSearch(data, people);
const available = Boolean(REFERENCE) && existsSync(PYTHON) && existsSync(REFERENCE);

const CURATED = [
  'archer jo', 'archer zhao', 'e when wrong', 'yiwen rong', 'satya nadela', 'sat ya nadella', 'mark russ in ovich',
  'sebastian levert', 'jessica dee oreo', 'sri nair', 'ryan chung', 'bas brekelmans', 'nirav shah', 'shah', 'chris',
  'scott hansel man', 'scott hanselman', 'please find the sessions by judson althoff', 'what is on thursday',
  'i want to check my balance', 'show me voice agents', 'can you find speaker matt landis please',
];

function reference(payload) {
  const program = `
import json, random, sys
sys.path.insert(0, sys.argv[1])
from namesearch import NameIndex, search, search_many
from eval.perturb import perturb_name
from rapidfuzz.distance import JaroWinkler
request = json.load(sys.stdin)
people = request["people"]
index = NameIndex([{"officer_id": p["id"], "full_name": p["name"], "aliases": p["aliases"]} for p in people])
rng = random.Random(20261029)
queries = list(request["curated"])
sample = rng.sample(people, 120)
queries += [p["name"] for p in sample[:40]]
queries += [p["name"].split()[-1] for p in sample[40:60]]
queries += [perturb_name(p["name"], rng, edits=2) for p in sample[60:100]]
queries += [perturb_name(p["name"], rng, edits=2, carrier=True) for p in sample[100:120]]
def shape(result):
    return {"status": result["status"], "normalized_query": result["normalized_query"],
            "joined_words": result.get("joined_words", False),
            "candidates": [[c["officer_id"], c["confidence"]] for c in result["candidates"]],
            "matches": [c["officer_id"] for c in result["matches"]]}
out = {"queries": queries, "results": [shape(search(index, q, top_k=5)) for q in queries]}
out["many"] = [shape(search_many(index, group, top_k=3)) for group in request["many"]]
out["jaro"] = [JaroWinkler.similarity(a, b) for a, b in request["pairs"]]
print(json.dumps(out))`;
  return JSON.parse(execFileSync(PYTHON, ['-c', program, REFERENCE], {input: JSON.stringify(payload), maxBuffer: 64 * 1024 * 1024}));
}

const shape = result => ({status: result.status, normalized_query: result.normalized_query, joined_words: result.joined_words ?? false,
  candidates: result.candidates.map(candidate => [candidate.id, candidate.confidence]), matches: result.matches.map(match => match.id)});
const MANY = [['archer jo', 'archer joe', 'arch your zhao'], ['e when wrong', 'yiwen rong'], ['mark russ in ovich', 'mark russinovich']];
const PAIRS = [['martha', 'marhta'], ['dixon', 'dicksonx'], ['jellyfish', 'smellyfish'], ['rong', 'wrong'], ['a', 'a'], ['ab', 'ba'],
  ...people.slice(0, 60).map((person, index) => [person.name.toLowerCase(), people[(index * 7 + 3) % people.length].name.toLowerCase()])];

test('the port returns the same status, candidates and confidences as the Python matcher', {skip: !available && 'NAMESEARCH_REFERENCE or its venv missing'}, () => {
  const expected = reference({people, curated: CURATED, many: MANY, pairs: PAIRS});
  assert.ok(expected.queries.length >= 140);
  expected.queries.forEach((query, index) => assert.deepEqual(shape(names.search(query, {topK: 5})), expected.results[index], query));
  MANY.forEach((group, index) => assert.deepEqual(shape(names.searchMany(group, {topK: 3})), expected.many[index], group.join(' / ')));
  PAIRS.forEach(([left, right], index) => assert.ok(Math.abs(jaroWinkler(left, right) - expected.jaro[index]) < 1e-12, `${left} ~ ${right}`));
});

test('misheard Ignite speakers are found, sentences without a name are not', () => {
  const names = new NameSearch(data, people, {extraStrongFiller: EVENT_FILLER});
  const person = name => people.find(entry => entry.name === name).id;
  assert.equal(names.search('satya nadela').matches[0].id, person('Satya Nadella'));
  const archer = names.search('archer jo');
  assert.equal(archer.status, 'multiple_matches', 'Ken Archer and Archer Zhao both fit "archer jo"');
  assert.ok(archer.candidates.slice(0, 2).some(match => match.id === person('Archer Zhao')), 'a close row below the floor is a candidate');
  assert.equal(names.search('e when wrong').candidates[0].id, person('Yiwen Rong'));
  assert.equal(names.search('sri nair').candidates[0].id, person('Srikumar Nair'), 'bracketed short names are aliases');
  assert.equal(names.search('shah').status, 'multiple_matches', 'a bare shared surname is never resolved to one person');
  assert.equal(names.search('what is on thursday').status, 'no_match');
  assert.equal(names.search('find sessions by scott hansel man on thursday').matches[0]?.name, 'Scott Hanselman', 'conference words around a split name');
  assert.equal(names.search('i want to check my balance').matches.length, 0);
});
