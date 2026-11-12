# Haier Voice Home

可从源码构建的中英双语智能家居概念演示：浏览器提供 React / Three.js
房间、文本与音频交互；Node relay 连接 **Foundry Voice Agent**，后者使用
**Voice Live** 处理语音输入输出。设备控制、环境读数、食材记录和补货清单均为模拟数据，
不连接真实 Haier IoT，不提供视频播放、购买、支付或配送。这不是海尔官方应用。

## 公开样例的范围

| 目录                         | 内容                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `src/`、`server/`、`shared/` | Classic UI、唯一的 Node API/relay、共享协议与控制规则        |
| `editions/modern/`           | 明亮现代客厅 UI，同时提供 Habitat 复用的可维护组件           |
| `editions/habitat/`          | 推荐展示的 Habitat UI，固定视平线、程序化材质和房间反射      |
| `agents/`                    | 国内客户 Flash 配置；其他模型仅作显式海外比较参考            |
| `knowledge/`                 | 产品事实摘要、来源及带日期的影视推荐快照                     |
| `webrtc-benchmark/`          | 独立的 WebRTC **model-mode** latency lab，不是完整家居 Agent |
| `tests/`、`deploy/`          | 离线回归、显式 opt-in 集成测试和可选 ACA 部署输入            |

不包含仅存编译产物的旧 Atelier Review、水岸历史版本、私有 ACR 镜像、真实 Azure
资源配置、环境文件、访问码、会话签名密钥或部署状态。三个保留的 UI 均从源码构建；
现代版不是对历史 minified bundle 的重新包装。

详细说明：[客户接入指南：部署 / WebSocket / WebRTC / 真实设备与 MCP](INTEGRATION.md) ·
[架构](ARCHITECTURE.md) · [Agent 配置](agents/README.md) ·
[ACA 部署](deploy/README.md) · [Modern](editions/modern/README.md) ·
[Habitat](editions/habitat/README.md)。

## 前置条件

需要 Node.js **24.5+**、npm、现代 Chrome/Edge，以及能使用麦克风和 WebGL 的设备。
Node 24.5+ 用于服务端 HTTPS 代理配置；无代理时同样使用这一基线。
只有启用真实语音时才需要 Azure CLI 登录、Foundry 资源和项目。
离线运行可以操作模拟设备和查看知识来源，但**没有伪造的 AI 回复或浏览器 TTS 回退**。

本样例的海尔国内客户接入以 **Microsoft Realtime Flash** 为准。
在自己的 Azure 订阅中准备 Foundry 资源和项目，确认客户项目的具体配置：

- Microsoft Realtime Flash managed Voice Agent，当前 API ID 为 `microsoft-realtime-flash-1`；
- Azure Speech streaming transcription、Azure Semantic VAD、
  personal noise suppression、server echo cancellation；
- `zh-CN-Xiaoxiao:DragonHDFlashLatestNeural`。

模板使用 `model_type: managed`，不是已有 Azure OpenAI deployment 的名字，
因此无需另外创建同名 self-deployed model deployment。仍需项目的访问资格、区域支持、
配额和计费能力。若项目只支持自部署模型，需要先部署相应模型并单独适配
`model_type` / model 映射；本样例不自动转换模型，也不默默改用其他区域或型号。
不支持上述能力时应停止并检查服务可用性，而不是删掉音频设置来宣称接入成功。

官方参考：[Voice Agent quickstart](https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-voice-agent)、
[配置 Voice Agent](https://learn.microsoft.com/azure/foundry/agents/how-to/configure-voice-agent)、
[区域和配额](https://learn.microsoft.com/azure/foundry/agents/concepts/limits-quotas-regions)。

## 本地启动

在仓库根目录执行：

```bash
cd samples/haier-voice-home
npm ci
cp .env.example .env
npm run dev
```

打开 `http://127.0.0.1:5178`。服务端在同一端口提供 Vite、HTTP API 和 WebSocket relay。
默认只绑定 loopback；端口占用会报错，不会停止其他服务或自动改用新端口。
多个本地 tab/edition 共用一个模拟家庭。

生产构建的本地预览：

```bash
npm run build
npm start
```

Habitat 在自己的终端中运行，后端仍是上面的服务：

```bash
cd samples/haier-voice-home/editions/modern
npm ci
cd ../habitat
npm ci
npm run dev
```

打开 `http://127.0.0.1:5184`。Modern 也可独立 `npm run dev`，默认端口 `5180`。
这两个 Vite proxy 只用于 loopback 开发，不是公共部署入口。

## 创建并发布客户 Flash Voice Agent

先用自己的开发身份完成 `az login`，必要时指定 tenant。不要把 access token 复制到配置或 UI。
管理 Agent 的身份需要项目级创建/更新权限，例如 **Foundry Agent Developer**；
运行 relay 的身份仅需消费 Agent 的权限，例如 **Foundry Agent Consumer**。
根据目标订阅实际可用的角色定义和服务文档授权，避免订阅级 Owner/Contributor。
本地使用 `AzureCliCredential`；云端使用 managed identity，不使用 API key。

`agents/*.json` 是可审阅的基础定义，`server/instructions.txt`、
`server/instructions.ts` 和 `server/tools.ts` 是 instructions / function schema 的唯一维护来源。
模板里空的 `instructions` / `tools` 由下面的命令填入；**不要直接上传未展开的 JSON**。

```bash
# 默认纯离线，既不查询也不修改 Azure。
npm run agents:render
```

检查忽略目录 `.local/agent-definitions.json` 中的 `flash` 完整定义。它包含 24 kHz mono PCM、
动态 VAD、AEC、降噪、双语转录、Xiaoxiao、structured input greeting 和全部工具。
默认 `store: false`，不会主动开启服务端会话存储；仍需遵守服务的数据处理条款。

在 `.env` 中填写自己的项目和 Flash Agent 名字，然后由有权限的操作者显式运行：

```dotenv
FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
HAIER_FLASH_AGENT=<your-flash-agent-name>
```

```bash
# 此命令会修改你显式确认的项目；不是本地启动的必要步骤。
npm run agents:publish -- --confirm-project "$FOUNDRY_PROJECT_ENDPOINT"
```

上面变量必须也导出到当前 shell；仅写进 `.env` 不会让 shell 展开该变量。
也可以在 `--confirm-project` 后直接填写与 `.env` 完全相同的项目 URL。
脚本创建缺失的 Agent，或为已有同类型、同模型 Agent 发布新版本；更新前检查版本变化，
更新后读回所有提交字段，发现配置丢失会报错。已有 Agent 的其他 Portal 设置会保留。
默认命令只发布客户 Flash，不会创建或更新其他海外比较模型。
该脚本不创建资源、model deployment、RBAC，也不修改任何预置项目。
现有 Agent 被其他操作者并发编辑时，应协调独占发布窗口；读前检查不能替代服务端事务。

验证项目中的精确模型和 Agent 定义后，在 `.env` 中显式启用选择器：

```dotenv
HAIER_VERIFIED_MODELS=microsoft-realtime-flash-1
```

这个变量是操作者声明，不是程序自动验收证明。先测试客户 Flash Agent，再用于演示。
`gpt-live` 在此应用中未集成，选择器会明确标为不可用，不会别名映射到其他模型。

## 环境变量

| 变量                                         | 用途 / 默认                                                         |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `FOUNDRY_PROJECT_ENDPOINT`                   | 服务端唯一允许的项目 HTTPS endpoint；无默认资源                     |
| `HAIER_FLASH_AGENT`                          | 客户 Flash Agent 名字；发布时必须显式提供                           |
| `HAIER_SECONDARY_MODEL_ID`                   | 默认 `microsoft-realtime-flash-1`；历史变量名不表示另需第二只 Agent |
| `HAIER_VERIFIED_MODELS`                      | 逗号分隔的精确模型 ID；默认不启用任何语音模型                       |
| `AZURE_TENANT_ID`                            | 可选，本地 CLI credential tenant                                    |
| `AZURE_CLIENT_ID`                            | 云端 user-assigned managed identity client ID                       |
| `HOST` / `PORT`                              | 默认 `127.0.0.1` / `5178`                                           |
| `HAIER_LOCAL_STATE_PATH`                     | 本地家庭 JSON；默认 `.azure/home.json`                              |
| `HAIER_PUBLIC_ORIGIN`                        | 可选云模式的精确 HTTPS origin；设置后必须完整配置保护               |
| `HAIER_ACCESS_CODE` / `HAIER_SESSION_SECRET` | 云模式私有随机值，分别至少 24 / 32 字符                             |
| `HAIER_PUBLIC_GUEST_ACCESS`                  | 默认 `0`；`1` 表示任何访客可产生实际服务费用                        |
| `HAIER_DATA_PATH`                            | 云模式持久化家庭目录；必须可写                                      |
| `HAIER_WEB_ROOT`                             | 构建目录：`dist`、`editions/modern/dist`、`editions/habitat/dist`   |
| `VOICE_LIVE_ENDPOINT` / `WEBRTC_MODEL`       | 仅 WebRTC lab；资源 endpoint 无默认值                               |

`.env` 只供服务端使用。不要创建含 secret 的 `VITE_*`，不要提交填好的环境文件、
上传文档、录音、Playwright trace 或 `.local` manifest。

## 交互约束与数据边界

模型在工具执行前只输出 function call，不输出中间文本、音频或过程说明。
relay 在执行前提供简短 spoken backchannel，中文只使用“好 / 收到 / 嗯，好 / 可以”，
英语使用 “Sure.”。backchannel 的音频正常播放，但对应 transcript/text delta 和 done
不会转发到聊天记录；聊天只显示一条工具后的完成回答。
relay 等 backchannel response 完成后再执行工具，随后请求只描述真实结果的 continuation。
设备实际成功后才报告完成结果；失败不能说成已完成。fallback 的选择、音频转发、
transcript 隐藏和执行顺序均有源码及单元测试覆盖。
如果模型仍在同一个 response 中先产生 message、再产生 function call，
relay 会发送应用事件 `demo.discard-assistant-output`，让共享浏览器客户端停止排队音频、
移除对应 message，并阻止该 item 的后续音频/文本继续到达页面。
已经实际播放的声音不能撤回；这个防线用于尽早截断过程输出，不能替代模型指令和实机听测。
它约束协议顺序，不代表模型的实际语音质量无需人工确认。

六类设备包括电视、冰箱、空调、加湿器、灯和窗帘。温度/湿度等设置受 schema 和服务端规则限制；
设置目标值不会伪造传感器变化。电影夜、舒适、外出是模拟场景，外出不会关闭冰箱。
影视推荐是带来源日期的快照，不是实时榜单；补货清单不是购物订单。

产品信息以 `shared/appliances.ts` 和 `knowledge/products.json` 中的来源为准，
采用简短事实摘要而非复制整本手册。程序化几何不是官方 CAD。导入 `.txt` / `.md`
前须拥有使用权限；导入文件仅作为检索证据，不能覆盖系统 instructions。
本地文件保存在忽略目录 `knowledge/uploads/`；云模式按签名浏览器 session 隔离。
清理/备份这些可能含个人信息的数据由部署者负责。

## WebSocket demo 与 WebRTC lab

完整 demo 使用 Browser → Node relay → **Foundry Voice Agent** 的 WebSocket，
包含工具、知识检索、家庭状态和 pre/post-tool 编排。
lab 直接连接 **Voice Live model mode**，浏览器音频走 WebRTC RTP，
事件走 `voice-live-events` DataChannel，Node 仅持有鉴权 control-channel。
它禁用工具、不加载家居 Agent，不能证明正式 Agent 的端到端延迟。

```bash
# 设置自己的 VOICE_LIVE_ENDPOINT 后启动；不创建或部署任何资源。
PORT=5188 npm run lab:webrtc
```

lab 仅监听 `127.0.0.1:5188`，保留的是历史海外模型传输对比，**不属于海尔国内 Flash 部署步骤**；
它不能证明客户 Flash 的 WebRTC 可用性，也不能直接切换为未列入 lab allowlist 的模型。
TTFA 从发送文本到每轮**第一个** `output_audio_buffer.started` 计算，
不是物理扬声器出声时间，也不包含麦克风 VAD 的端到端测量。
浏览器使用 STUN 进行 ICE 协商；防火墙、UDP、浏览器策略和区域能力会影响连接。
不要直接公开这个无用户鉴权的实验入口。

## 检查与测试

```bash
npm test
npm run build
npm run lint
npm run agents:render
# 后端已在 5178 启动，且已安装兼容的 Playwright Chromium 时：
npm run test:browser -- tests/browser/ui.spec.ts
```

Modern / Habitat 各自运行 `npm test`、`npm run build`、`npm run format:check`。
根包 `lint` 使用严格 TypeScript + Prettier，不额外引入另一套 lint 规则。
unit tests mock 云边界；浏览器 UI tests 中命名的 mock 场景不证明 Azure 连通。
真实服务测试必须显式 opt-in，会计费；不要在公共 CI 默认运行：

```bash
RUN_LIVE_TESTS=1 npm run test:live
HAIER_LIVE_BROWSER=1 npm run test:browser -- tests/browser/live-ui.spec.ts --workers=1
```

这两条也不等价于物理麦克风/扬声器的主观听测。涉及原生音频处理的服务端 E2E
应在具备所需 Linux 音频运行库的隔离环境执行，不能删掉 AEC/降噪来绕过依赖。
本公开迁移不声称已经对新项目运行这些 live 验收。

## 故障排查

| 症状                         | 检查                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| 模型不可用                   | 项目 endpoint、Agent 名字、`HAIER_VERIFIED_MODELS` 和区域/配额；重启 Node 读取新环境     |
| `401` / `403`                | 开发身份登录状态、正确 tenant、项目消费或开发角色；不要换成浏览器 token                  |
| `realtime_requires_language` | 检查已发布定义包含 `azure-speech-streaming` 的 `zh-CN,en-US` candidate languages         |
| 连接后一直等待               | greeting 是否完成、structured input 模板是否发布、输出 voice 是否匹配、服务端错误 code   |
| pre-tool 没有声音            | 检查 response audio 事件和 fallback 测试；backchannel transcript 按设计不显示在聊天中    |
| 麦克风被拒绝                 | localhost 或 HTTPS secure context、用户手势、浏览器系统权限                              |
| `EADDRINUSE`                 | 选择自己空闲的端口，不停止其他会话的服务；edition proxy 的 backend 端口须一致            |
| 无 WebGL                     | 使用可用 GPU/浏览器；UI 应显示错误，设备/文本控件仍可使用                                |
| 存储错误                     | 确认运行身份可写家庭 JSON、上传目录及 ACA 挂载；不能把未保存结果当成功                   |
| WebRTC SDP/ICE 失败          | 服务是否提供 `/voice-live/realtime/calls` 对应 API、UDP/ICE 可达性、模型是否在该资源可用 |
| 配置发布后字段消失           | 使用脚本读回对比；不要再用会丢弃 advanced fields 的其他 serializer 覆盖                  |

## 公共访问风险

云端代码提供签名、HttpOnly、Secure、SameSite cookie、Host/Origin 检查及每浏览器家庭隔离。
访问码只适用于受控演示，**不是企业用户认证**。guest 模式没有身份认证；
任何得到 URL 的人都可能产生费用、上传内容或耗尽 100 个家庭的容量。
生产用途需外部身份认证、连接/请求/上传限额、预算告警、审计、数据保留策略及人工管理。
不要将签名 cookie 或 access code 当作跨设备用户身份，也不要在多个副本间复制文件状态。
部署 renderer 默认禁止 guest、单副本，并要求自己的持久化存储；详见部署文档。
