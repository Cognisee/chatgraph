/**
 * Extractor-facing views of the gate contract.
 *
 * The schema reference, the provenance instructions, and the tool parameter
 * schema are all generated from the same contract the gate enforces. Nothing
 * here restates a label, an endpoint, or a vocabulary by hand, so the extractor
 * cannot be told something the gate will then reject — the drift that the
 * ablation's own logs show as the dominant failure mode.
 */

import type { GraphState } from "@/lib/types";
import { gateContract, type GateContract } from "./contract";
import { vertexKeyText, SUPERSEDED_BY } from "./gate";

/** Vertex and edge inventory, with required properties marked by `!`. */
export function schemaReference(domainId: string): string {
  const contract = gateContract(domainId);
  const vertexLines = [...contract.vertexSpecs.values()].map((spec) => {
    const props = [...spec.properties]
      .sort()
      .map((prop) => (spec.requiredProperties.has(prop) ? `${prop}!` : prop));
    return props.length ? `${spec.label}: ${props.join(", ")}` : `${spec.label}: no properties`;
  });
  const vertexSet = new Set(contract.vertexSpecs.keys());
  const edgeLines = [...contract.edgeSpecs.values()]
    // Gate-authored edges are omitted: provenance and supersession are attached
    // by the gate, so offering them would invite the extractor to guess.
    .filter((spec) => !gateAuthored(contract, spec.label) && !containerAnchored(contract, spec.label))
    .filter((spec) => [...spec.out].every((label) => vertexSet.has(label)) && [...spec.in].every((label) => vertexSet.has(label)))
    .map((spec) => `${spec.label}: ${[...spec.out].join(" | ")} -> ${[...spec.in].join(" | ")}`);
  return `VERTICES\n${vertexLines.join("\n")}\n\nEDGES\n${edgeLines.join("\n")}`;
}

/** How to ground each knowledge vertex, derived from the governance spec. */
export function provenanceInstructions(domainId: string): string {
  const contract = gateContract(domainId);
  if (!contract.governed || !contract.evidenceLabel) return "";
  const knowledge = [...contract.knowledgeLabels].sort().join(", ");
  const confidence = [...contract.confidenceValues].join(", ");
  const banned = contract.bannedTracePatterns.map((pattern) => `"${pattern}"`).join(", ");
  return [
    "GROUNDING",
    `These labels carry knowledge and must each carry an "evidence" object: ${knowledge}.`,
    'Set evidence.traceText to the expert\'s own words from the latest utterance — the specific span that licenses this fact, not a summary of the topic and not the whole turn.',
    confidence ? `Set evidence.confidence to one of: ${confidence}. Use "inferred" only for a fact synthesised across turns that no single quote states.` : "",
    banned ? `These traceText values are rejected: ${banned}.` : "",
    "A relationship between two knowledge entities is itself a claim: give each such edge an evidence object whose traceText is the span that ASSERTS THE RELATIONSHIP — the sentence linking both concepts — never a span that merely names one endpoint. An edge that connects two previously-known entities is REJECTED unless its evidence quotes the current utterance asserting that link.",
    assertionOnlyProperties(contract),
    "If the expert is merely agreeing with or echoing something the interviewer suggested, extract only what the expert themselves adds beyond the echo — interviewer-originated content is not the expert's knowledge.",
    "Do not emit evidence vertices or provenance edges yourself; they are attached for you from the evidence object.",
    "If the utterance does not support a fact, omit the fact rather than grounding it in something the expert did not say."
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tool parameters for the extraction call, including the inline evidence field. */
export function extractionToolSchema(domainId: string): Record<string, unknown> {
  const contract = gateContract(domainId);
  const vertexProperties: Record<string, unknown> = {
    id: { type: "string", description: "lowercase, hyphen-separated, colon-namespaced" },
    label: { type: "string", enum: [...contract.vertexSpecs.keys()] },
    properties: { type: "object", additionalProperties: true }
  };
  if (contract.governed && contract.evidenceLabel) {
    vertexProperties.evidence = evidenceSchema(contract);
  }

  return {
    type: "object",
    properties: {
      vertices: {
        type: "array",
        items: {
          type: "object",
          properties: vertexProperties,
          // `evidence` is required rather than optional: left optional, the model
          // intermittently omits it and authors orphan evidence vertices instead,
          // which the gate then discards as ungrounded.
          required: contract.governed && contract.evidenceLabel
            ? ["id", "label", "properties", "evidence"]
            : ["id", "label", "properties"]
        }
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: {
              type: "string",
              enum: [...contract.edgeSpecs.keys()].filter(
                (label) => !gateAuthored(contract, label) && !containerAnchored(contract, label)
              )
            },
            out: { type: "string" },
            in: { type: "string" },
            // A relationship claim is grounded exactly like a vertex claim.
            ...(contract.governed && contract.evidenceLabel ? { evidence: evidenceSchema(contract) } : {})
          },
          required: ["label", "out", "in"]
        }
      }
    },
    required: ["vertices", "edges"]
  };
}

/** True for edges only the gate may write. */
export function gateAuthored(contract: GateContract, edgeLabel: string): boolean {
  return contract.provenanceEdgeLabels.has(edgeLabel) || edgeLabel === SUPERSEDED_BY;
}

/**
 * True for edges anchored on structural containers (episodes, sections, the
 * session) whose ids only the deterministic scaffold knows. Offering these to
 * the extractor is how the live trial burned most of its retry budget: the
 * model kept guessing episode ids ("transcript:episode:1",
 * "transcriptepisode:latest") for `discusses` edges and collected HR004/HR005
 * rejections it could never fix — 21 of the session's 24 hard drops. The
 * episode→fact link already exists structurally via evidence.sourceEpisode,
 * so removing these from the vocabulary loses nothing.
 */
export function containerAnchored(contract: GateContract, edgeLabel: string): boolean {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return false;
  const containers = new Set([...contract.infrastructureLabels].filter((label) => label !== "Person"));
  if (containers.size === 0) return false;
  const allIn = (labels: Set<string>) => labels.size > 0 && [...labels].every((label) => containers.has(label));
  return allIn(spec.out) || allIn(spec.in);
}

/**
 * Boolean and numeric properties are judgments ("never compromise", a frequency,
 * a likelihood). The live audit found these to be the dominant padding channel:
 * 58 fabricated values, mostly booleans stamped true. The list is derived from
 * the schema's own type declarations, so it cannot drift.
 */
function assertionOnlyProperties(contract: GateContract): string {
  const names = new Set<string>();
  for (const label of contract.knowledgeLabels) {
    const spec = contract.vertexSpecs.get(label);
    if (!spec) continue;
    for (const [prop, type] of spec.propertyTypes) {
      if ((type === "boolean" || type === "integer") && !spec.requiredProperties.has(prop)) names.add(prop);
    }
  }
  if (names.size === 0) return "";
  return `ASSERTION-ONLY properties — set these ONLY when the expert explicitly states that judgment in this utterance, otherwise OMIT the property entirely (never guess a boolean or a number): ${[...names].sort().join(", ")}.`;
}

const SUMMARY_MAX_VERTICES = 80;
const SUMMARY_MAX_EDGES = 60;
const SUMMARY_MAX_TEXT = 60;

/**
 * The graph as the extractor should see it: knowledge only, one short line per
 * entity, framed as ids to reuse.
 *
 * The previous summary rendered every vertex with full properties — including
 * transcript episodes and evidence nodes carrying whole quoted utterances — so by
 * mid-interview it dwarfed the schema reference and the model began imitating
 * the summary's prose instead of the schema's vocabulary. Everything the model
 * does not need to *reference* is omitted; everything included is something it
 * should reuse rather than restate.
 */
export function knownEntitiesSummary(domainId: string, graph: GraphState): string {
  const contract = gateContract(domainId);

  const superseded = new Set<string>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.label === SUPERSEDED_BY) superseded.add(edge.out);
  }

  const referenceable = (label: string) =>
    contract.knowledgeLabels.has(label) ||
    (!contract.governed && Boolean(contract.vertexSpecs.get(label))) ||
    label === "Person" ||
    label === "KnowledgeSession";

  const vertices = Object.values(graph.vertices).filter(
    (vertex) => referenceable(vertex.label) && !superseded.has(vertex.id)
  );
  const shown = vertices.slice(-SUMMARY_MAX_VERTICES);
  const shownIds = new Set(shown.map((vertex) => vertex.id));
  const vertexLines = shown.map((vertex) => {
    const text = vertexKeyText(vertex, contract);
    const clipped = text.length > SUMMARY_MAX_TEXT ? `${text.slice(0, SUMMARY_MAX_TEXT - 1)}…` : text;
    return clipped ? `${vertex.id} (${vertex.label}) "${clipped}"` : `${vertex.id} (${vertex.label})`;
  });

  const edgeLines = Object.values(graph.edges)
    .filter(
      (edge) =>
        !gateAuthored(contract, edge.label) &&
        shownIds.has(edge.out) &&
        shownIds.has(edge.in)
    )
    .slice(-SUMMARY_MAX_EDGES)
    .map((edge) => `${edge.out} --${edge.label}--> ${edge.in}`);

  const omittedVertices = vertices.length - shown.length;
  return [
    "KNOWN ENTITIES — reuse these exact ids when the expert refers to the same concept again; never mint a second id for a concept listed here:",
    vertexLines.join("\n") || "(none yet)",
    "",
    "EXISTING RELATIONSHIPS (do not re-emit):",
    edgeLines.join("\n") || "(none yet)",
    omittedVertices > 0 ? `\n(${omittedVertices} older entities omitted)` : "",
    "",
    attachmentOptions(contract, shown.map((vertex) => vertex.label))
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The relations that could legally attach what the graph already holds.
 *
 * Isolated facts and mistyped relations came from the same place: the model knew
 * two concepts were related but had to guess which relation joined them, out of
 * 33, from the full schema table. In one trial it wanted to attach a staffing
 * ContextualConstraint to the CheckInPolicy — a pair the schema explicitly
 * permits — reached for `modulatedBy`, which does not accept CheckInPolicy, and
 * lost the edge; the constraint was left floating in a graph that already
 * contained its legal partner.
 *
 * So the options are enumerated instead: every relation whose BOTH endpoint
 * labels are already present, rendered in the schema's own direction. Generated
 * from the contract, never authored, so it cannot drift from the schema and
 * shrinks to nothing on an empty graph.
 */
function attachmentOptions(contract: GateContract, presentLabels: string[]): string {
  const present = new Set(presentLabels);
  // Person is always in the graph, and the identity facts hang off it.
  present.add("Person");

  const lines: string[] = [];
  for (const [label, spec] of contract.edgeSpecs) {
    if (gateAuthored(contract, label) || label === SUPERSEDED_BY) continue;
    const from = [...spec.out].filter((endpoint) => present.has(endpoint));
    const to = [...spec.in].filter((endpoint) => present.has(endpoint));
    if (from.length === 0 || to.length === 0) continue;
    lines.push(`${from.join("|")} --${label}--> ${to.join("|")}`);
  }
  if (lines.length === 0) return "";
  return [
    "ATTACHMENT OPTIONS — every relation whose endpoints are BOTH already in this graph. " +
    "If the utterance relates a new fact to something above, the relation you need is almost certainly here; " +
    "copy its direction exactly. Emit an edge only when the expert's words assert the relationship:",
    lines.join("\n")
  ].join("\n");
}

/**
 * Retry guidance for facts a delta left unattached.
 *
 * An isolated fact produces no hard finding, so before this the retry loop never
 * fired for the defect users complain about most: the gate would admit a
 * ContextualConstraint about solo afternoon shifts, leave it touching nothing,
 * and stop — even though the CheckInPolicy it constrains was sitting in the
 * graph and the schema had a relation for exactly that pair.
 *
 * Each unattached fact is named with the relations that could legally hold it,
 * computed against the labels actually present. Returns null when nothing can be
 * said, so a fact with no legal partner in the graph does not cost an attempt.
 */
export function isolationFeedback(
  domainId: string,
  graph: GraphState,
  isolated: { id: string; label: string; name: string }[]
): string | null {
  if (isolated.length === 0) return null;
  const contract = gateContract(domainId);
  const present = new Set(Object.values(graph.vertices).map((vertex) => vertex.label));

  const lines: string[] = [];
  for (const fact of isolated) {
    const options: string[] = [];
    for (const [label, spec] of contract.edgeSpecs) {
      if (gateAuthored(contract, label) || label === SUPERSEDED_BY) continue;
      if (spec.out.has(fact.label)) {
        const targets = [...spec.in].filter((endpoint) => present.has(endpoint));
        if (targets.length > 0) options.push(`${fact.label} --${label}--> ${targets.join("|")}`);
      }
      if (spec.in.has(fact.label)) {
        const sources = [...spec.out].filter((endpoint) => present.has(endpoint));
        if (sources.length > 0) options.push(`${sources.join("|")} --${label}--> ${fact.label}`);
      }
    }
    if (options.length === 0) continue;
    lines.push(`- "${fact.name}" (${fact.label}) is connected to nothing. Relations available: ${options.join("; ")}`);
  }
  if (lines.length === 0) return null;

  return [
    "These facts were admitted but left unattached:",
    lines.join("\n"),
    "",
    "Re-emit the same delta with the relationships the utterance supports, using the exact ids from KNOWN ENTITIES. " +
    "Do not add new facts and do not invent a relationship the expert did not state — if the utterance genuinely " +
    "asserts no relation for one of these, leave it unattached and re-emit the rest unchanged."
  ].join("\n");
}

function evidenceSchema(contract: GateContract): Record<string, unknown> {
  const confidence = [...contract.confidenceValues];
  return {
    type: "object",
    description: "Required on every knowledge vertex. The expert's own words supporting this fact.",
    properties: {
      traceText: { type: "string", description: "Verbatim span from the latest utterance" },
      ...(confidence.length > 0 ? { confidence: { type: "string", enum: confidence } } : {})
    },
    required: ["traceText"]
  };
}
