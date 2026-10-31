// Copyright (c) Microsoft. All rights reserved.

function folded(value) {
  return String(value || "").normalize("NFKD").toLowerCase()
    .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

function matchesTerms(value, query) {
  const text = folded(value);
  return String(query || "").trim().split(/\s+/).every((term) => text.includes(folded(term)));
}

export function filterVoiceGroups(groups, localeQuery = "", voiceQuery = "") {
  const locale = localeQuery.trim();
  const all = !locale || /^all(?: locales)?$/i.test(locale);
  const compact = folded(locale);
  const codeSearch = !all && (
    groups.some((group) => group.locale && folded(group.locale).startsWith(compact))
    || /^[a-z]{2,3}[-_\s][a-z]{1,3}$/i.test(locale)
  );
  return groups.flatMap((group) => {
    if (!all && !(codeSearch
      ? folded(group.locale).startsWith(compact)
      : matchesTerms(group.label, locale))) return [];
    const items = group.items.filter((voice) => matchesTerms([
      voice.id || voice.value, voice.label, voice.type, group.label,
      ...(voice.secondaryLocales || []),
    ].join(" "), voiceQuery));
    return items.length ? [{ ...group, items }] : [];
  });
}

export function voiceMatchCount(groups) {
  return groups.reduce((count, group) => count + group.items.length, 0);
}
