// Client delegation: the page is GPT Live's backend, mirroring ../python/client_delegation.py.
// When GPT Live delegates, the page answers from what the learner just said: it reads this
// computer's clock, or adds two whole numbers. It replies on the same Live session with thinking
// (unspoken facts) and commentary (what GPT Live says), both tied to the delegation ID.

export const FALLBACK =
  "This app can only tell the time on this computer or add two whole numbers. " +
  "Let's continue the English lesson.";
const TIME_WORDS = /\b(time|date|day|today|clock)\b/;
const UNITS = Object.fromEntries(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen"
    .split(" ")
    .map((word, value) => [word, value]),
);
const TENS = Object.fromEntries(
  "twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, index) => [word, 10 * (index + 2)]),
);
const isNumberWord = (word) => word in UNITS || word in TENS;

/** Splits a transcript into words, turning digits and spelled-out numbers into numbers. */
export function wordsAndNumbers(text) {
  const words = text.toLowerCase().replaceAll("-", " ").match(/\d[\d,]*|[a-z]+|\+/g) ?? [];
  const tokens = [];
  let total = 0;
  let current = 0;
  let inNumber = false;
  const finishNumber = () => {
    if (inNumber) tokens.push(total + current);
    total = current = 0;
    inNumber = false;
  };
  words.forEach((word, index) => {
    if (/^\d/.test(word)) {
      finishNumber();
      tokens.push(Number(word.replaceAll(",", "")));
    } else if (isNumberWord(word)) {
      current += (UNITS[word] ?? 0) + (TENS[word] ?? 0);
      inNumber = true;
    } else if (word === "hundred" && inNumber) {
      current *= 100;
    } else if (word === "thousand" && inNumber) {
      total += current * 1000;
      current = 0;
    } else if (word === "and" && inNumber && words[index - 1] === "hundred" && isNumberWord(words[index + 1] ?? "")) {
      // "one hundred and five"
    } else {
      finishNumber();
      tokens.push(word);
    }
  });
  finishNumber();
  return tokens;
}

/** The last "A plus B", "add A and B", or "sum of A and B" the learner said, if any. */
export function findAddition(text) {
  const tokens = wordsAndNumbers(text);
  const isNumber = (token) => typeof token === "number";
  let found;
  tokens.forEach((token, index) => {
    const [a, b, c, d, e] = tokens.slice(index, index + 5);
    if (isNumber(a) && (b === "plus" || b === "+") && isNumber(c)) found = [a, c];
    else if (a === "add" && isNumber(b) && (c === "and" || c === "to") && isNumber(d)) found = [b, d];
    else if (a === "sum" && b === "of" && isNumber(c) && d === "and" && isNumber(e)) found = [c, e];
  });
  return found;
}

/** Reads this computer's clock once. */
export function currentDatetime(now = new Date()) {
  const pad = (value) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const local =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(offset / 60)}:${pad(offset % 60)}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const spoken = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return {
    spoken,
    local_datetime: local,
    timezone,
    utc_datetime: now.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
  };
}

/** This page's whole backend: returns { answer, facts } where facts may be undefined. */
export function answerLocally(learnerSaid, now = new Date()) {
  const answers = [];
  const facts = [];
  const addition = findAddition(learnerSaid);
  if (addition) {
    const [a, b] = addition;
    answers.push(`${a} plus ${b} is ${a + b}.`);
    facts.push(`The client app computed ${a} + ${b} = ${a + b}.`);
  }
  if (TIME_WORDS.test(learnerSaid.toLowerCase())) {
    const clock = currentDatetime(now);
    answers.push(`On this computer it's ${clock.spoken}.`);
    facts.push(`Client computer clock: local ${clock.local_datetime} (${clock.timezone}), UTC ${clock.utc_datetime}.`);
  }
  if (!answers.length) return { answer: FALLBACK, facts: undefined };
  return { answer: answers.join(" "), facts: facts.join(" ") };
}

/**
 * Answers a client delegation on the same Live session. `connection` is the SDK connection;
 * report(delegationId, title, status, delta) updates the page.
 */
export async function answerClientDelegation(connection, delegationId, learnerSaid, report) {
  const { answer, facts } = answerLocally(learnerSaid);
  report(delegationId, "Client delegation → this page", `Answered locally from: ${learnerSaid || "(no transcript yet)"}`, answer);
  // Unspoken context: GPT Live may use it but does not read it aloud.
  if (facts) await connection.appendThinking(facts, { delegationId });
  // GPT Live says this to the learner and finishes the delegation.
  await connection.appendCommentary(answer, { delegationId });
}
