#!/usr/bin/env python3
"""Talk to a GPT Live agent whose delegations this app answers itself (client delegation)."""

import re
from datetime import datetime, timezone

from azure.ai.projects.models import VoiceAgentLiveClientDelegation, VoiceAgentLiveDefinition

import response_delegation as sample
from response_delegation import (
    ENGLISH_TEACHER_INSTRUCTIONS,
    LESSON_CONTEXT,
    lesson_greeting,
    lesson_inputs,
    live_audio,
    required,
)

CLIENT_POLICY = (
    " Delegation policy: this app is your backend. It reads the current date and time "
    "from the learner's computer and adds two whole numbers. For any question about the "
    "current date or time, or any request to add two numbers, always delegate before "
    "answering, then say the app's commentary naturally. Do not guess the time or "
    "calculate yourself. Handle greetings and English practice yourself; do not delegate them."
)
FALLBACK = (
    "This app can only tell the time on this computer or add two whole numbers. "
    "Let's continue the English lesson."
)
TIME_WORDS = re.compile(r"\b(time|date|day|today|clock)\b")
UNITS = {
    word: value
    for value, word in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen "
        "fourteen fifteen sixteen seventeen eighteen nineteen".split()
    )
}
TENS = {
    word: 10 * value
    for value, word in enumerate(
        "twenty thirty forty fifty sixty seventy eighty ninety".split(), start=2
    )
}


def agent_definition():
    """A GPT Live English teacher whose delegations go to this app, not a Foundry backend."""
    return VoiceAgentLiveDefinition(
        model=required("GPT_LIVE_DEPLOYMENT"),
        model_type="self_deployed",
        instructions=ENGLISH_TEACHER_INSTRUCTIONS + LESSON_CONTEXT + CLIENT_POLICY,
        greeting=lesson_greeting(),
        structured_inputs=lesson_inputs(),
        audio=live_audio(),
        # GPT Live reports each delegation as target "client" and waits for this app's
        # commentary tied to the delegation ID.
        delegation=VoiceAgentLiveClientDelegation(),
        store=True,
    )


def words_and_numbers(text):
    """Split a transcript into words, turning digits and spelled-out numbers into ints."""
    words = re.findall(r"\d[\d,]*|[a-z]+|\+", text.lower().replace("-", " "))
    tokens = []
    total = current = 0
    in_number = False

    def finish_number():
        nonlocal total, current, in_number
        if in_number:
            tokens.append(total + current)
        total = current = 0
        in_number = False

    for index, word in enumerate(words):
        if word[0].isdigit():
            finish_number()
            tokens.append(int(word.replace(",", "")))
        elif word in UNITS or word in TENS:
            current += UNITS.get(word, 0) + TENS.get(word, 0)
            in_number = True
        elif word == "hundred" and in_number:
            current *= 100
        elif word == "thousand" and in_number:
            total += current * 1000
            current = 0
        elif (
            word == "and"
            and in_number
            and words[index - 1] == "hundred"
            and index + 1 < len(words)
            and (words[index + 1] in UNITS or words[index + 1] in TENS)
        ):
            continue  # "one hundred and five"
        else:
            finish_number()
            tokens.append(word)
    finish_number()
    return tokens


def find_addition(text):
    """The last 'A plus B', 'add A and B', or 'sum of A and B' the learner said, if any."""
    tokens = words_and_numbers(text)
    found = None
    for index in range(len(tokens)):
        match tokens[index : index + 5]:
            case [int() as a, "plus" | "+", int() as b, *_]:
                found = (a, b)
            case ["add", int() as a, "and" | "to", int() as b, *_]:
                found = (a, b)
            case ["sum", "of", int() as a, "and", int() as b, *_]:
                found = (a, b)
    return found


def current_datetime(now=None):
    """Read this computer's clock once."""
    utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    local = utc.astimezone()
    spoken = (
        f"{local:%A, %B} {local.day}, {local.year}, at "
        f"{local.hour % 12 or 12}:{local:%M} {local:%p} ({local.tzname()})"
    )
    return {
        "spoken": spoken,
        "local_datetime": local.isoformat(timespec="seconds"),
        "timezone": local.tzname(),
        "utc_datetime": utc.isoformat(timespec="seconds"),
    }


def answer_locally(learner_said, now=None):
    """This app's whole backend: return (spoken answer, unspoken facts or None)."""
    answers, facts = [], []
    addition = find_addition(learner_said)
    if addition:
        a, b = addition
        answers.append(f"{a} plus {b} is {a + b}.")
        facts.append(f"The client app computed {a} + {b} = {a + b}.")
    if TIME_WORDS.search(learner_said.lower()):
        clock = current_datetime(now)
        answers.append(f"On this computer it's {clock['spoken']}.")
        facts.append(
            f"Client computer clock: local {clock['local_datetime']} "
            f"({clock['timezone']}), UTC {clock['utc_datetime']}."
        )
    if not answers:
        return FALLBACK, None
    return " ".join(answers), " ".join(facts)


class ClientExecutor:
    """Answer client delegations on the same Live session, tied to their delegation IDs."""

    async def __call__(self, connection, delegation_id, learner_said, transcript):
        answer, facts = answer_locally(learner_said)
        transcript.update_agent_activity(
            delegation_id,
            title="Client delegation → this app",
            status=f"Answered locally from: {learner_said or '(no transcript yet)'}",
            delta=answer,
        )
        if facts:
            # Unspoken context: GPT Live may use it but does not read it aloud.
            await connection.session.thinking.append(delegation_id=delegation_id, content=facts)
        # GPT Live says this to the learner and finishes the delegation.
        await connection.session.commentary.append(delegation_id=delegation_id, content=answer)


async def main(*, auto_delete=False, **lesson):
    # Always create a client-delegation agent; AGENT_NAME is for response_delegation.py.
    await sample.main(
        auto_delete=auto_delete,
        definition_factory=agent_definition,
        reuse_agent_name=False,
        client_executor=ClientExecutor(),
        **lesson,
    )


if __name__ == "__main__":
    sample.run_cli(main, description=__doc__)
