// The saved agenda as an iCalendar file (.ics, RFC 5545) that Outlook, Google Calendar and Apple
// Calendar import: CRLF line ends, escaped text, lines folded at 75 octets, times in UTC so every
// calendar shows them in its own time zone. Each event's UID is its session instance, so the file
// describes the same events however often it is exported.
const CRLF = '\r\n';
const encoder = new TextEncoder();

const escape = text => String(text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Long lines continue on the next line after CRLF and one space; never split a UTF-8 character.
function fold(line) {
  let out = '', size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) { out += `${CRLF} `; size = 1; }
    out += char;
    size += bytes;
  }
  return out;
}

// sessions: catalog rows; details: /session-details.json sessions (speaker roles), optional.
export function agendaCalendar(sessions, {details = {}, stamp = new Date().toISOString(), name = 'Microsoft Ignite 2026 · My agenda'} = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Microsoft Ignite 2026 voice planner demo//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${escape(name)}`];
  for (const session of sessions.filter(row => row.start && row.end)) {
    const people = details[session.id]?.speakers?.map(person => [person.name, person.job_title, person.company].filter(Boolean).join(', '))
      ?? (session.speaker_names_text ? [session.speaker_names_text] : []);
    const about = [session.description, people.length ? `Speakers: ${people.join('; ')}` : '', `Official session page: ${session.url}`,
      'Saved from the Microsoft Ignite 2026 voice planner demo. This is not a seat reservation.'].filter(Boolean).join('\n\n');
    lines.push('BEGIN:VEVENT', `UID:${session.id}@ignite-2026-voice-planner`, `DTSTAMP:${utc(stamp)}`,
      `DTSTART:${utc(session.start)}`, `DTEND:${utc(session.end)}`, `SUMMARY:${escape(`${session.code} · ${session.title}`)}`,
      `LOCATION:${escape(session.location || '')}`, `DESCRIPTION:${escape(about)}`, `URL:${session.url}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}
