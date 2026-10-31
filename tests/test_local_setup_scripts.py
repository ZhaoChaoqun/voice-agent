"""Offline contracts for the Linux/WSL local setup entry points."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETUP = ROOT / "scripts" / "setup-local-examples.sh"
LOGIN = ROOT / "scripts" / "login-devtunnel.sh"
MCP_E2E = ROOT / "shared_mcp" / "scripts" / "e2e-local.sh"
PORTAL_RUN = ROOT / "portal" / "run.sh"


def shell_function(source: str, name: str) -> str:
    start = source.index(f"{name}() {{")
    end = source.index("\n}\n", start) + 3
    return source[start:end]


class LocalSetupScriptContractTests(unittest.TestCase):
    def test_shell_entry_points_parse(self):
        for script in (SETUP, LOGIN, MCP_E2E, PORTAL_RUN):
            with self.subTest(script=script):
                subprocess.run(["bash", "-n", str(script)], check=True, cwd=ROOT)

    def test_minimal_python_can_bootstrap_component_pip(self):
        source = SETUP.read_text(encoding="utf-8")
        installer = shell_function(source, "install_python_environment")

        self.assertIn("import ensurepip", installer)
        self.assertIn("venv --without-pip", installer)
        self.assertIn("https://bootstrap.pypa.io/get-pip.py", installer)
        self.assertIn('"${python}" -m pip --version', installer)

    def test_setup_covers_both_independent_finance_runtimes(self):
        source = SETUP.read_text(encoding="utf-8")
        for variable, folder in (
            ("HANDOFF_ROOT", "example1_finance_with_handoff_realtime"),
            ("CASCADE_ROOT", "example1_finance_with_handoff_cascade"),
        ):
            with self.subTest(folder=folder):
                self.assertIn(f'{variable}="${{SAMPLES_ROOT}}/{folder}"', source)
                self.assertIn(f'install_python_environment "${{{variable}}}"', source)
                self.assertIn(f'"${{{variable}}}/.venv/bin/python"', source)
                self.assertIn(f'check_env_file "${{{variable}}}/.env"', source)
                self.assertTrue((ROOT / "samples" / folder / "sample.py").is_file())
        self.assertIn(
            'HANDOFF_SAMPLE="${SAMPLES_ROOT}/example1_finance_with_handoff_realtime"',
            MCP_E2E.read_text(encoding="utf-8"),
        )

    def test_devtunnel_login_uses_repo_cli_and_mcp_working_directory(self):
        source = LOGIN.read_text(encoding="utf-8")

        self.assertIn(".local-tools/devtunnel/bin/devtunnel", source)
        self.assertIn("user login --github --use-device-code-auth", source)
        self.assertNotIn("--entra", source)
        self.assertIn('cd "${ROOT}/shared_mcp"', source)
        self.assertIn("--use-device-code-auth", source)

    def test_setup_recommends_github_devtunnel_login(self):
        source = SETUP.read_text(encoding="utf-8")
        authentication = shell_function(source, "check_authentication")

        self.assertIn("required GitHub device-code authentication", authentication)
        self.assertIn("./scripts/login-devtunnel.sh", authentication)
        self.assertNotIn("For Microsoft Entra", authentication)

    def test_local_mcp_e2e_recommends_github_wrapper(self):
        source = MCP_E2E.read_text(encoding="utf-8")

        self.assertIn("scripts/login-devtunnel.sh", source)
        self.assertNotIn("--entra", source)

    def test_portal_wrapper_forwards_arguments_without_overriding_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            portal = root / "portal"
            python = portal / ".venv/bin/python"
            python.parent.mkdir(parents=True)
            shutil.copy2(PORTAL_RUN, portal / "run.sh")
            python.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "print(json.dumps({'args': sys.argv[1:], 'cwd': os.getcwd()}))\n",
                encoding="utf-8",
            )
            python.chmod(0o755)
            for arguments in (
                [],
                ["--help"],
                ["--port", "9530", "--bind", "::1", "--no-record-sessions",
                 "--project-endpoint", "https://sample.services.ai.azure.com/api/projects/sample",
                 "--data-dir", "folder with spaces"],
            ):
                with self.subTest(arguments=arguments):
                    result = subprocess.run(
                        ["bash", str(portal / "run.sh"), *arguments],
                        cwd=root,
                        env={**os.environ, "DEMO_PORT": "9540", "VOICE_PORTAL_HOST": "localhost"},
                        capture_output=True, text=True, check=True,
                    )
                    payload = json.loads(result.stdout)
                    self.assertEqual(["demo_server.py", *arguments], payload["args"])
                    self.assertEqual(str(portal), payload["cwd"])

    def test_fresh_setup_creates_tools_parent_before_installing_devtunnel(self):
        source = SETUP.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / ".local-tools"
            installer = root / "installer.sh"
            installer.write_text(
                "#!/usr/bin/env bash\n"
                "mkdir -p \"$HOME/bin\"\n"
                "printf '#!/bin/sh\\necho fixture-devtunnel\\n' > \"$HOME/bin/devtunnel\"\n"
                "chmod +x \"$HOME/bin/devtunnel\"\n",
                encoding="utf-8",
            )
            script = "\n".join((
                "set -Eeuo pipefail",
                shell_function(source, "die"),
                shell_function(source, "ensure_devtunnel"),
                'curl() { cp "$FIXTURE_INSTALLER" "${@: -1}"; }',
                "command() {",
                '  if [[ "$1" == "-v" && "$2" == "devtunnel" ]]; then',
                '    [[ -x "$LOCAL_DEVTUNNEL_ROOT/bin/devtunnel" ]]',
                "  else",
                '    builtin command "$@"',
                "  fi",
                "}",
                'export PATH="$LOCAL_DEVTUNNEL_ROOT/bin:$PATH"',
                "ensure_devtunnel",
            ))
            result = subprocess.run(
                ["bash"], input=script, capture_output=True, text=True, check=True,
                env={
                    **os.environ,
                    "PATH": os.defpath,
                    "CHECK_ONLY": "0",
                    "LOCAL_TOOLS_ROOT": str(tools),
                    "LOCAL_DEVTUNNEL_ROOT": str(tools / "devtunnel"),
                    "FIXTURE_INSTALLER": str(installer),
                },
            )
            self.assertTrue((tools / "devtunnel/bin/devtunnel").is_file())
            self.assertIn("source=repo-local", result.stdout)
            self.assertEqual([], list(tools.glob("devtunnel-install.*")))

    def test_mcp_e2e_finds_repository_devtunnel_in_a_fresh_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mcp = root / "shared_mcp"
            scripts = mcp / "scripts"
            scripts.mkdir(parents=True)
            (root / "samples").mkdir()
            shutil.copy2(MCP_E2E, scripts / "e2e-local.sh")
            tunnel = root / ".local-tools/devtunnel/bin/devtunnel"
            tunnel.parent.mkdir(parents=True)
            tunnel.write_text(textwrap.dedent("""\
                #!/bin/sh
                printf '%s\\n' "$PWD" > "$DEVTUNNEL_CALL_LOG"
                printf '{"status":"Not logged in"}\\n'
                """), encoding="utf-8")
            tunnel.chmod(0o755)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            az = bin_dir / "az"
            az.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
            az.chmod(0o755)
            python = mcp / ".venv/bin/python"
            python.parent.mkdir(parents=True)
            python.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
            python.chmod(0o755)
            call_log = root / "devtunnel-call"
            result = subprocess.run(
                ["bash", str(scripts / "e2e-local.sh")],
                capture_output=True, text=True,
                env={
                    **os.environ,
                    "PATH": f"{bin_dir}{os.pathsep}{os.defpath}",
                    "HOME": str(root / "home"),
                    "SHARED_MCP_PYTHON": str(python),
                    "DEVTUNNEL_CALL_LOG": str(call_log),
                },
            )
            self.assertEqual(1, result.returncode)
            self.assertIn("Dev Tunnel is not authenticated", result.stderr)
            self.assertNotIn("devtunnel is required", result.stderr)
            self.assertEqual(str(mcp), call_log.read_text(encoding="utf-8").strip())
            self.assertFalse((mcp / "state").exists())

    def test_portal_quickstarts_preserve_existing_environment_files(self):
        copy_command = "[ -f .env ] || cp .env.example .env"
        for guide in (ROOT / "README.md", ROOT / "docs/README.md", ROOT / "portal/README.md"):
            with self.subTest(guide=guide), tempfile.TemporaryDirectory() as directory:
                self.assertIn(copy_command, guide.read_text(encoding="utf-8"))
                root = Path(directory)
                (root / ".env.example").write_text("EXAMPLE=default\n", encoding="utf-8")
                subprocess.run(["bash", "-c", copy_command], cwd=root, check=True)
                self.assertEqual("EXAMPLE=default\n", (root / ".env").read_text(encoding="utf-8"))
                (root / ".env").write_text("PROJECT=keep-existing\n", encoding="utf-8")
                subprocess.run(["bash", "-c", copy_command], cwd=root, check=True)
                self.assertEqual("PROJECT=keep-existing\n", (root / ".env").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()