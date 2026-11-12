import { models, devices, manuals, initialState, controlDevice, lookupManual, clarifyFridge } from "./demo.mjs";

const $ = id => document.getElementById(id);
let state = initialState();
let active = false;
let selected = "ac";
let pendingFridge = false;

function message(role, text, source) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("small");
  label.textContent = role === "user" ? "你 · 脚本输入" : `小家 · ${models[$("model").value].name} · 模拟回复`;
  const content = document.createElement("p");
  content.textContent = text;
  article.append(label, content);
  if (source) {
    const link = document.createElement("button");
    link.textContent = `出处：${source.title} · 第 ${source.page} 页 ↗`;
    link.addEventListener("click", () => openManual(source.id));
    article.append(link);
  }
  $("conversation").append(article);
  $("conversation").scrollTop = $("conversation").scrollHeight;
}

function receipt(value) {
  $("trace").textContent = JSON.stringify({ simulated: true, ...value }, null, 2);
}

function updateModel() {
  const model = models[$("model").value];
  $("voice-note").textContent = model.note;
  $("voice-title").textContent = model.title;
  $("voice-detail").textContent = model.detail;
}

function render() {
  $("state-ac").textContent = state.ac.power ? `${state.ac.temperature}°C · 制冷` : "关闭";
  $("state-tv").textContent = state.tv.online ? (state.tv.power ? "开启" : "关闭") : "离线 · 状态未确认";
  $("state-light").textContent = state.light.power ? "开启" : "关闭";
  for (const id of ["ac", "tv", "light"]) $("hot-" + id).textContent = $("state-" + id).textContent;
  $("hot-fridge").textContent = "4°C · 保鲜中";
  $("session-status").textContent = active ? "模拟中" : "未开始";
  $("session-toggle").textContent = active ? "结束模拟体验" : "开始模拟体验";
  $("model").disabled = active;
  $("tv-offline").checked = !state.tv.online;
  $("clarification").hidden = !active || !pendingFridge;
  document.querySelectorAll("[data-scenario], [data-command]").forEach(button => { button.disabled = !active; });
  document.querySelectorAll(".device").forEach(button => {
    const isSelected = button.dataset.device === selected;
    button.classList.toggle("selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function command(request) {
  const result = controlDevice(state, request);
  state = result.state;
  receipt({ tool: "control_device", request, status: result.status });
  message("assistant", result.message);
  render();
}

function cancelPending() {
  if (pendingFridge) {
    pendingFridge = false;
    message("assistant", "已取消上一个冰箱澄清请求，没有执行操作。");
  }
}

function askFridge() {
  pendingFridge = true;
  message("assistant", "你是想查看冰箱状态、接通电源，还是打开冰箱门？我先确认一下。");
  receipt({ tool: "clarify_intent", device: "fridge", status: "awaiting_choice" });
  render();
}

function knowledge(model, topic) {
  const result = lookupManual(model, topic);
  receipt({ tool: "lookup_demo_manual", model, topic, status: result.status, source: result.source?.id ?? null });
  message("assistant", result.message, result.source);
}

function selectDevice(id) {
  selected = id;
  $("device-title").textContent = devices[id].name;
  $("device-description").textContent = devices[id].description;
  $("device-actions").replaceChildren();
  const actions = id === "fridge"
    ? [["查看状态", () => { receipt({ tool: "get_device_state", device: "fridge", status: "ok", state: state.fridge }); message("assistant", clarifyFridge("status")); }], ["打开冰箱…", askFridge]]
    : [["打开", () => command({ device: id, action: "power", value: true })], ["关闭", () => command({ device: id, action: "power", value: false })]];
  if (id === "ac") actions.push(["设为 26°C", () => command({ device: "ac", action: "temperature", value: 26 })]);
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.textContent = label;
    button.dataset.command = id;
    button.addEventListener("click", () => {
      if (!active) return;
      cancelPending();
      message("user", `${devices[id].name}：${label}`);
      action();
      render();
    });
    $("device-actions").append(button);
  }
  render();
}

const scenarios = {
  home() {
    message("user", "打开空调，调到 26 度。");
    command({ device: "ac", action: "power", value: true });
    command({ device: "ac", action: "temperature", value: 26 });
  },
  movie() {
    message("user", "打开电视，把灯关掉。");
    command({ device: "tv", action: "power", value: true });
    command({ device: "light", action: "power", value: false });
  },
  fridge() { message("user", "帮我打开冰箱。"); askFridge(); },
  manual() { message("user", "这台空调怎么清洗滤网？"); knowledge("DEMO AC-01", "clean"); },
  intro() { message("user", "介绍一下这台冰箱。"); knowledge("DEMO RF-01", "intro"); },
  missing() { message("user", "这台电视保修几年？"); knowledge("DEMO TV-01", "warranty"); },
};

function openManual(id) {
  $("manual-content").replaceChildren();
  for (const source of manuals.filter(entry => !id || entry.id === id)) {
    const article = document.createElement("article");
    article.className = "manual-entry";
    const heading = document.createElement("h3");
    heading.textContent = source.title;
    const meta = document.createElement("small");
    meta.textContent = `${source.model} / 第 ${source.page} 页 / ${source.section}`;
    const text = document.createElement("p");
    text.textContent = source.text;
    article.append(heading, meta, text);
    $("manual-content").append(article);
  }
  $("manual-dialog").showModal();
}

document.querySelectorAll("[data-device]").forEach(button => button.addEventListener("click", () => selectDevice(button.dataset.device)));
document.querySelectorAll("[data-scenario]").forEach(button => button.addEventListener("click", () => {
  if (!active) return;
  cancelPending();
  scenarios[button.dataset.scenario]();
  render();
}));
document.querySelectorAll("[data-clarify]").forEach(button => button.addEventListener("click", () => {
  if (!active || !pendingFridge) return;
  message("user", button.textContent);
  message("assistant", clarifyFridge(button.dataset.clarify));
  receipt({ tool: "clarify_intent", choice: button.dataset.clarify, status: "resolved_without_mutation" });
  pendingFridge = false;
  render();
}));
$("model").addEventListener("change", updateModel);
$("session-toggle").addEventListener("click", () => {
  if (active) cancelPending();
  active = !active;
  message("assistant", active
    ? "欢迎回家！我是小家。点一下场景脚本，看看我如何帮助你控制家电、查阅手册。这是无语音的交互原型。"
    : "模拟体验已结束。设备模拟状态保留，可以切换模型；点击重置可恢复初始状态。");
  render();
});
$("reset").addEventListener("click", () => {
  state = initialState();
  active = false;
  pendingFridge = false;
  $("conversation").replaceChildren();
  $("trace").textContent = "尚未执行操作。";
  message("assistant", "你好，我是小家。先选择模型，再点击「开始模拟体验」。所有控制与问答都是本地脚本演示。");
  selectDevice("ac");
});
$("tv-offline").addEventListener("change", event => {
  state = { ...state, tv: { ...state.tv, online: !event.target.checked } };
  receipt({ tool: "simulate_connectivity", device: "tv", online: state.tv.online });
  render();
});
$("manual-open").addEventListener("click", () => openManual());
$("manual-close").addEventListener("click", () => $("manual-dialog").close());
updateModel();
$("reset").click();
