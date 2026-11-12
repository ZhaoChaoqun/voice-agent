# 海尔语音智慧家居 — Modern

Modern（Atelier）是[海尔语音智慧家居样例](../../README.md)中持续维护、可从源码构建的现代家居前端，**不是**历史编译镜像，也不是单独部署的 Agent。它提供明亮的 WebGL 室内场景、中英双语控件、六种模拟家电、家庭场景预设、产品知识面板和语音对话。

## 本地启动

使用[主样例](../../README.md)要求的 Node.js 版本。在 `samples/haier-voice-home` 目录中按照主 README 安装并启动经典版后端；后端地址为 **http://127.0.0.1:5178**。启动本前端不会创建、部署或配置 Azure 资源。

在另一个终端运行：

```bash
cd samples/haier-voice-home/editions/modern
npm ci
npm run dev
```

打开 **http://127.0.0.1:5180**。服务只绑定回环地址并使用 `--strictPort`，端口被占用时直接报错，不会自动更换端口。经典版界面保留在 `5178`，[Habitat](../habitat/README.md) 独立使用 `5184`。

经典版导航链接默认指向本地经典版界面。如果采用其他本地地址或同源静态托管布局，可在构建前设置 `VITE_CLASSIC_URL`。不要将密钥放进 `VITE_*` 变量：这些值会被 Vite 写入浏览器资源。

## 共享源码与后端边界

请保持完整样例目录结构。本版本导入经典版 `../../src` 中的 hooks 和知识库组件，以及 `../../shared` 中的协议和回环后端校验。Habitat 也复用本版本持续维护的设备控件、文案、默认模型选择和程序化场景工具。内部 `@v2` 别名指向本版本源码，并不代表历史二进制或外部包。

Vite 将 `/api`（包括语音 WebSocket）代理至 `http://127.0.0.1:5178`。可选的 `HAIER_LOCAL_BACKEND` 是仅在服务端生效、经过共享校验函数限制的回环地址配置，浏览器不能选择上游目标。外部来源或缺少 Origin 的变更请求和 WebSocket 升级会在代理重写 Host/Origin 之前被拒绝。密钥、Agent 和资源配置只属于后端。开发代理不是面向公网的认证网关。

模型列表与可用状态由 `/api/config` 提供：

| 选项     | 模型 ID                 | 后端变量               | 默认逻辑名称    |
| -------- | ----------------------- | ---------------------- | --------------- |
| Realtime | `gpt-realtime-2.1`      | `HAIER_REALTIME_AGENT` | `home-realtime` |
| Mini     | `gpt-realtime-2.1-mini` | `HAIER_MINI_AGENT`     | `home-mini`     |

前端优先选择可用的 Mini，后端 secondary 默认也是 Mini；没有可用模型时不会伪装成可用引擎。上述 Agent 变量只在主服务配置，不要作为 `VITE_*` 暴露给浏览器。家电状态由样例后端模拟；真实语音需要用户自行授权并配置服务。

场景几何与材质由源码生成，不包含下载的场景素材、外部字体、模型二进制、云凭据或私有部署值。锁文件保留包版本和完整性校验，省略绑定特定镜像的 `resolved` 地址；依赖下载使用用户自己的 npm registry 配置。

## 本地验证

```bash
npm test
npm run build
npm run format:check
```

`build` 先运行 TypeScript 检查，再运行 Vite 构建。`npm start` 在 `5180` 提供构建后的本地预览，并保留相同的 API 代理边界。

`npm run test:browser` 保留桌面/移动端 WebGL、设备控制、REST 和明确标记的模拟语音传输测试。运行前需要启动经典版后端、本前端，并安装适合本机的 Playwright 浏览器。测试会重置和修改样例状态，请使用隔离的本地实例。

`tests/browser/live.spec.ts` 仅在明确设置 `HAIER_LIVE_BROWSER` 后启用，会调用真实服务且可能产生费用。离线验证或未获得服务授权的 CI 不应启用它。本源码发布不声称已经完成部署或真实服务验收。
