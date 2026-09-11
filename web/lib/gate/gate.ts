/**
 * The symbolic gate: a deterministic admission decision for every proposed fact.
 *
 * Two properties matter and are deliberate:
 *
 * 1. Admission is PER FACT, not per delta. A single bad edge drops that edge, not
 *    the turn's knowledge. Replaying the frozen ablation deltas under per-delta
 *    admission yields 60.4% (A3); per-fact admission yields 97.9% of the same
 *    proposals, because whole turns were being discarded over one dangling edge.
 *
 * 2. Provenance is STRUCTURAL, not remembered. The extractor attaches evidence
 *    inline to each knowledge vertex; this module materializes the evidence
 *    vertex and selects the correctly-typed provenance edge from the contract.
 *    An unlinked evidence node and a mistyped provenance edge are therefore not
 *    representable. In the frozen run the extractor emitted 41 evidence nodes but
 *    only 7 provenance edges, which is what collapsed A4 to zero admitted facts.
 *
 * The check is stateless apart from the caller-supplied graph, so any admission
 * decision can be reproduced from the contract and the record's own metadata.
 */

import type { GraphDelta, GraphEdge, GraphState, GraphVertex, JsonValue } from "@/lib/types";
import { gateContract, severityOf as contractSeverity, type GateContract, type Severity, type VertexSpec } from "./contract";

export type GateMode = "schema" | "governed";

/**
 * Turn-level facts the gate fills in on materialized evidence. Supplying these
 * deterministically means the extractor only has to quote the expert; it cannot
 * misattribute a speaker or invent an episode id.
 */
export type EvidenceContext = {
  sourceEpisode: string;
  speaker: string;
  /** The turn being extracted. Evidence is checked for being a span of it. */
  utterance?: string;
  /**
   * Everything the expert said BEFORE this turn. Used only by HR029, to tell a
   * fact extracted from this utterance apart from one remembered out of an
   * earlier one.
   */
  priorUtterances?: string[];
};

export type GateOptions = {
  mode?: GateMode;
  evidenceContext?: EvidenceContext;
  /**
   * Rewrite knowledge-vertex ids to a content hash so the same fact stated twice
   * merges instead of duplicating. Off leaves extractor-chosen ids intact.
   */
  deterministicIds?: boolean;
  /**
   * Supersede rather than overwrite: a singleton whose content changed marks the
   * prior version invalid and keeps it, so corrections stay auditable.
   */
  temporalContradictions?: boolean;
  /**
   * Raise or lower a rule's severity for this run. Used by the evaluation harness
   * to price what strict enforcement of an otherwise-soft rule costs; the deployed
   * configuration always uses the severities the spec declares.
   */
  severityOverrides?: Record<string, Severity>;
  /**
   * Resolve near-duplicate knowledge vertices onto the vertex the graph already
   * holds. Content hashing only merges exact restatements; an expert who says
   * "guest-centered service" one turn and "guest-centred experience" the next
   * otherwise mints a new concept each time, and the graph sprawls into
   * hub-and-spoke clutter. Matching is deterministic: same label, same normalized
   * key text, or token overlap above a fixed threshold.
   */
  resolveEntities?: boolean;
};

/** A prior fact a new one invalidates. */
export type Supersession = {
  supersededId: string;
  supersedingId: string;
  label: string;
};

export type GateFinding = {
  ruleId: string;
  severity: Severity;
  message: string;
  subjectId: string | null;
  action: "dropped" | "flagged" | "repaired";
};

export type GateResult = {
  delta: GraphDelta;
  findings: GateFinding[];
  /** Feedback for a bounded retry, or null when nothing hard was rejected. */
  retryFeedback: string | null;
  /** Prior facts this delta invalidated. Empty unless temporal handling is on. */
  supersessions: Supersession[];
};

/** Edges the gate writes itself; the extractor is never offered them. */
export const SUPERSEDED_BY = "supersededBy";

/** Rule severity, with any harness override applied. */
function severityOf(
  contract: GateContract,
  ruleId: string,
  fallback: Severity,
  options?: GateOptions
): Severity {
  return options?.severityOverrides?.[ruleId] ?? contractSeverity(contract, ruleId, fallback);
}

type Candidate = {
  id: string;
  label: string;
  properties: Record<string, JsonValue>;
  evidence: Record<string, JsonValue> | null;
  /** True for vertices the gate itself materialized rather than the extractor. */
  synthetic: boolean;
};

export function runGate(
  input: unknown,
  graph: GraphState,
  domainId: string,
  options: GateOptions = {}
): GateResult {
  const contract = gateContract(domainId);
  const findings: GateFinding[] = [];
  const governed = (options.mode ?? "governed") === "governed" && contract.governed;

  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) {
    findings.push(finding("HR000", "hard", "extractor returned a non-object delta", null, "dropped"));
  }

  const candidates = parseVertices(raw.vertices, findings);
  const parsedEdges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map(parseEdge)
    .filter((item): item is ParsedEdge => item !== null);
  const supersessions: Supersession[] = [];

  // Resolution runs before evidence materialization so evidence follows the
  // resolved id, and before admission so singleton and duplicate checks see the
  // canonical identity.
  const resolvedIds = new Set<string>();
  if (governed && options.resolveEntities) {
    const rewrites = resolveEntities(candidates, graph, contract);
    for (const [from, to] of rewrites) {
      findings.push(finding("HR009", "advisory", `resolved ${from} to existing ${to}`, from, "repaired"));
      resolvedIds.add(to);
    }
    if (rewrites.size > 0) {
      for (const candidate of candidates) {
        const to = rewrites.get(candidate.id);
        if (to) candidate.id = to;
      }
      for (const edge of parsedEdges) {
        edge.out = rewrites.get(edge.out) ?? edge.out;
        edge.in = rewrites.get(edge.in) ?? edge.in;
      }
    }
  }

  // Materialize inline evidence before validation, so the synthesized vertices and
  // edges are held to exactly the same rules as extractor-authored ones.
  const materialized = governed
    ? materializeEvidence(candidates, contract, findings, options, graph)
    : { vertices: [], edges: [] };

  const admittedVertices: GraphVertex[] = [];
  const labels = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  const seenCandidateIds = new Set<string>();
  const deltaSingletons = new Set<string>();
  for (const candidate of [...candidates, ...materialized.vertices]) {
    if (seenCandidateIds.has(candidate.id)) continue;
    seenCandidateIds.add(candidate.id);
    // Evidence is the gate's to author. An extractor-supplied evidence vertex is
    // dropped rather than admitted, otherwise the orphan nodes it emits alongside
    // the materialized ones accumulate as unreferenced clutter.
    if (governed && !candidate.synthetic && candidate.label === contract.evidenceLabel) {
      findings.push(finding("HR006", "advisory", `ignored extractor-authored evidence ${candidate.id}; evidence is attached from the inline field`, candidate.id, "dropped"));
      continue;
    }
    const spec = contract.vertexSpecs.get(candidate.label);
    if (!spec) {
      findings.push(finding("HR002", severityOf(contract, "HR002", "hard", options), `unknown vertex label ${candidate.label}`, candidate.id, "dropped"));
      continue;
    }
    const properties = pick(candidate.properties, spec.properties);
    const missing = [...spec.requiredProperties].filter((key) => isBlank(properties[key]));
    if (missing.length > 0) {
      findings.push(finding("HR001", severityOf(contract, "HR001", "hard", options), `${candidate.id} missing required ${missing.join(", ")}`, candidate.id, "dropped"));
      continue;
    }
    // A knowledge fact must say something: a vertex whose only surviving
    // properties are booleans/numbers ({"lateCheckOut": false}) names no concept,
    // cannot be resolved by keyText, and is almost always a padding artifact.
    if (governed && contract.knowledgeLabels.has(candidate.label)) {
      const hasContent = Object.values(properties).some(
        (value) => typeof value === "string" && value.trim().length > 0
      );
      if (!hasContent) {
        findings.push(finding("HR001", severityOf(contract, "HR001", "hard", options), `${candidate.id} carries no textual content; a knowledge fact needs at least one substantive string property`, candidate.id, "dropped"));
        continue;
      }
    }
    if (governed && !admitEvidenceQuality(candidate.label, properties, contract, findings, candidate.id, options)) continue;
    if (governed && !admitTextQuality(candidate.label, properties, contract, findings, candidate.id, options)) continue;
    if (governed && !admitSingleton(candidate, properties, graph, contract, findings, options, supersessions)) continue;
    // A singleton label may appear once per delta: the live session admitted two
    // CheckInPolicy vertices from one turn because only the graph was checked.
    if (governed && contract.singletonLabels.has(candidate.label)) {
      if (deltaSingletons.has(candidate.label)) {
        findings.push(finding("HR009", severityOf(contract, "HR009", "hard", options), `${candidate.label} appears more than once in this delta; ${candidate.id} dropped`, candidate.id, "dropped"));
        continue;
      }
      deltaSingletons.add(candidate.label);
    }
    admittedVertices.push({ id: candidate.id, label: candidate.label, properties });
    labels.set(candidate.id, candidate.label);
  }

  const admittedEdges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const deltaVertexIds = new Set(candidates.map((candidate) => candidate.id));

  // Provenance edges are the gate's to author, exactly as evidence vertices are.
  // An extractor-emitted supportedBy necessarily points at an evidence id the
  // gate ignored, so it can only dangle — and as a hard HR005 it burned a retry
  // asking the model to "emit the missing endpoint", which is the one repair
  // HR006 forbids. Trial turns spent two of three attempts in that loop.
  const extractorEdges = governed
    ? parsedEdges.filter((item) => {
        if (!contract.provenanceEdgeLabels.has(item.label)) return true;
        findings.push(finding("HR006", "advisory", `ignored extractor-authored ${item.label} edge; provenance is attached from the inline evidence field`, item.id || null, "dropped"));
        return false;
      })
    : parsedEdges;

  for (const item of [...extractorEdges, ...materialized.edges]) {
    const spec = contract.edgeSpecs.get(item.label);
    if (!spec) {
      findings.push(finding("HR003", severityOf(contract, "HR003", "hard", options), `unknown edge label ${item.label}`, item.id || null, "dropped"));
      continue;
    }
    // A malformed endpoint id with an unambiguous referent is repaired rather
    // than dropped: "guest-persona:tired-arrival" for guestpersona:<hash>, or
    // "timingrule:undefined" when exactly one TimingRule exists. Repair demands
    // a unique match, so a guess is never possible.
    if (governed && !labels.has(item.out)) {
      const repaired = repairEndpointId(item.out, labels, graph, contract);
      if (repaired) {
        findings.push(finding("HR005", "advisory", `repaired endpoint ${item.out} -> ${repaired}`, item.id || null, "repaired"));
        item.out = repaired;
      }
    }
    if (governed && !labels.has(item.in)) {
      const repaired = repairEndpointId(item.in, labels, graph, contract);
      if (repaired) {
        findings.push(finding("HR005", "advisory", `repaired endpoint ${item.in} -> ${repaired}`, item.id || null, "repaired"));
        item.in = repaired;
      }
    }
    if (!labels.has(item.out) || !labels.has(item.in)) {
      findings.push(finding("HR005", severityOf(contract, "HR005", "hard", options), `dangling ${item.label}: ${labels.has(item.out) ? item.in : item.out} is not in this delta or the graph`, item.id || null, "dropped"));
      continue;
    }
    const outLabel = labels.get(item.out) ?? "";
    const inLabel = labels.get(item.in) ?? "";
    if (!endpointsConform(contract, item.label, outLabel, inLabel)) {
      findings.push(finding("HR004", severityOf(contract, "HR004", "hard", options), `${item.label} connects ${outLabel}->${inLabel}, expected ${expectedEndpoints(contract, item.label)}${edgeSuggestions(contract, outLabel, inLabel)}`, item.id || null, "dropped"));
      continue;
    }
    const id = item.id || `${item.out}--${item.label}-->${item.in}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);
    // Edge properties are held to the schema exactly as vertex properties are.
    const properties = pick(item.properties, spec.properties);

    // HR026: an edge between two concepts that both live only in the graph —
    // neither re-emitted this turn — asserts a relationship the current utterance
    // did not visibly discuss. The live audit found this to be the dominant
    // incoherence surface ("theft resolvedBy cigarette response"). Such an edge
    // must carry its own span-valid witness from the current utterance.
    if (
      governed &&
      contract.knowledgeLabels.has(labels.get(item.out) ?? "") &&
      contract.knowledgeLabels.has(labels.get(item.in) ?? "") &&
      !deltaVertexIds.has(item.out) &&
      !deltaVertexIds.has(item.in)
    ) {
      const witness = item.evidence ? asString(item.evidence.traceText) : "";
      const problem = witness
        ? edgeTraceProblem(witness, contract, options)
        : "is missing entirely";
      if (problem) {
        const severity = severityOf(contract, "HR026", "hard", options);
        findings.push(finding("HR026", severity, `cross-turn edge ${id} witness evidence ${problem}`, id, severity === "hard" ? "dropped" : "flagged"));
        if (severity === "hard") continue;
      }
    }
    // A relationship between knowledge vertices is a fact; its inline evidence is
    // validated with the same span rule and stored on the edge itself. Failure is
    // advisory: the edge is admitted ungrounded and flagged, mirroring the spec's
    // soft severity for vertex provenance.
    if (governed && item.evidence && spec.properties.has("traceText")) {
      const trace = asString(item.evidence.traceText);
      const problem = edgeTraceProblem(trace, contract, options);
      if (problem) {
        findings.push(finding("HR012", "advisory", `${id} edge evidence ${problem}`, id, "flagged"));
      } else {
        properties.traceText = trace;
        const confidence = asString(item.evidence.confidence);
        if (confidence && contract.confidenceValues.has(confidence)) properties.confidence = confidence;
      }
    }
    admittedEdges.push({ id, label: item.label, out: item.out, in: item.in, properties });
  }

  // HR027 runs on what survived, because whether a property restates the delta
  // can only be judged once the delta's other facts are known.
  if (governed) stripRestatedProperties(admittedVertices, contract, findings, options);
  const remembered = governed
    ? stripRememberedProperties(admittedVertices, contract, findings, options)
    : new Set<string>();
  if (remembered.size > 0) {
    // A fact that never happened supersedes nothing: the singleton it displaced
    // must stay live, or an utterance about interview pacing retires a real one.
    for (let i = supersessions.length - 1; i >= 0; i -= 1) {
      if (remembered.has(supersessions[i].supersedingId)) supersessions.splice(i, 1);
    }
  }

  // Provenance attachment is checked after admission, on what actually survived.
  const ungroundedAll = governed
    ? checkProvenanceAttachment(admittedVertices, admittedEdges, labels, contract, findings, options)
    : new Set<string>();
  // Dropped outright only when the spec's soft provenance rule is escalated.
  const ungrounded =
    governed && severityOf(contract, "HR006", "soft", options) === "hard" ? ungroundedAll : new Set<string>();

  // HR028: an unwitnessed re-assertion must not rewrite a fact already stored.
  //
  // On a turn where the expert only asked the interviewer to keep the questions
  // short, the extractor re-emitted a TimingRule it had captured two turns
  // earlier — with a DIFFERENT ruleType, and with evidence that quoted neither
  // utterance. Because the id is content-derived the re-emission merged onto the
  // stored fact and silently overwrote it from an utterance that never mentioned
  // it. Nothing is lost by refusing this: the fact is already in the graph, and
  // edges may still reference it, because HR005 resolves endpoints against the
  // graph as well as the delta.
  // What "witnessed by this turn" actually means: the CANDIDATE carried inline
  // evidence whose trace is a valid span of the current utterance. It must be
  // judged from the candidate, not from whether a provenance edge was
  // materialized this turn — first-witness-wins deliberately declines to
  // materialize for an already-grounded fact, and reading that as "unwitnessed"
  // made HR028 block legitimate corrections: the expert said "it's three rooms
  // now", the extractor correctly reused the stored id with a fresh quote, and
  // the gate dropped the correction three attempts in a row. (An `inferred`
  // trace is intentionally not a witness here: cross-turn synthesis may add new
  // facts, but rewriting a stored one demands direct words.)
  const witnessedIds = new Set<string>();
  if (governed && options.evidenceContext?.utterance) {
    for (const candidate of candidates) {
      if (!candidate.evidence) continue;
      const trace = asString(candidate.evidence.traceText);
      if (trace && !traceSpecificity(trace, options.evidenceContext.utterance)) {
        witnessedIds.add(candidate.id);
      }
    }
  }

  const unwitnessed = new Set<string>();
  if (governed) {
    for (const vertex of admittedVertices) {
      // Knowledge only: the scaffold re-emits sections and episodes every turn,
      // and infrastructure carries no inline evidence to witness it with.
      if (!contract.knowledgeLabels.has(vertex.label)) continue;
      if (witnessedIds.has(vertex.id)) continue;
      const stored = graph.vertices[vertex.id];
      if (stored && stored.label === vertex.label) {
        unwitnessed.add(vertex.id);
        findings.push(finding(
          "HR028",
          severityOf(contract, "HR028", "soft", options),
          `${vertex.id} restates a stored fact without evidence from this utterance; the stored fact is left unchanged`,
          vertex.id,
          "dropped"
        ));
        continue;
      }
      // Superseding is destructive, so it is held to the same witness standard
      // HR026 puts on a cross-turn edge. A logistics turn retired a real
      // check-in policy this way: HR029 stripped the field copied verbatim from
      // an earlier turn, but a numeral rendering of it ("11:00" for "eleven")
      // survived the lexical test, and that residue was enough to mint a new
      // singleton and supersede the genuine one. An ungrounded fact may not
      // retire a grounded one.
      const displaces = supersessions.some((item) => item.supersedingId === vertex.id);
      if (!displaces) continue;
      unwitnessed.add(vertex.id);
      findings.push(finding(
        "HR028",
        severityOf(contract, "HR028", "soft", options),
        `${vertex.id} would supersede a stored fact without evidence from this utterance; the stored fact stays live`,
        vertex.id,
        "dropped"
      ));
    }
    for (let i = supersessions.length - 1; i >= 0; i -= 1) {
      if (unwitnessed.has(supersessions[i].supersedingId)) supersessions.splice(i, 1);
    }
    // Only supersessions that survived every witness check inherit: a pruned
    // one keeps the stored vertex live, so there is nothing to carry over.
    inheritSupersededProperties(admittedVertices, supersessions, graph, contract, findings);
  }

  if (governed && options.deterministicIds) {
    for (const vertex of admittedVertices) {
      // Only knowledge vertices have content-derived identity; evidence and
      // other infrastructure ids are structural and are never re-hashed, so
      // judging them here produced repair findings that never happened.
      if (!contract.knowledgeLabels.has(vertex.label)) continue;
      const existing = graph.vertices[vertex.id];
      if (!existing || existing.label !== vertex.label) continue;
      // Iteration-05 protected every reused id from re-hashing, which let a
      // reused id be silently overwritten with a DIFFERENT concept ("loyalty
      // program" became "theft" in the first live session, dragging every prior
      // edge to the wrong endpoint). Protection now requires identity
      // consistency: the reused id keeps its id only if its content still names
      // the same concept; otherwise it de-collides into its own content hash and
      // the stored concept is left untouched.
      if (contract.singletonLabels.has(vertex.label)) {
        // Singletons have their own change mechanism (supersession).
        resolvedIds.add(vertex.id);
        continue;
      }
      const spec = contract.vertexSpecs.get(vertex.label);
      const declared = spec?.properties ?? new Set<string>();
      const existingKey = keyText(pick(existing.properties, declared), spec);
      const candidateKey = keyText(vertex.properties, spec);
      if (!existingKey || !candidateKey || sameConceptName(existingKey, candidateKey)) {
        resolvedIds.add(vertex.id);
      } else {
        findings.push(finding(
          "HR009", "advisory",
          `${vertex.id} was reused for a different concept ("${candidateKey.slice(0, 40)}" vs stored "${existingKey.slice(0, 40)}"); assigned its own identity`,
          vertex.id, "repaired"
        ));
      }
    }
  }

  // An ungrounded fact leaves with anything hanging off it (hard escalation
  // only). An unwitnessed re-assertion leaves alone: its edges stay, because the
  // fact it names is already in the graph.
  let delta: GraphDelta = {
    vertices: admittedVertices.filter(
      (vertex) => !ungrounded.has(vertex.id) && !unwitnessed.has(vertex.id) && !remembered.has(vertex.id)
    ),
    edges: admittedEdges.filter(
      (edge) =>
        !ungrounded.has(edge.out) && !ungrounded.has(edge.in) &&
        !remembered.has(edge.out) && !remembered.has(edge.in)
    )
  };
  if (governed && options.deterministicIds) delta = applyDeterministicIds(delta, contract, supersessions, resolvedIds);
  for (const supersession of supersessions) {
    delta.edges.push({
      id: `${supersession.supersededId}--${SUPERSEDED_BY}-->${supersession.supersedingId}`,
      label: SUPERSEDED_BY,
      out: supersession.supersededId,
      in: supersession.supersedingId,
      properties: {}
    });
  }

  return { delta, findings, retryFeedback: buildRetryFeedback(findings, contract), supersessions };
}

/**
 * The property that names a vertex — derived from the schema, never listed here.
 *
 * Every label declares its naming property FIRST, and almost always as required:
 * ExpertRole.title, HospitalityBusiness.name, OperatingTenure.duration,
 * TimingRule.ruleText, ContextualConstraint.constraintType. Declaration order in
 * the schema therefore *is* the priority order, and any hand-written ranking can
 * only drift away from it.
 *
 * The list this replaced did exactly that, in two ways. It ranked `description`
 * above `duration`, so an OperatingTenure holding {duration: "10 years"} was
 * named by its padding description instead — displayed on the node, used as the
 * identity-resolution key, and shown to the extractor in KNOWN ENTITIES — which
 * is how a node meaning "10 years" came to read "general manager for a large
 * hotel chain" and looked like a duplicate of the ExpertRole beside it. It also
 * ranked `signalText`, which no label in the schema declares at all.
 *
 * Shared by resolution here, by the graph view, and by human-readable rendering
 * in the evaluation harness, so all three name a vertex identically.
 */
export function keyText(properties: Record<string, JsonValue>, spec?: VertexSpec): string {
  if (spec) {
    for (const [key, type] of spec.propertyTypes) {
      if (type !== "string") continue;
      const value = properties[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  // Without a spec (or for a vertex carrying only undeclared text) fall back to
  // any non-empty string, so naming is never blind to a vertex that has content.
  for (const value of Object.values(properties)) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * HR027: an optional free-text property must say something the delta does not
 * already say.
 *
 * The extractor fills every optional property it can, and the cheapest way to
 * fill a free-text one is to paraphrase the rest of the utterance. The live
 * trial produced OperatingTenure {duration: "10 years", description: "general
 * manager for a large hotel chain"} — a description that restated the two OTHER
 * vertices in the same delta and said nothing whatever about the tenure. Under
 * the old naming list it was also what got rendered on the node, so a fact
 * meaning "10 years" displayed as a near-copy of the ExpertRole beside it and
 * read as a duplicate.
 *
 * Two deterministic shapes of emptiness, and only these two:
 *
 *   1. SELF-DUPLICATE — the property's tokens are exactly the vertex's own name
 *      ({description: "general manager"} on ExpertRole{title: "General Manager"}).
 *      It restates the identity under a second key.
 *   2. FOREIGN RESTATEMENT — the property shares NO token with its own vertex's
 *      name and is wholly contained in the names of the OTHER facts in the delta.
 *      It is about other entities, not this one. This is the OperatingTenure
 *      case: nothing of "10 years" in it, all of the role and the business.
 *
 * Requiring zero overlap with the vertex's own name in case 2 is what keeps the
 * rule off typed categorical slots. HospitalityBusiness{name: "Large Hotel
 * Chain", businessType: "hotel chain", scale: "large"} has both narrower
 * properties fully covered by its own name — a first cut stripped them and lost
 * real structure. A property that talks about its own vertex is never padding,
 * however much it echoes the name.
 *
 * Scoped to the delta rather than the whole graph on purpose: late in a session
 * almost every word appears somewhere, and a graph-wide vocabulary would start
 * stripping real content.
 *
 * Two further guards make the rule unable to damage a fact: the naming property
 * is never a candidate (it IS the vertex's identity), and a strip that would
 * leave the vertex with no text at all is refused — otherwise this could
 * manufacture exactly the contentless vertex HR001 exists to reject.
 */
function stripRestatedProperties(
  admitted: GraphVertex[],
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions
): void {
  const knowledge = admitted.filter((vertex) => contract.knowledgeLabels.has(vertex.label));
  if (knowledge.length === 0) return;

  const nameTokens = (vertex: GraphVertex) =>
    conceptTokens(normalizeText(keyText(vertex.properties, contract.vertexSpecs.get(vertex.label))));

  for (const vertex of knowledge) {
    const spec = contract.vertexSpecs.get(vertex.label);
    if (!spec) continue;
    // The naming property is whichever declared string property keyText settled
    // on for THIS vertex, so an absent first choice does not expose the second.
    const namingValue = keyText(vertex.properties, spec);

    const ownTokens = nameTokens(vertex);
    const foreignTokens = new Set<string>();
    for (const other of knowledge) {
      if (other.id === vertex.id) continue;
      for (const token of nameTokens(other)) foreignTokens.add(token);
    }

    for (const key of Object.keys(vertex.properties)) {
      if (spec.requiredProperties.has(key)) continue;
      if (spec.propertyTypes.get(key) !== "string") continue;
      const value = vertex.properties[key];
      if (typeof value !== "string" || !value.trim()) continue;
      if (value === namingValue) continue;
      const tokens = conceptTokens(normalizeText(value));
      if (tokens.size === 0) continue;

      const selfDuplicate =
        tokens.size === ownTokens.size && [...tokens].every((token) => ownTokens.has(token));
      const foreignRestatement =
        !selfDuplicate &&
        ![...tokens].some((token) => ownTokens.has(token)) &&
        [...tokens].every((token) => foreignTokens.has(token));
      if (!selfDuplicate && !foreignRestatement) continue;
      const survivingText = Object.entries(vertex.properties).filter(
        ([otherKey, otherValue]) =>
          otherKey !== key && typeof otherValue === "string" && otherValue.trim()
      );
      if (survivingText.length === 0) continue;
      delete vertex.properties[key];
      findings.push(finding(
        "HR027",
        severityOf(contract, "HR027", "advisory", options),
        `${vertex.id}.${key} restates facts already in this delta ("${value.slice(0, 48)}"); dropped as padding`,
        vertex.id,
        "repaired"
      ));
    }
  }
}

/**
 * HR029: a property value carried over from an earlier turn is not extraction.
 *
 * On a turn where the expert only asked that the interview questions be kept
 * short, the extractor emitted a CheckInPolicy whose earlyArrivalHandling read
 * "three rooms ready by eleven" — verbatim from two turns earlier. Because
 * CheckInPolicy is a session singleton, that re-emission SUPERSEDED the real
 * policy, so an utterance about interview pacing silently replaced a captured
 * fact. HR028 could not catch it: the content hash differed, so it was not a
 * re-assertion of a stored vertex but a new one built from memory.
 *
 * The test separates remembering from paraphrasing, which is the only reason it
 * is safe. A value is remembered when its content tokens appear WHOLLY inside
 * some earlier utterance and share nothing with the current one — the signature
 * of copying. A genuine paraphrase of the current turn ("tired arrival" for
 * "dragging a big case slowly ... has had a bad journey") is not wholly present
 * in any earlier utterance, so it is untouched, and a fact the expert actually
 * repeats in their own words this turn overlaps the current utterance and is
 * likewise untouched.
 *
 * A fact whose text is ENTIRELY remembered is not a fact this turn produced, and
 * the whole vertex goes; the logistics turn above emitted nothing else, so it
 * now yields nothing at all. A fact with some remembered fields and some fresh
 * ones keeps the fresh ones and loses only what was copied.
 */
function stripRememberedProperties(
  admitted: GraphVertex[],
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions
): Set<string> {
  const remembered = new Set<string>();
  const prior = options.evidenceContext?.priorUtterances ?? [];
  const current = options.evidenceContext?.utterance;
  if (prior.length === 0 || !current) return remembered;

  const currentTokens = conceptTokens(normalizeText(current));
  const priorTokenSets = prior.map((text) => conceptTokens(normalizeText(text)));
  const severity = severityOf(contract, "HR029", "soft", options);

  for (const vertex of admitted) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    const spec = contract.vertexSpecs.get(vertex.label);
    if (!spec) continue;

    const textKeys: string[] = [];
    const copiedKeys: string[] = [];
    for (const key of Object.keys(vertex.properties)) {
      if (spec.propertyTypes.get(key) !== "string") continue;
      const value = vertex.properties[key];
      if (typeof value !== "string" || !value.trim()) continue;
      textKeys.push(key);
      const tokens = conceptTokens(normalizeText(value));
      if (tokens.size === 0) continue;
      if ([...tokens].some((token) => currentTokens.has(token))) continue;
      if (priorTokenSets.some((earlier) => [...tokens].every((token) => earlier.has(token)))) {
        copiedKeys.push(key);
      }
    }
    if (copiedKeys.length === 0) continue;

    if (copiedKeys.length === textKeys.length) {
      remembered.add(vertex.id);
      findings.push(finding(
        "HR029",
        severity,
        `${vertex.id} is built entirely from an earlier turn ("${String(vertex.properties[textKeys[0]]).slice(0, 48)}") and this utterance states none of it; dropped`,
        vertex.id,
        "dropped"
      ));
      continue;
    }
    for (const key of copiedKeys) {
      // A required field stays: dropping it would take the whole fact with it
      // under HR001, and losing a real fact is worse than an over-copied field.
      if (spec.requiredProperties.has(key)) continue;
      const value = String(vertex.properties[key]);
      delete vertex.properties[key];
      findings.push(finding(
        "HR029",
        severity,
        `${vertex.id}.${key} is remembered from an earlier turn ("${value.slice(0, 48)}") and is absent from this utterance; dropped`,
        vertex.id,
        "repaired"
      ));
    }
  }
  return remembered;
}

/**
 * Resolve a malformed edge-endpoint id to the vertex it plainly means, or null.
 *
 * The extractor loses real relationships to id spelling: a trial emitted
 * `experienceDesignedFor -> guest-persona:tired-arrival` (hyphenated label
 * prefix; the actual id was guestpersona:<hash>) and `governs ->
 * timingrule:undefined` (an invented placeholder while exactly one TimingRule
 * existed). Both edges dropped as dangling, and the facts they should have
 * anchored were left isolated.
 *
 * Three deterministic strategies, each requiring a UNIQUE match so a guess is
 * structurally impossible:
 *   1. alphanumeric-folded id equality — catches punctuation variants of an id
 *      that exists in the delta or graph;
 *   2. label prefix + name: the prefix names a label, the suffix (hyphens as
 *      spaces) equals some vertex's key text under that label;
 *   3. label prefix alone, when exactly one live vertex of that label exists.
 */
function repairEndpointId(
  id: string,
  labels: Map<string, string>,
  graph: GraphState,
  contract: GateContract
): string | null {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folded = fold(id);
  if (!folded) return null;

  const idMatches: string[] = [];
  for (const known of labels.keys()) {
    if (fold(known) === folded) idMatches.push(known);
  }
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return null;

  const prefix = fold(id.split(":")[0] ?? "");
  const label = [...contract.vertexSpecs.keys()].find((name) => fold(name) === prefix);
  if (!label || !contract.knowledgeLabels.has(label)) return null;

  const ofLabel = [...labels.entries()].filter(([, vertexLabel]) => vertexLabel === label);
  const suffix = normalizeText((id.split(":").slice(1).join(" ") ?? "").replace(/[-_]/g, " "));
  if (suffix) {
    const nameMatches = ofLabel.filter(([vertexId]) => {
      const vertex = graph.vertices[vertexId];
      if (!vertex) return false;
      return normalizeText(keyText(vertex.properties, contract.vertexSpecs.get(label))) === suffix;
    });
    if (nameMatches.length === 1) return nameMatches[0][0];
  }
  if (ofLabel.length === 1) return ofLabel[0][0];
  return null;
}

/**
 * Supersession inheritance: a correction changes what it corrects and nothing
 * else.
 *
 * When the expert amended one detail of the check-in policy ("it's three rooms
 * now"), the extractor rebuilt the whole singleton and guessed the fields the
 * utterance never mentioned — writing standardTime "11:00" because "eleven"
 * appeared in the sentence, when eleven is the rooms-ready hour and the real
 * standard time (15:00) was sitting on the superseded vertex. Supersession then
 * retired the correct policy in favour of the corrupted rebuild.
 *
 * So a superseding vertex now inherits every declared property it does not
 * itself state from the vertex it replaces (same label only). The extractor is
 * told to emit only the corrected fields; whatever it omits survives the
 * correction by construction.
 */
function inheritSupersededProperties(
  admitted: GraphVertex[],
  supersessions: Supersession[],
  graph: GraphState,
  contract: GateContract,
  findings: GateFinding[]
): void {
  for (const supersession of supersessions) {
    const stored = graph.vertices[supersession.supersededId];
    const replacement = admitted.find((vertex) => vertex.id === supersession.supersedingId);
    if (!stored || !replacement || stored.label !== replacement.label) continue;
    const declared = contract.vertexSpecs.get(replacement.label)?.properties;
    if (!declared) continue;
    const inherited: string[] = [];
    for (const key of declared) {
      if (!isBlank(replacement.properties[key])) continue;
      const previous = stored.properties[key];
      if (previous === undefined || isBlank(previous)) continue;
      replacement.properties[key] = previous;
      inherited.push(key);
    }
    if (inherited.length > 0) {
      findings.push(finding(
        "HR009", "advisory",
        `${replacement.id} inherited ${inherited.join(", ")} from superseded ${stored.id}; a correction only changes what it states`,
        replacement.id, "repaired"
      ));
    }
  }
}

/** Name a vertex under a contract: the common case, with the spec looked up. */
export function vertexKeyText(
  vertex: { label: string; properties: Record<string, JsonValue> },
  contract: GateContract
): string {
  return keyText(vertex.properties, contract.vertexSpecs.get(vertex.label));
}

const RESOLUTION_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "at", "is", "it", "with"
]);

function conceptTokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((token) => token && !RESOLUTION_STOPWORDS.has(token)));
}

/** True when two tokens are the same word up to one edit (plural, spelling variant). */
function tokensMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  if (Math.abs(left.length - right.length) > 1) return false;
  // One-pass edit-distance-≤-1 check.
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    if (edits > 0) return false;
    edits = 1;
    if (left.length === right.length) { i += 1; j += 1; }
    else if (left.length > right.length) i += 1;
    else j += 1;
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
}

/**
 * True when every token of the smaller name matches into the larger one:
 * "body language" is the same concept as "body language cues", even though
 * their Jaccard overlap (2/3) misses the threshold. Requires at least two
 * matched tokens so a single shared word never merges two concepts.
 */
function subsumedName(left: Set<string>, right: Set<string>): boolean {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size < 2) return false;
  const unmatched = [...large];
  for (const token of small) {
    const index = unmatched.findIndex((other) => tokensMatch(token, other));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

/**
 * Jaccard overlap where tokens match up to one edit, so "centred" matches
 * "centered" and "signal" matches "signals" without any language resource.
 */
function conceptOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const unmatched = [...right];
  let shared = 0;
  for (const token of left) {
    const index = unmatched.findIndex((other) => tokensMatch(token, other));
    if (index >= 0) {
      shared += 1;
      unmatched.splice(index, 1);
    }
  }
  return shared / (left.size + right.size - shared);
}

/** Same-concept test shared by resolution and reused-id protection. */
function sameConceptName(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = conceptTokens(a);
  const tb = conceptTokens(b);
  return conceptOverlap(ta, tb) >= 0.7 || subsumedName(ta, tb);
}

/**
 * Map candidate ids onto existing graph vertices that hold the same concept.
 * Two vertices are the same concept when they share a label and their key text
 * is identical after normalization, or overlaps beyond a fixed threshold with
 * tokens matched up to one edit. Deterministic and order-independent:
 * candidates match against the graph, then against earlier candidates in the
 * same delta, never transitively.
 */
function resolveEntities(
  candidates: Candidate[],
  graph: GraphState,
  contract: GateContract
): Map<string, string> {
  type Anchor = { id: string; normalized: string; tokens: Set<string> };
  const anchorsByLabel = new Map<string, Anchor[]>();

  const superseded = new Set<string>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.label === SUPERSEDED_BY) superseded.add(edge.out);
  }

  const addAnchor = (label: string, id: string, text: string) => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    let list = anchorsByLabel.get(label);
    if (!list) {
      list = [];
      anchorsByLabel.set(label, list);
    }
    list.push({ id, normalized, tokens: conceptTokens(normalized) });
  };

  for (const vertex of Object.values(graph.vertices)) {
    // A superseded fact is not a merge target; matching it would resurrect it.
    if (!contract.knowledgeLabels.has(vertex.label) || superseded.has(vertex.id)) continue;
    addAnchor(vertex.label, vertex.id, keyText(vertex.properties, contract.vertexSpecs.get(vertex.label)));
  }

  const rewrites = new Map<string, string>();
  for (const candidate of candidates) {
    if (!contract.knowledgeLabels.has(candidate.label)) continue;
    // Key on the properties that will actually be admitted. Resolution once keyed
    // on a raw undeclared `name` that pick() then discarded, so an exact-name twin
    // slipped through (the live session's duplicate "demographic" constraint).
    const candidateSpec = contract.vertexSpecs.get(candidate.label);
    const declaredProps = candidateSpec?.properties;
    const text = keyText(
      declaredProps ? pick(candidate.properties, declaredProps) : candidate.properties,
      candidateSpec
    );
    const normalized = normalizeText(text);
    if (!normalized) continue;
    const tokens = conceptTokens(normalized);

    let match: Anchor | null = null;
    for (const anchor of anchorsByLabel.get(candidate.label) ?? []) {
      if (anchor.id === candidate.id) { match = null; break; }
      if (
        anchor.normalized === normalized ||
        // 0.7, not 0.6: at 0.6 four-token names sharing three tokens merge, which
        // conflates "early check policy" with "late check policy". Genuine
        // restatements score 1.0 under edit-tolerant matching or hit the subset
        // rule; 0.7 keeps those and blocks single-qualifier opposites.
        conceptOverlap(anchor.tokens, tokens) >= 0.7 ||
        subsumedName(anchor.tokens, tokens)
      ) {
        match = anchor;
        break;
      }
    }
    if (match) {
      rewrites.set(candidate.id, match.id);
    } else {
      // Unmatched candidates become anchors so a second near-duplicate in the
      // same delta lands on the first, not beside it.
      addAnchor(candidate.label, candidate.id, text);
    }
  }
  return rewrites;
}

/**
 * Content-derived ids for knowledge vertices: the same fact stated twice lands on
 * the same id and merges, so duplicates become structurally impossible rather
 * than something a later deduplication pass has to find.
 */
function applyDeterministicIds(
  delta: GraphDelta,
  contract: GateContract,
  supersessions: Supersession[],
  resolvedIds: Set<string> = new Set()
): GraphDelta {
  const rewritten = new Map<string, string>();
  for (const vertex of delta.vertices) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    // A vertex resolved onto an existing graph id keeps that id: re-hashing its
    // (possibly partial) properties would fork the identity resolution just fixed.
    if (resolvedIds.has(vertex.id)) continue;
    rewritten.set(vertex.id, `${vertex.label.toLowerCase()}:${contentHash(vertex.label, vertex.properties)}`);
  }
  // Evidence follows the fact it grounds, so identical facts share evidence too.
  for (const vertex of delta.vertices) {
    if (vertex.label !== contract.evidenceLabel) continue;
    for (const [from, to] of rewritten) {
      if (vertex.id === `evidence:${from}`) rewritten.set(vertex.id, `evidence:${to}`);
    }
  }
  if (rewritten.size === 0) return delta;

  const resolve = (id: string): string => rewritten.get(id) ?? id;
  const vertices = new Map<string, GraphVertex>();
  for (const vertex of delta.vertices) {
    const id = resolve(vertex.id);
    const existing = vertices.get(id);
    vertices.set(id, { ...vertex, id, properties: { ...(existing?.properties ?? {}), ...vertex.properties } });
  }
  const edges = new Map<string, GraphEdge>();
  for (const edge of delta.edges) {
    const out = resolve(edge.out);
    const incoming = resolve(edge.in);
    const id = `${out}--${edge.label}-->${incoming}`;
    edges.set(id, { ...edge, id, out, in: incoming });
  }
  for (const supersession of supersessions) {
    supersession.supersedingId = resolve(supersession.supersedingId);
  }
  return { vertices: [...vertices.values()], edges: [...edges.values()] };
}

/**
 * Order-independent 128-bit content hash. Deliberately dependency-free and
 * synchronous so the same id is produced in the browser, on the server, and in
 * the evaluation harness.
 */
function contentHash(label: string, properties: Record<string, JsonValue>): string {
  const canonical = JSON.stringify([
    label,
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, normalizeForHash(value)])
      .sort((left, right) => (String(left[0]) < String(right[0]) ? -1 : 1))
  ]);
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}`;
}

function normalizeForHash(value: JsonValue): JsonValue {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : value;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Turn each knowledge vertex's inline `evidence` into a ProvenanceEvidence vertex
 * plus the provenance edge the contract assigns to that label.
 */
function materializeEvidence(
  candidates: Candidate[],
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions,
  graph: GraphState
): { vertices: Candidate[]; edges: ParsedEdge[] } {
  const context = options.evidenceContext;
  const vertices: Candidate[] = [];
  const edges: ParsedEdge[] = [];
  if (!contract.evidenceLabel) return { vertices, edges };

  for (const candidate of candidates) {
    if (!contract.knowledgeLabels.has(candidate.label)) continue;
    if (!candidate.evidence) continue;
    // First witness wins — for a fact whose content is unchanged. A fact that is
    // already grounded keeps the provenance that licensed its admission, so a
    // re-emission with a different quote cannot churn the original evidence.
    //
    // But a CORRECTION is not a re-emission: when the stored content changed and
    // the new evidence is a valid span of the current utterance, retaining the
    // old quote would leave a fact whose provenance supports its previous
    // content ("two rooms" evidence under a "three rooms" fact). Content change
    // plus valid witness refreshes the evidence instead.
    if (graph.vertices[`evidence:${candidate.id}`]) {
      const stored = graph.vertices[candidate.id];
      const declared = contract.vertexSpecs.get(candidate.label)?.properties ?? new Set<string>();
      const unchanged =
        stored &&
        contentHash(stored.label, pick(stored.properties, declared)) ===
          contentHash(candidate.label, pick(candidate.properties, declared));
      const trace = asString(candidate.evidence.traceText);
      const validWitness =
        trace.length > 0 && !traceSpecificity(trace, context?.utterance);
      if (unchanged || !validWitness) {
        findings.push(finding("HR006", "advisory", `${candidate.id} is already grounded; original provenance retained`, candidate.id, "repaired"));
        continue;
      }
      findings.push(finding("HR006", "advisory", `${candidate.id} content changed with a valid new witness; evidence refreshed`, candidate.id, "repaired"));
    }
    const edgeLabel = contract.provenanceEdgeByLabel.get(candidate.label);
    if (!edgeLabel) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft", options), `no provenance edge is mapped for ${candidate.label}`, candidate.id, "flagged"));
      continue;
    }
    const evidenceId = `evidence:${candidate.id}`;
    vertices.push({
      id: evidenceId,
      label: contract.evidenceLabel,
      // Turn-level facts come from the gate, not the model; anything the model
      // did supply for them is overwritten rather than trusted.
      properties: {
        ...candidate.evidence,
        ...(context ? { sourceEpisode: context.sourceEpisode, speaker: context.speaker } : {})
      },
      evidence: null,
      synthetic: true
    });
    edges.push({
      id: `${candidate.id}--${edgeLabel}-->${evidenceId}`,
      label: edgeLabel,
      out: candidate.id,
      in: evidenceId,
      properties: {},
      evidence: null
    });
    findings.push(finding("HR006", "advisory", `materialized evidence for ${candidate.id} as ${edgeLabel}`, candidate.id, "repaired"));
  }
  return { vertices, edges };
}

function admitEvidenceQuality(
  label: string,
  properties: Record<string, JsonValue>,
  contract: GateContract,
  findings: GateFinding[],
  id: string,
  options: GateOptions
): boolean {
  const utterance = options.evidenceContext?.utterance;
  if (label !== contract.evidenceLabel) return true;

  const speaker = asString(properties.speaker);
  if (contract.speakerValues.size > 0 && !contract.speakerValues.has(speaker)) {
    findings.push(finding("HR010", severityOf(contract, "HR010", "hard", options), `${id} speaker "${speaker}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const confidence = asString(properties.confidence);
  if (confidence && contract.confidenceValues.size > 0 && !contract.confidenceValues.has(confidence)) {
    findings.push(finding("HR011", severityOf(contract, "HR011", "hard", options), `${id} confidence "${confidence}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const traceText = asString(properties.traceText);
  const trace = traceText.toLowerCase();
  const banned = contract.bannedTracePatterns.find((pattern) => trace === pattern || trace.startsWith(pattern));
  if (banned) {
    findings.push(finding("HR012", severityOf(contract, "HR012", "hard", options), `${id} traceText is generic ("${banned}")`, id, "dropped"));
    return false;
  }
  const specificity = traceSpecificity(traceText, utterance);
  if (specificity) {
    // `inferred` marks knowledge synthesised across turns that no single quote
    // supports (spec HR013). Requiring its trace to be a span of the *current*
    // utterance would make the tier unusable by construction, so for inferred
    // evidence a span failure is recorded for audit instead of rejected — but
    // only the span failure: an inferred trace must still be substantive and
    // non-generic.
    const isInferred = confidence === "inferred";
    const isSpanFailure = specificity.includes("does not appear");
    if (isInferred && isSpanFailure) {
      findings.push(finding("HR013", "advisory", `${id} is inferred cross-turn synthesis; trace is not a span of this utterance`, id, "flagged"));
      return true;
    }
    findings.push(finding("HR012", severityOf(contract, "HR012", "hard", options), `${id} traceText ${specificity}`, id, "dropped"));
    return false;
  }
  return true;
}

/**
 * Evidence must be a *span* of the utterance, not a restatement of it.
 *
 * A token-overlap threshold cannot express this: echoing the whole turn scores a
 * perfect overlap, so the rule it is supposed to enforce is trivially satisfied by
 * the laziest possible evidence. These checks test the two things that actually
 * distinguish a citation from a paraphrase of the topic: the trace must appear in
 * the utterance, and it must not swallow the whole turn.
 *
 * Returns a reason when the trace fails, or null when it is acceptable.
 */
function traceSpecificity(traceText: string, utterance: string | undefined): string | null {
  const trace = normalizeText(traceText);
  if (!trace) return "is empty";
  if (countWords(trace) < 4) return "is too short to identify a claim";
  if (!utterance) return null;

  const source = normalizeText(utterance);
  if (!source) return null;

  // A quotation is a substring of what was said. Anything else is the model's
  // own prose, which is what ungrounded-but-plausible facts are made of.
  if (!source.includes(trace)) return "does not appear in the utterance it cites";

  // Citing the entire turn identifies no particular claim, so it grounds nothing.
  // Short turns are exempt: when the expert said one thing, the whole turn is the
  // span. Twenty words is where a turn reliably contains more than one claim.
  const sourceWords = countWords(source);
  if (sourceWords >= 20 && countWords(trace) / sourceWords > 0.9) {
    return "restates the whole utterance instead of the span that licenses the fact";
  }
  return null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function countWords(value: string): number {
  return value ? value.split(" ").filter(Boolean).length : 0;
}

function edgeTraceProblem(
  trace: string,
  contract: GateContract,
  options: GateOptions
): string | null {
  const lower = trace.toLowerCase();
  if (!lower.trim()) return "is empty";
  const banned = contract.bannedTracePatterns.find((pattern) => lower === pattern || lower.startsWith(pattern));
  if (banned) return `is generic ("${banned}")`;
  return traceSpecificity(trace, options.evidenceContext?.utterance);
}

function admitTextQuality(
  label: string,
  properties: Record<string, JsonValue>,
  contract: GateContract,
  findings: GateFinding[],
  id: string,
  options: GateOptions
): boolean {
  for (const rule of contract.textQualityRules) {
    if (rule.label !== label) continue;
    const value = asString(properties[rule.property]).toLowerCase().trim();
    const banned = rule.bannedPatterns.find((pattern) => value === pattern || value.startsWith(pattern));
    if (!banned) continue;
    const severity = severityOf(contract, rule.ruleId, rule.severity, options);
    findings.push(finding(rule.ruleId, severity, `${id} ${rule.property} is generic ("${banned}")`, id, severity === "hard" ? "dropped" : "flagged"));
    if (severity === "hard") return false;
  }
  return true;
}

function admitSingleton(
  candidate: Candidate,
  properties: Record<string, JsonValue>,
  graph: GraphState,
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions,
  supersessions: Supersession[]
): boolean {
  if (!contract.singletonLabels.has(candidate.label)) return true;
  const existing = Object.values(graph.vertices).find((vertex) => vertex.label === candidate.label);
  if (!existing || existing.id === candidate.id) return true;

  if (!options.temporalContradictions) {
    findings.push(finding("HR009", severityOf(contract, "HR009", "hard", options), `${candidate.label} is a session singleton; ${existing.id} already exists`, candidate.id, "dropped"));
    return false;
  }

  // A restated singleton is the expert correcting themselves, not a duplicate.
  // Identical content is a no-op; changed content supersedes rather than
  // overwrites, so the superseded claim remains in the graph and auditable.
  // Compare like with like: the candidate's properties have already been filtered
  // to the schema, so the stored vertex is filtered the same way before hashing.
  const declared = contract.vertexSpecs.get(candidate.label)?.properties ?? new Set<string>();
  if (contentHash(existing.label, pick(existing.properties, declared)) === contentHash(candidate.label, properties)) {
    findings.push(finding("HR009", "advisory", `${candidate.label} restated unchanged; merged into ${existing.id}`, candidate.id, "repaired"));
    return false;
  }
  supersessions.push({ supersededId: existing.id, supersedingId: candidate.id, label: candidate.label });
  findings.push(finding("HR009", "advisory", `${candidate.label} changed; ${existing.id} superseded by ${candidate.id}`, candidate.id, "repaired"));
  return true;
}

function checkProvenanceAttachment(
  vertices: GraphVertex[],
  edges: GraphEdge[],
  labels: Map<string, string>,
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions
): Set<string> {
  const unprovenanced = severityOf(contract, "HR006", "soft", options);
  const ungrounded = new Set<string>();
  for (const vertex of vertices) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    const attached = edges.find(
      (edge) =>
        edge.out === vertex.id &&
        contract.provenanceEdgeLabels.has(edge.label) &&
        labels.get(edge.in) === contract.evidenceLabel
    );
    if (!attached) {
      findings.push(finding("HR006", unprovenanced, `${vertex.id} has no evidence`, vertex.id, unprovenanced === "hard" ? "dropped" : "flagged"));
      ungrounded.add(vertex.id);
      continue;
    }
    const expected = contract.provenanceEdgeByLabel.get(vertex.label);
    if (expected && attached.label !== expected) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft", options), `${vertex.id} uses ${attached.label}, expected ${expected}`, vertex.id, "flagged"));
    }
  }
  // Always the full set. Whether an ungrounded fact is DROPPED depends on the
  // spec's severity and is decided by the caller; HR028 needs to know which
  // facts are ungrounded either way, and returning an empty set under the
  // default soft severity left it unable to fire at all.
  return ungrounded;
}

/**
 * What to tell the extractor after a rejection.
 *
 * The blanket "do not add any fact that was not in your previous attempt" guard
 * exists to stop a retry from inventing claims to satisfy the gate. But a
 * dangling edge (HR005) has exactly two legal repairs and one of them IS to emit
 * the missing endpoint — so on those turns the guard forbade the only correct
 * fix and contradicted the sentence before it. A trial turn where the expert
 * read two guest types off one signal emitted both `signalIndicates` edges and
 * neither GuestPersona; the model, told both to complete its endpoints and to
 * add nothing, dropped the relationships instead. Both signals ended up isolated
 * and both personas were lost.
 *
 * Naming the missing endpoint as a sanctioned repair keeps the anti-invention
 * guard everywhere it belongs and lifts it exactly where it was wrong.
 */
function buildRetryFeedback(findings: GateFinding[], contract: GateContract): string | null {
  const hard = findings.filter((item) => item.severity === "hard" && item.action === "dropped");
  if (hard.length === 0) return null;
  const lines = hard.map((item) => `${item.ruleId}: ${item.message}`);
  if (!contract.governed) {
    return `${lines.join("\n")}\n\nRe-emit the complete corrected delta using only schema labels and edge directions. Do not add facts that were not in your previous attempt.`;
  }

  const guidance = [
    "Re-emit the complete corrected delta. Attach evidence to each knowledge vertex with its inline evidence field, quoting the expert's own words."
  ];
  if (hard.some((item) => item.ruleId === "HR005")) {
    guidance.push(
      "An edge was dropped because one of its endpoints does not exist. Each such edge has exactly two valid repairs, and you must pick one: (a) EMIT the missing endpoint as a full knowledge vertex with its own inline evidence — if the expert did describe that concept, this is the CORRECT repair and does not count as introducing a new claim; or (b) DROP that edge entirely. Renaming the endpoint id is never a repair."
    );
    guidance.push(
      "Apart from endpoints you are completing this way, do not add any fact that was not in your previous attempt."
    );
  } else {
    guidance.push(
      "Every edge endpoint must be a vertex you emit in this same delta or one already in the graph. Do NOT add any fact that was not in your previous attempt: a correction fixes what was rejected, it never introduces new claims."
    );
  }
  if (hard.some((item) => item.ruleId === "HR012" && item.message.includes("whole utterance"))) {
    guidance.push(
      "For evidence rejected as restating the whole utterance: quote the SHORTEST contiguous phrase or clause that supports that specific fact — different facts from the same reply cite different spans, never the full reply."
    );
  }
  guidance.push(
    "Drop anything you cannot support with the expert's words rather than repairing it with invented evidence."
  );
  return `${lines.join("\n")}\n\n${guidance.join(" ")}`;
}

function endpointsConform(contract: GateContract, edgeLabel: string, outLabel: string, inLabel: string): boolean {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return false;
  return spec.out.has(outLabel) && spec.in.has(inLabel);
}

/**
 * When an edge fails endpoint typing, name what WOULD be legal between these
 * labels — the live trial showed the extractor repeating the same illegal edge
 * across all three attempts because the error told it only what was wrong.
 */
function edgeSuggestions(contract: GateContract, outLabel: string, inLabel: string): string {
  const semantic = [...contract.edgeSpecs.values()].filter(
    (spec) => !contract.provenanceEdgeLabels.has(spec.label) && spec.label !== SUPERSEDED_BY
  );
  const from = semantic.filter((spec) => spec.out.has(outLabel)).map((spec) => `${spec.label}->${[...spec.in].join("|")}`).slice(0, 4);
  const into = semantic.filter((spec) => spec.in.has(inLabel)).map((spec) => `${[...spec.out].join("|")}->${spec.label}`).slice(0, 4);
  const parts = [];
  if (from.length) parts.push(`valid from ${outLabel}: ${from.join(", ")}`);
  if (into.length) parts.push(`valid into ${inLabel}: ${into.join(", ")}`);
  return parts.length ? `. ${parts.join("; ")}` : "";
}

function expectedEndpoints(contract: GateContract, edgeLabel: string): string {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return "an unknown endpoint pair";
  return `${[...spec.out].join("|")}->${[...spec.in].join("|")}`;
}

type ParsedEdge = {
  id: string;
  label: string;
  out: string;
  in: string;
  properties: Record<string, JsonValue>;
  evidence: Record<string, JsonValue> | null;
};

function parseVertices(input: unknown, findings: GateFinding[]): Candidate[] {
  const items = Array.isArray(input) ? input : [];
  const out: Candidate[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      findings.push(finding("HR001", "hard", "vertex is not an object", null, "dropped"));
      continue;
    }
    const id = asString(item.id).trim();
    const label = asString(item.label).trim();
    if (!id || !label) {
      findings.push(finding("HR001", "hard", "vertex is missing id or label", id || null, "dropped"));
      continue;
    }
    out.push({
      id,
      label,
      properties: jsonRecord(item.properties),
      evidence: isRecord(item.evidence) ? jsonRecord(item.evidence) : null,
      synthetic: false
    });
  }
  return out;
}

function parseEdge(item: unknown): ParsedEdge | null {
  if (!isRecord(item)) return null;
  const label = asString(item.label).trim();
  const out = asString(item.out).trim();
  const incoming = asString(item.in).trim();
  if (!label || !out || !incoming) return null;
  return {
    id: asString(item.id).trim(),
    label,
    out,
    in: incoming,
    properties: jsonRecord(item.properties),
    evidence: isRecord(item.evidence) ? jsonRecord(item.evidence) : null
  };
}

function finding(
  ruleId: string,
  severity: Severity,
  message: string,
  subjectId: string | null,
  action: GateFinding["action"]
): GateFinding {
  return { ruleId, severity, message, subjectId, action };
}

function pick(properties: Record<string, JsonValue>, allowed: Set<string>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonValue(item)) out[key] = item;
  }
  return out;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isBlank(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}
