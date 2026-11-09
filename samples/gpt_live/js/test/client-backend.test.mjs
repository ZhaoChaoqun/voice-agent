// Offline tests for the page's client-delegation backend, matching ../python/client_delegation.py.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FALLBACK, answerLocally, currentDatetime, findAddition } from "../public/client-backend.js";

const NOW = new Date("2026-11-09T04:05:06Z");

describe("client backend", () => {
  it("finds the last addition the learner said, in digits or words", () => {
    for (const [said, expected] of [
      ["What is seventeen plus twenty-five?", [17, 25]],
      ["what's 17 + 25", [17, 25]],
      ["Can you add one hundred and five to 20?", [105, 20]],
      ["The sum of 3 and 4, please.", [3, 4]],
      ["One plus one. No wait, what is 2,000 plus 30?", [2000, 30]],
      ["I goed to school.", undefined],
      ["", undefined],
    ]) {
      assert.deepEqual(findAddition(said), expected, said);
    }
  });

  it("answers the time and addition from one clock reading", () => {
    const { answer, facts } = answerLocally("What is 2 plus 3, and what time is it?", NOW);
    const clock = currentDatetime(NOW);
    assert.equal(answer, `2 plus 3 is 5. On this computer it's ${clock.spoken}.`);
    assert.match(facts, /UTC 2026-11-09T04:05:06\+00:00/);
    assert.equal(Date.parse(clock.local_datetime), NOW.getTime());
  });

  it("falls back without facts", () => {
    assert.deepEqual(answerLocally("Let's talk about my weekend.", NOW), { answer: FALLBACK, facts: undefined });
  });
});
