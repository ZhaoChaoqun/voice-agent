# 海尔语音智慧家居 — Habitat

Habitat 是[海尔语音智慧家居样例](../../README.md)的独立前端，可从源码构建。平视 WebGL 室内空间采用程序化木纹、亚麻、灰泥与石灰石表面、基于物理的材质、环境光遮蔽、克制的泛光，以及适配桌面/移动端的渲染预算。中英双语家电控制、家庭场景、产品知识和语音传输复用持续维护的样例源码。

## 本地启动

使用[主样例](../../README.md)要求的 Node.js 版本。在 `samples/haier-voice-home` 目录按照主 README 安装并启动经典版后端，地址为 **http://127.0.0.1:5178**。启动 Habitat 不会创建、部署或修改 Azure 资源。

在另一个终端运行：

```bash
cd samples/haier-voice-home/editions/habitat
npm ci
npm run dev
```

打开 **http://127.0.0.1:5184**。本前端只绑定回环地址并使用 `--strictPort`，端口被占用会报错。经典版界面保留在 `5178`，[Modern](../modern/README.md) 独立运行在 `5180`。无需重启其他开发服务器来启动本版本。

## 源码结构

请保留完整 `samples/haier-voice-home` 目录：

```text
haier-voice-home/
  src/                  # 经典版 hooks 与知识库界面
  shared/               # 协议和回环后端校验
  server/               # 唯一的后端与工具执行入口
  editions/
    modern/src/         # 持续维护的共享控件与场景工具
    habitat/src/        # Habitat 界面和渲染实现
```

Habitat 导入 `../../src`、`../../shared` 和 `../modern/src`。内部 `@v2` 别名指向 Modern 源码，而不是历史编译产物。Vite 对 React、React DOM 和 Three.js 去重。本包独立构建静态资源，不需要下载场景素材、CDN 脚本、外部字体或浏览器凭据。

锁文件保留依赖版本与完整性校验，省略特定镜像的 `resolved` 地址，使用用户自己的 npm registry 配置下载。

## API 与模型边界

本地 Vite 将 `/api` HTTP 与 WebSocket 请求代理至后端 `http://127.0.0.1:5178`。可选 `HAIER_LOCAL_BACKEND` 仅在服务端生效，且由共享函数校验为回环地址；浏览器不能选择目标。变更请求和 WebSocket 升级必须携带严格同源的回环 Host/Origin，检查通过后才会将 Origin 重写为后端地址。其他版本的来源、外部来源和缺少 Origin 的请求会被拒绝。这是本地开发边界，不是生产认证网关。

模型可用状态由后端提供：

| 选项                     | 模型 ID                      | 后端变量            | 默认逻辑名称 |
| ------------------------ | ---------------------------- | ------------------- | ------------ |
| Microsoft Realtime Flash | `microsoft-realtime-flash-1` | `HAIER_FLASH_AGENT` | `home-flash` |

海尔国内客户只配置并启用 Flash；后端默认使用 Flash，前端使用后端实际提供的可用模型。
其他海外比较模型不属于本客户部署要求。凭据、资源标识符和 Agent 配置均留在后端，不应写入浏览器变量。家庭设备是模拟状态；真实语音需要用户自行授权并配置服务。本目录不提供任何私有部署值。

## 本地验证

```bash
npm test
npm run build
npm run format:check
```

单元测试覆盖相机取景、质量预算、程序化纹理、材质资源、后处理和来源校验，不调用外部服务。`build` 运行 TypeScript 和 Vite；`npm start` 在 `5184` 提供构建后的预览，并保留 API 代理。

`npm run test:browser` 保留桌面/移动端 WebGL、控制、REST 与明确标记的模拟语音测试。请先启动隔离的经典版后端和 Habitat，并安装适合本机的 Playwright 浏览器。浏览器测试会重置和修改样例状态。

`npm run test:live` 在 Habitat 上复用 Modern 的真实模型场景。仅当明确设置 `HAIER_LIVE_BROWSER` 时才会执行，否则跳过。真实服务调用需要授权且可能产生费用，不要在离线验证中启用。本 README 不声称已经部署或完成真实服务验收。
