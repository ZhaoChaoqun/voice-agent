"""Offline regression checks for ICE credentials in compiled ARM templates."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


def resources(template):
    value = template["resources"]
    return value.values() if isinstance(value, dict) else value


class IceParameterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            [
                "bicep", "build", str(Path(__file__).with_name("main.bicep")),
                "--stdout", "--no-restore",
            ],
            capture_output=True,
            text=True,
        )
        sys.stderr.write(result.stderr)
        result.check_returncode()
        cls.root = json.loads(result.stdout)
        cls.deployment = next(
            resource for resource in resources(cls.root)
            if resource["type"] == "Microsoft.Resources/deployments"
            and resource["name"] == "container-app"
        )
        cls.module = cls.deployment["properties"]["template"]

    def test_root_and_nested_module_use_secure_string(self):
        for template in (self.root, self.module):
            with self.subTest(scope=template["$schema"]):
                self.assertEqual(
                    template["parameters"]["iceServersJson"]["type"].lower(),
                    "securestring",
                )

    def test_defaults_contain_only_public_stun_configuration(self):
        # ARM escapes a literal leading "[" as "[[".
        self.assertEqual(
            self.root["parameters"]["iceServersJson"]["defaultValue"],
            '[[{"urls":"stun:stun.l.google.com:19302"}]',
        )
        self.assertNotIn("defaultValue", self.module["parameters"]["iceServersJson"])

    def test_ice_parameter_is_not_exposed_in_outputs(self):
        for template in (self.root, self.module):
            with self.subTest(scope=template["$schema"]):
                self.assertNotIn(
                    "iceserversjson", json.dumps(template.get("outputs", {})).lower()
                )

    def test_parameter_forwarding_and_runtime_secret_reference_are_preserved(self):
        self.assertEqual(
            self.deployment["properties"]["parameters"]["iceServersJson"],
            {"value": "[parameters('iceServersJson')]"},
        )
        app = next(
            resource for resource in resources(self.module)
            if resource["type"] == "Microsoft.App/containerApps"
        )
        container = app["properties"]["template"]["containers"][0]
        ice_env = next(
            item for item in container["env"] if item["name"] == "ICE_SERVERS_JSON"
        )
        self.assertEqual(
            ice_env, {"name": "ICE_SERVERS_JSON", "secretRef": "ice-servers-json"}
        )


if __name__ == "__main__":
    unittest.main()
