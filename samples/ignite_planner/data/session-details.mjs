// Per-session detail facts that the planner catalog omits (speaker job titles and companies,
// seating and audience) and the speaker directory used for "find sessions by person", joined from
// the public snapshot in this directory. Speaker IDs are only resolved through the speaker
// directory, never by splitting speaker_names_text, and IDs missing from the directory are counted
// rather than guessed (see README.md here).
import {readFileSync} from 'node:fs';

const SNAPSHOT = new URL('./', import.meta.url);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba']);

// Directory names carry invisible characters, credential suffixes, repeated surnames and short
// names in brackets ("Srikumar (Sri) Nair"). Clean the spoken form and keep the bracketed short
// name as an alias ("Sri Nair"); other bracketed notes such as "(LI)" are dropped.
export function cleanSpeakerName(raw) {
  const aliases = [];
  const text = String(raw).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\(([^)]*)\)/g, (_, inner) => {
    if (/^\p{Lu}\p{Ll}+$/u.test(inner.trim())) aliases.push(inner.trim());
    return ' ';
  });
  let tokens = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean).filter(token => !SUFFIXES.has(token.toLowerCase().replace(/\.$/, '')));
  tokens = tokens.filter((token, index) => index === 0 || token.toLowerCase() !== tokens[index - 1].toLowerCase());
  tokens = tokens.map(token => token.length > 2 && token === token.toUpperCase() && /\p{Lu}/u.test(token)
    ? token[0] + token.slice(1).toLowerCase() : token);
  return {name: tokens.join(' '), aliases: aliases.map(alias => [alias, ...tokens.slice(1)].join(' '))};
}

const personKey = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function buildSessionDetails(read = name => JSON.parse(readFileSync(new URL(name, SNAPSHOT), 'utf8'))) {
  const directory = new Map();
  for (const speaker of read('speakers.json').speakers) {
    if (!directory.has(speaker.speaker_id)) directory.set(speaker.speaker_id, speaker);
  }
  const rows = read('sessions.json').sessions;
  // One person per spoken name: the snapshot lists a few people twice under different IDs.
  const people = new Map(), personOf = new Map();
  for (const row of rows) {
    for (const speakerId of row.speaker_ids) {
      const speaker = directory.get(speakerId);
      if (!speaker || personOf.has(speakerId)) continue;
      const {name, aliases} = cleanSpeakerName(speaker.name);
      if (!name) continue;
      const key = personKey(name);
      if (!people.has(key)) people.set(key, {id: speakerId, name, aliases, job_title: speaker.job_title || null,
        company: speaker.company || null, speaker_ids: [], sessions: []});
      const person = people.get(key);
      person.speaker_ids.push(speakerId);
      person.job_title ??= speaker.job_title || null;
      person.company ??= speaker.company || null;
      personOf.set(speakerId, person);
    }
  }
  const sessions = {};
  for (const row of [...rows].sort((a, b) => (a.start_utc || '~').localeCompare(b.start_utc || '~'))) {
    const resolved = row.speaker_ids.map(id => [directory.get(id), personOf.get(id)]).filter(([speaker]) => speaker);
    for (const [, person] of resolved) if (person && !person.sessions.includes(row.instance_id)) person.sessions.push(row.instance_id);
    sessions[row.instance_id] = {
      speakers: resolved.map(([{name, job_title: jobTitle, company}, person]) => ({name, job_title: jobTitle || null,
        company: company || null, person: person?.id ?? null})),
      unresolved_speakers: row.speaker_ids.length - resolved.length,
      seating_experience: row.seating_experience,
      target_audience: row.target_audience,
      source_last_updated_at: row.source_last_updated_at,
    };
  }
  return {sessions, people: [...people.values()]};
}
