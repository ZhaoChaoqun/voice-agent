"""Grounded, per-call banking fixtures. No bank or document-upload integration."""

import json
from dataclasses import dataclass, field

MODEL = "gpt-realtime-2.1"
VOICE = "en-US-Harper:MAI-Voice-2.1-Flash"


def tools():
    specs = [
        ("get_demo_account", "Read the fictional, pre-verified Lehmann scenario. Not real identity verification.", {}),
        ("submit_demo_overdraft",
         "Save a simulated overdraft request ONLY after explicit customer consent to the total limit. Never approves credit.",
         {"amount_eur": {"type": "integer", "minimum": 2001, "maximum": 10000},
          "customer_confirmed": {"type": "boolean"}}),
        ("get_account_comparison", "Read the comparison checklist. Current product terms are unavailable; do not invent benefits.", {}),
        ("send_demo_comparison",
         "Add the comparison checklist to this call's demo inbox ONLY after the customer agrees. Does not send email or switch accounts.",
         {"customer_confirmed": {"type": "boolean"}}),
    ]
    return [{"type": "function", "name": name, "description": description,
             "parameters": {"type": "object", "properties": props, "required": list(props),
                            "additionalProperties": False}} for name, description, props in specs]


def comparison():
    return {
        "title": "KlassikKonto / PremiumKonto",
        "status": "Current terms need verification",
        "verified_prices_available": False,
        "items": [
            {"label": "Monthly account fee", "detail": "Compare the current price list for both accounts."},
            {"label": "Overdraft interest", "detail": "Check both current rates and your typical borrowing; savings are not guaranteed."},
            {"label": "Travel & credit card", "detail": "Confirm card inclusion, withdrawal allowances, exchange and ATM operator charges."},
            {"label": "Insurance", "detail": "Verify any included cover, eligibility, exclusions and activation requirements."},
        ],
        "note": "Information checklist only, not a quote or financial recommendation. No account change.",
    }


@dataclass
class DemoBank:
    application: dict | None = None
    inbox: list = field(default_factory=list)
    results: dict = field(default_factory=dict)

    def snapshot(self):
        return {"account": "KlassikKonto", "current_limit_eur": 2000,
                "application": self.application, "inbox": self.inbox, "simulated": True}

    def execute(self, call):
        call_id = call.get("call_id")
        name = call.get("name")
        raw = call.get("arguments", "")
        fingerprint = (name, raw)
        if not isinstance(call_id, str) or not call_id or len(call_id) > 256:
            return {"ok": False, "error": "Missing valid tool call ID."}
        if call_id in self.results:
            previous, result = self.results[call_id]
            return result if previous == fingerprint else {"ok": False, "error": "Conflicting repeated tool call."}
        try:
            if not isinstance(raw, str) or len(raw) > 4096:
                raise ValueError("Invalid tool arguments.")
            args = json.loads(raw)
            spec = next((item for item in tools() if item["name"] == name), None)
            if spec is None or not isinstance(args, dict) or set(args) != set(spec["parameters"]["required"]):
                raise ValueError("Unknown tool or invalid argument fields.")
            if "customer_confirmed" in args and args["customer_confirmed"] is not True:
                raise ValueError("Explicit customer confirmation is required.")
            if name == "get_demo_account":
                result = {"customer": "Mr Lehmann", "verification": "Simulated, not actual identity verification",
                          "account": "KlassikKonto", "current_limit_eur": 2000,
                          "new_employer_since": "September (fictional scenario)",
                          "new_salary_credits": 2, "salary_amount": None}
            elif name == "get_account_comparison":
                result = comparison()
            elif name == "submit_demo_overdraft":
                amount = args["amount_eur"]
                if type(amount) is not int or not 2001 <= amount <= 10000:
                    raise ValueError("The demo supports total limits from 2,001 to 10,000 euros.")
                if self.application and self.application["requested_limit_eur"] != amount:
                    raise ValueError("A different request is already saved. Start a new demo call to change it.")
                self.application = {"reference": "DEMO-OD-001", "requested_limit_eur": amount,
                                    "status": "Pending payslip and checks", "approved": False,
                                    "real_submission": False,
                                    "next_step": "In a real application, upload a recent payslip in the bank's secure app. Do not upload one here."}
                if not any(item["id"] == "overdraft" for item in self.inbox):
                    self.inbox.append({"id": "overdraft", "title": "Your overdraft request",
                                       "detail": f"EUR {amount:,} total limit requested. Pending payslip and checks. Demo only."})
                result = self.application
            else:
                if not any(item["id"] == "comparison" for item in self.inbox):
                    self.inbox.append({"id": "comparison", "title": "Your account comparison",
                                       "detail": "A checklist to review in your own time. No account change.",
                                       "comparison": comparison()})
                result = {"delivered_to": "On-screen demo inbox", "account_changed": False,
                          "comparison": comparison()}
            result = {"ok": True, "simulated": True, **result}
        except (ValueError, TypeError) as error:
            result = {"ok": False, "error": str(error), "simulated": True}
        self.results[call_id] = (fingerprint, result)
        return result
