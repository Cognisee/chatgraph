import medicalSchemaRaw from "../src/main/json/medical.json";
import type { GraphDelta, GraphEdge, GraphState, GraphVertex, JsonValue } from "./types";

type SchemaProperty = {
  key: string;
  value?: unknown;
  required?: boolean;
};

type SchemaVertexEntry = {
  "@key": string;
  "@value": {
    properties?: SchemaProperty[];
  };
};

type SchemaEdgeEntry = {
  "@key": string;
  "@value": {
    out: string;
    in: string;
    properties?: SchemaProperty[];
  };
};

type MedicalSchema = {
  vertices: SchemaVertexEntry[];
  edges: SchemaEdgeEntry[];
};

const medicalSchema = medicalSchemaRaw as MedicalSchema;

export type VertexSpec = {
  label: string;
  properties: Set<string>;
};

export type EdgeSpec = {
  label: string;
  out: string;
  in: string;
  properties: Set<string>;
};

export const vertexSpecs = new Map<string, VertexSpec>(
  medicalSchema.vertices.map((entry) => [
    entry["@key"],
    {
      label: entry["@key"],
      properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key))
    }
  ])
);

export const edgeSpecs = new Map<string, EdgeSpec>(
  medicalSchema.edges.map((entry) => [
    entry["@key"],
    {
      label: entry["@key"],
      out: entry["@value"].out,
      in: entry["@value"].in,
      properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key))
    }
  ])
);

export function emptyGraph(): GraphState {
  return {
    vertices: {
      "Person:patient": {
        id: "Person:patient",
        label: "Person",
        properties: { name: "patient" }
      }
    },
    edges: {}
  };
}

export function schemaReference(): string {
  const vertexLines = [...vertexSpecs.values()]
    .map((spec) => {
      const props = [...spec.properties].sort();
      return props.length ? `${spec.label}: ${props.join(", ")}` : `${spec.label}: no properties`;
    })
    .join("\n");
  const edgeLines = [...edgeSpecs.values()]
    .map((spec) => {
      const props = [...spec.properties].sort();
      const suffix = props.length ? ` (${props.join(", ")})` : "";
      return `${spec.label}: ${spec.out} -> ${spec.in}${suffix}`;
    })
    .join("\n");

  return `VERTICES\n${vertexLines}\n\nEDGES\n${edgeLines}`;
}

export function graphSummary(graph: GraphState): string {
  const vertices = Object.values(graph.vertices)
    .slice(0, 160)
    .map((vertex) => {
      const props = Object.entries(vertex.properties ?? {})
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(", ");
      return props ? `${vertex.label} [${vertex.id}] {${props}}` : `${vertex.label} [${vertex.id}]`;
    });
  const edges = Object.values(graph.edges)
    .slice(0, 220)
    .map((edge) => `${edge.out} --${edge.label}--> ${edge.in}`);
  return `Vertices:\n${vertices.join("\n") || "(none)"}\n\nEdges:\n${edges.join("\n") || "(none)"}`;
}

export function mergeDelta(graph: GraphState, delta: GraphDelta): GraphState {
  const next: GraphState = {
    vertices: { ...graph.vertices },
    edges: { ...graph.edges }
  };
  for (const vertex of delta.vertices) {
    next.vertices[vertex.id] = {
      ...vertex,
      properties: {
        ...(next.vertices[vertex.id]?.properties ?? {}),
        ...(vertex.properties ?? {})
      }
    };
  }
  for (const edge of delta.edges) {
    next.edges[edge.id] = {
      ...edge,
      properties: {
        ...(next.edges[edge.id]?.properties ?? {}),
        ...(edge.properties ?? {})
      }
    };
  }
  return next;
}

export function sanitizeDelta(input: unknown, graph: GraphState): {
  delta: GraphDelta;
  warnings: string[];
} {
  const warnings: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) {
    warnings.push("Extractor returned non-object input.");
  }
  const rawVertices = Array.isArray(raw.vertices) ? raw.vertices : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const vertices: GraphVertex[] = [];
  const labelsById = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  for (const item of rawVertices) {
    if (!isRecord(item)) {
      warnings.push("Dropped vertex: not an object.");
      continue;
    }
    const id = stringValue(item.id);
    const label = stringValue(item.label);
    if (!id || !label) {
      warnings.push(`Dropped vertex: missing id or label (id=${JSON.stringify(item.id)}, label=${JSON.stringify(item.label)}).`);
      continue;
    }
    const spec = vertexSpecs.get(label);
    if (!spec) {
      warnings.push(`Dropped vertex ${id}: unknown label ${label}.`);
      continue;
    }
    const properties = filterProperties(item.properties, spec.properties);
    vertices.push({ id, label, properties });
    labelsById.set(id, label);
  }

  const edges: GraphEdge[] = [];
  for (const item of rawEdges) {
    if (!isRecord(item)) {
      warnings.push("Dropped edge: not an object.");
      continue;
    }
    const label = stringValue(item.label);
    const out = stringValue(item.out);
    const incoming = stringValue(item.in);
    if (!label || !out || !incoming) {
      warnings.push(`Dropped edge: missing label, out, or in (label=${JSON.stringify(item.label)}, out=${JSON.stringify(item.out)}, in=${JSON.stringify(item.in)}).`);
      continue;
    }
    const spec = edgeSpecs.get(label);
    if (!spec) {
      warnings.push(`Dropped edge ${label}: unknown edge label.`);
      continue;
    }
    const outLabel = labelsById.get(out);
    const inLabel = labelsById.get(incoming);
    if (outLabel !== spec.out || inLabel !== spec.in) {
      warnings.push(`Dropped edge ${label}: expected ${spec.out}->${spec.in}.`);
      continue;
    }
    const id = stringValue(item.id) || `${out}-${label}->${incoming}`;
    edges.push({
      id,
      label,
      out,
      in: incoming,
      properties: filterProperties(item.properties, spec.properties)
    });
  }

  return { delta: { vertices, edges }, warnings };
}

function filterProperties(input: unknown, allowed: Set<string>): Record<string, JsonValue> {
  if (!isRecord(input)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && isJsonValue(value)) out[key] = value;
  }
  return out;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
