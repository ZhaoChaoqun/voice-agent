export const models = {
  realtime: {
    name: "GPT Realtime",
    note: "童声风格 · 待验证可用音色",
    title: "轻快、温暖的童声风格",
    detail: "GPT Realtime 的目标音色，尚未验证。当前原型无音频输出。",
  },
  live: {
    name: "GPT Live",
    note: "缺省音色 · 以已保存 Agent 配置为准",
    title: "自然陪伴，使用缺省音色",
    detail: "GPT Live 不要求童声，不覆盖已保存 Agent 的音色。当前原型无音频输出。",
  },
  flash: {
    name: "Azure Realtime Flash",
    note: "Azure Speech HD · 童声兼容性待验证",
    title: "轻快回应，自然的家庭陪伴",
    detail: "计划使用 Azure Speech HD 音色；童声与部署兼容性待验证。当前原型无音频输出。",
  },
};

export const devices = {
  ac: { name: "客厅空调", description: "支持开关与 16–30°C 温度设置。" },
  tv: { name: "客厅电视", description: "支持电源开关；可在下方模拟设备离线。" },
  fridge: { name: "厨房冰箱", description: "持续运行；“打开冰箱”先澄清含义，不自动开门或断电。" },
  light: { name: "客厅灯光", description: "支持照明开关。图片为静态效果图，请以状态标签为准。" },
};

export const manuals = [
  { id: "ac-clean", model: "DEMO AC-01", title: "空调使用手册（虚构）", page: 12, section: "滤网维护", text: "清洁前关闭空调并断开电源，按照图示取出滤网，用清水冲洗，阴干后装回。勿使用热水或直接暴晒。实际操作须遵循真实型号的官方手册。" },
  { id: "fridge-intro", model: "DEMO RF-01", title: "冰箱产品介绍（虚构）", page: 3, section: "分区储鲜", text: "这款示例冰箱设有独立冷藏与冷冻空间。演示状态为冷藏 4°C、冷冻 −18°C；它们是虚构设备的设定值，不是实时传感器数据或对所有食品的储存建议。" },
];

export function initialState() {
  return { ac: { power: false, temperature: 26 }, tv: { power: false, online: true }, fridge: { power: true, fresh: 4, frozen: -18 }, light: { power: true } };
}

export function controlDevice(state, request) {
  const { device, action, value } = request;
  const fail = (status, message) => ({ state, status, message, request });
  if (!Object.hasOwn(devices, device)) return fail("rejected", "未知设备，没有执行操作。");
  if (device === "fridge") return fail("confirmation_required", "冰箱不执行通用开关命令。请先确认是查看状态、接通电源，还是打开冰箱门。");
  if (action !== "power" && !(device === "ac" && action === "temperature")) return fail("rejected", "设备不支持这项操作，没有改变状态。");
  if (action === "power" && typeof value !== "boolean") return fail("rejected", "电源参数必须为布尔值，没有执行操作。");
  if (action === "temperature" && (!Number.isInteger(value) || value < 16 || value > 30)) return fail("rejected", "示例空调温度只支持 16–30°C 的整数，没有执行操作。");
  if (device === "tv" && !state.tv.online) return fail("offline", "电视离线，无法确认执行结果，未改变电源状态。");
  const next = structuredClone(state);
  next[device][action] = value;
  const message = action === "power"
    ? `${devices[device].name}已${value ? "打开" : "关闭"}（模拟设备回执）。`
    : `空调设定温度已改为 ${value}°C（模拟设备回执${next.ac.power ? "" : "；电源仍关闭"}）。`;
  return { state: next, status: "ok", message, request };
}

export function lookupManual(model, topic) {
  const id = topic === "clean" ? "ac-clean" : topic === "intro" ? "fridge-intro" : null;
  const source = manuals.find(entry => entry.model === model && entry.id === id);
  return source
    ? { status: "found", message: source.text, source }
    : { status: "not_found", message: "示例资料里没有找到该型号的相关内容。我不能确认，请提供对应型号的官方手册或联系官方客服。", source: null };
}

export function clarifyFridge(choice) {
  const replies = {
    status: "示例冰箱正在运行：冷藏 4°C，冷冻 −18°C，门已关闭。这些是模拟状态。",
    door: "这台示例冰箱不支持电动开门，请手动打开冰箱门；没有执行远程开门。",
    power: "示例冰箱已经通电，无需重复打开。原型不提供冰箱远程断电操作。",
    cancel: "已取消，没有改变冰箱状态。",
  };
  return Object.hasOwn(replies, choice) ? replies[choice] : "未识别该选择，没有执行操作。";
}
