// Copyright (c) Microsoft. All rights reserved.
import { anchoredPopover } from "./anchored-popover.mjs";

// Voice Live's published input languages, verified 2026-10-27:
// https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-language-support
export const INPUT_LANGUAGE_HINT =
  "Auto detects the input language. For more accurate recognition, open the list and check the candidate languages. The first selection is primary.";
export const INPUT_LANGUAGE_SOURCE =
  "https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-language-support";

export const VOICE_LIVE_INPUT_LOCALES = Object.freeze(`
zh-CN en-AU en-CA en-IN en-GB en-US fr-CA fr-FR de-DE hi-IN
it-IT ja-JP ko-KR es-MX es-ES
`.trim().split(/\s+/));
// Explicit Azure Speech locales, not just the default multilingual model's locales:
// https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=stt
export const AZURE_SPEECH_INPUT_LOCALES = Object.freeze(`
af-ZA am-ET ar-AE ar-BH ar-DZ ar-EG ar-IL ar-IQ ar-JO ar-KW ar-LB ar-LY
ar-MA ar-OM ar-PS ar-QA ar-SA ar-SY ar-TN ar-YE as-IN az-AZ bg-BG bho-IN
bn-IN bs-BA ca-ES cs-CZ cy-GB da-DK de-AT de-CH de-DE el-GR en-AU en-CA
en-GB en-GH en-HK en-IE en-IN en-KE en-NG en-NZ en-PH en-SG en-TZ en-US
en-ZA es-AR es-BO es-CL es-CO es-CR es-CU es-DO es-EC es-ES es-GQ es-GT
es-HN es-MX es-NI es-PA es-PE es-PR es-PY es-SV es-US es-UY es-VE et-EE
eu-ES fa-IR fi-FI fil-PH fr-BE fr-CA fr-CH fr-FR ga-IE gl-ES gu-IN he-IL
hi-IN hr-HR hu-HU hy-AM id-ID is-IS it-CH it-IT ja-JP jv-ID ka-GE kk-KZ
km-KH kn-IN ko-KR lo-LA lt-LT lv-LV mk-MK ml-IN mn-MN mr-IN ms-MY mt-MT
my-MM nb-NO ne-NP nl-BE nl-NL or-IN pa-IN pl-PL ps-AF pt-BR pt-PT ro-RO
ru-RU si-LK sk-SK sl-SI so-SO sq-AL sr-ME sr-RS sr-XK sv-SE sw-KE sw-TZ
ta-IN te-IN th-TH tr-TR uk-UA ur-IN uz-UZ vi-VN wuu-CN yue-CN zh-CN
zh-CN-shandong zh-CN-sichuan zh-HK zh-TW zu-ZA
`.trim().split(/\s+/));
const AZURE_MODELS = new Set(["azure-speech", "azure-speech-streaming", "azure-fast-transcription"]);
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

function inputLocales(model) {
  if (model === "azure-fast-transcription") {
    return AZURE_SPEECH_INPUT_LOCALES.filter((locale) => ![
      "sr-ME", "sr-XK", "sw-TZ", "zh-CN-shandong",
    ].includes(locale));
  }
  return AZURE_MODELS.has(model) ? AZURE_SPEECH_INPUT_LOCALES : VOICE_LIVE_INPUT_LOCALES;
}

function languageLabel(value) {
  return languageNames.of(value.split("-").slice(0, 2).join("-"));
}

export function inputLanguageLimit(model) {
  return AZURE_MODELS.has(model) || model === "azure-llm-speech" ? 10 : 1;
}

export function transcriptionLanguageOptions(model) {
  const options = inputLocales(model).map((value) => ({
    value,
    label: `${value} (${languageLabel(value)})`,
  })).sort((left, right) => left.value.localeCompare(right.value, "en"));
  return [
    { value: "", label: "Auto", disabled: model === "azure-speech-streaming" },
    ...options,
  ];
}

function foldedLanguage(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function displayTranscriptionLanguage(language = "") {
  if (!language || /^auto$/i.test(language)) return "Auto";
  if (language.includes(",")) return language.split(",").map((part) => displayTranscriptionLanguage(part.trim())).join(", ");
  const exact = VOICE_LIVE_INPUT_LOCALES.find((locale) => foldedLanguage(locale) === foldedLanguage(language));
  if (exact) return exact;
  const defaults = { en: "en-US", fr: "fr-FR", es: "es-ES" };
  return defaults[language] || VOICE_LIVE_INPUT_LOCALES.find((locale) => locale.split("-")[0] === language) || language;
}

export function normalizeTranscriptionLanguage(model, language = "") {
  if (typeof language !== "string") return language;
  if (!language.trim() || /^auto$/i.test(language.trim())) return "";
  const supported = inputLocales(model);
  return language.split(",").map((part) => {
    const text = part.trim();
    const query = foldedLanguage(text);
    const exact = supported.find((value) => foldedLanguage(value) === query);
    if (exact) return exact;
    const named = supported.filter((value) => [
      languageLabel(value),
      languageNames.of(value.split("-")[0]),
      `${languageLabel(value)} ${value}`,
      `${value} ${languageLabel(value)}`,
    ].some((name) => foldedLanguage(name) === query));
    if (named.length === 1) return named[0];
    return text;
  }).join(",");
}

export function transcriptionLanguageError(model, language) {
  if (language != null && typeof language !== "string") return "Input language must be a language code.";
  language = normalizeTranscriptionLanguage(model, language);
  if (!language?.trim()) {
    return model === "azure-speech-streaming"
      ? "Streaming Azure Speech requires an input language. Select a locale instead of Auto."
      : "";
  }
  const codes = language.split(",").map((code) => code.trim());
  if (codes.some((code) => !code)) return "Input language contains an empty language code.";
  if (codes.length > inputLanguageLimit(model)) {
    return inputLanguageLimit(model) > 1
      ? "Select at most 10 input locales."
      : `${model} supports only one input language. Select a language or Auto.`;
  }
  const supported = inputLocales(model);
  const invalid = codes.find((code) => !supported.some((value) => (
    value.toLowerCase() === code.toLowerCase()
    || (AZURE_MODELS.has(model)
      ? !code.includes("-") && value.split("-")[0] === code.toLowerCase()
      : value.split("-")[0] === code.split("-")[0].toLowerCase())
  )));
  if (invalid) return `${invalid} is not in the published Voice Live input language list for ${model}. Select a listed language or Auto.`;
  const bases = codes.map((code) => code.split("-")[0].toLowerCase());
  if (new Set(bases).size !== bases.length) return "Select only one locale per language; for example, en-IN or en-US, not both.";
  return "";
}

export function buildInputTranscription(model = "azure-speech", language = "") {
  language = normalizeTranscriptionLanguage(model, language);
  const error = transcriptionLanguageError(model, language);
  if (error) throw new Error(error);
  // Keep the API helper's language-code wire format separate from the picker's locale identity.
  const requestLanguage = language && !AZURE_MODELS.has(model)
    ? language.split(",").map((code) => code.split("-")[0]).join(",")
    : language;
  return { model, ...(requestLanguage?.trim() ? { language: requestLanguage.trim() } : {}) };
}

export function mountInputLanguagePicker({ input, toggle, list, model, value, onChange, onError = () => {} }) {
  const controller = new AbortController();
  const popup = list.closest(".input-language-options");
  const wasOpen = !popup.hidden;
  let header = popup.querySelector(".input-language-search-header");
  if (!header) {
    header = input.ownerDocument.createElement("div");
    header.className = "input-language-search-header";
    header.innerHTML = `
      <div class="input-language-search-row">
        <input type="search" data-language-search aria-label="Search input language locales"
          placeholder="Locale prefix: en-, hi-IN" autocomplete="off" spellcheck="false">
        <button type="button" data-language-search-clear aria-label="Clear language search">Clear</button>
      </div>
      <div class="input-language-selection"></div>
      <p class="input-language-results" role="status"></p>
      <p class="input-language-empty" role="status" hidden>No locales match this prefix.</p>`;
    popup.prepend(header);
  }
  const search = header.querySelector("[data-language-search]");
  const clearSearch = header.querySelector("[data-language-search-clear]");
  const summary = header.querySelector(".input-language-selection");
  const results = header.querySelector(".input-language-results");
  const empty = header.querySelector(".input-language-empty");
  search.setAttribute("aria-controls", list.id);
  const options = transcriptionLanguageOptions(model);
  let visibleOptions = options;
  const limit = 10;
  let current = normalizeTranscriptionLanguage(model, value);
  if (current) current = current.split(",").map((code) => (
    code.includes("-") ? code : displayTranscriptionLanguage(code)
  )).join(",");
  let active = options.findIndex((_, index) => input.getAttribute("aria-activedescendant") === `${list.id}-${index}`);
  input.readOnly = true;
  input.value = displayTranscriptionLanguage(current);
  input.removeAttribute("aria-autocomplete");
  input.removeAttribute("placeholder");
  input.setAttribute("aria-haspopup", "listbox");
  input.title = current || "Auto-detect";
  list.setAttribute("aria-multiselectable", String(limit > 1));
  const close = () => {
    floating.hide();
  };
  const floating = anchoredPopover(popup, input, { onClose: () => {
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    search.removeAttribute("aria-activedescendant");
  } });
  const render = () => {
    if (input.disabled) return;
    if (popup.hidden) {
      search.value = "";
      active = -1;
    }
    const scrollTop = popup.scrollTop;
    const selected = current ? current.split(",") : [];
    const prefix = search.value.trim().toLowerCase();
    visibleOptions = options.filter((option) => (option.value || "auto").toLowerCase().startsWith(prefix));
    clearSearch.disabled = !search.value;
    results.textContent = `${visibleOptions.length} of ${options.length} options`;
    empty.hidden = visibleOptions.length > 0;
    summary.textContent = selected.length
      ? `Selected: ${selected.join(" → ")}. First is primary.`
      : "Auto · default multilingual recognition";
    summary.textContent += ` Choose up to ${limit} languages.`;
    if (inputLanguageLimit(model) === 1) {
      summary.textContent += ` ${model} accepts one language when published. Use Azure Speech to run multiple candidates; your selections are kept.`;
    }
    list.replaceChildren(...visibleOptions.map((option, index) => {
      const label = input.ownerDocument.createElement("label");
      label.id = `${list.id}-${index}`;
      label.setAttribute("role", "option");
      const checked = option.value ? selected.includes(option.value) : !current;
      label.setAttribute("aria-selected", String(checked));
      const checkbox = input.ownerDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.tabIndex = -1;
      checkbox.checked = checked;
      checkbox.dataset.languageValue = option.value;
      const requiredSelection = checked && option.value && selected.length === 1 && model === "azure-speech-streaming";
      checkbox.disabled = option.disabled || requiredSelection || (!checked && Boolean(option.value) && (
        selected.length >= limit
        || selected.some((code) => code.split("-")[0] === option.value.split("-")[0])
      ));
      if (requiredSelection) label.title = "Streaming Azure Speech requires at least one input language.";
      const text = input.ownerDocument.createElement("span");
      text.textContent = option.label;
      label.append(checkbox, text);
      return label;
    }));
    floating.show();
    popup.scrollTop = scrollTop;
    input.setAttribute("aria-expanded", "true");
  };
  const commit = (text) => {
    const language = normalizeTranscriptionLanguage(model, text);
    const error = transcriptionLanguageError(model, language);
    input.setAttribute("aria-invalid", String(Boolean(error)));
    onError(error);
    const changed = language !== current;
    current = language;
    input.value = displayTranscriptionLanguage(language);
    input.title = language || "Auto-detect";
    render();
    if (changed) onChange(language);
  };
  const choose = (option) => {
    const selected = current ? current.split(",") : [];
    const language = normalizeTranscriptionLanguage(model, option.value);
    commit(!language ? "" : selected.includes(language) ? selected.filter((item) => item !== language).join(",")
        : [...selected, language].join(","));
  };
  const listen = (element, event, handler) => element.addEventListener(event, handler, { signal: controller.signal });
  input.ownerDocument.addEventListener("pointerdown", (event) => {
    if (!popup.hidden && !popup.contains(event.target) && !input.contains(event.target) && !toggle.contains(event.target)) {
      close();
    }
  }, { capture: true, signal: controller.signal });
  listen(input, "focus", render);
  listen(input, "click", () => { if (popup.hidden) render(); });
  const closeOnBlur = (event) => {
    if (!popup.contains(event.relatedTarget) && event.relatedTarget !== input && event.relatedTarget !== toggle) close();
  };
  listen(input, "blur", closeOnBlur);
  listen(search, "blur", closeOnBlur);
  listen(search, "input", () => {
    active = -1;
    input.removeAttribute("aria-activedescendant");
    search.removeAttribute("aria-activedescendant");
    popup.scrollTop = 0;
    render();
  });
  listen(clearSearch, "click", () => {
    search.value = "";
    active = -1;
    input.removeAttribute("aria-activedescendant");
    search.removeAttribute("aria-activedescendant");
    popup.scrollTop = 0;
    render();
    search.focus();
  });
  listen(toggle, "mousedown", (event) => event.preventDefault());
  listen(toggle, "click", () => {
    if (popup.hidden) { input.focus(); render(); } else close();
  });
  listen(popup, "mousedown", (event) => {
    if (event.target !== search) event.preventDefault();
  });
  listen(list, "change", (event) => {
    const checkbox = event.target.closest("[data-language-value]");
    if (checkbox && !checkbox.disabled) choose({ value: checkbox.dataset.languageValue });
  });
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      event.preventDefault();
      event.stopPropagation();
      input.focus({ preventScroll: true });
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (popup.hidden) render();
      if (!visibleOptions.length) return;
      active = active < 0
        ? (event.key === "ArrowDown" ? 0 : visibleOptions.length - 1)
        : (active + (event.key === "ArrowDown" ? 1 : -1) + visibleOptions.length) % visibleOptions.length;
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      search.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      input.ownerDocument.getElementById(`${list.id}-${active}`).scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || (event.key === " " && event.currentTarget === input)) {
      event.preventDefault();
      if (popup.hidden) {
        render();
        return;
      }
      const index = active >= 0 ? active : event.currentTarget === search && visibleOptions.length === 1 ? 0 : -1;
      const option = visibleOptions[index];
      const checkbox = option && list.querySelector(`#${list.id}-${index} input`);
      if (option && !checkbox.disabled) choose(option);
    }
  };
  listen(input, "keydown", onKeyDown);
  listen(search, "keydown", onKeyDown);
  const initialError = transcriptionLanguageError(model, value);
  input.setAttribute("aria-invalid", String(Boolean(initialError)));
  onError(initialError);
  if (wasOpen && !input.disabled) render();
  else close();
  return () => {
    controller.abort();
    floating.dispose();
  };
}
