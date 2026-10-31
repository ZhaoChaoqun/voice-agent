"""Offline tests: real SDK serialization, synthetic HTTP, and failure preservation."""

import builtins
import copy
import io
import json
import os
import tempfile
import unittest
import warnings
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx2
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AgentVersionDetails,
    EvaluatorVersion,
    ToolboxVersionObject,
)
from azure.core.credentials import AccessToken
from azure.core.pipeline.transport import HttpResponse, HttpTransport
from openai import OpenAI

import run_evaluation as runner


ENDPOINT = "https://sample.services.ai.azure.com/api/projects/sample"
ENV = {
    "AZURE_AI_PROJECT_ENDPOINT": ENDPOINT,
    "AZURE_AI_SIMULATOR_MODEL": "simulator-deployment",
    "AZURE_AI_MODEL_DEPLOYMENT_NAME": "judge-deployment",
}


class Credential:
    def get_token(self, *args, **kwargs):
        return AccessToken("offline-test-token", 4102444800)


class Response(HttpResponse):
    def __init__(self, request, payload, status=200):
        super().__init__(request, None)
        self.status_code = status
        self.headers = {"Content-Type": "application/json"}
        self.reason = "OK"
        self.payload = json.dumps(payload).encode()

    def body(self):
        return self.payload

    def json(self):
        return json.loads(self.payload)


class Transport(HttpTransport):
    def __init__(self, handler):
        self.handler = handler

    def open(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def send(self, request, **kwargs):
        payload = self.handler(request)
        return payload if isinstance(payload, HttpResponse) else Response(request, payload)


def run_payload(status="completed", total=1):
    return {
        "id": "evalrun_test", "eval_id": "eval_test", "status": status,
        "report_url": "https://example.invalid/synthetic-evaluation",
        "result_counts": {"total": total, "passed": total, "failed": 0, "errored": 0},
    }


def item_payload(identifier="item_1"):
    return {
        "id": identifier, "status": "completed",
        "datasource_item": {"messages": [
            {"role": "user", "content": "Synthetic cancellation request"},
            {"role": "assistant", "content": "Synthetic eligibility reply"},
        ]},
        "results": [{
            "name": "flight_info_retrieval", "score": 0.943, "passed": True,
            "reason": "Synthetic explanation", "properties": {"retry_and_error_handling": None},
        }],
    }


class RunnerTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, ENV, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name)
        self.requests = []

    def plan(self, *args):
        return runner.build_plan(
            runner.parser().parse_args(["plan", *args]), run_key="offline"
        )

    def client(self, handler):
        def record(request):
            self.requests.append(request)
            return handler(request)

        client = OpenAI(
            api_key="offline-test-token", base_url=f"{ENDPOINT}/openai",
            default_query={"api-version": runner.API_VERSION}, max_retries=0,
            http_client=httpx2.Client(transport=httpx2.MockTransport(record)),
        )
        self.addCleanup(client.close)
        return client

    def receipt(self, expected=1):
        return {
            "endpoint": ENDPOINT, "eval_id": "eval_test", "run_id": "evalrun_test",
            "expected_conversations": expected, "criterion_name": "flight_info_retrieval",
            "pass_threshold": 0.5,
        }

    def result_client(self, run=None, items=None):
        payload = run if run is not None else run_payload()
        rows = items if items is not None else [item_payload()]

        def handler(request):
            if request.url.path.endswith("/output_items"):
                return httpx2.Response(200, json={
                    "object": "list", "data": rows, "has_more": False,
                })
            return httpx2.Response(200, json=payload)

        return self.client(handler)

    def test_plan_is_standard_library_only_and_creates_nothing(self):
        original_import = builtins.__import__

        def standard_library_only(name, *args, **kwargs):
            if name.split(".")[0] in {"azure", "openai", "httpx2"}:
                self.fail(f"Plan imported a cloud dependency: {name}")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=standard_library_only):
            with redirect_stdout(io.StringIO()) as stdout:
                runner.main(["plan"])
        self.assertEqual(json.loads(stdout.getvalue())["expected_conversations"], 1)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_exact_native_rubric_and_conversation_configuration(self):
        plan = self.plan()
        definition = plan["evaluator"]["evaluator_version"]["definition"]
        self.assertEqual(definition["type"], "rubric")
        self.assertEqual(definition["pass_threshold"], 0.5)
        self.assertEqual([d["weight"] for d in definition["dimensions"]], [4, 4, 9, 3, 5])
        self.assertTrue(definition["dimensions"][-1]["always_applicable"])
        self.assertEqual(plan["run"]["evaluation_level"], "conversation")
        self.assertEqual(plan["expected_conversations"], 1)
        criterion = plan["evaluation"]["testing_criteria"][0]
        self.assertEqual(criterion["initialization_parameters"], {"deployment_name": "judge-deployment"})
        self.assertEqual(criterion["data_mapping"], {
            "messages": "{{item.messages}}", "tool_definitions": "{{sample.tool_definitions}}",
        })
        self.assertEqual(
            plan["run"]["data_source"]["model_configuration"]["voice_model"]["name"],
            "en-US-Ava:DragonHDLatestNeural",
        )
        self.assertEqual(
            plan["run"]["data_source"]["source"]["test_cases"][0]["simulation_configuration"],
            {"desired_num_turns": 10},
        )

    def test_invalid_configuration_prevents_cloud_calls(self):
        for key, value in (
            ("AZURE_AI_PROJECT_ENDPOINT", ENDPOINT + "?token=private"),
            ("AZURE_AI_PROJECT_ENDPOINT", "http://example.invalid/api/projects/sample"),
            ("AZURE_AI_SIMULATOR_MODEL", ""),
            ("AZURE_AI_MODEL_DEPLOYMENT_NAME", "<judge>"),
        ):
            with self.subTest(key=key), patch.dict(os.environ, {key: value}):
                with self.assertRaises(ValueError):
                    self.plan()
        with self.assertRaises(ValueError):
            self.plan("--max-turns", "5")
        with self.assertRaises(ValueError):
            self.plan("--name-prefix", "../existing")

    def test_scenario_overrides_cannot_bypass_the_budget(self):
        source = json.loads((runner.HERE / "scenarios.jsonl").read_text())
        source["simulation_configuration"]["conversation_repetitions"] = 100
        path = self.output / "unsafe.jsonl"
        path.write_text(json.dumps(source), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.plan("--scenarios", str(path))

    def test_duplicate_scenarios_and_large_runs_are_rejected(self):
        source = (runner.HERE / "scenarios.jsonl").read_text().strip()
        path = self.output / "scenarios.jsonl"
        path.write_text(source + "\n" + source, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.plan("--scenarios", str(path))
        rows = [json.loads(source) for _ in range(5)]
        for index, row in enumerate(rows):
            row["test_case_id"] = f"scenario_{index}"
        path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "1-20 conversations"):
            self.plan("--scenarios", str(path), "--repetitions", "5")

    def test_sdk_end_to_end_request_serialization(self):
        plan = self.plan()
        saved_agent = {}
        azure_requests = []

        def azure_handler(request):
            body = json.loads(request.body) if request.body else {}
            azure_requests.append((request.method, request.url, body))
            if "/toolboxes/" in request.url:
                self.assertEqual(body["tools"], [{"type": "code_interpreter", "container": "cntr_test"}])
                return ToolboxVersionObject({
                    "name": plan["toolbox"]["name"], "version": "2",
                    "tools": body["tools"],
                }).as_dict()
            if "/agents/" in request.url:
                if request.method == "POST" and "definition" in body:
                    saved_agent.update(body["definition"])
                elif request.method == "POST":
                    self.assertIn(":enable", request.url)
                    return Response(request, {}, status=204)
                return AgentVersionDetails({
                    "name": plan["agent"]["agent_name"], "version": "3",
                    "definition": saved_agent,
                }).as_dict()
            if "/evaluators/" in request.url:
                body["version"] = "4"
                for dimension in body["definition"]["dimensions"]:
                    dimension.setdefault("always_applicable", False)
                return Response(request, EvaluatorVersion(body).as_dict(), status=201)
            self.fail(f"Unexpected Azure request: {request.method} {request.url}")

        def openai_handler(request):
            path = request.url.path
            body = json.loads(request.content) if request.content and "/files" not in path else {}
            if path.endswith("/files") and request.method == "POST":
                self.assertIn(b'name="purpose"', request.content)
                self.assertIn(b"assistants", request.content)
                self.assertIn((runner.HERE / "airline_lookup_default.py").read_bytes(), request.content)
                return httpx2.Response(200, json={"id": "assistant_test", "status": "processed"})
            if path.endswith("/files/assistant_test"):
                return httpx2.Response(200, json={"id": "assistant_test", "status": "processed"})
            if path.endswith("/containers"):
                self.assertEqual(body["file_ids"], ["assistant_test"])
                return httpx2.Response(200, json={"id": "cntr_test"})
            if path.endswith("/cntr_test/files"):
                return httpx2.Response(200, json={"data": [{
                    "id": "cfile_test", "path": "/mnt/data/service-prefix-airline_lookup_default.py",
                }], "has_more": False})
            if path.endswith("/cfile_test/content"):
                return httpx2.Response(200, content=(runner.HERE / "airline_lookup_default.py").read_bytes())
            if path.endswith("/evals"):
                criterion = body["testing_criteria"][0]
                self.assertEqual(criterion["evaluator_version"], "4")
                self.assertEqual(criterion["initialization_parameters"], {"deployment_name": "judge-deployment"})
                return httpx2.Response(200, json={"id": "eval_test"})
            if path.endswith("/runs"):
                self.assertEqual(body["evaluation_level"], "conversation")
                self.assertEqual(body["data_source"]["target"]["version"], "3")
                self.assertEqual(body["data_source"]["type"], "azure_ai_user_conversation_simulation")
                return httpx2.Response(200, json=run_payload())
            self.fail(f"Unexpected OpenAI request: {request.method} {path}")

        with AIProjectClient(
            endpoint=ENDPOINT, credential=Credential(), allow_preview=True,
            transport=Transport(azure_handler), retry_total=0,
        ) as project, redirect_stdout(io.StringIO()):
            receipt = runner.provision_and_submit(
                project, self.client(openai_handler), plan, self.output, 5,
            )
        self.assertEqual(receipt["stage"], "run_submitted")
        self.assertEqual(receipt["agent_version"], "3")
        self.assertEqual(receipt["toolbox_version"], "2")
        self.assertEqual(receipt["evaluator_version"], "4")
        self.assertEqual(receipt["run_id"], "evalrun_test")
        self.assertNotIn("$", saved_agent["instructions"])
        self.assertIn("/mnt/data/service-prefix-airline_lookup_default.py", saved_agent["instructions"])
        self.assertEqual(saved_agent["tools"][0]["toolbox_version"], "2")
        self.assertEqual(json.loads((self.output / "receipt.json").read_text()), receipt)
        self.assertTrue((self.output / "resolved_request.json").is_file())
        self.assertTrue(any("evaluators" in url for _, url, _ in azure_requests))
        for request in self.requests:
            self.assertEqual(request.url.params["api-version"], runner.API_VERSION)

    def test_aggregate_and_raw_conversation_results_are_preserved(self):
        with redirect_stdout(io.StringIO()):
            runner.collect_results(self.result_client(), self.receipt(), self.output, 5)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["scores"][0]["score"], 0.943)
        self.assertTrue(json.loads((self.output / "output_items.json").read_text())[0]["datasource_item"]["messages"])

    def test_missing_failing_or_malformed_scores_fail_explicitly(self):
        good = item_payload()
        variants = [
            {**good, "results": []},
            {**good, "status": "error"},
            {**good, "results": [{**good["results"][0], "passed": False}]},
            {**good, "results": [{**good["results"][0], "score": 0.1}]},
            {**good, "results": [{**good["results"][0], "score": "0.943"}]},
            {**good, "results": good["results"] * 2},
        ]
        for item in variants:
            with self.subTest(item=item), warnings.catch_warnings():
                warnings.filterwarnings("ignore", message="Pydantic serializer warnings:")
                with self.assertRaises(RuntimeError):
                    runner.collect_results(self.result_client(items=[item]), self.receipt(), self.output, 5)
            self.assertTrue((self.output / "output_items.json").is_file())

    def test_every_output_page_is_downloaded(self):
        def handler(request):
            if request.url.path.endswith("/output_items"):
                more = "after" not in request.url.params
                identifier = "item_1" if more else "item_2"
                return httpx2.Response(200, json={
                    "object": "list", "data": [item_payload(identifier)],
                    "has_more": more, "first_id": identifier, "last_id": identifier,
                })
            return httpx2.Response(200, json=run_payload(total=2))

        with redirect_stdout(io.StringIO()):
            runner.collect_results(self.client(handler), self.receipt(2), self.output, 5)
        items = json.loads((self.output / "output_items.json").read_text())
        self.assertEqual([item["id"] for item in items], ["item_1", "item_2"])
        self.assertEqual(self.requests[-1].url.params["after"], "item_1")

    def test_missing_counts_duplicate_rows_and_failed_runs_are_not_success(self):
        cases = [
            (run_payload(total=2), [item_payload()], self.receipt(2)),
            (run_payload(total=2), [item_payload(), item_payload()], self.receipt(2)),
            (run_payload(status="failed"), [item_payload()], self.receipt()),
            ({**run_payload(), "result_counts": None}, [item_payload()], self.receipt()),
        ]
        for run, rows, receipt in cases:
            with self.subTest(status=run["status"]), self.assertRaises(RuntimeError):
                runner.collect_results(self.result_client(run, rows), receipt, self.output, 5)
            self.assertTrue((self.output / "run.json").is_file())
            self.assertTrue((self.output / "output_items.json").is_file())

    def test_poll_timeout_is_read_only_and_preserves_receipt(self):
        receipt = self.receipt()
        runner.write_json(self.output / "receipt.json", receipt)
        with patch.object(runner.time, "monotonic", side_effect=[0, 10]):
            with self.assertRaisesRegex(TimeoutError, "NOT canceled"):
                runner.collect_results(
                    self.result_client(run_payload(status="queued")), receipt, self.output, 1
                )
        self.assertEqual(json.loads((self.output / "receipt.json").read_text()), receipt)
        self.assertTrue(all(request.method == "GET" for request in self.requests))

    def test_file_processing_errors_stop_before_provisioning(self):
        project = Mock()
        client = Mock()
        client.files.create.return_value = SimpleNamespace(id="assistant_test")
        metadata = Mock(status="error")
        metadata.to_dict.return_value = {"id": "assistant_test", "status": "error"}
        client.files.retrieve.return_value = metadata
        with redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                runner.provision_and_submit(project, client, self.plan(), self.output, 5)
        receipt = json.loads((self.output / "receipt.json").read_text())
        self.assertEqual(receipt["file_id"], "assistant_test")
        self.assertEqual(receipt["stage"], "processing_file")
        project.agents.create_version.assert_not_called()
        client.containers.create.assert_not_called()

    def test_file_processing_timeout_preserves_metadata(self):
        file = Mock(status="uploaded")
        file.to_dict.return_value = {"id": "assistant_test", "status": "uploaded"}
        client = Mock()
        client.files.retrieve.return_value = file
        with patch.object(runner.time, "monotonic", side_effect=[0, 10]):
            with self.assertRaises(TimeoutError):
                runner.wait_for_file(client, "assistant_test", self.output, 1)
        self.assertEqual(json.loads((self.output / "file.json").read_text())["status"], "uploaded")

    def test_container_content_must_match_and_paths_are_not_guessed(self):
        client = Mock()
        file = Mock(path="/mnt/data/other-airline_lookup_default.py", id="cfile_test")
        file.to_dict.return_value = {"id": file.id, "path": file.path}
        client.containers.files.list.return_value = [file]
        client.containers.files.content.retrieve.return_value.read.return_value = b"wrong source"
        with self.assertRaisesRegex(RuntimeError, "differs"):
            runner.container_path(client, "cntr_test", self.plan()["file"]["sha256"], self.output)
        client.containers.files.list.return_value = []
        with self.assertRaisesRegex(RuntimeError, "no mounted path was guessed"):
            runner.container_path(client, "cntr_test", "hash", self.output)

    def test_readback_allows_normalized_voice_but_rejects_configuration_drift(self):
        expected = self.plan()["agent"]["definition"]
        actual = copy.deepcopy(expected)
        actual["audio"]["output"] = {"voice": {"type": "openai", "name": "Marin"}}
        runner.verify_agent(actual, expected)
        actual["model"] = "different-model"
        with self.assertRaisesRegex(RuntimeError, "model"):
            runner.verify_agent(actual, expected)

    def test_results_requires_a_submitted_receipt_before_loading_credentials(self):
        path = self.output / "receipt.json"
        runner.write_json(path, {**self.receipt(), "run_id": None})
        with patch("azure.identity.DefaultAzureCredential") as credential:
            with self.assertRaisesRegex(ValueError, "submitted run"):
                runner.main(["results", "--receipt", str(path)])
        credential.assert_not_called()

    def test_results_never_overwrites_an_existing_output_folder(self):
        path = self.output / "receipt.json"
        runner.write_json(path, self.receipt())
        with patch("azure.identity.DefaultAzureCredential") as credential:
            with self.assertRaises(FileExistsError):
                runner.main(["results", "--receipt", str(path), "--output", str(self.output)])
        credential.assert_not_called()


if __name__ == "__main__":
    unittest.main()
