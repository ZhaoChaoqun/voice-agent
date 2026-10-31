# Evaluate an airline Voice Agent in Microsoft Foundry

This portal-first walkthrough evaluates a multi-turn reservation cancellation
request using a Voice Agent, a Python Code Interpreter toolbox, a simulated
caller, and a custom rubric. It adapts *A Step-by-Step Guide to Foundry Evaluation*
to the observed `Cancel_order` evaluation of `Airline-Agent:1` on October 30, 2026.

The agent collects identifiers, runs a **mock** reservation lookup, and explains
whether the booking meets a fixed 24-hour refund eligibility rule. It cannot
cancel a reservation or process a refund. This is a smoke test with fixed sample
data, not production airline policy, identity verification, or a customer benchmark.

**Python compatibility warning:** the [SDK runner](#run-the-entire-example-with-python)
did not run unchanged in a reported live test. That test needed compatibility
wrappers and a separate transcript-grading step that are not included here.
Read the [known issues](#reported-live-compatibility-issues) before creating
resources; this is not currently a verified one-command SDK reproduction.

## Follow the illustrated tutorial

Every numbered step below has its screenshot **embedded directly after the
instructions**, followed by a caption explaining what to look for.

> **Reading on GitHub:** use the README's **Preview** view to see the illustrated
> tutorial. A pull request's source diff displays Markdown image references
> rather than the full tutorial layout.

| Stage | What you will do |
| --- | --- |
| [Prepare: steps 1-5](#prepare-the-agent-scenario-and-rubric) | Upload the Python toolbox, configure the agent, import the scenario, and create the rubric. |
| [Run: steps 6-13](#run-the-evaluation) | Follow the seven-screen evaluation wizard, including the evaluator field mappings. |
| [Inspect: steps 14-15](#inspect-the-results) | Read the completed run and understand its per-dimension scores. |

**Before starting:** use a test Foundry project with Voice Agents, Code
Interpreter/toolboxes, conversation simulation, and custom rubric evaluation
enabled. You need permission to create those resources and available model
deployments; see [evaluation permissions](https://learn.microsoft.com/azure/foundry/observability/how-to/evaluation-permissions).
Only attach mock tools: a simulated caller can invoke the target's tools.

You do not need access to the original project or SharePoint guide. All inputs
are [included below](#input-files-and-offline-preparation). In the portal path,
only the final **Submit** starts an evaluation. The optional Python `run` command
also attempts to create resources and submit a billable evaluation, but has the
compatibility issues noted above. Preview-portal labels and model availability
can vary. The screenshots and saved settings describe the original portal run;
they are not proof that the same configuration works unchanged through the SDK.

## Prepare the agent, scenario, and rubric

### Step 1. Upload the Python file to a toolbox

In **Build > Tools > Toolboxes**, create a toolbox named `airline-refund-python`.
Add **Code interpreter**, upload [airline_lookup_default.py](airline_lookup_default.py),
wait for the file status to become **Processed**, and save the toolbox. The
observed run used toolbox version `1`.

**Checkpoint:** the file row must show `airline_lookup_default.py` with status
**Processed**, not just a successful file selection.

![Upload the Python file and wait for Processed status](screenshots/01-toolbox-upload.png)

*Figure 1. Code Interpreter upload dialog: the sample Python file is processed
and ready to attach to the toolbox.*

Record the exact mounted path assigned to the uploaded Python file. It is an
upload-specific path under `/mnt/data/`, not the repository path. Do not copy
another project's file ID or assume the file mounts at its original basename.
If the dialog only shows a filename, use the
[setup-only path discovery instructions](#find-the-uploaded-python-path).
See the [toolbox documentation](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/toolbox)
for the current setup experience.

### Step 2. Create the agent and paste its instructions

Create a test Voice Agent. Use the example's model and greeting when available:

| Setting | Example value |
| --- | --- |
| Agent name / version | `Airline-Agent` / `1` |
| Agent model | `gpt-realtime-2.1` |
| Agent voice | `Marin` |
| Session-start greeting | `None` |
| Attached toolbox | `airline-refund-python`, version `1` |

Copy [agent_prompt.md](agent_prompt.md) into **Instructions**, replacing
`<UPLOADED_PYTHON_PATH>` with the exact path from step 1 before saving. The
original prompt refers to the toolbox as `airline_refund_python`; the portal
display name is `airline-refund-python`. Keep the instructions consistent with
the tool name exposed in your own project.

Alternatively, the [offline preparation helper](#input-files-and-offline-preparation)
generates ready-to-paste `agent_prompt.txt` with both substitutions. Python is
optional; the portal steps also work with manual substitution.

**Checkpoint:** the **Instructions** field contains your prepared agent prompt,
not the caller scenario, and no `<UPLOADED_PYTHON_PATH>` placeholder remains.

![Configure the agent instructions and model](screenshots/02-agent-instructions.png)

*Figure 2. Agent configuration: paste the supplied prompt into Instructions,
select the agent model, and leave the session-start greeting as None.*

### Step 3. Select the voice and attach the toolbox

Select **Marin**, then use **Add a toolbox** to attach the saved toolbox version.
The toolbox should expose **Code interpreter** as shown below. Do not start a
microphone session just to configure these settings.

**Checkpoint:** the agent uses **Marin**, and the attached
`airline-refund-python` toolbox lists **Code interpreter**. Save the agent and
record the version containing this prompt and toolbox.

![Agent voice and attached Code Interpreter toolbox](screenshots/03-agent-tools.png)

*Figure 3. Agent voice and tools: Marin is selected, and the saved Python
toolbox is attached to the agent.*

The prompt requires the agent to collect both IDs before execution, remember
previous answers, interpret clearly spoken identifier punctuation, and ask for
clarification rather than invent values. It requires loading the uploaded file
with `runpy.run_path`, running both functions, and using their actual outputs.
It also forbids claiming that a cancellation or refund was processed.
See [tool behavior and execution](#tool-behavior-and-execution) for the mock
record and the intended Python calls.

### Step 4. Upload and preview the scenario dataset

Upload [scenarios.jsonl](scenarios.jsonl) as the simulation dataset. It preserves
the observed fields: `test_case_id`, `test_case_description`, and
`simulation_configuration.desired_num_turns`. Each JSONL line is one scenario.
Use **Download sample** in your portal if its expected schema differs.

The original dataset is named `flight_info_retrieval4`, version `1`. In a new
project, upload the included `scenarios.jsonl` and give the dataset that name,
or consistently select your own name in the evaluation wizard. The local
filename does not need to match the original service-generated filename.

**Checkpoint:** the preview has exactly **one row** with test case ID
`flight_info_retrieval` and `desired_num_turns: 10`.

![Preview of the uploaded one-row scenario dataset](screenshots/04-scenario-dataset.png)

*Figure 4. Dataset preview: the JSONL imports as a single multi-turn scenario,
not a list of fixed user/assistant messages.*

The task ID remains `flight_info_retrieval` to match the original run, although
the task is **reservation cancellation/refund eligibility**, not flight search.

| Task element | Expected behavior |
| --- | --- |
| Opening | Caller says only that they want to cancel a reservation. |
| Identifier collection | Caller supplies at most one new detail per reply, only when asked. |
| Known sample details | Emma Kim; user ID `emma_kim_9957`; reservation ID `EHGLP3`. |
| Hidden information | Caller must not disclose the booking timestamp or elapsed booking age. |
| Agent tool use | Look up using both IDs; calculate eligibility from returned `created_at` and `reference_time`. |
| Expected explanation | Booking is outside the 24-hour refund window; no claim of cancellation or refund execution. |

Keep the scenario and ground truth out of the agent prompt. This prevents the
caller from simply handing the agent the eligibility answer. It does not by
itself prove that the agent executed the required tool.

The scenario requests `desired_num_turns: 10`; it is not a fixed transcript or a
guarantee of ten completed exchanges. The observed conversation ended after four
user/assistant exchanges.

### Step 5. Create the five-dimension custom rubric

In **Evaluations > Evaluator catalog**, create a **Rubric** evaluator, or select
the existing `flight_info_retrieval` evaluator in the original project.
The inspected catalog version was `4`. Set the **pass score threshold to `0.5`**
and copy the dimensions and weights from [rubric.json](rubric.json).

For a new project, use evaluator name `flight_info_retrieval` and display name
`flight info retrieval`. To generate a starting rubric, select **Rubric**, enable
**Auto-generate rubric**, choose an available generation model, and paste
`generation_prompt` from `rubric.json` (or the generated text file). After
generation, edit/add/remove dimensions until the five IDs, descriptions, and
weights below match the included JSON, then save. Do not assume the generated
output matches automatically. A new evaluator's first saved version can be `1`;
`4` is the inspected original version, not a version you must manufacture.

**Checkpoint:** choose evaluator type **Rubric**, set the pass threshold to
**0.5**, and confirm all five dimensions and weights match `rubric.json`.
Scroll the dimension panel to check the lower rows before saving.

![Custom rubric editor with the pass threshold and weighted dimensions](screenshots/05-custom-rubric.png)

*Figure 5. Rubric editor: the threshold and first three weighted dimensions are
visible; the remaining two dimensions are below the scroll area.*

The JSON also preserves the original rubric-generation prompt. Auto-generation
can produce different dimensions, so inspect and edit its output rather than
assuming that regenerating the prompt recreates this rubric.

| Dimension | Weight | Criterion |
| --- | --- | --- |
| `reservation_number_used` | 4 | Observable capture of `EHGLP3`, compared case-insensitively after removing whitespace and non-alphanumeric characters. |
| `user_id_used` | 4 | Observable capture of `emma_kim_9957`, using the same normalization (`emmakim9957`). |
| `booking_timestamp_older_than_24h` | 9 | Agent explicitly says that more than 24 hours have passed since booking; evaluate its response. |
| `retry_and_error_handling` | 3 | If a transient lookup error/timeout/null occurs, retry with correct parameters or explicitly handle/report the failure. |
| `general_quality` | 5 | Always-applicable quality factors not covered by the other dimensions. |

Dimension scores range from `1` to `5`; overall rubric scores range from `0` to
`1`. A dimension can be **N/A** when its condition did not occur. Identifier
normalization is a grading rule, not permission for the agent to guess an ID or
rewrite tool arguments arbitrarily.

**Known gaps in the original rubric:** its catalog description still refers to
flight numbers, while its dimensions refer to reservations. Its generation
prompt asks about customer-name association and exact lookup arguments, but
there is no separate customer-name dimension and the two identifier dimensions
only require observable capture. Preserve this distinction when explaining the
run. A stricter follow-up evaluator should explicitly score tool execution,
arguments, returned data, and name association; that would be a new rubric,
not the rubric used for this result.

## Run the evaluation

In **Evaluations > Create**, select the agent and configure the workflow below.
Do not submit until the target is a test agent, only mock tools are attached,
and you have reviewed inference costs.

The following steps follow the wizard's order. Keep
[evaluation_settings.json](evaluation_settings.json) open as a configuration
checklist; it is not an API import payload.

### Step 6. Select and pin the evaluation target

Choose **Agent**, search for your test agent, select its row, and use the version
selector to **Pin v1** (or your deliberately selected saved version). Select
**Next**. Do not accidentally select a similarly named agent.

**Checkpoint:** the chosen agent and pinned version match the final saved
configuration from step 3. The screenshot pins `Airline-Agent:1`; use your
actual saved version if it differs.

![Select Airline-Agent and pin the intended version](screenshots/06-evaluation-target.png)

*Figure 6. Wizard screen 1, Target: select the test agent and pin its version
rather than relying on Latest available.*

### Step 7. Evaluate full conversations

Choose **Full conversations**, then **Next**. This grades the multi-turn
identifier-collection flow, not isolated query/response rows.

**Checkpoint:** **Full conversations** is selected.

![Choose Full conversations](screenshots/07-evaluation-scope.png)

*Figure 7. Wizard screen 2, Scope: grade the complete multi-turn interaction.*

### Step 8. Choose a one-time evaluation

Choose **One time**, then **Next**. A recurring configuration is not needed to
reproduce this example.

**Checkpoint:** **One time** is selected, not a recurring schedule.

![Choose a one-time evaluation](screenshots/08-evaluation-frequency.png)

*Figure 8. Wizard screen 3, Frequency: run once with the selected inputs.*

### Step 9. Configure the simulated caller

Choose **Simulated data > Use a dataset**. Use **Upload dataset** for the supplied
`scenarios.jsonl`, or select the dataset already uploaded in step 4. Verify that
the preview contains `flight_info_retrieval` and `desired_num_turns: 10`.

Select the simulator deployment (`gpt-5.6-luna` in this run) and
**Ava Dragon HD Latest** voice (`en-US-Ava:DragonHDLatestNeural`,
type `azure-standard`). Under
**Simulation settings > Edit**, set **Conversations per test case scenario** to
`1`, set **Max turns per conversation** to `10`, and leave **Save conversations
as a dataset** unchecked to match the original run. Then select **Next**.

**Checkpoint:** one scenario will generate **one conversation**, with at most
**10 turns**. The simulator model and voice are caller settings, not the target
agent's model and voice.

![Dataset selection, simulator model, caller voice, and simulation limits](screenshots/09-simulation-settings.png)

*Figure 9. Wizard screen 4, Conversation data: the selected dataset appears at
the top; simulator model, voice, repetitions, turn limit, and persistence are
shown below. Scroll the right-hand panel to inspect every setting.*

### Step 10. Keep the saved agent instructions

If **Configure agents** appears, leave the saved instructions unchanged and
select **Next**. This step is for an optional evaluation-specific custom prompt;
it is not where you paste the simulated caller scenario.

**Checkpoint:** no evaluation-specific prompt override has been entered.

![Continue without an evaluation-specific agent prompt override](screenshots/10-configure-agent.png)

*Figure 10. Wizard screen 5, Configure agents: evaluate the saved agent as-is.*

### Step 11. Select the judge and only the custom rubric

Choose the judge deployment (`gpt-5.6-luna` in this run). Clear any preselected
recommended evaluators or evaluator bundles, then select **only** `flight info retrieval`. Confirm
**Review selected (1)** so the result is comparable to this single-rubric run.

**Checkpoint:** exactly **one evaluator** is selected. Recommended evaluator
bundles must not remain selected by default.

![Judge model and only the intended custom evaluator selected](screenshots/11-judge-and-evaluator.png)

*Figure 11. Wizard screen 6, Criteria: select the judge and the custom rubric,
not the recommended evaluator packs.*

### Step 12. Verify the evaluator field mappings

Open the selected evaluator's **...** configuration menu and expand
**Advanced settings**. Verify **Messages** is `{{item.messages}}` and **Tool
definitions** is `{{sample.tool_definitions}}`. The current editor also displays
**Response** as `{{sample.output_text}}` and **Query** as unavailable; the
original evaluation JSON stored the messages/tool-definitions mappings.
Keep the judge selection consistent and return to the wizard.

**Portal snapshot, not an SDK mapping guarantee:** these mappings were observed
in the original portal configuration. In the reported SDK simulation,
`sample.tool_definitions` was absent. The working wrapper supplied the actual
tool definitions in its custom dataset record and mapped
`{{item.tool_definitions}}` instead. For that separate grading step, messages
were mapped from `{{item.transcript}}`; see the
[compatibility workflow](#reported-live-compatibility-issues). Do not assume a
field is available just because the portal or request template displays it.

**Checkpoint:** the evaluator receives the full **Messages** mapping, not just
an isolated response string.

![Inspect the evaluator field mappings](screenshots/12-field-mappings.png)

*Figure 12. Criteria advanced settings: confirm the conversation and tool
definition mappings before leaving the configuration dialog.*

### Step 13. Review the configuration and submit

Select **Next**, enter an evaluation name such as `Cancel_order`, and review the
target/version, full-conversation scope, one-time frequency, and custom
evaluator. Recheck the scenario count, turn limit, simulator voice, and judge
settings before submitting.

**Checkpoint:** the review shows the intended pinned agent, **Full
conversations**, **One time**, and only the custom evaluator.

![Final configuration review before Submit](screenshots/13-review-submit.png)

*Figure 13. Wizard screen 7, Review: the setup is ready for Submit. This
documentation capture stopped here; it did not submit another cloud run.*

The agent model/voice, simulator model/voice, and judge model are separate
settings. The evaluator editor displayed `gpt-5-mini` for **rubric generation**;
the evaluation's raw JSON identifies `gpt-5.6-luna` as the **run's judge**.

Review the settings and select **Submit**. Wait for **Completed**, then open
the run to inspect its overall results and individual conversation. Completion
means processing finished, not that every criterion passed.

For an audit record, use **Raw JSON** on both the evaluation and run. The
original evaluation's `evaluator_version` was an empty string, and the run's
target `version` was `null`; the catalog and result row supplied the versions
reported above. For future runs, explicitly select/pin versions where supported
and retain the resolved configuration rather than assuming "latest" is stable.

For API-driven simulation with built-in task-completion/coherence scoring,
see the separate [simulation sample](../simulation_evaluation/README.md).
That sample is not a drop-in runner for this preview custom-rubric workflow.

## Inspect the results

### Step 14. Open the completed run

Open the completed run to see its overall metrics and per-conversation table.

**Checkpoint:** confirm **Completed**, then check the conversation count and
pass rate. Completion alone does not mean every criterion passed.

![Completed run and overall metrics, with the run author's name redacted](screenshots/14-run-results.png)

*Figure 14. Original completed run: one conversation passed, giving a 100%
aggregate pass rate. The creator's name is redacted.*

| Run result, October 30, 2026 | Observed value |
| --- | --- |
| Status | `completed` |
| Conversations | `1` |
| Passed / failed / errored / skipped | `1 / 0 / 0 / 0` |
| Aggregate pass rate | `100%` (`1 / 1`) |
| Conversation rubric score | `0.943` (detail panel rounded to `0.94 / 1.0`) |
| Run duration | `1m 4.14s` |
| Target P50 / P95 latency | `29.5s / 29.5s` (`29523.84 ms`, one sample) |

**The 100% pass rate and 0.943 rubric score are different metrics.** One
conversation passed the threshold; it did not receive a perfect quality score.
With only one latency sample, P50 and P95 coincide and do not establish a
population latency distribution or per-turn speech responsiveness.

The observed conversation proceeded as follows:

1. Caller requested cancellation without supplying identifiers.
2. Agent requested the user ID and reservation ID; caller supplied only the user ID.
3. Agent remembered that ID and requested the missing reservation ID.
4. After receiving `EHGLP3`, the agent reported the May 4, 2024 booking date and
   explained that it was outside the fixed 24-hour refund window.
5. Caller asked how to cancel even without a refund. Agent directed them to the
   airline/booking platform without claiming to perform the cancellation.

### Step 15. Read the rubric score and dimension explanations

Open **View details** on the rubric result for the dimension scores and reasons.

**Checkpoint:** distinguish the **0.94 / 1.0** rounded conversation score from
the **100%** run pass rate. The retry dimension is **N/A**, not a tested pass.

![Rubric result with individual dimension scores and reasons](screenshots/15-rubric-results.png)

*Figure 15. Conversation-level rubric result: the five dimensions include one
N/A and a general-quality score of 4, explaining why the score is not perfect.*

| Dimension | Score | Result / explanation |
| --- | --- | --- |
| `reservation_number_used` | 5 | Pass; judge credited capture/use of `EHGLP3`. |
| `user_id_used` | 5 | Pass; user ID was explicitly captured and confirmed. |
| `booking_timestamp_older_than_24h` | 5 | Pass; agent explicitly said the booking was outside the window. |
| `retry_and_error_handling` | N/A | No initial lookup error, timeout, or null result occurred. |
| `general_quality` | 4 | Pass; judge noted that the final guidance did not repeat the exact reservation ID. |

The retry dimension being N/A is **not evidence that retries work**. The displayed
messages contained user/assistant text, not an execution trace. The judge's
statement that the reservation ID was "evidently used" is a judgment, not an
independent verification of Code Interpreter execution.

Inspect the agent's tool traces separately for both supplied arguments,
`runpy.run_path` execution of the uploaded file, the returned timestamps, and
the eligibility result. The `tool_definitions` mapping alone does not establish
that these runtime traces reached the judge. Because the mock echoes arbitrary
IDs, a plausible response cannot prove ownership verification or correct lookup.
The caller also never supplied a customer name in this conversation; do not
report name collection as demonstrated.

Use **Download results** and **Download user logs** to retain authorized evidence
according to your project's policy. Keep raw conversations, internal portal
links, signed storage URLs, and credentials out of the repository.

## Run the entire example with Python

[run_evaluation.py](run_evaluation.py) is intended to orchestrate agent creation,
cloud conversation simulation, and custom-rubric evaluation. **The checked-in
runner has known live compatibility failures and has not been corrected to
implement the reported working workflow.** Offline SDK tests check synthetic
responses, not service acceptance.

### Reported live compatibility issues

Feedback on the pinned example at commit `1951e61` reported that it did not
work unchanged. The successful run used external compatibility wrappers without
modifying this repository. The following are reported runtime findings, not an
independently reproduced run by this guide's author:

| Area | Checked-in behavior / reported failure | Reported working change |
| --- | --- | --- |
| Voice configuration | The runner takes portal label `Marin` as its voice value and does not specify the complete audio input/output configuration; runtime validation failed. | Lowercase `marin`, explicit PCM at 24 kHz, server VAD, and Whisper transcription, matching the existing working agent. |
| Tool-definition mapping | The runner copies `{{sample.tool_definitions}}` from the portal snapshot, but that field was absent from simulation output. | Supply the actual exposed Toolbox definitions in each grading record and map `{{item.tool_definitions}}`. |
| Tool-definition format | The evaluator rejected nested function definitions supplied during the compatibility attempt. The runner does not currently export and normalize definitions for a separate grading dataset. | Use the evaluator's accepted top-level `name`, `description`, and `parameters` fields, preserving the actual definitions. |
| Grading mode | The service rejected this custom rubric at the runner's `conversation` evaluation level. | Save the entire transcript and grade it separately as one custom dataset record, mapping `{{item.transcript}}` to the evaluator's `messages` input. |
| Authentication | The compatibility run used existing cached Azure authentication instead of the example's credential setup. | Treat this as environment-specific; use an authorized credential source for your tenant/project rather than copying tokens. This does not establish that `DefaultAzureCredential` is universally unsuitable. |

The reported working sequence is:

```text
Create/configure the Voice Agent and Toolbox
    -> Simulate the conversation and save its entire transcript
    -> Assemble one custom dataset record per conversation:
         transcript + actual, evaluator-compatible tool_definitions
    -> Submit a separate custom-dataset rubric evaluation
    -> Collect that grading run's scores and pass/fail results
```

In that grading record, `transcript` holds the entire saved conversation,
preserving roles and turn order, not just the final assistant reply. The
evaluator input mappings are `messages: {{item.transcript}}` and
`tool_definitions: {{item.tool_definitions}}`. This is transcript-level coverage
through a custom dataset, **not** a claim that the service accepted the rubric
at `evaluation_level="conversation"`.

The tool definitions must describe the actual exposed Toolbox tools. Do not
invent separate function tools for `lookup_reservation` and
`check_refund_eligibility`: those functions run inside Code Interpreter.
Definitions describe tool capabilities; they are not execution logs.

One script can orchestrate both simulation and separate grading, but the
checked-in runner does not yet implement this two-stage flow. The working
wrappers, exact accepted audio/definition payloads, and service responses have
not been supplied with this feedback, so this guide does not invent a
ready-to-run replacement or claim that a voice-name change alone fixes it.

**Result attribution:** the reported `0.943` rubric score (94.3% of the
normalized score scale), reported as passing, came from the corrected
**separate grading step**, not an unchanged execution of the documented
command. It is not a 94.3% aggregate pass rate. This report is separate evidence
from the original portal result shown in figures 14-15. Neither result
independently proves Python tool execution; inspect runtime traces separately.

### Inspect the existing runner

Keep the runner with the other files in this directory; it reads the supplied
prompt, Python tool, scenario, rubric, settings, and `prepare_example.py`.
The following setup and offline planning instructions remain useful for
inspection. They do not resolve the compatibility issues above.

**Prerequisites:** Python 3.10+, an existing Foundry project with the features
listed above, resource-creation/evaluation permissions, and actual deployed
simulator and judge models. This script does not create an Azure project,
deploy models, grant permissions, or configure billing. Native Voice Agents,
Code Interpreter toolboxes, Files/Containers, simulation, and custom rubric
APIs must all be available in the target project. There is no text-only or
different-evaluator fallback if a preview feature is unavailable.

From the repository root, set up this sample in PowerShell:

```powershell
Set-Location samples\foundry_evaluation
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# If using Azure CLI credentials, sign in to the tenant owning your project.
az login

$env:AZURE_AI_PROJECT_ENDPOINT = "https://<resource>.services.ai.azure.com/api/projects/<project>"
$env:AZURE_AI_SIMULATOR_MODEL = "<your-simulator-deployment>"
$env:AZURE_AI_MODEL_DEPLOYMENT_NAME = "<your-judge-deployment>"
```

Replace **all** placeholders with your project's values. The two model values
are deployment names, not an assumption that the screenshot's `gpt-5.6-luna`
exists in your project. Authentication uses `DefaultAzureCredential`; Azure CLI
is one supported credential source, not a requirement if another source is
configured. GitHub sign-in does not authenticate Azure.

First inspect the proposed request. `plan` needs no third-party imports,
credentials, network access, or output directory:

```powershell
.\.venv\Scripts\python.exe run_evaluation.py plan
```

**Do not start `run` unchanged in the reported environment.** It may create
billable resources before failing. `plan` checks local inputs and prints the
proposed payload; it cannot detect live API incompatibilities. Changing only
`--agent-voice marin` does not add the missing audio settings, supply tool
definitions, or implement the separate grading flow.

The current `run` implementation attempts the following sequence with uniquely
named resources, without modifying the original agent/toolbox. These are
implementation details, **not a verified successful execution**:

1. Uploads `airline_lookup_default.py` and waits for **Processed**.
2. Creates a Code Interpreter container, reads the actual mounted file path
   from service metadata, and verifies the mounted file's SHA-256.
3. Creates a toolbox and Voice Agent, substitutes that path/toolbox in the
   original prompt, reads back the agent, and enables it.
4. Registers the five supplied rubric dimensions with weights `4, 4, 9, 3, 5`,
   `general_quality` always applicable, and a normalized threshold of `0.5`.
5. Pins the toolbox, agent, and evaluator versions, then submits cloud voice
   conversation simulation with **conversation-level** evaluation.
6. Polls the run, downloads every page of output items, and writes the scores.

Defaults were copied from the portal snapshot: managed `gpt-realtime-2.1`, OpenAI `Marin`, simulated
caller `en-US-Ava:DragonHDLatestNeural`, one scenario/repetition, and a maximum
of ten turns. Use `--agent-model`, `--agent-voice`, `--agent-voice-type`,
`--simulator-model`, `--judge-model`, or `--caller-voice` when necessary.
Inspect `run --help` for the full options. The runner caps each run at twenty
conversations, each with at most twenty turns, to bound accidental spend.

**Artifacts and recovery:** the output folder must not already exist. It holds
`request.json`, a progressively updated `receipt.json`, upload/container
metadata, rendered `agent_prompt.txt`, `resolved_request.json`, `run.json`,
`output_items.json`, and, for an entirely passing run, `summary.json`. Files
appear as their stages complete. The raw run and conversation results are
retained before checking completion, expected counts, and rubric scores.
A failed/errored/incomplete run, invalid result, or failing rubric returns a
nonzero exit code; the runner does not interpret mere completion as success.

If an earlier attempt submitted a run and saved its IDs in `receipt.json`, a
polling timeout does not cancel that cloud run. **Do not repeat `run`.**
Retrieve that same submitted evaluation into a new local folder:

```powershell
.\.venv\Scripts\python.exe run_evaluation.py results `
  --receipt .\voice-agent-output\airline-eval-01\receipt.json `
  --output .\voice-agent-output\airline-eval-01-results `
  --timeout-seconds 900
```

`results` only retrieves results; it never creates another agent or evaluation.
It does not fix a rejected rubric, change mappings, or submit the separate
transcript-grading step described above.
If provisioning failed before a run ID was saved, inspect the receipt and
Foundry before submitting again. Creation calls are not automatically retried;
a lost response may still mean the server created a resource. There is no
automatic deletion, cancellation, or provisioning-resume operation. Retain the
receipt and clean up its uniquely named test resources through your project's
approved process.

### Implementation details and differences from the portal run

The runner uses the native SDK rubric definition, translating the snapshot's
`pass_score_threshold` to API field `pass_threshold`; `rubric.json` itself is
still not an API import payload. It uses the SDK's `evaluators.create_version`
and the conversation-simulation preview API (`2025-11-15-preview`).
The original rubric generation prompt is documentation: the script registers
the already-reviewed dimensions directly instead of generating them again.
It honors the service's `passed` flag as well as the threshold; a dimension
scoring 1 can cause failure regardless of the aggregate score.

Unlike the portal's automatic Code Interpreter container, the runner uses an
explicit container so it can resolve the mounted path without an extra LLM
conversation or an invented filename. All conversations in this run share that
container. The supplied functions are stateless, but this is not isolated
per-conversation tool execution. Containers expire according to the service's
lifetime rules; create a fresh run rather than reusing an expired toolbox.

The agent sets `store=True`, retaining cloud conversation/audio artifacts for
inspection. `--save-conversations` additionally asks the simulator to generate
a conversation dataset; it does not control agent storage. This command saves
returned evaluation JSON, not downloaded WAV files or independently verified
tool execution traces. Use only the fictional sample inputs and keep the
ignored output directory private.

The runner is covered by offline SDK request/response tests, whose synthetic
fixtures assume the original mappings and grading mode are accepted. Those
tests did not reveal the live failures reported above and must not be cited as
evidence of end-to-end service compatibility. **The author has not independently
executed the corrected workflow against Azure.** Feature support, quotas,
permissions, and the Files/Containers endpoint also depend on the target
project. A new simulation is nondeterministic and need not reproduce the
original `0.943` score. The fifteen screenshots above document the original
portal workflow, not execution of the runner or the external wrappers.

## Input files and offline preparation

Only the **Python file** and **scenario JSONL** are uploaded as files. Paste the
agent prompt into **Instructions**, and enter the rubric in the evaluator
editor. Do not upload the README, screenshots, helper, tests, or settings JSON
as agent tools.

| File | Where to use it |
| --- | --- |
| [airline_lookup_default.py](airline_lookup_default.py) | Step 1: upload to Code Interpreter. |
| [agent_prompt.md](agent_prompt.md) | Step 2: replace the mounted path and paste into Instructions. |
| [scenarios.jsonl](scenarios.jsonl) | Step 4 or 9: upload the single simulated-caller scenario. |
| [rubric.json](rubric.json) | Step 5: copy the generation prompt, dimensions, weights, and threshold; **not** an API import payload. |
| [evaluation_settings.json](evaluation_settings.json) | Steps 2-13: reference checklist for all portal values; **not** an API import payload. |
| [prepare_example.py](prepare_example.py) | Optional offline generation of ready-to-paste inputs. |
| [run_evaluation.py](run_evaluation.py) / [requirements.txt](requirements.txt) | Preliminary SDK runner and pinned dependencies; see the known live compatibility issues before running. |
| [test_airline_lookup_default.py](test_airline_lookup_default.py) / [test_prepare_example.py](test_prepare_example.py) | Offline checks for the mock functions and input preparation. |
| [test_run_evaluation.py](test_run_evaluation.py) | Offline SDK serialization, orchestration, and failure-handling tests. |
| [screenshots/](screenshots/) | Image assets for the fifteen figures embedded in this tutorial. |

The helper needs Python 3.10+ but no third-party packages or repository SDK
dependencies. From the repository root:

```powershell
python samples\foundry_evaluation\prepare_example.py --check

$uploadedPath = Read-Host "Paste the actual uploaded /mnt/data/... Python path"
python samples\foundry_evaluation\prepare_example.py `
  --uploaded-python-path $uploadedPath
```

The helper writes six files to the ignored `.generated` subfolder: the Python
tool, scenario JSONL, rubric JSON, evaluation settings checklist, rendered
`agent_prompt.txt`, and `rubric_generation_prompt.txt`. Paste the two text files
into the corresponding portal fields. It performs no uploads or Azure calls.
It refuses to overwrite an existing output folder; use `--output` with a new
local path for another preparation. If you named the toolbox differently, pass
`--toolbox-name` to keep the generated prompt and settings consistent.

You can use this directory on its own: run the helper from inside it without
the `samples\foundry_evaluation\` prefix.

## Reference and troubleshooting

### Find the uploaded Python path

If the upload dialog shows only the filename, before installing the final
instructions use a disposable setup agent/preview with the same toolbox. Ask
it to execute the following **in Code Interpreter** and return the printed
path. This setup-only discovery step may incur inference/tool costs; it is not
part of the evaluated conversation.

```python
from pathlib import Path

matches = sorted(Path("/mnt/data").glob("*airline_lookup_default.py"))
if len(matches) != 1:
    raise RuntimeError(f"Expected one uploaded sample file; found {len(matches)}")
print(str(matches[0]))
```

Use the printed path for the preparation command, then install the final prompt.
Do not guess a path when no match is returned. Remove unintended/duplicate
attachments if multiple matches are returned. The final evaluation prompt
deliberately prohibits filesystem discovery; the agent under test must use
the configured exact path instead. Pin the saved agent version containing
that final prompt, even if its version number differs from the screenshots.

### Tool behavior and execution

The simulator, agent, and judge have different roles. The scenario instructs
the simulated caller, not the agent. The rubric grades the conversation; it
does not execute the reservation tool.

```text
Scenario JSONL -> simulated caller <-> Airline-Agent
                                          |
                                   Code Interpreter
                                          |
                               airline_lookup_default.py

Conversation messages -> custom rubric + judge model -> scores and reasons
Tool execution traces -> separate inspection of arguments, execution, and output
```

The file exposes two functions **inside Code Interpreter**, not two client-side
function tools:

| Function | Inputs | Output |
| --- | --- | --- |
| `lookup_reservation` | `user_id`, `reservation_id` | Fixed customer/booking data, echoed IDs, and the fixed reference time. |
| `check_refund_eligibility` | `created_at`, `reference_time` | Eligibility, booking age, reason, and flags confirming no reservation/refund mutation. |

The fixed record contains:

```json
{
  "mock": true,
  "customer_name": "Emma Kim",
  "reference_time": "2024-05-15T15:00:00",
  "time_zone": "EST (benchmark fixed time)",
  "reservation": {
    "user_id": "emma_kim_9957",
    "reservation_id": "EHGLP3",
    "created_at": "2024-05-04T23:12:06"
  }
}
```

`lookup_reservation` accepts any string containing at least one alphanumeric
character and echoes the supplied IDs. **It does not check whether those IDs
exist, match this customer, or belong together.** Its docstring is shorthand:
underscores and other punctuation are allowed, as in the sample user ID.

The timestamp strings are timezone-naive; the `time_zone` label is descriptive
metadata, not a timezone conversion. Eligibility uses the difference between
the two returned timestamps, not today's clock or a flight departure time.
Exactly 24 hours is eligible; strictly more than 24 hours is ineligible. The
sample booking is approximately `255.7983` hours old and therefore ineligible.

After collecting both IDs, the intended Code Interpreter execution is
equivalent to the following. Replace the placeholder before using it:

```python
import json
import runpy

functions = runpy.run_path("<UPLOADED_PYTHON_PATH>")
record = functions["lookup_reservation"](
    user_id="emma_kim_9957", reservation_id="EHGLP3"
)
eligibility = functions["check_refund_eligibility"](
    record["reservation"]["created_at"], record["reference_time"]
)
print(json.dumps({"lookup": record, "eligibility": eligibility}))
```

These are illustrative tool-execution instructions, not a script that creates
the Foundry agent.

### About the screenshots

All fifteen figures are real captures from the example's preview portal. The
wizard was staged for documentation **without submitting** another run, with
the target explicitly pinned to version `1`. Result screenshots come from the
original completed run. Captures exclude the account header, some trailing
whitespace is cropped, and the run author's name is visibly redacted. Scores
and configuration values have not been altered.

## Offline checks

From the repository root, the original mock/preparation checks need no
third-party packages or Azure calls:

```powershell
python -m unittest discover -s samples\foundry_evaluation -p "test_airline_lookup_default.py" -v
python -m unittest discover -s samples\foundry_evaluation -p "test_prepare_example.py" -v
```

For all checks, including the end-to-end runner's synthetic HTTP tests, install
this sample's `requirements.txt` as above, then run from the sample directory:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_*.py" -v
```

All tests are offline. The runner tests use the real pinned SDK clients and
synthetic service responses, not Azure credentials or live evaluations. No new
cloud run was submitted to prepare this walkthrough.

## Limits and follow-up coverage

This single run demonstrates one multi-turn sample and a rubric judgment. It
does not measure transcription accuracy, pronunciation, audio quality,
interruption handling, or real cancellation processing. The results row showed
no audio artifact; this guide does not claim playback was assessed.

Before using this approach as a regression suite, add separate scenarios for
missing/changed identifiers, ambiguous spoken characters, a lookup failure,
within/exactly/beyond-24-hour bookings, and requests to execute cancellation.
Those are recommended extensions, not cases covered by the observed run. The
current mock has a fixed old booking and no transient-failure injection; testing
those branches requires deliberate new test fixtures and rubric expectations.
