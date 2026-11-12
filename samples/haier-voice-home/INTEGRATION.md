# 客户接入指南：部署 Agent、API 对话与真实设备工具

本文面向海尔国内客户环境，按三个步骤组织：

1. 在客户自己的 Foundry project 中部署、配置 **Microsoft Realtime Flash** Voice Agent。
2. 通过 WebSocket 或 WebRTC 与**同一只已保存的 Voice Agent** 对话。
3. 把工具执行连接到真实设备，选择直接设备 API 或 MCP。

**Voice Agent 使用 Voice Live，但不等于 Voice Live。**
本指南的对话入口是 Foundry Agent endpoint，而不是直接指定模型的 Voice Live endpoint。
所有命令中的资源参数均由客户提供，不包含预置资源或访问密钥。

## 第 1 节：部署和配置 Voice Agent

### 1.1 前置条件与身份

准备 Node.js 24.5+、npm、Azure CLI，以及客户自己的 Foundry resource / project。
国内环境仅支持 **Microsoft Realtime Flash**，无需准备海外 `gpt-realtime` 系列模型。
当前仓库默认模型 ID 为 `microsoft-realtime-flash-1`；若客户项目模型目录中显示的精确 ID 为不带版本号的 `microsoft-realtime-flash`，后端和模板同样支持（只需在 `agents/flash.json`、`.env` 的 `HAIER_SECONDARY_MODEL_ID` 与 `HAIER_VERIFIED_MODELS` 中保持一致）。
请在目标项目中确认模型访问资格、配额，以及 Azure Speech streaming transcription 和下方语音配置的区域支持情况。

`model_type: managed` 直接绑定服务托管模型，不需要预先创建同名 Azure OpenAI model deployment。
若客户环境采用 `self_deployed` 模式，则需先部署对应模型并同步调整 `model_type` 与 `model` 字段。

管理身份需要读取、创建/更新及启用 Agent 的项目权限（如 `Foundry Agent Developer`）；运行态服务仅需调用权限（如 `Foundry Agent Consumer`）。
生产环境推荐使用应用自身的 Managed Identity，不要为运行服务授予订阅级 Owner，也不要将 API key 或 Entra token 下发到浏览器。

```bash
# 以下变量均替换为客户自己的值。不要把填好的脚本或 .env 提交到 Git。
export AZURE_TENANT_ID="<your-tenant-id>"
export AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
export FOUNDRY_PROJECT_ENDPOINT="https://<resource>.services.ai.azure.com/api/projects/<project>"
export HAIER_FLASH_AGENT="<your-flash-agent-name>"

az login --tenant "$AZURE_TENANT_ID"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

# 从仓库根目录进入样例；此前已在该目录时不要重复 cd。
cd samples/haier-voice-home
npm ci
```

`az account set` 用于指定 CLI 默认订阅；Agent 发布和对话均以 `FOUNDRY_PROJECT_ENDPOINT` 指向的项目为准。

### 1.2 可审阅的 Agent YAML

下面以与 Foundry Portal 一致的单 Agent YAML 格式展示 Flash Agent 的 `definition` 结构。
源码基础模板（`agents/flash.json`）中 `instructions` 和 `tools` 留空，由生成脚本从 `server/instructions.*` 与 `server/tools.ts` 自动合并填入，避免维护两份重复定义。
Foundry REST API 接收 JSON 请求体，请使用 1.3 节生成的 JSON 文件提交，不要直接把 YAML 作为 `--body` 上传。

```yaml
kind: voice
model: microsoft-realtime-flash-1
model_type: managed
sub_protocol: realtime
instructions: "" # 由 server/instructions.ts 和 instructions.txt 填入
tools: [] # 由 server/tools.ts 填入完整 function schema
store: false
output_modalities: [audio, text]
structured_inputs:
  welcome_text:
    description: Initial welcome only; speech recognition remains bilingual.
    schema:
      type: string
      minLength: 1
      maxLength: 200
    default_value: 你好，我是小海，你的家庭助手。今天想让我帮你做点什么？
greeting:
  type: template
  text: "{{{welcome_text}}}"
audio:
  input:
    format:
      type: audio/pcm
      rate: 24000
    echo_cancellation:
      type: server_echo_cancellation
      reference_source: server
      channels: 1
    noise_reduction:
      type: azure_personal_noise_suppression
      detection_input: mas_dns
    transcription:
      model: azure-speech-streaming
      language: zh-CN,en-US
    turn_detection:
      type: azure_semantic_vad
      profile: normal
      auto_truncate: true
      create_response: true
      interrupt_response: true
      remove_filler_words: false
  output:
    format:
      type: audio/pcm
      rate: 24000
    voice: zh-CN-Xiaoxiao:DragonHDFlashLatestNeural
    voice_type: azure-standard
```

权威配置源码位于 `agents/flash.json`、`server/voice-profile.ts`、`server/greeting.ts`、`server/instructions.*` 和 `server/tools.ts`。
界面初始语言仅决定连接时的 `welcome_text`，后续语音识别保持中英双语自动检测（`zh-CN,en-US`）。
若目标国内区域对个别输入子项（如 `noise_reduction.detection_input: "mas_dns"` 或特定 `transcription.model`）存在版本限制，可在 Foundry Portal 中调整该子项；`npm run agents:publish` 在更新已有 Flash Agent 时会保留 Portal 中已配置的降噪和转录设置。

### 1.3 生成完整定义

```bash
# 完全离线渲染，不访问或修改 Azure。
npm run agents:render

# 仅提取客户所需的 Flash 定义，包装为 authoring API 请求体。
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const definitions = JSON.parse(
  readFileSync(".local/agent-definitions.json", "utf8"),
);
writeFileSync(
  ".local/flash.request.json",
  `${JSON.stringify({ definition: definitions.flash }, null, 2)}\n`,
  { mode: 0o600 },
);
NODE
```

检查 `.local/flash.request.json`：应包含完整的 `instructions`、全部 7 个工具 schema、`greeting`、音频参数与动态 VAD。
新模板默认 `store: false`（不开启服务端会话落盘）；更新已有 Agent 时会保留其原有 `store` 配置。

### 1.4 发布：推荐使用带校验的发布脚本

```bash
npm run agents:publish -- \
  --confirm-project "$FOUNDRY_PROJECT_ENDPOINT"
```

脚本默认仅发布 `HAIER_FLASH_AGENT` 单只 Flash Agent，要求 `--confirm-project` 与 `FOUNDRY_PROJECT_ENDPOINT` 完全一致并拒绝示例占位符。
更新已有 Agent 时会合并保留 Portal 侧其他字段、拒绝跨模型类型覆盖、发布前检查版本并发变更，并在发布后逐字段读回校验。

### 1.5 等价的 `az rest` 发布与读回命令

如果不使用 Node 脚本，也可以直接用 `az rest` 调用底层 API（与 1.4 节二选一，无需重复执行；注意直接 POST 会按请求体完整写入新版本，更新已有 Agent 时建议优先用 1.4 节脚本保留 Portal 字段）：

```bash
export AUTHORING_API_VERSION="2025-11-15-preview"

az rest --method post \
  --url "$FOUNDRY_PROJECT_ENDPOINT/agents/$HAIER_FLASH_AGENT/versions?api-version=$AUTHORING_API_VERSION" \
  --resource "https://ai.azure.com" \
  --headers "Content-Type=application/json" "Foundry-Features=VoiceAgents=V1Preview" \
  --body @.local/flash.request.json \
  --query "{version:version,status:status}" --output json

# 读回服务端实际保存的最新版本为 YAML 进行核对。
az rest --method get \
  --url "$FOUNDRY_PROJECT_ENDPOINT/agents/$HAIER_FLASH_AGENT?api-version=$AUTHORING_API_VERSION" \
  --resource "https://ai.azure.com" \
  --headers "Foundry-Features=VoiceAgents=V1Preview" \
  --query "versions.latest" --output yaml > .local/flash.saved.yaml
```

核对返回的 `version`、`status: active`、模型 ID 及音频字段。若目标项目中的 Agent 处于未启用状态，可按服务接口显式启用：

```bash
az rest --method post \
  --url "$FOUNDRY_PROJECT_ENDPOINT/agents/$HAIER_FLASH_AGENT:enable?api-version=v1" \
  --resource "https://ai.azure.com" \
  --headers "Foundry-Features=VoiceAgents=V1Preview"
```

最后在 `samples/haier-voice-home/.env` 中写入完整服务端配置（完成实际连通性验证后设置 `HAIER_VERIFIED_MODELS`）：

```dotenv
FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
HAIER_FLASH_AGENT=<your-flash-agent-name>
HAIER_SECONDARY_MODEL_ID=microsoft-realtime-flash-1
HAIER_VERIFIED_MODELS=microsoft-realtime-flash-1
```

## 第 2 节：通过 API 与 Voice Agent 对话

### 2.1 共同的鉴权与 endpoint

两种传输都选择 Agent **name**，不是模型名、旧 assistant ID 或资源 ID。
对客户同一只 Flash Agent，只使用其实际项目和模型支持的传输建立 session；
WebRTC 是否可用需要单独确认，不能根据另一种模型或海外项目的验证结果承诺支持。
token 由受信任后端取得，scope/resource 是 `https://ai.azure.com`：

```bash
# 仅供服务端调试；不要 echo、写入 URL、提交或发送给浏览器。
TOKEN="$(az account get-access-token \
  --resource https://ai.azure.com \
  --query accessToken --output tsv)"
# 使用后清理当前 shell 变量。
unset TOKEN
```

实际 Node 服务优先使用 Azure Identity SDK，不让脚本反复获取 token。
生产场景使用应用身份；用户/家庭/设备权限仍由客户应用单独判断，服务 token 不等于最终用户授权。
不要把长期凭据硬编码到浏览器 WebSocket subprotocol、DataChannel、日志或 localStorage。

### 2.2 WebSocket：音频与事件经后端转发

```text
wss://<resource>.services.ai.azure.com/api/projects/<project>/agents/<agent-name>/endpoint/protocols/voice?api-version=v1
```

后端握手使用 `Authorization: Bearer <server-acquired-token>`。
可增加 `agent_session_id=<unique-id>`，通过 URL 编码的 `structured_inputs`
传入 `{"welcome_text":"你好，我是小海，你的家庭助手。今天想让我帮你做点什么？"}`。
这些参数不是浏览器可任意覆盖 instructions/tools 的通道。
如需复现固定版本，按服务支持的 `x-agent-version-override` 选择经验证的版本，
不要把另一个 Agent 的版本号直接套用。

```mermaid
sequenceDiagram
  participant B as Browser / Device client
  participant R as 客户后端 relay
  participant A as Foundry Voice Agent (Flash)
  B->>R: 建立会话
  R->>A: 鉴权 WebSocket + structured_inputs
  R->>A: session.update (PCM 24kHz + tool_choice:required)
  A-->>R: session.updated + 开场 greeting response.done
  R-->>B: 会话就绪 (demo.ready)
  B->>R: 用户文本或 24kHz PCM 音频帧
  R->>A: conversation.item.create / input_audio_buffer.append
  A-->>R: 静默 function_call
  R->>R: 播放短 backchannel（隐藏其 transcript）+ 鉴权执行真实工具
  R->>A: function_call_output + response.create (tool_choice:none)
  A-->>B: 单条完成结果语音与字幕，经 relay 转发
```

**握手后的会话初始化（关键）**：连接打开后，后端发送一次 `session.update` 固定音频采样率、音色和工具策略。针对 `microsoft-realtime-flash-1` 等轻量实时模型，建议将会话级 `tool_choice` 设为 `"required"` 以确保设备控制指令稳定触发工具调用；同时等待收到 `session.updated` **以及**开场欢迎语的 `response.done` 后，再允许客户端发送首轮输入，避免与欢迎语抢话：

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "<server-owned-instructions>",
    "tools": [],
    "tool_choice": "required",
    "output_modalities": ["audio", "text"],
    "audio": {
      "input": { "format": { "type": "audio/pcm", "rate": 24000 } },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "voice": {
          "type": "azure-standard",
          "name": "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural"
        }
      }
    }
  }
}
```

（注：上方 `"tools": []` 在实际代码中填入 `server/tools.ts` 的工具数组；不要在连接时的 `session.update` 里重置已保存 Agent 的 `turn_detection`、`noise_reduction` 或 `transcription`，以保留服务端已发布的配置。在工具执行完成后的续写 `response.create` 中再显式传 `{"tool_choice": "none"}`，防止模型再次循环调用工具。）

**文本输入**由两个 JSON frame 组成：

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [{ "type": "input_text", "text": "请打开电视。" }]
  }
}
```

```json
{ "type": "response.create" }
```

**音频输入**使用 base64 编码的原始 PCM16 little-endian，24 kHz mono，
不是 WAV 文件、MP3 或 WebM。下面的值只是两个静音样本的 wire-format 示例：

```json
{ "type": "input_audio_buffer.append", "audio": "AAAAAA==" }
```

连续实时发送合理长度的分片。使用自动 VAD 时由服务管理回合，不要对每个分片重复 commit/create。
非自动模式才按该模式的协议提交缓冲区。浏览器采样率可能是 48 kHz，必须正确重采样；
不能只把 metadata 写成 24 kHz。现成实现见 `src/lib/capture-worklet.ts`、`audio.ts` 和 `pcm.ts`。

关键返回事件：

| 事件                                                                 | 客户端职责                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `session.created` / `session.updated`                                | 核对 session；配置确认不等于 greeting 已结束                      |
| `response.audio.delta` / `response.output_audio.delta`               | base64 解码，按协议采样率排队播放 PCM                             |
| `response.audio_transcript.*` / `response.output_audio_transcript.*` | 增量与最终 assistant transcript                                   |
| `conversation.item.input_audio_transcription.completed`              | 用户语音转录                                                      |
| `response.function_call_arguments.done`                              | 在受信任后端按 allowlist 执行工具，不能直接交给浏览器执行任意命令 |
| `response.done`                                                      | 检查 completed/failed/cancelled，处理回合与工具 continuation      |
| `input_audio_buffer.speech_started`                                  | 处理打断，停止客户端已排队的旧输出                                |
| `error`                                                              | 显式失败、清理连接；不要回退为伪造回复                            |

工具返回使用与原 call 相同的 `call_id`：

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "<the-original-call-id>",
    "output": "{\"ok\":true,\"status\":\"succeeded\"}"
  }
}
```

```json
{
  "type": "response.create",
  "response": { "tool_choice": "none" }
}
```

随后由编排器发起带 `"tool_choice": "none"` 的 `response.create`，避免与已有 response 重叠或重复触发工具。
`ok: true` 必须来自真实执行结果，不能照抄示例伪造成功。
本样例还会在工具前生成短 backchannel、隐藏其 transcript，并在工具后只显示一条完成回答。
若模型在同一 response 先生成 message 再调用函数，relay 会发送
`demo.discard-assistant-output`（携带 `itemIds`），要求浏览器停止排队音频并删除对应消息，
同时丢弃这些 item 的后续输出。它是**应用自己的事件，不是 Azure 原生协议事件**，
自定义客户端需要实现相同处理；不能只处理原生 `response.*` 而忽略它。
已经播放的声音无法撤回，此机制用于截断余下的错误过程输出。
具体调度、取消、去重与错误处理见 `server/voice.ts` 和 `tests/server-voice.test.ts`。

**可直接运行的完整应用路径**：

```bash
# 在完成 Agent 配置的 samples/haier-voice-home/ 目录：
npm run dev
# 浏览器打开 http://127.0.0.1:5178，使用文字或麦克风交互。
```

浏览器连接的是应用自己的 `/api/voice?model=...&language=...`；
Node 把 allowlisted model 映射到保存的 Agent name，再打开上面的 Azure endpoint。
两层 URL 不能互换。外部应用复用 relay 时必须保持同源、认证和家庭隔离。

### 2.3 WebRTC：仍然调用同一只 Voice Agent

**Agent-mode WebRTC** 的服务端信令入口：

```text
wss://<resource>.services.ai.azure.com/api/projects/<project>/agents/<agent-name>/endpoint/protocols/voice?api-version=v1&transport=webrtc&agent_session_id=<unique-id>
```

token 同样留在后端。后端建立这个 WebSocket control-channel，浏览器通过客户应用自己的
鉴权信令接口交换 SDP；音频随后在浏览器与服务之间走 WebRTC RTP。
本节给出客户 Flash Agent 的候选信令接入方式；必须先验证目标项目和 Flash 模型对
该 transport 的支持，不把其他模型的 WebRTC 验证当作 Flash 的验收。不讨论 GPT Live 的另一套协议。

```mermaid
sequenceDiagram
  participant B as Browser RTCPeerConnection
  participant R as 客户鉴权信令后端
  participant A as 同一只 Foundry Voice Agent
  B->>B: 麦克风、voice-live-events DataChannel、SDP offer
  R->>A: 鉴权 WS，transport=webrtc
  B->>R: SDP offer
  R->>A: rtc.call.sdp.create
  A-->>R: rtc.call.sdp.created + sdp_answer
  R-->>B: SDP answer
  B->>B: setRemoteDescription，等待 ICE/连接就绪
  B->>A: WebRTC RTP 麦克风音频
  A-->>B: WebRTC RTP 输出音频 / DataChannel 事件
  Note over R,A: control-channel 保留至会话结束；工具执行保持服务端授权
```

浏览器需要创建 `RTCPeerConnection`，加入麦克风 track，并在生成 offer **之前**创建
`voice-live-events` DataChannel；本节的 realtime 协议 SDP 需要相应的 SCTP/application media section。
按部署网络配置 STUN/TURN，等待 ICE gathering 完成或按服务支持的 candidate 流程处理。
SDP 经鉴权信令后端发送下面的 JSON，而不是 POST 到另一个 model-mode endpoint：

```json
{
  "type": "rtc.call.sdp.create",
  "sdp_offer": "<the-full-browser-local-description-sdp>"
}
```

接收：

```json
{
  "type": "rtc.call.sdp.created",
  "sdp_answer": "<the-service-sdp-answer>"
}
```

核心浏览器片段如下，展示 API 对接点，**不是独立可运行的完整客户端**：

```javascript
async function negotiateAgentWebRtc({
  iceServers,
  exchangeOffer,
  remoteAudio,
  onAgentEvent,
}) {
  const peer = new RTCPeerConnection({ iceServers });
  const microphone = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  microphone.getAudioTracks().forEach((track) => {
    track.enabled = false; // 等媒体、配置和 greeting 就绪后才允许上传
    peer.addTrack(track, microphone);
  });
  const events = peer.createDataChannel("voice-live-events");
  events.onmessage = ({ data }) => onAgentEvent(JSON.parse(data));
  peer.ontrack = ({ streams }) => {
    remoteAudio.srcObject = streams[0];
  };
  await peer.setLocalDescription(await peer.createOffer());
  // exchangeOffer 必须有界等待 ICE gathering、使用完整 localDescription，
  // 通过客户已鉴权后端转发 rtc.call.sdp.create 并接收 sdp_answer。
  const answer = await exchangeOffer(peer);
  await peer.setRemoteDescription({ type: "answer", sdp: answer });
  return { peer, microphone, events };
}
```

`exchangeOffer`、就绪门控、超时/失败清理、自动播放用户手势和结束会话由客户实现。
在 ICE/配置/greeting 都就绪后才 enable track；失败或结束时关闭 peer/control-channel，
停止所有麦克风 track。WebRTC 的 codec/sample rate 由 SDP 协商，
不要把 RTP 当作 WebSocket 的 base64 PCM，也不要向 RTP 写入 JSON。

同一个 function tool 的执行权不会因为换成 WebRTC 自动迁到浏览器。
后端必须接收/处理相应 function events，并在受支持的 control/event 路径返回
`function_call_output`，保留 call ID、授权、去重和完成确认。
如果同一 event 在 control-channel 与 DataChannel 都可见，要选定权威事件源并去重，
不能执行两次动作。backchannel 的 transcript 若直接从 DataChannel 到达，
还需 UI 按后端提供的 backchannel response identity 过滤；
仅依赖现有 WebSocket relay 的过滤代码不能覆盖这条直达路径。

**仓库现状与可复用实现**：

| 路径                                                                    | 已提供什么 / 没提供什么                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 本样例 `server/voice.ts`、三个 UI                                       | 已接通 Haier 的 WebSocket relay、家庭工具和 backchannel；没有接上 Agent-mode WebRTC |
| `../foundry_voice_webrtc/server.py` 的 `Config.voice_url()` / `relay()` | 同一个保存的 Agent 的 WebSocket/WebRTC endpoint 与信令参考                          |
| `../foundry_voice_webrtc/public/app.js` 的 `connectWebRtc()`            | SDP、ICE、麦克风、DataChannel 和远端音频参考                                        |
| 本样例 `server/webrtc-benchmark.ts`                                     | **直接 Voice Live model-mode lab**；不是这里的 Agent-mode 接入实现                  |

参考 sample 有自己的 Agent 创建/设置逻辑与业务场景，**不等于已装好 Haier 工具执行器**。
不要直接启动其 create/reset/apply-settings 流程去覆盖已保存的 Haier Agent。
客户若要在 Haier UI 切换 WebRTC，需要把信令、真实工具与 backchannel 编排一起接入并验收；
不能仅给当前 `/api/voice` 添加 `transport=webrtc` 就宣称完成。

Agent-mode、model-mode 和 Azure OpenAI 的 `/openai/v1/realtime/calls` 是不同入口，
不能混用 SDP 创建流程。GPT Live Agent 还使用另一条 `/voice/live/sessions` 路由及事件族，
不在本文客户 Flash 模板的接入范围内。

## 第 3 节：把工具接到真实设备——直接 API 还是 MCP

### 3.1 MCP 不是接入真实设备的前提

当前调用链是：

```text
Voice Agent function call → Node VoiceSession → ToolRunner → HomeStore（模拟）
```

`HomeStore` 的成功只说明模拟家庭已保存，不能拿来证明真实设备动作完成。
第一步是准备客户设备平台/网关的 API、设备身份、功能清单、授权方式及真实状态回执；
是否封装 MCP 是后续架构选择。

| 方案                      | 链路                                                                    | 适用场景                                                                     |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 直接 Function Tool        | Agent → relay/ToolRunner → DeviceAdapter → 客户设备 REST/MQTT/SDK/网关  | 推荐先完成一台设备闭环；复用现有 schema 和 UI 编排                           |
| relay 调用 MCP            | Agent function → relay → 受信任 MCP client → 设备 MCP server → 设备平台 | 希望复用现有 relay 的 backchannel/审计，同时把设备能力独立服务化             |
| Foundry 托管远端 MCP tool | Agent → 项目配置的 MCP connection/server → 设备平台                     | 多 Agent 共用工具或已有 MCP 平台；需验证该 Agent/model 的支持与审批/事件机制 |

无论选哪种，MCP 都不会自动提供真实设备驱动、租户权限、用户确认或设备执行证明。
本次交付**没有实现 DeviceAdapter 或真实设备 MCP server**，不应把模拟接口当作已有硬件集成。

### 3.2 推荐先完成直接设备 API 闭环

保留 `get_home_state`、`control_device` 等 allowlisted schema，
把执行实现从模拟 HomeStore 改为客户设备适配器。内部逻辑 `deviceId` 先解析为当前用户有权控制的
真实设备，不能让模型提供任意 URL、厂商 token、tenant ID 或网关指令。
读操作也必须校验所有权。

现有 `ToolRunner.run()`、状态存储和相关调用是同步实现；
远程网络操作需要改为异步，并同步调整 VoiceSession 的 pending-call、取消、超时和 continuation 调度。
**不能只在 `home.control()` 里发一个不等待结果的 HTTP 请求，然后沿用 `ok:true`。**

设备适配器至少应支持：

- 读取设备能力、在线状态、当前真实状态和状态时间戳；setpoint 与实际测量值分开。
- 根据真实型号校验能力/范围，不把 demo 的六种设备假设当成所有客户设备的通用协议。
- 使用 application-generated request ID / idempotency key 提交动作，关联查询或推送回执。
- 区分 `accepted`、`succeeded`、`failed`、`unknown`。收到 HTTP `200/202` 不必然说明设备已执行。
- 超时后先查询动作状态，不能盲目重复开锁、开机或触发其他不可重复动作。
- 将已确认的状态/失败回推 UI 与 Agent；真实设备模式不能在断连时静默回退到模拟成功。

可以设计如下内部执行结果，**这是客户适配器的示例协议，不是现有工具已实现的返回结构**：

```json
{
  "ok": true,
  "status": "succeeded",
  "requestId": "<application-generated-request-id>",
  "deviceId": "<authorized-device-alias>",
  "confirmedState": { "power": true, "temperature": 24 },
  "confirmedAt": "<device-or-platform-confirmation-time>"
}
```

只有 `succeeded` 且有可信回执时才能说“空调已经设为 24 度”。
`accepted` 只能说“指令已发送”，超时/`unknown` 应说“暂时无法确认是否执行”，并避免编造状态。
多设备场景不是天然事务：部分成功时必须报告实际结果，预先定义补偿或人工处理方式。

### 3.3 如果选择 MCP，需要另外准备什么

把业务能力封装成受控工具，例如 `get_device_state`、`set_climate`，
而不是向模型暴露 `execute_any_command` 或任意设备 URL。
MCP server 实现这些工具后仍需调用真实设备平台。
server 建议放在客户受控网络，使用支持的 MCP transport 和明确的服务端鉴权。
不要为了方便把设备 MCP 变成公开 no-auth 服务。

需要准备：

| 项目         | 要求                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| MCP 契约     | 工具 schema、能力边界、read/write 区分、版本兼容、业务错误及结果状态                  |
| 两跳身份     | Agent/relay → MCP 的服务身份；MCP → 设备平台的服务身份，分别管理最小权限              |
| 用户授权     | 从已验证应用会话取得 user/home context，服务端校验，不信任模型生成的 tenant/user 参数 |
| 设备平台连接 | 客户平台 API/MQTT/SDK、设备清单、状态订阅和可核验执行回执                             |
| 运维         | 幂等与审计、限流、网络策略、告警、紧急停止、密钥安全存储和轮换                        |
| 高风险动作   | 门锁、燃气、加热等由服务端策略和明确用户确认保护；模型 prompt 不是唯一防线            |

选择 Foundry 托管远端 MCP 时，在客户项目中创建对应的受保护 connection，
再把 MCP tool 绑定到 Agent。connection ID、凭据和实际 server endpoint
属于客户环境，不写进公共模板；具体字段以目标 API/SDK 版本为准。
仓库的 [`voice_agent_with_mcp.py`](../voice_agent_with_mcp.py) 展示
`VoiceAgentMcpTool` 与 `project_connection_id` 的接入方式。
不要照抄其中的免审批策略用于有风险的真实设备操作。

**托管 MCP 的执行不再经过现有本地 `ToolRunner`。**
现有本地 function call 的短 backchannel、transcript 隐藏、设备动态展示和完成确认
不会因此自动套用；需针对托管 MCP 的实际事件与审批生命周期另行接入和验收。
如果要最小化行为变化，可以先保留 function tool，让受信任 relay 内部调用 MCP。

### 3.4 客户联调与验收清单

建议先选一台空调完成闭环，再扩展其他设备和场景：

1. 客户提供测试设备、协议/SDK 文档、沙箱身份，以及型号能力与状态回执定义。
2. 只读查询：确认用户只能看到自己的设备，离线/陈旧状态不被说成实时事实。
3. 一次写操作：语音请求 → 参数/授权校验 → 短 backchannel → 提交命令 → 设备回执 → 单条完成回答。
4. 验证重复事件、超时、网络中断、设备拒绝、权限不足、用户取消及部分失败；不能重复执行或假报成功。
5. 在 WebSocket 与 Agent-mode WebRTC 分别验收工具顺序、打断、音频及 transcript 行为。
6. 上线前补齐用户认证、审计、限额/预算、告警、人工处理与数据保留；private Git 仓库不能替代运行时鉴权。

发布新定义后只影响新建立/相应版本的会话；不要把本地模板修改或单元测试通过当作客户设备接通。
本指南的 Azure 命令、Agent-mode WebRTC 和真实设备步骤未在客户环境执行，
必须由获授权操作者在隔离测试环境验证后才可用于真实用户。
