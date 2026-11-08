"""Default template personas and privacy-sensitive conversational guidance."""

import json
import re
from pathlib import Path

# Default template definitions in this checkout, not historical backups.
SAMPLES = Path(__file__).resolve().parents[3] / "samples"
# Reject names inherited from the reference templates or the initial migration.
INHERITED_NAMES = {
    "Jamie",
    "Nina",
    "Sam",
    "Ava",
    "Avery",
    "Morgan",
    "Jordan",
    "Sage",
    "Grace",
    "Sophie",
    "Kai",
    "Claire",
    "Atlas",
    "Priya",
    "Max",
    "Lena",
    "Riley",
    "Finn",
    "Emma",
    "Alex",
    "Juno",
    "Marco",
    "Mia",
    "Nova",
}
# The 30 migrated examples occupy the consecutive example5..example34 range.
FIRST_TEMPLATE_NUMBER = 5
TEMPLATE_COUNT = 30


class TestTemplatePersonas:
    def test_personas_are_fresh_unique_and_consistent(self) -> None:
        names = []
        for number in range(FIRST_TEMPLATE_NUMBER, FIRST_TEMPLATE_NUMBER + TEMPLATE_COUNT):
            path = next(SAMPLES.glob(f"example{number}_*/agent.json"))
            definition = json.loads(path.read_text(encoding="utf-8"))["definition"]
            persona = re.search(r"You are ([^,.]+)", definition["instructions"])[1]
            names.append(persona)
            assert persona not in INHERITED_NAMES
            assert f"I'm {persona}" in definition["greeting"]["text"]
            # Every subagent inherits the persona from the shared top-level instructions.
            assert "Never announce internal steps" in definition["instructions"]
            for subagent in definition["subagent_config"]["subagents"]:
                assert subagent["inherit_base_instructions"] is True
                assert "You are " not in subagent.get("instructions", "")
        assert len(names) == len(set(names)) == TEMPLATE_COUNT

    def test_billing_email_confirmation_precedes_lookup(self) -> None:
        path = SAMPLES / "example5_customer_support" / "agent.json"
        definition = json.loads(path.read_text(encoding="utf-8"))["definition"]
        subagents = definition["subagent_config"]["subagents"]
        instructions = next(item for item in subagents if item["id"] == "account_billing")["instructions"]
        assert "say 'at' and 'dot'" in instructions
        assert "until an explicit confirmation in a later caller turn" in instructions
        assert "read the updated address back and wait for confirmation again" in instructions
        assert "Never read back phone numbers" in instructions
