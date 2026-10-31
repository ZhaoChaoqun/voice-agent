import json
import tempfile
import unittest
from pathlib import Path

from prepare_example import SAMPLE_DIR, prepare_example, validate_inputs


class PrepareExampleTests(unittest.TestCase):
    def test_validate_included_inputs(self):
        prompt, rubric = validate_inputs()
        self.assertIn("<UPLOADED_PYTHON_PATH>", prompt)
        self.assertEqual(len(rubric["dimensions"]), 5)
        self.assertEqual(rubric["pass_score_threshold"], 0.5)

    def test_prepare_portal_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "inputs"
            path = "/mnt/data/assistant-example-airline_lookup_default.py"
            prepare_example(path, "my-airline-toolbox", output)
            self.assertEqual(
                {item.name for item in output.iterdir()},
                {
                    "airline_lookup_default.py",
                    "scenarios.jsonl",
                    "rubric.json",
                    "evaluation_settings.json",
                    "agent_prompt.txt",
                    "rubric_generation_prompt.txt",
                },
            )
            prompt = (output / "agent_prompt.txt").read_text(encoding="utf-8")
            self.assertIn(path, prompt)
            self.assertIn("my-airline-toolbox", prompt)
            self.assertNotIn("<UPLOADED_PYTHON_PATH>", prompt)
            self.assertNotIn("airline_refund_python", prompt)
            for name in ("airline_lookup_default.py", "scenarios.jsonl", "rubric.json"):
                self.assertEqual(
                    (output / name).read_bytes(), (SAMPLE_DIR / name).read_bytes()
                )
            rubric = json.loads((output / "rubric.json").read_text(encoding="utf-8"))
            self.assertEqual(
                (output / "rubric_generation_prompt.txt").read_text(encoding="utf-8"),
                rubric["generation_prompt"] + "\n",
            )
            settings = json.loads(
                (output / "evaluation_settings.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                settings["agent"]["toolbox"]["name"], "my-airline-toolbox"
            )

    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            sentinel = output / "keep.txt"
            sentinel.write_text("unchanged", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                prepare_example("/mnt/data/example.py", "toolbox", output)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")
            self.assertEqual([item.name for item in output.iterdir()], ["keep.txt"])

    def test_invalid_upload_paths_do_not_create_output(self):
        for path in (
            "C:\\local\\airline_lookup_default.py",
            "/tmp/example.py",
            "/mnt/data/../example.py",
            "/mnt/data/<uploaded-file>.py",
            "/mnt/data/example.json",
            "/mnt/data/example\n.py",
        ):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "inputs"
                with self.assertRaises(ValueError):
                    prepare_example(path, "toolbox", output)
                self.assertFalse(output.exists())

    def test_invalid_toolbox_names_do_not_create_output(self):
        for name in ("", " ", "toolbox\ninstructions"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "inputs"
                with self.assertRaises(ValueError):
                    prepare_example("/mnt/data/example.py", name, output)
                self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
