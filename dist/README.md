# SDK packages

Python samples now install `azure-ai-projects>=2.7.0`
from PyPI, using the `[voice]` extra for SDK voice connections. Use the
requirements files under `samples/` to install the public package.

The [Python GPT Live samples](../samples/gpt_live/python/README.md) are the exception:
they install the bundled preview wheel below, which adds the GPT Live agent models
and Live WebSocket client that are not yet in a PyPI release. The
[browser GPT Live sample](../samples/gpt_live/js/README.md) likewise installs the
bundled preview `@azure/ai-projects` package described below.

## Bundled Python preview build: azure-ai-projects 2.11.0

`azure_ai_projects-2.11.0-py3-none-any.whl` was built from the unmodified
`sdk/ai/azure-ai-projects` package on the Azure SDK for Python feature branch that
merged the GPT Live client. It is a preview build, not a release; PyPI's latest
release was 2.9.0 when it was added.

- Branch: [`feature/azure-ai-projects/vnext`](https://github.com/Azure/azure-sdk-for-python/tree/feature/azure-ai-projects/vnext/sdk/ai/azure-ai-projects),
  which contains [Azure/azure-sdk-for-python#49631](https://github.com/Azure/azure-sdk-for-python/pull/49631)
  "[azure-ai-projects] Add GPT Live WebSocket clients and samples" and
  [Azure/azure-sdk-for-python#49836](https://github.com/Azure/azure-sdk-for-python/pull/49836)
  "[azure-ai-projects] Refresh voice agent recordings for sub_protocol". #49836 changes only
  test recordings, and its merge commit predates #49631, so the branch head is used.
- Commit: [`5649a953fea77213307e8b2e6d4f441ec1c86c60`](https://github.com/Azure/azure-sdk-for-python/tree/5649a953fea77213307e8b2e6d4f441ec1c86c60/sdk/ai/azure-ai-projects)
  (November 6, 2026)
- Adds: `VoiceAgentLiveDefinition` with `greeting` and `structured_inputs`, the client,
  Responses, and Foundry-managed Live delegation models, Live event models,
  `beta.voice_agents.live_conversations`, and the `beta.voice_agents.live` WebSocket client
  used for the samples' audio sessions (requires the `[voice]` extra).
- Package version: `2.11.0`
- Built: November 9, 2026, using Python 3.12.10 on Windows (`core.autocrlf=false`, LF checkout),
  `python -m build --wheel --no-isolation`
- Build tools: `build==1.6.0`, `setuptools==84.0.0`, `wheel==0.48.0`
- SHA-256: `bda7efbf70324e4306cf6a40d032b6f1ae1beefdd79d4de9419bd9b5cb46050b`
- License: MIT

## Bundled JavaScript preview build: @azure/ai-projects 2.11.0

The [browser GPT Live sample](../samples/gpt_live/js/README.md) installs
`azure-ai-projects-2.11.0.tgz`, a local build of the `sdk/ai/ai-projects` package from the
merge of the Azure SDK for JavaScript pull request that adds the native GPT Live client. The
feature branch has no CI build, so this is a source build, not a pipeline artifact or a
release; npm's latest release was 2.9.0 when it was added.

- Source: [Azure/azure-sdk-for-js#40419](https://github.com/Azure/azure-sdk-for-js/pull/40419)
  "[ai-projects] Add native GPT Live client, samples, and tests", merged into
  [`feature/ai-projects/vnext`](https://github.com/Azure/azure-sdk-for-js/tree/feature/ai-projects/vnext/sdk/ai/ai-projects)
- Commit: [`86517ee63ee15bc5be430e655d950e7ff900e2c3`](https://github.com/Azure/azure-sdk-for-js/tree/86517ee63ee15bc5be430e655d950e7ff900e2c3/sdk/ai/ai-projects)
  (the merge commit and branch head, November 7, 2026)
- Adds: GPT Live agent definitions with `greeting` and `structured_inputs`,
  `beta.voiceAgents.live` (the Live WebSocket client, with Node.js and browser transports),
  and `beta.voiceAgents.liveConversations`.
- Package version: `2.11.0`
- Built: November 9, 2026, with Node.js 22.23.4 and TypeScript 6.0.3 (the repository's catalog
  version), using the repository's own build tool, `common/tools/warp`, with the package's
  `warp.config.yml`. It type-checks and emits all four targets the package publishes: `browser`,
  `react-native`, `esm`, and `commonjs`. No source file was changed.
- Packaging: `npm pack` of the package's `files`, after resolving the `workspace:` and
  `catalog:` development-dependency ranges to versions, as `pnpm pack` does.
- SHA-256: `38bd7c9f16f77208dacc846149e13bca9e7ef25aa4399571ff0704b4698555a9`
- License: MIT

The .NET sample installs the published
[`Azure.AI.Projects`](https://www.nuget.org/packages/Azure.AI.Projects/3.0.0-beta.3)
and [`Azure.AI.Projects.Agents`](https://www.nuget.org/packages/Azure.AI.Projects.Agents/3.0.0-beta.3)
3.0.0-beta.3 preview SDK packages from NuGet.org. No .NET packages are bundled. See the
[C# setup instructions](../samples/CSharp/README.md) for package and restore details.

## Historical .NET preview build record

The removed bundled package used the same `3.0.0-beta.3` version as the public
release but was a separate preview build. It is no longer a sample dependency.

- Source archive: `Azure.AI.Projects.Agents.3.0.0-beta.3-voice-samples.zip`
- Package: `Azure.AI.Projects.Agents.3.0.0-beta.3.nupkg`
- SDK repository commit recorded in package: `4c94d5d53db51d0fd8089a341ccbe11d4ff9f65d`
- SHA-256: `16f5214c679488943d103a32b7a0fff1321e08815f50400bf14c3f62f3e62329`
- License: MIT

## Historical Python preview build record

The removed preview wheel was built from the unmodified
`sdk/ai/azure-ai-projects` package in the Azure SDK for Python repository.
This record describes the SDK used for the September 16-17 evaluations,
not a current sample dependency.

- Branch: [`xitzhang/voice-agent-pupr`](https://github.com/Azure/azure-sdk-for-python/tree/xitzhang/voice-agent-pupr/sdk/ai/azure-ai-projects)
- Commit: [`f84c5330f4246892455f33fccdf9503a774ecf66`](https://github.com/Azure/azure-sdk-for-python/tree/f84c5330f4246892455f33fccdf9503a774ecf66/sdk/ai/azure-ai-projects)
- Package version: `2.7.0b1`
- Built: September 15, 2026, using Python 3.12.10 on Windows (`core.autocrlf=false`, LF checkout)
- Build tools: `build==1.6.0`, `setuptools==84.0.0`, `wheel==0.48.0`
- SHA-256: `f857a1281e2fa3414f25e02aed95dfe2275495027b0a764f38921a8589f15e75`
