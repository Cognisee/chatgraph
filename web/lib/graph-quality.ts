/**
 * One definition of "is this graph any good", shared by the session export, the
 * audit bundle, and the trial harness.
 *
 * The three used to answer this separately and disagreed. For the same live
 * session the export reported 1 semantic edge and the audit reported 3, because
 * the export counted only knowledge->knowledge edges while the audit also
 * counted the Person hub. A user reading one downloaded bundle got two different
 * numbers for the same quantity, and neither told them the thing they actually
 * wanted to know: is this one connected graph, and does every node carry a real
 * label instead of a sentence?
 *
 * Person counts as a semantic endpoint everywhere. It is the hub the first facts
 * of every session hang from (hasRole, operatesBusiness), so excluding it makes
 * a perfectly connected opening look like three isolated fragments.
 */

import { gateContract, type GateContract } from "./gate/contract";
import { keyText, SUPERSEDED_BY } from "./gate/gate";
import type { GraphState, GraphVertex } from "./types";

export type NamedFact = { id: string; label: string; name: string };

export type GraphQuality = {
  /** Live (non-superseded) knowledge facts. */
  knowledgeVertices: number;
  supersededFacts: number;
  /** Edges between two semantic endpoints, excluding gate-authored plumbing. */
  semanticEdges: number;
  groundedSemanticEdges: number;
  /** Knowledge facts carrying a materialized evidence vertex. */
  groundedKnowledge: number;

  /** Live knowledge facts that no semantic edge touches. The target is none. */
  isolated: NamedFact[];
  /**
   * Components of the WHOLE graph, provenance spine included. Every fact hangs
   * off its evidence, which hangs off its episode, section and session, so a
   * healthy session is one reachable whole and this is 1. It is the honest
   * reading of "one connected graph": nothing is stranded, and every fact can be
   * traced back to the moment it was said.
   */
  fullGraphComponents: number;
  /**
   * Components of the SEMANTIC subgraph alone. Reported, never asserted on.
   * Expert knowledge genuinely arrives in topic clusters — arrival, recovery,
   * staffing — and the only relations that would fuse them into one component
   * are ones the expert never actually asserted. Driving this to 1 would mean
   * inventing relationships, which is precisely what the gate exists to prevent.
   */
  components: number;
  largestComponent: number;
  /** Fraction of semantic vertices inside the largest semantic component. */
  connectedShare: number;

  /** Facts whose displayed name reads as a sentence where a label belongs. */
  sentenceNamed: NamedFact[];
  /** Facts named by an identifier rather than a concept ("arrival:fragile"). */
  idShapedNames: NamedFact[];
  /** Facts with no textual content at all — HR001 should make this impossible. */
  contentless: NamedFact[];
  /** Facts sharing a normalized name with another fact of the same label. */
  duplicateNames: NamedFact[];
};

/**
 * Properties the schema declares to hold prose. A TimingRule's ruleText and an
 * OperatingHeuristic's heuristic are SUPPOSED to be full sentences ("if the guest
 * arrives before noon and the room is ready, let them in") — that is the content
 * of the fact, not a naming failure. Every other naming slot (name, title,
 * duration, constraintType, standardTime) is meant to be a short handle, and a
 * sentence sitting in one is the defect this flags.
 *
 * Presentation policy only: it decides what the quality report complains about
 * and never what the gate admits, so a wrong call here cannot corrupt data.
 */
function isProseSlot(propertyKey: string): boolean {
  return /Text$/.test(propertyKey) || propertyKey === "heuristic";
}

/** The declared string property keyText actually settled on for this vertex. */
function namingPropertyOf(vertex: GraphVertex, contract: GateContract): string | null {
  const spec = contract.vertexSpecs.get(vertex.label);
  if (!spec) return null;
  for (const [key, type] of spec.propertyTypes) {
    if (type !== "string") continue;
    const value = vertex.properties[key];
    if (typeof value === "string" && value.trim()) return key;
  }
  return null;
}

/**
 * A name that is really an identifier. The extractor reaches for one when it
 * mints a vertex to satisfy an edge endpoint: a trial produced GuestSignal
 * {name: "arrival:fragile"} beside GuestPersona {name: "fragile"}, naming the
 * signal after the id of the persona it pointed at. Colon-namespaced or
 * whole-string slug forms only, so ordinary hyphenated prose ("check-in delay")
 * is never mistaken for one.
 *
 * Every segment must contain a letter, which is what keeps a clock time out of
 * this: CheckInPolicy{standardTime: "15:00"} is a perfectly good name and was
 * flagged as an identifier until the numeric case was excluded.
 */
function readsAsIdentifier(name: string): boolean {
  const text = name.trim();
  if (!text) return false;
  if (/\s/.test(text)) return false;
  const segments = text.split(/[:-]/);
  if (segments.length < 2) return false;
  return segments.every((segment) => /[a-z]/i.test(segment));
}

const SENTENCE_MAX_WORDS = 8;

function readsAsSentence(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > SENTENCE_MAX_WORDS) return true;
  // First-person narration is the extractor copying the utterance rather than
  // naming the concept ("I keep two rooms ready").
  return /^(i|we|you|they|it|he|she)\b/i.test(name.trim());
}

/** Union-find over an edge list; returns root -> component size. */
function connectedComponents(
  vertexIds: string[],
  edges: { out: string; in: string }[]
): Map<string, number> {
  const parent = new Map<string, string>(vertexIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (!parent.has(edge.out) || !parent.has(edge.in)) continue;
    const a = find(edge.out);
    const b = find(edge.in);
    if (a !== b) parent.set(a, b);
  }
  const sizes = new Map<string, number>();
  for (const id of vertexIds) {
    const root = find(id);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  return sizes;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function graphQuality(graph: GraphState, domainId: string): GraphQuality {
  const contract = gateContract(domainId);
  const vertices = Object.values(graph.vertices);
  const edges = Object.values(graph.edges);

  const superseded = new Set(edges.filter((e) => e.label === SUPERSEDED_BY).map((e) => e.out));

  const isKnowledge = (v: GraphVertex | undefined): v is GraphVertex =>
    Boolean(v && contract.knowledgeLabels.has(v.label));
  const isSemanticEndpoint = (v: GraphVertex | undefined): v is GraphVertex =>
    Boolean(v && (contract.knowledgeLabels.has(v.label) || v.label === "Person"));

  const live = vertices.filter((v) => isKnowledge(v) && !superseded.has(v.id));
  const name = (v: GraphVertex) => keyText(v.properties, contract.vertexSpecs.get(v.label));
  const named = (v: GraphVertex): NamedFact => ({ id: v.id, label: v.label, name: name(v) });

  // Gate-authored plumbing is not a relationship the expert asserted.
  const plumbing = new Set<string>([...contract.provenanceEdgeLabels, SUPERSEDED_BY, "hasSection", "hasEpisode", "hasSession"]);
  const semantic = edges.filter(
    (e) =>
      !plumbing.has(e.label) &&
      isSemanticEndpoint(graph.vertices[e.out]) &&
      isSemanticEndpoint(graph.vertices[e.in]) &&
      !superseded.has(e.out) &&
      !superseded.has(e.in)
  );

  // --- connectivity ----------------------------------------------------------
  const componentSizes = connectedComponents(
    vertices.filter((v) => isSemanticEndpoint(v) && !superseded.has(v.id)).map((v) => v.id),
    semantic
  );
  const semanticVertices = vertices.filter((v) => isSemanticEndpoint(v) && !superseded.has(v.id));
  const largestComponent = componentSizes.size ? Math.max(...componentSizes.values()) : 0;
  // The whole graph, plumbing included: this is what "one connected graph" means.
  //
  // Evidence reaches its episode through the `sourceEpisode` PROPERTY rather than
  // an edge — the schema declares no evidence->episode relation — so a purely
  // edge-based walk finds every fact-plus-evidence pair stranded from the session
  // spine and reports a healthy session as five fragments. The reference is a
  // real structural link (HR025 exists to check it resolves to a live episode),
  // and the graph view already draws the chain, so connectivity counts it.
  const referenceEdges: { out: string; in: string }[] = [];
  for (const v of vertices) {
    if (v.label !== contract.evidenceLabel) continue;
    const episode = v.properties.sourceEpisode;
    if (typeof episode === "string" && graph.vertices[episode]) {
      referenceEdges.push({ out: v.id, in: episode });
    }
  }
  const fullGraphComponents = connectedComponents(
    vertices.map((v) => v.id),
    [...edges, ...referenceEdges]
  ).size;

  const degree = new Map<string, number>();
  for (const e of semantic) {
    degree.set(e.out, (degree.get(e.out) ?? 0) + 1);
    degree.set(e.in, (degree.get(e.in) ?? 0) + 1);
  }

  // --- per-fact quality ------------------------------------------------------
  const sentenceNamed: NamedFact[] = [];
  const idShapedNames: NamedFact[] = [];
  const contentless: NamedFact[] = [];
  for (const v of live) {
    const slot = namingPropertyOf(v, contract);
    if (!slot) {
      contentless.push(named(v));
      continue;
    }
    if (readsAsIdentifier(name(v))) idShapedNames.push(named(v));
    else if (!isProseSlot(slot) && readsAsSentence(name(v))) sentenceNamed.push(named(v));
  }

  const byNormalizedName = new Map<string, GraphVertex[]>();
  for (const v of live) {
    const key = `${v.label}::${normalizeName(name(v))}`;
    const list = byNormalizedName.get(key);
    if (list) list.push(v);
    else byNormalizedName.set(key, [v]);
  }
  const duplicateNames = [...byNormalizedName.values()]
    .filter((list) => list.length > 1)
    .flat()
    .map(named);

  const evidenceOwners = new Set(
    edges.filter((e) => contract.provenanceEdgeLabels.has(e.label)).map((e) => e.out)
  );

  return {
    knowledgeVertices: live.length,
    supersededFacts: superseded.size,
    semanticEdges: semantic.length,
    groundedSemanticEdges: semantic.filter((e) => typeof e.properties?.traceText === "string").length,
    groundedKnowledge: live.filter((v) => evidenceOwners.has(v.id)).length,
    isolated: live.filter((v) => !(degree.get(v.id) ?? 0)).map(named),
    fullGraphComponents,
    components: componentSizes.size,
    largestComponent,
    connectedShare: semanticVertices.length ? largestComponent / semanticVertices.length : 1,
    sentenceNamed,
    idShapedNames,
    contentless,
    duplicateNames
  };
}
