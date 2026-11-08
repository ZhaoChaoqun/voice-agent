"""Offline tests for deployment CLI diagnostics; never execute the deployment."""

import json
from pathlib import Path
import subprocess
import unittest


class AzureCliTests(unittest.TestCase):
    def invoke_cli(self, exit_code):
        script_path = str(Path(__file__).with_name("deploy-azure.ps1")).replace(
            "'", "''"
        )
        harness = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    '__SCRIPT_PATH__', [ref]$tokens, [ref]$parseErrors
)
if ($parseErrors.Count) { throw 'Deployment script failed to parse.' }
$definitions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Invoke-AzureCli'
}, $true))
if ($definitions.Count -ne 1) { throw 'Expected exactly one CLI wrapper.' }
. ([scriptblock]::Create($definitions[0].Extent.Text))

function az {
    $script:forwarded = @($args)
    $global:LASTEXITCODE = __EXIT_CODE__
    if ($LASTEXITCODE -eq 0) {
        '{"id":"offline-account"}'
        'offline-principal'
    } else {
        [Console]::Error.WriteLine('Mock Azure CLI diagnostic.')
    }
}

$parameters = @(
    'iceServersJson=[{"urls":"turn:example.invalid","credential":"synthetic-test-secret"}]',
    'unrecognizedParameter=synthetic-other-secret'
)
$command = @(
    'deployment', 'sub', 'create', '--name', 'offline deployment',
    '--parameters'
) + $parameters + @('--output', 'none')
$message = $null
$record = $null
$output = @()
try {
    $output = @(Invoke-AzureCli @command)
} catch {
    $message = $_.Exception.Message
    $record = $_ | Out-String
}
[pscustomobject]@{
    output = $output
    forwarded = $script:forwarded
    expected = $command
    message = $message
    record = $record
} | ConvertTo-Json -Depth 5 -Compress
"""
        result = subprocess.run(
            [
                "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                harness.replace("__SCRIPT_PATH__", script_path).replace(
                    "__EXIT_CODE__", str(exit_code)
                ),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        return json.loads(result.stdout), result.stderr

    def test_failure_reports_exit_code_without_argument_values(self):
        for exit_code in (1, 2, 17):
            with self.subTest(exit_code=exit_code):
                result, stderr = self.invoke_cli(exit_code)
                diagnostics = result["message"] + result["record"] + stderr
                for value in (
                    "synthetic-test-secret", "synthetic-other-secret",
                    "iceServersJson", "offline deployment",
                ):
                    self.assertNotIn(value, diagnostics)
                self.assertEqual(
                    result["message"],
                    f"Azure CLI command failed with exit code {exit_code}.",
                )
                self.assertEqual(result["forwarded"], result["expected"])
                self.assertEqual(result["output"], [])

    def test_success_preserves_output_and_argument_boundaries(self):
        result, stderr = self.invoke_cli(0)
        self.assertIsNone(result["message"])
        self.assertIsNone(result["record"])
        self.assertEqual(result["forwarded"], result["expected"])
        self.assertEqual(
            result["output"], ['{"id":"offline-account"}', "offline-principal"]
        )
        self.assertEqual(stderr, "")

    def test_failure_preserves_cli_stderr(self):
        result, stderr = self.invoke_cli(1)
        self.assertIsNotNone(result["message"])
        self.assertEqual(stderr.strip(), "Mock Azure CLI diagnostic.")


if __name__ == "__main__":
    unittest.main()
