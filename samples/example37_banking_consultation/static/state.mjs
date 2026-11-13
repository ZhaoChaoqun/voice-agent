export const preferenceKey = "northstar-demo.preferences.v1";

export function validChoice(choice, models) {
  return choice && typeof choice.model === "string" && typeof choice.voice === "string"
    && Object.hasOwn(models, choice.model)
    && models[choice.model].voices.some(voice => voice.id === choice.voice);
}

export function chooseModel(choice, model, locked, models) {
  if (locked || model === choice.model || !Object.hasOwn(models, model)) return choice;
  return { model, voice: models[model].default_voice };
}

export function chooseVoice(choice, voice, locked, models) {
  const next = { model: choice.model, voice };
  return !locked && validChoice(next, models) ? next : choice;
}

function storageError(error) {
  if (!(error instanceof DOMException)
      || !["SecurityError", "QuotaExceededError"].includes(error.name)) throw error;
  console.warn("Northstar demo preferences cannot be stored:", error.name);
}

export function readPreferences(models, defaultModel, storage = () => globalThis.localStorage) {
  const defaults = { model: defaultModel, voice: models[defaultModel].default_voice, language: "de" };
  try {
    const raw = storage().getItem(preferenceKey);
    if (raw === null) return defaults;
    let value;
    try { value = JSON.parse(raw); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn("Northstar demo ignored malformed saved preferences.");
      return defaults;
    }
    if (!validChoice(value, models) || !["de", "en", "zh"].includes(value.language)) {
      console.warn("Northstar demo ignored unsupported saved preferences.");
      return defaults;
    }
    return { model: value.model, voice: value.voice, language: value.language };
  } catch (error) {
    storageError(error);
    return defaults;
  }
}

export function savePreferences(choice, language, models, storage = () => globalThis.localStorage) {
  if (!validChoice(choice, models) || !["de", "en", "zh"].includes(language)) {
    throw new RangeError("Unsupported demo preferences.");
  }
  try {
    storage().setItem(preferenceKey, JSON.stringify({ ...choice, language }));
    return true;
  } catch (error) {
    storageError(error);
    return false;
  }
}

export function updateTranscript(entries, event) {
  if (!["user", "assistant"].includes(event.role) || typeof event.id !== "string"
      || typeof event.text !== "string" || typeof event.final !== "boolean") {
    throw new TypeError("Invalid conversation caption.");
  }
  const key = `${event.role}:${event.id}`;
  const previous = entries.get(key);
  if (previous?.final && !event.final) return;
  entries.set(key, {
    role: event.role, final: event.final,
    text: event.final ? event.text : (previous?.text ?? "") + event.text,
  });
  if (entries.size > 200) entries.delete(entries.keys().next().value);
}
