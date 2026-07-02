import OpenAI from "openai";
import { graphSummary, sanitizeDelta, schemaReference } from "@/lib/schema";
import type { ChatRequest, GraphDelta } from "@/lib/types";
import { getDomain } from "@/lib/domains";

const DEFAULT_EXTRACTOR_MODEL = "gpt-4o-mini";
const HOSPITALITY_INFRA_LABELS = new Set([
  "Person",
  "KnowledgeSession",
  "SessionSection",
  "TranscriptEpisode",
  "ProvenanceEvidence"
]);
const HOSPITALITY_SEMANTIC_EDGES = new Set([
  "appliesToPersona",
  "standardEnforces",
  "signalTriggers",
  "signalIndicates",
  "governs",
  "governsCheckOut",
  "resolvedBy",
  "exceptionAppliesTo",
  "exceptionMadeFor",
  "heuristicExplains",
  "leadsTo",
  "recoveryLeadsTo",
  "shapesLoyalty",
  "drivenBy",
  "loyaltyLeadsTo",
  "modulatedBy",
  "constraintAffectsPolicy"
]);

export async function extractGraphDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[] }> {
  if (body.domainId === "hospitality" && isNonKnowledgeHospitalityUtterance(latestText)) {
    return { delta: { vertices: [], edges: [] }, warnings: [] };
  }
  if (body.domainId === "hospitality" && isProfileOnlyHospitalityUtterance(latestText)) {
    return { delta: hospitalityFallbackDelta(latestText, body), warnings: [] };
  }

  let best: { delta: GraphDelta; warnings: string[] } | null = null;
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await callExtractor(openai, latestText, body, feedback);
    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned no graph delta."]
      };
      feedback = "The previous attempt returned no tool output. Emit the graph delta using the tool.";
      continue;
    }

    const firstCall = toolCalls[0];
    if (!("function" in firstCall)) {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned unexpected tool call type."]
      };
      feedback = "Emit the graph delta using the emit_graph_delta function tool.";
      continue;
    }
    let rawInput: unknown;
    try {
      rawInput = JSON.parse(firstCall.function.arguments);
    } catch {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned invalid JSON."]
      };
      feedback = "The previous attempt returned invalid JSON. Emit valid JSON using the emit_graph_delta function.";
      continue;
    }
    const sanitized = sanitizeDelta(rawInput, body.graph, body.domainId);
    if (!best || scoreDelta(sanitized) > scoreDelta(best)) best = sanitized;
    if (sanitized.warnings.length === 0) {
      return body.domainId === "hospitality"
        ? ensureHospitalityConnectedDelta(sanitized, latestText, body)
        : sanitized;
    }
    feedback =
      `The previous graph delta failed validation and was sanitized with these problems:\n` +
      sanitized.warnings.join("\n") +
      "\n\nRe-emit the entire corrected delta. Valid schema labels and edge directions:\n" +
      schemaReference(body.domainId);
  }

  const result = best ?? {
    delta: { vertices: [], edges: [] },
    warnings: ["Extractor did not run."]
  };
  if (body.domainId === "hospitality") return ensureHospitalityConnectedDelta(result, latestText, body);
  return result;
}

function scoreDelta(result: { delta: GraphDelta; warnings: string[] }): number {
  const graphItems = result.delta.vertices.length + result.delta.edges.length;
  return graphItems * 100 - result.warnings.length;
}

function ensureHospitalityConnectedDelta(
  result: { delta: GraphDelta; warnings: string[] },
  latestText: string,
  body: ChatRequest
): { delta: GraphDelta; warnings: string[] } {
  const normalizedDelta = normalizeHospitalityDelta(result.delta, latestText);
  const hasSemanticKnowledge = hasHospitalitySemanticEdge(normalizedDelta);
  const fallback = hospitalityFallbackDelta(latestText, body);
  const infrastructure = hasSemanticKnowledge
    ? hospitalityInfrastructureDelta(latestText, body, normalizedDelta)
    : { vertices: [], edges: [] };
  if (
    fallback.vertices.length === 0 &&
    fallback.edges.length === 0 &&
    infrastructure.vertices.length === 0 &&
    infrastructure.edges.length === 0
  ) {
    return { delta: normalizedDelta, warnings: result.warnings };
  }
  return {
    delta: {
      vertices: mergeUniqueById(mergeUniqueById(normalizedDelta.vertices, fallback.vertices), infrastructure.vertices),
      edges: mergeUniqueById(mergeUniqueById(normalizedDelta.edges, fallback.edges), infrastructure.edges)
    },
    warnings: []
  };
}

function normalizeHospitalityDelta(delta: GraphDelta, latestText: string): GraphDelta {
  const transcriptLikeVertexIds = new Set(
    delta.vertices
      .filter((vertex) => {
        if (HOSPITALITY_INFRA_LABELS.has(vertex.label)) return false;
        return isTranscriptLikeHospitalityVertex(vertex, latestText);
      })
      .map((vertex) => vertex.id)
  );
  const semanticEdges = delta.edges.filter((edgeItem) => HOSPITALITY_SEMANTIC_EDGES.has(edgeItem.label));
  const semanticallyConnectedIds = new Set<string>();
  for (const edgeItem of semanticEdges) {
    semanticallyConnectedIds.add(edgeItem.out);
    semanticallyConnectedIds.add(edgeItem.in);
  }

  const vertices = delta.vertices
    .filter((vertex) => !transcriptLikeVertexIds.has(vertex.id) || semanticallyConnectedIds.has(vertex.id))
    .map((vertex) => {
      if (vertex.label === "GuestExperiencePrinciple") {
        return {
          ...vertex,
          properties: {
            ...vertex.properties,
            name: conceptNameForHospitality(latestText)
          }
        };
      }
      if (vertex.label === "ServiceStandard") {
        return {
          ...vertex,
          properties: {
            ...vertex.properties,
            name: serviceStandardName(latestText)
          }
        };
      }
      return vertex;
    });
  const vertexIds = new Set(vertices.map((vertex) => vertex.id));
  const edges = delta.edges.filter(
    (edgeItem) =>
      !transcriptLikeVertexIds.has(edgeItem.out) &&
      !transcriptLikeVertexIds.has(edgeItem.in) &&
      (!transcriptLikeVertexIds.size || vertexIds.has(edgeItem.out) || vertexIds.has(edgeItem.in))
  );
  return { vertices, edges };
}

function isTranscriptLikeHospitalityVertex(vertex: GraphDelta["vertices"][number], latestText: string): boolean {
  const candidate =
    stringProperty(vertex.properties.name) ||
    stringProperty(vertex.properties.ruleText) ||
    stringProperty(vertex.properties.description) ||
    stringProperty(vertex.properties.standardText);
  const text = latestText.replace(/\s+/g, " ").trim().toLowerCase();
  const value = candidate.replace(/\s+/g, " ").trim().toLowerCase();
  if (!value) return false;
  if (isFillerText(value) || isProfileOpening(value)) return true;
  if (value.length > 55 && (text.includes(value.slice(0, 45)) || value.includes(text.slice(0, 45)))) return true;
  return value.split(/\s+/).length > 9 && overlapRatio(value, text) > 0.65;
}

function hasHospitalitySemanticEdge(delta: GraphDelta): boolean {
  return delta.edges.some((edgeItem) => HOSPITALITY_SEMANTIC_EDGES.has(edgeItem.label));
}

function hospitalityInfrastructureDelta(
  latestText: string,
  body: ChatRequest,
  delta: GraphDelta
): GraphDelta {
  const text = latestText.trim();
  const sectionId = "section:session:hospitality:default:1";
  const vertices: GraphDelta["vertices"] = [
    {
      id: sectionId,
      label: "SessionSection",
      properties: {
        sectionType: "introduction",
        title: "Introduction",
        order: 1,
        purpose: "Capture expert background and initial hospitality knowledge"
      }
    }
  ];
  const edges: GraphDelta["edges"] = [];

  if (!hasEdge(body.graph, delta, "session:hospitality:default", "hasSection", sectionId)) {
    edges.push(edge("session:hospitality:default", "hasSection", sectionId));
  }

  const episodeIds = delta.vertices
    .filter((vertex) => vertex.label === "TranscriptEpisode")
    .map((vertex) => vertex.id);
  for (const episodeId of episodeIds) {
    if (!hasIncomingEdge(body.graph, delta, episodeId, "hasEpisode")) {
      edges.push(edge(sectionId, "hasEpisode", episodeId));
    }
  }

  const provenanceId = `prov:${episodeIds[0] ?? "ep:session:hospitality:default:000"}:01`;
  const hasProvenance =
    Object.values(body.graph.vertices).some((vertex) => vertex.label === "ProvenanceEvidence") ||
    delta.vertices.some((vertex) => vertex.label === "ProvenanceEvidence");
  if (episodeIds.length > 0 && !hasProvenance) {
    vertices.push({
      id: provenanceId,
      label: "ProvenanceEvidence",
      properties: {
        traceText: text,
        sourceEpisode: episodeIds[0],
        speaker: "expert",
        confidence: "medium"
      }
    });
  }

  for (const vertex of delta.vertices) {
    const provenanceEdgeLabel = provenanceEdgeFor(vertex.label);
    if (!provenanceEdgeLabel) continue;
    if (!hasOutgoingProvenance(body.graph, delta, vertex.id)) {
      edges.push(edge(vertex.id, provenanceEdgeLabel, provenanceId));
    }
  }

  return { vertices, edges };
}

function hospitalityFallbackDelta(latestText: string, body: ChatRequest): GraphDelta {
  const text = latestText.trim();
  if (text.length < 8) return { vertices: [], edges: [] };
  if (isNonKnowledgeHospitalityUtterance(text)) return { vertices: [], edges: [] };

  const sequence = String(
    Object.values(body.graph.vertices).filter((vertex) => vertex.label === "TranscriptEpisode").length + 1
  ).padStart(3, "0");
  const sectionId = "section:session:hospitality:default:1";
  const episodeId = `ep:session:hospitality:default:${sequence}`;
  const provenanceId = `prov:${episodeId}:01`;
  const conceptName = conceptNameForHospitality(text);
  const conceptSlug = slug(conceptName).slice(0, 48) || `turn-${sequence}`;
  const principleId = `principle:${conceptSlug}`;
  const personaId = "persona:hotel-guests";

  const sessionPatch = sessionUpdateForHospitality(text);

  const vertices: GraphDelta["vertices"] = [
    ...(sessionPatch ? [sessionPatch] : []),
    {
      id: sectionId,
      label: "SessionSection",
      properties: {
        sectionType: "introduction",
        title: "Introduction",
        order: 1,
        purpose: "Capture expert background and initial hospitality knowledge"
      }
    },
    {
      id: episodeId,
      label: "TranscriptEpisode",
      properties: {
        verbatimText: text,
        speaker: "expert"
      }
    },
    {
      id: provenanceId,
      label: "ProvenanceEvidence",
      properties: {
        traceText: text,
        sourceEpisode: episodeId,
        speaker: "expert",
        confidence: "medium"
      }
    }
  ];

  const edges: GraphDelta["edges"] = [
    edge("session:hospitality:default", "hasSection", sectionId),
    edge(sectionId, "hasEpisode", episodeId)
  ];

  if (isProfileOnlyHospitalityUtterance(text)) {
    return { vertices, edges };
  }

  vertices.push(
    {
      id: principleId,
      label: "GuestExperiencePrinciple",
      properties: {
        name: conceptName,
        description: text,
        type: "operational"
      }
    },
    {
      id: personaId,
      label: "GuestPersona",
      properties: {
        name: "Hotel guests",
        description: "Guests served by the hospitality business"
      }
    }
  );

  edges.push(
    edge(episodeId, "discusses", principleId),
    edge(principleId, "appliesToPersona", personaId),
    edge(principleId, "principleSupportedBy", provenanceId)
  );

  if (/\b(if|when|whenever|decide|rule|usually|always|never)\b/i.test(text)) {
    const ruleId = `rule:${conceptSlug}`;
    vertices.push({
      id: ruleId,
      label: "DecisionRule",
      properties: {
        ruleText: text,
        ifCondition: text
      }
    });
    edges.push(edge(episodeId, "discussesRule", ruleId));
    edges.push(edge(ruleId, "supportedBy", provenanceId));
    edges.push(edge(ruleId, "leadsTo", outcomeVertex(vertices, "consistent-guest-experience")));
  }

  if (/\b(towel|welcome|drink|sit|relax|standard|staff|guest|check-?in|arrival|service)\b/i.test(text)) {
    const standardId = `standard:${conceptSlug}`;
    vertices.push({
      id: standardId,
      label: "ServiceStandard",
      properties: {
        name: serviceStandardName(text),
        standardText: text
      }
    });
    edges.push(edge(standardId, "standardEnforces", principleId));
    edges.push(edge(standardId, "supportedBy", provenanceId));
  }

  return { vertices, edges };
}

function outcomeVertex(vertices: GraphDelta["vertices"], slugPart: string): string {
  const id = `outcome:${slugPart}`;
  vertices.push({
    id,
    label: "Outcome",
    properties: {
      outcomeType: "guest-experience",
      description: "Consistent, positive guest experience",
      loyaltyAchieved: false
    }
  });
  return id;
}

function isProfileOnlyHospitalityUtterance(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRoleOrTenure = /\b(ceo|owner|manager|operator|role|run|running|operate|operating|years?)\b/.test(lower);
  const hasHospitalityType = /\b(hotel|hotels|resort|restaurant|chain|business)\b/.test(lower);
  const hasServiceKnowledge = /\b(guest|customer|service|experience|staff|check-?in|welcome|towel|policy|rule|when|if|recover|loyalty|successful|success)\b/.test(lower);
  return hasRoleOrTenure && hasHospitalityType && !hasServiceKnowledge;
}

function isNonKnowledgeHospitalityUtterance(text: string): boolean {
  const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!lower) return true;
  if (isFillerText(lower)) return true;
  if (lower.length < 18 && /^(yes|yeah|yep|ok|okay|sure|fine|cool|go ahead|continue|let'?s go)[.! ]*$/.test(lower)) return true;
  return false;
}

function isFillerText(text: string): boolean {
  return /^(okay|ok|sure|yes|yeah|yep|great|thanks?|thank you|cool|fine)(\b|[.!,'-])/.test(text) ||
    /^let'?s\s+(go|continue|start)/.test(text);
}

function isProfileOpening(text: string): boolean {
  return /^(i am|i'm|my role is)\b/.test(text);
}

function sessionUpdateForHospitality(text: string): GraphDelta["vertices"][number] | null {
  const lower = text.toLowerCase();
  const properties: Record<string, string> = {};
  const roleMatch = lower.match(/\b(owner|operator|manager)\b/);
  if (/\bceo\b/.test(lower)) properties.expertRole = "CEO";
  else if (roleMatch) properties.expertRole = roleMatch[1];
  if (Object.keys(properties).length === 0) return null;
  return {
    id: "session:hospitality:default",
    label: "KnowledgeSession",
    properties
  };
}

function conceptNameForHospitality(text: string): string {
  const lower = text.toLowerCase();
  if (/\bhot towels?\b/.test(lower)) return "Hot towel welcome ritual";
  if (/\bcheck-?in\b/.test(lower) && /\b(relax|sit|seated|welcome)\b/.test(lower)) return "Relaxed check-in experience";
  if (/\bcustomer service\b/.test(lower)) return "Customer service excellence";
  if (/\bguest(s)?\b/.test(lower) && /\b(success|successful|love|experience|care|happy|satisfaction)\b/.test(lower)) {
    return "Guest-centered experience";
  }
  if (/\bguest(s)?\b/.test(lower)) return "Guest-centered service";
  if (/\bservice\b/.test(lower)) return "Service quality practice";
  return shortConceptTitle(text);
}

function serviceStandardName(text: string): string {
  const lower = text.toLowerCase();
  if (/\bhot towels?\b/.test(lower)) return "Offer hot towels on arrival";
  if (/\bcheck-?in\b/.test(lower) && /\b(relax|sit|seated)\b/.test(lower)) return "Seat guests during check-in";
  if (/\bwelcome\b/.test(lower)) return "Warm arrival welcome";
  if (/\bcustomer service\b/.test(lower)) return "Customer service standard";
  return shortConceptTitle(text);
}

function shortConceptTitle(text: string): string {
  const cleaned = text
    .replace(/\b(i think|i feel|what makes it|especially successful|kind of stuff|that we do|with our)\b/gi, " ")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  const title = words.slice(0, 5).join(" ");
  return title ? title[0].toUpperCase() + title.slice(1) : "Hospitality practice";
}

function stringProperty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function overlapRatio(a: string, b: string): number {
  const aWords = new Set(a.split(/\s+/).filter((word) => word.length > 2));
  const bWords = new Set(b.split(/\s+/).filter((word) => word.length > 2));
  if (aWords.size === 0) return 0;
  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap += 1;
  }
  return overlap / aWords.size;
}

function edge(out: string, label: string, incoming: string): GraphDelta["edges"][number] {
  return {
    id: `${out}--${label}-->${incoming}`,
    label,
    out,
    in: incoming,
    properties: {}
  };
}

function hasEdge(graph: ChatRequest["graph"], delta: GraphDelta, out: string, label: string, incoming: string): boolean {
  return [...Object.values(graph.edges), ...delta.edges].some(
    (edgeItem) => edgeItem.out === out && edgeItem.label === label && edgeItem.in === incoming
  );
}

function hasIncomingEdge(graph: ChatRequest["graph"], delta: GraphDelta, vertexId: string, label: string): boolean {
  return [...Object.values(graph.edges), ...delta.edges].some(
    (edgeItem) => edgeItem.in === vertexId && edgeItem.label === label
  );
}

function hasOutgoingProvenance(graph: ChatRequest["graph"], delta: GraphDelta, vertexId: string): boolean {
  return [...Object.values(graph.edges), ...delta.edges].some(
    (edgeItem) =>
      edgeItem.out === vertexId &&
      ["supportedBy", "principleSupportedBy", "heuristicSupportedBy"].includes(edgeItem.label)
  );
}

function provenanceEdgeFor(label: string): string {
  if (label === "GuestExperiencePrinciple") return "principleSupportedBy";
  if (label === "OperatingHeuristic" || label === "TimingRule") return "heuristicSupportedBy";
  if (
    [
      "ServiceStandard",
      "GuestSignal",
      "GuestPersona",
      "CheckInPolicy",
      "CheckOutPolicy",
      "ServiceFailure",
      "RecoveryAction",
      "ExceptionRule",
      "DecisionRule",
      "LoyaltyDriver",
      "EmotionalMoment",
      "ContextualConstraint",
      "Outcome"
    ].includes(label)
  ) {
    return "supportedBy";
  }
  return "";
}

function mergeUniqueById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of first) byId.set(item.id, item);
  for (const item of second) byId.set(item.id, item);
  return [...byId.values()];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function callExtractor(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest,
  feedback: string
) {
  const domain = getDomain(body.domainId);
  const speakerLabel = domain.userLabel === "expert" ? "expert" : "patient";
  return openai.chat.completions.create({
    model: process.env.CHATGRAPH_EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL,
    max_completion_tokens: 1200,
    messages: [
      {
        role: "system",
        content: `${domain.extractorIntro}\n\n${schemaReference(domain.id)}`
      },
      {
        role: "user",
        content:
          `Latest ${speakerLabel} utterance:\n${latestText}\n\n` +
          `Conversation window:\n${body.messages
            .slice(-8)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n")}\n\n` +
          `Current graph:\n${graphSummary(body.graph)}` +
          (feedback ? `\n\nValidation feedback:\n${feedback}` : "")
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_graph_delta",
          description: "Emit the new graph delta captured from the latest patient utterance.",
          parameters: {
            type: "object",
            properties: {
              vertices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["id", "label"]
                }
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    out: { type: "string" },
                    in: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["label", "out", "in"]
                }
              }
            },
            required: ["vertices", "edges"]
          }
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
  });
}
