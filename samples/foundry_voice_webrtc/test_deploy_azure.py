"""Offline deployment-helper tests; requires PowerShell 7 (pwsh), not Azure CLI."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
POWERSHELL = shutil.which("pwsh")
LOAD_HELPER = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PWD 'deploy-azure.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors -join "`n") }
$helper = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Invoke-AzureCli'
}, $true)
if (-not $helper) { throw 'Invoke-AzureCli was not found.' }
. ([scriptblock]::Create($helper.Extent.Text))
"""


class DeployAzureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not POWERSHELL:
            raise RuntimeError("PowerShell 7 (pwsh) is required for deployment tests.")

    def run_powershell(self, script):
        result = subprocess.run(
            [POWERSHELL, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
             LOAD_HELPER + script],
            cwd=ROOT, capture_output=True, text=True, timeout=30, check=True,
        )
        self.assertEqual("", result.stderr)
        return json.loads(result.stdout)

    def invoke_helper(self, arguments, exit_code, output):
        fixture = json.dumps({
            "arguments": arguments, "exitCode": exit_code, "output": output,
        })
        return self.run_powershell(
            "$fixture = @'\n" + fixture + "\n'@ | ConvertFrom-Json\n" + r"""
function az {
    $script:received = @($args)
    $global:LASTEXITCODE = $fixture.exitCode
    $fixture.output
}
$message = $null
$diagnostic = $null
$output = @()
$arguments = @($fixture.arguments)
try {
    $output = @(Invoke-AzureCli -Operation 'Deploy infrastructure' @arguments)
} catch {
    $message = $_.Exception.Message
    $diagnostic = $_ | Out-String
}
[pscustomobject]@{
    received = @($script:received)
    output = @($output)
    message = $message
    diagnostic = $diagnostic
} | ConvertTo-Json -Depth 10 -Compress
""")

    def test_failure_omits_all_argument_values(self):
        arguments = [
            "deployment", "sub", "create", "--parameters",
            'iceServersJson=[{"username":"fixture-turn-user",'
            '"credential":"fixture-turn-password"}]',
            "unrecognizedSetting=fixture-unclassified-secret",
        ]
        for exit_code in (1, 42):
            with self.subTest(exit_code=exit_code):
                result = self.invoke_helper(arguments, exit_code, [])
                self.assertEqual(arguments, result["received"])
                self.assertEqual(
                    f"Azure CLI operation failed: Deploy infrastructure (exit code {exit_code}).",
                    result["message"],
                )
                for value in arguments:
                    self.assertNotIn(value, result["diagnostic"])
                for value in ("fixture-turn-user", "fixture-turn-password",
                              "fixture-unclassified-secret"):
                    self.assertNotIn(value, result["diagnostic"])

    def test_success_preserves_arguments_and_output(self):
        arguments = ["resource", "show", "--query", "properties.value",
                     "--name", "name with spaces", "--output", "json"]
        for output in ([], ['{"value": "first"}', "second line"]):
            with self.subTest(output=output):
                result = self.invoke_helper(arguments, 0, output)
                self.assertEqual(arguments, result["received"])
                self.assertEqual(output, result["output"])
                self.assertIsNone(result["message"])

    def test_every_call_supplies_a_literal_operation_label(self):
        result = self.run_powershell(r"""
$calls = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -eq 'Invoke-AzureCli'
}, $true)
$labels = foreach ($call in $calls) {
    $parameters = @($call.CommandElements | Where-Object {
        $_ -is [System.Management.Automation.Language.CommandParameterAst] -and
        $_.ParameterName -eq 'Operation'
    })
    if ($parameters.Count -ne 1) { throw 'Every call needs one operation label.' }
    $index = $call.CommandElements.IndexOf($parameters[0])
    $label = $call.CommandElements[$index + 1]
    if ($label -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or
        [string]::IsNullOrWhiteSpace($label.Value)) {
        throw 'Operation labels must be nonempty literals, never argument values.'
    }
    $label.Value
}
ConvertTo-Json -InputObject @($labels) -Compress
""")
        self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
