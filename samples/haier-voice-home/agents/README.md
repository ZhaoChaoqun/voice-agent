# 可复现 Voice Agent 配置

`realtime.json` 映射 `gpt-realtime-2.1`，`mini.json` 映射
`gpt-realtime-2.1-mini`，均为 `kind: voice` / `model_type: managed`，
不含 endpoint、subscription、tenant、project 或 agent version ID。

这两个文件是**基础模板，不是可直接上传的最终 payload**：
`npm run agents:render` 合并以下源码，生成忽略目录中的完整
`.local/agent-definitions.json`：

| 来源                                                 | 维护内容                                                 |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `agents/*.json`                                      | 模型、PCM 格式、speech profile、voice 和 `store: false`  |
| `server/voice-profile.ts`                            | 两只 Agent 共享的动态 VAD、AEC、降噪和双语转录常量       |
| `server/instructions.txt` / `server/instructions.ts` | 简短 acknowledgement、结果确认、语言和 grounding 规则    |
| `server/tools.ts` / `shared/controls.ts`             | 全部 function schema 与服务端输入范围                    |
| `server/greeting.ts`                                 | 中英文 welcome_text 和 structured input greeting 默认值  |
| `server/agent-config.ts`                             | wire definition 合并，以及保留未知 Portal 字段的转换逻辑 |
| `server/sync-agent-config.ts`                        | 离线展开、显式发布、并发检查和 readback                  |

`welcome_text` 是字符串 structured input，greeting 为
`{"type":"template","text":"{{{welcome_text}}}"}`。浏览器初始语言在建立 Voice
WebSocket 时选择中英文欢迎语，不会把识别语言锁定为单一语言。

输入输出是 24 kHz PCM；浏览器发送 mono。`server_echo_cancellation`
使用 server reference、`channels: 1`；personal noise suppression 的 detection
input 是 `mas_dns`。转录显式提供 `zh-CN,en-US` 候选语言。
两只 Agent 均使用 `azure_semantic_vad`、`profile: normal`，
`auto_truncate/create_response/interrupt_response: true`，
`remove_filler_words: false`。模板不会绑定原演示部署中的其他 classifier。

## 发布流程

先按[接入文档](../README.md#创建并发布两只-voice-agent)准备自己的项目、权限和 `.env`，
离线检查展开结果，再执行：

```bash
npm run agents:publish -- --confirm-project "https://<resource>.services.ai.azure.com/api/projects/<project>"
```

确认参数必须与 `FOUNDRY_PROJECT_ENDPOINT` 完全相同，两个 Agent 名字必须不同且显式配置。
发布命令拒绝示例占位符；默认 render 完全不访问 Azure。
API 使用 `2025-11-15-preview` authoring contract，voice 连接使用 `api-version=v1`。
如目标服务尚不支持 contract 或能力，应检查官方版本说明，而不是忽略字段。

新 Agent 从模板创建。已有同 kind/model/model_type Agent 从最新完整定义合并：
保留 Portal-owned recording、输出设置和未知字段，更新共享 instructions/tools、
greeting 及输入 speech profile；不更改 Agent 的模型身份。
因此，已有 Agent 的 `store` 或 output voice 可能与 fresh template 不同，需要审阅 readback。
relay 使用源码规定的 Xiaoxiao voice；若用户有意改 voice，须同步源码和模板后重新验证。

发布前会再检查 latest version，发布后逐字段验证完整定义；这是乐观检查，
不等同于服务端 compare-and-swap。应避免与其他操作者同时编辑。
两只 Agent 不是原子发布，脚本失败不会回滚已经成功的第一只。
未实际对云端运行过的模板/脚本不能被当成已验收部署。
