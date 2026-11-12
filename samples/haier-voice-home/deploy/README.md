# 可选 Azure Container Apps 部署

此目录只提供从源码构建的镜像和**纯离线** manifest renderer。
没有真实资源默认值，不会自动创建资源、分配角色、部署 Agent 或更新已有演示。
旧 Review 私有镜像和基于其 digest 的 Dockerfile 已移除。

## 先准备自己的基础设施

需要部署者自己的 subscription、region、resource group、ACA managed environment、
ACR、user-assigned managed identity、Foundry project，以及 ACA environment 中已注册的
Azure Files storage。海尔国内客户使用 Microsoft Realtime Flash，核对客户项目中该模型及
speech profile 的支持情况，不把其他海外模型作为部署前提。

建议先完成[本地 Agent 接入与验收](../README.md)，再部署 Web 应用。
使用独立 app/存储隔离不同公开演示；不要覆盖他人现有资源。
本样例不提供跨区域迁移、删除资源或自动 provisioning 脚本。

最小权限原则：

| 身份                               | 目标范围             | 作用                                        |
| ---------------------------------- | -------------------- | ------------------------------------------- |
| 镜像构建/发布者                    | 自己的 registry      | 推送源码构建镜像所需权限                    |
| ACA user-assigned managed identity | 同一 registry        | `AcrPull`                                   |
| 同一 runtime identity              | 指定 Foundry project | `Foundry Agent Consumer` 等实际项目消费权限 |
| Agent 管理者                       | 指定 Foundry project | `Foundry Agent Developer` 等创建/更新权限   |

以订阅内实际角色定义和官方文档为准，不因演示便利授予订阅级 Owner。
runtime identity 不需要创建 Agent、修改 RBAC 或获取资源 API key。
Azure Files credential 在 ACA environment 的 storage binding 中管理，
不能写进源码、镜像层或普通环境变量。

## 构建

从 `samples/haier-voice-home/` 作为 Docker build context：

```bash
docker build -f deploy/Dockerfile -t "<your-registry>/voice-home:<your-tag>" .
```

Dockerfile 安装锁定依赖，分别构建 Classic、Modern、Habitat，使用非 root `node` 用户运行
production Node server。不会复制 `.env*`、`.azure`、`.local`、上传内容、测试结果或证书。
默认展示 Habitat；`HAIER_WEB_ROOT` 可选择其他两个源码 edition。
无需私有历史镜像，镜像内不运行 Vite dev server。
将构建镜像推送到你自己的 registry；本迁移不声称实际完成 Docker 构建或 Azure 部署。

## 准备私有环境

所有参数由操作者提供。以下仅示意变量名称，`<...>` 必须替换；
不要把填好的文件提交到 Git，也不要在终端输出 secret：

```dotenv
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_LOCATION=<your-region>
HAIER_CONTAINER_APP_NAME=<your-app-name>
HAIER_CONTAINER_APP_ENVIRONMENT_ID=/subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.App/managedEnvironments/<environment>
HAIER_MANAGED_IDENTITY_ID=/subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<identity>
AZURE_CLIENT_ID=<your-identity-client-id>
HAIER_REGISTRY_SERVER=<your-registry>.azurecr.io
HAIER_IMAGE=<your-registry>.azurecr.io/voice-home:<your-tag>
HAIER_PUBLIC_ORIGIN=https://<your-app-fqdn>
FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
HAIER_FLASH_AGENT=<your-flash-agent>
HAIER_VERIFIED_MODELS=microsoft-realtime-flash-1
HAIER_ENVIRONMENT_STORAGE=<your-environment-storage-binding-name>
HAIER_ACCESS_CODE=<new-random-value-at-least-24-characters>
HAIER_SESSION_SECRET=<different-new-random-value-at-least-32-characters>
HAIER_PUBLIC_GUEST_ACCESS=0
HAIER_WEB_ROOT=editions/habitat/dist
HAIER_MIN_REPLICAS=1
```

可以放入样例根目录被忽略的 `.env`，或注入进程环境。access code / signing secret
必须分别生成高熵随机值，不能使用文档占位符、公司共享密码、默认值或测试 fixture。
`HAIER_PUBLIC_ORIGIN` 必须是最终真实 HTTPS origin，不带路径、末尾 `/` 或 wildcard。
尚未有 app FQDN 时，先通过自己的基础设施流程取得/预留域名，再生成正确 manifest；
不要临时公开一个绕过同源/访问保护的实例来探测域名。

```bash
node deploy/render-container-app.mjs
```

脚本检查必填字段、资源 subscription、镜像 registry、HTTPS origin、secret 长度和 edition，
然后写入权限 `0600` 的 `.local/container-app.json`。此文件**含明文 secret**；
它只是 Azure 部署输入，不是可发布的文档。目录权限 `0700`，但不能替代安全备份/销毁流程。
renderer 不打印 secret、不调用 `az`，没有 `--deploy` 隐式路径。
生成后由部署者审阅，在自己的 Azure 环境中显式应用 manifest，例如：

```bash
# 操作者确认 subscription/group 后才运行；这会真正创建或更新 app。
az containerapp create \
  --subscription "<your-subscription-id>" \
  --resource-group "<your-resource-group>" \
  --yaml .local/container-app.json
```

JSON 是 YAML 的子集；也可使用组织批准的 IaC 流程消费同等定义。
部署后必须核对实际 FQDN 与配置 origin，并验证 identity、存储写权限、客户 Flash Agent、
greeting、工具前短 acknowledgement、工具后结果、音频/打断和双浏览器家庭隔离。
`/api/health` 只证明进程存活，不证明 Foundry 或全部功能已就绪。
更新已存在 app 的流程由部署者自己的 IaC 管理；不要假定 `create` 能替代所有更新策略。

## 副本、状态与访问保护

正式 demo 默认 `HAIER_MIN_REPLICAS=1`，避免 scale-to-zero 冷启动；
只允许 `0` 或 `1`，`0` 会降低闲置成本但增加冷启动。最大副本保持 `1`，
因为 HomeStore/KnowledgeStore 的 JSON 文件不是多副本事务存储。
需要横向扩展时先改为合适的共享数据库与事务/租户模型。

`/data` 必须挂载前述 environment storage，并由 `node` 用户写入。
家庭和上传按签名浏览器 session 分目录；重新部署不应丢失挂载数据。
过期 session 文件没有自动删除，需部署者制定保留/清理策略。
轮换 signing secret 会使现有 cookie 失效，必须当作有用户影响的运维变更。

renderer 默认 access-code 保护，明确拒绝 `HAIER_PUBLIC_GUEST_ACCESS=1`。
源码仍保留显式 guest 模式供评估，但不能把它误称为认证：
它允许任何持有链接的人创建独立家庭、使用收费 AI 服务并消耗容量。
签名 cookie 只能提供会话完整性/隔离，不能代替身份鉴别、速率限制或计费保护。
公共演示至少应加外部身份或反滥用入口、并发/请求限额、预算告警与数据治理。

## WebRTC 延迟实验独立部署与安全边界

`deploy/Dockerfile.webrtc` 与参数化脚本 `deploy/deploy-webrtc.mjs` 仅供需要单独对比 Voice Live model-mode WebRTC 首包延迟的测试环境使用：默认离线渲染 `.local/webrtc-manifests.json`（默认 `microsoft-realtime-flash-1`、`HAIER_WEBRTC_MIN_REPLICAS=0`），不含任何预置订阅或资源名，且必须显式传入 `--apply --confirm-endpoint <url>` 才会调用 Azure CLI。

注意：lab 的 `/api/sessions` 接口禁用工具且不连接 Foundry Voice Agent，也不内置访问码或用户登录保护。切勿将其作为正式客户应用长期暴露在无保护公网；正式应用请使用上方的 `deploy/Dockerfile` 与 `deploy/render-container-app.mjs`。
