// Copyright (c) Microsoft. All rights reserved.
// Inline subagents (definition.subagent_config with subagent_type "inline") are the authored and
// published form of a handoff Agent. The Editor canvas and the Runtime graph draw the equivalent
// handoff graph, so this module converts between the two without losing authored fields.
//
// Editor form: the legacy handoff graph shape, except that instructions stay uncombined:
//   - definition.instructions is the shared (base) prompt;
//   - definition.handoff.entrypoint keeps $entrypoint's own description, instructions and flags;
//   - each node.config keeps inherit_base_instructions and only its stage instructions.
// legacyGraphView() combines them into the graph the service would run, for display only.

export const ENTRYPOINT_ID = "$entrypoint";

// Behavior an implicit legacy entrypoint takes from the top-level definition.
const ENTRYPOINT_SESSION_FIELDS = ["tools", "tool_choice", "parallel_tool_calls"];
const NODE_METADATA_FIELDS = new Set(["description", "source", "interface"]);
const DEFAULT_SOURCE = "inline";
const DEFAULT_INTERFACE = "voice";
const DEFAULT_ENTRYPOINT_DESCRIPTION = "Entry point.";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const compact = (object) => Object.fromEntries(
  Object.entries(object).filter(([, value]) => value !== undefined),
);

export function usesInlineSubagents(definition) {
  return isObject(definition?.subagent_config)
    && definition.subagent_config.subagent_type === "inline";
}

function inlineSubagents(definition) {
  const subagents = definition.subagent_config.subagents;
  if (
    !Array.isArray(subagents)
    || subagents.length < 2
    || !subagents.every(isObject)
    || subagents[0].id !== ENTRYPOINT_ID
  ) {
    throw new Error(
      "Inline subagents must be objects, start with $entrypoint, and include at least one specialist.",
    );
  }
  return subagents;
}

function combinedInstructions(base, own, inherit) {
  if (!inherit || !base) return own;
  if (!own) return base;
  return `${base}\n\n${own}`;
}

/** Inline subagents -> Editor form. Other definitions are returned as a copy. */
export function inlineToEditorGraph(definition) {
  if (!usesInlineSubagents(definition)) return clone(definition);
  const subagents = inlineSubagents(definition);
  const { subagent_config: config, ...root } = clone(definition);
  const [entrypoint, ...specialists] = subagents;
  const entry = {};
  for (const [key, value] of Object.entries(entrypoint)) {
    if (key === "id" || key === "handoff_conditions") continue;
    if (ENTRYPOINT_SESSION_FIELDS.includes(key)) root[key] = clone(value);
    else entry[key] = clone(value);
  }
  const nodes = specialists.map((subagent) => {
    const node = { id: subagent.id };
    const nodeConfig = {};
    for (const [key, value] of Object.entries(subagent)) {
      if (key === "id" || key === "handoff_conditions") continue;
      if (NODE_METADATA_FIELDS.has(key)) node[key] = clone(value);
      else nodeConfig[key] = clone(value);
    }
    node.config = nodeConfig;
    return node;
  });
  const edges = subagents.flatMap((subagent) => (
    Array.isArray(subagent.handoff_conditions) ? subagent.handoff_conditions : []
  ).map((condition) => {
    const { id, target, condition: description, ...rest } = condition;
    return compact({ id, source: subagent.id, target, description, ...clone(rest) });
  }));
  root.handoff = {
    ...clone(isObject(config.handoff_policy) ? config.handoff_policy : {}),
    entrypoint: entry,
    nodes,
    edges,
  };
  return root;
}

/** Any definition (inline, Editor form or legacy) -> the combined legacy graph, for display. */
export function legacyGraphView(definition) {
  const view = usesInlineSubagents(definition)
    ? inlineToEditorGraph(definition)
    : clone(definition);
  const graph = view?.handoff;
  if (!isObject(graph)) return view;
  const base = typeof view.instructions === "string" ? view.instructions : "";
  if (isObject(graph.entrypoint)) {
    const entry = graph.entrypoint;
    const instructions = combinedInstructions(
      base, entry.instructions, entry.inherit_base_instructions ?? true,
    );
    if (instructions === undefined || instructions === null) delete view.instructions;
    else view.instructions = instructions;
  }
  delete graph.entrypoint;
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!isObject(node)) continue;
    // Subagent identity metadata has no place in a legacy graph node.
    delete node.source;
    delete node.interface;
    if (!isObject(node.config)) continue;
    const config = node.config;
    const inherit = config.inherit_base_instructions ?? config.inherit_from_base_instructions;
    delete config.inherit_base_instructions;
    delete config.inherit_from_base_instructions;
    if (inherit === true) {
      const instructions = combinedInstructions(base, config.instructions, true);
      if (instructions !== undefined) config.instructions = instructions;
    }
  }
  return view;
}

function convertibleGraph(graph) {
  if (!isObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  if (!graph.nodes.length) return null;
  const ids = new Set([ENTRYPOINT_ID]);
  for (const node of graph.nodes) {
    if (
      !isObject(node) || typeof node.id !== "string" || !node.id
      || ids.has(node.id) || !isObject(node.config)
    ) {
      return null;
    }
    ids.add(node.id);
  }
  if (!graph.edges.every((edge) => isObject(edge) && ids.has(edge.source))) return null;
  return ids;
}

/**
 * Editor form (or a legacy graph) -> inline subagents for export and publication.
 * A graph the inline form cannot express (no specialists, or edges from unknown nodes) is
 * returned as the combined legacy graph instead, so nothing authored is dropped.
 */
export function editorGraphToInline(definition) {
  if (!isObject(definition) || usesInlineSubagents(definition)) return clone(definition);
  if (!isObject(definition.handoff)) return clone(definition);
  const ids = convertibleGraph(definition.handoff);
  if (!ids) return legacyGraphView(definition);
  const { handoff, ...root } = clone(definition);
  const { nodes, edges, entrypoint, ...policy } = handoff;
  const conditions = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    const { id, source, target, description, ...rest } = edge;
    conditions.get(source).push(compact({ id, target, condition: description, ...rest }));
  }
  const withConditions = (subagent) => (
    conditions.get(subagent.id).length
      ? { ...subagent, handoff_conditions: conditions.get(subagent.id) }
      : subagent
  );
  const entry = {
    id: ENTRYPOINT_ID,
    source: DEFAULT_SOURCE,
    interface: DEFAULT_INTERFACE,
    description: DEFAULT_ENTRYPOINT_DESCRIPTION,
    inherit_base_instructions: true,
    ...(isObject(entrypoint) ? entrypoint : {}),
  };
  for (const field of ENTRYPOINT_SESSION_FIELDS) {
    if (field in root) entry[field] = clone(root[field]);
  }
  const specialists = nodes.map((node) => {
    const {
      id, config, description, source = DEFAULT_SOURCE, interface: nodeInterface = DEFAULT_INTERFACE,
      ...extra
    } = node;
    const { inherit_from_base_instructions: legacyInherit, ...behavior } = config;
    return compact({
      id,
      source,
      interface: nodeInterface,
      description,
      ...extra,
      // A legacy node without a flag already carries its complete instructions.
      inherit_base_instructions: behavior.inherit_base_instructions ?? legacyInherit ?? false,
      ...behavior,
    });
  });
  root.subagent_config = {
    subagent_type: "inline",
    subagents: [entry, ...specialists].map(withConditions),
    ...(Object.keys(policy).length ? { handoff_policy: policy } : {}),
  };
  return root;
}
