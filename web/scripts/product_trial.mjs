/**
 * Self-trial harness: runs a full elicitation session end-to-end against the
 * REAL production pipeline — the deployed agent prompt, the deployed governed
 * extractor, the deployed gate — with a simulated expert standing in for the
 * human. Used to take product trials autonomously and judge the outcome.
 *
 *   node --import ./scripts/ts-alias-hooks.mjs scripts/product_trial.mjs [turns] [outfile]
 *
 * Prints a quality analysis: capture rate, isolated-knowledge rate, section
 * progression, gate findings, retries, duplicates. Writes the full session
 * (graph + turns + gate reports) to the outfile for inspection. The expert is
 * synthetic, so nothing here is private.
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

import { getDomain } from "@/lib/domains";
import { mergeDelta } from "@/lib/schema";
import { extractGovernedDelta } from "@/lib/server/extract-governed";
import { gateContract } from "@/lib/gate/contract";
import { graphQuality, interviewNote } from "@/lib/graph-quality";

// --- env ---------------------------------------------------------------------
for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : []) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, idx).trim();
  if (!process.env[key]) process.env[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TURNS = Number(process.argv[2] ?? 16);
const OUT = process.argv[3] ?? path.join(
  "/tmp/claude-1000/-workspaces-Chatgraph-V2/7d6c85b0-e91c-40e4-8dc9-0781310611d9/scratchpad",
  `trial-${Date.now()}.json`
);

const DOMAIN = getDomain("hospitality");
const CONTRACT = gateContract("hospitality");

const EXPERT_PERSONA = `You are Maria, the owner-operator of "Casa Almendra", a 14-room boutique guesthouse in Seville that you have run for 18 years after a decade as a hotel front-office manager.

You are being interviewed by a knowledge engineer. Answer as a real person speaking out loud:
- Natural spoken sentences, 2-5 per answer. Occasional light disfluency is fine.
- Draw on concrete lived experience: real routines, numbers, incidents, judgments.
- Some of your beliefs: arrival minute matters more than the room; you keep two rooms ready by 11am for early arrivals; you read guests' luggage and pace to judge tiredness; repeat guests get their previous room when possible; you never charge for a late checkout under an hour; when something goes wrong you fix it first and explain later; solo staff shifts are your biggest bottleneck; summer heat changes everything about your operation.
- When the interviewer asks whether you want to add anything before moving on, usually say a short "no, let's move on" style reply.
- If asked about pacing preferences, pick concise answers.
- Never break character, never mention being an AI.`;

// --- production agent (same prompt + model + params as app/api/chat) ---------
async function agentReply(messages, graph) {
  // Same composition as the deployed route: the interviewer sees which captured
  // points are still unconnected and is asked to draw the relationship out.
  const note = interviewNote(graph, "hospitality");
  const response = await openai.chat.completions.create({
    model: process.env.CHATGRAPH_AGENT_MODEL || "gpt-4o",
    max_completion_tokens: 420,
    messages: [
      { role: "system", content: note ? `${DOMAIN.agentPrompt}\n\n${note}` : DOMAIN.agentPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ]
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function expertReply(messages) {
  // The simulated expert sees the conversation from the other side.
  const flipped = messages.map((m) => ({
    role: m.role === "assistant" ? "user" : "assistant",
    content: m.content
  }));
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 260,
    temperature: 0.6,
    messages: [{ role: "system", content: EXPERT_PERSONA }, ...flipped]
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

// --- session loop ------------------------------------------------------------
const now = Date.now();
let graph = {
  vertices: Object.fromEntries(DOMAIN.initialVertices.map((v) => [v.id, v])),
  edges: Object.fromEntries((DOMAIN.initialEdges ?? []).map((e) => [e.id, e]))
};
const messages = [
  { id: "m0", role: "assistant", content: DOMAIN.openingLine, createdAt: now }
];
const turnRecords = [];

for (let turn = 1; turn <= TURNS; turn += 1) {
  const expertText = await expertReply(messages);
  const userMessage = { id: `u${turn}`, role: "user", content: expertText, createdAt: now + turn * 1000 };
  messages.push(userMessage);
  process.stdout.write(`turn ${String(turn).padStart(2)}: expert ${expertText.slice(0, 72).replace(/\n/g, " ")}…\n`);

  const { delta, warnings, gate } = await extractGovernedDelta(openai, expertText, {
    domainId: "hospitality",
    messages,
    graph
  });
  graph = mergeDelta(graph, delta);
  turnRecords.push({ turn, userMessageId: userMessage.id, userText: expertText, delta, warnings, gate });

  const agentText = await agentReply(messages, graph);
  messages.push({ id: `a${turn}`, role: "assistant", content: agentText, createdAt: now + turn * 1000 + 500 });
  process.stdout.write(`         agent  ${agentText.slice(0, 72).replace(/\n/g, " ")}…\n`);
}

// --- analysis ----------------------------------------------------------------
const vertices = Object.values(graph.vertices);
const edges = Object.values(graph.edges);
const provenanceEdges = new Set([...CONTRACT.provenanceEdgeLabels, "supersededBy", "hasSection", "hasEpisode", "hasSession"]);
const knowledge = vertices.filter((v) => CONTRACT.knowledgeLabels.has(v.label));
const superseded = new Set(edges.filter((e) => e.label === "supersededBy").map((e) => e.out));
const liveKnowledge = knowledge.filter((v) => !superseded.has(v.id));
const semantic = edges.filter((e) => {
  if (provenanceEdges.has(e.label)) return false;
  const a = graph.vertices[e.out]; const b = graph.vertices[e.in];
  return a && b && (CONTRACT.knowledgeLabels.has(a.label) || a.label === "Person") &&
         (CONTRACT.knowledgeLabels.has(b.label) || b.label === "Person");
});
const degree = new Map();
for (const e of semantic) {
  degree.set(e.out, (degree.get(e.out) ?? 0) + 1);
  degree.set(e.in, (degree.get(e.in) ?? 0) + 1);
}
const isolated = liveKnowledge.filter((v) => !(degree.get(v.id) > 0));
const grounded = liveKnowledge.filter((v) => graph.vertices[`evidence:${v.id}`]);
const sections = [];
for (const t of turnRecords) {
  for (const v of t.delta.vertices) if (v.label === "SessionSection") sections.push(v.properties.order);
}
const findings = {};
let attempts = 0, retriedTurns = 0, skipped = 0;
for (const t of turnRecords) {
  const g = t.gate ?? {};
  if (g.skippedAsFiller || g.skippedAsFragment) { skipped += 1; continue; }
  attempts += (g.attempts ?? []).length;
  if ((g.attempts ?? []).length > 1) retriedTurns += 1;
  for (const at of g.attempts ?? []) for (const f of at.findings ?? []) {
    const k = `${f.ruleId}/${f.severity}/${f.action}`;
    findings[k] = (findings[k] ?? 0) + 1;
  }
}
const eligible = turnRecords.length - skipped;

const analysis = {
  turns: turnRecords.length,
  eligibleTurns: eligible,
  skippedFillerOrFragment: skipped,
  vertices: vertices.length,
  edges: edges.length,
  knowledgeVertices: liveKnowledge.length,
  knowledgePerEligibleTurn: Number((liveKnowledge.length / Math.max(1, eligible)).toFixed(2)),
  semanticEdges: semantic.length,
  isolatedKnowledge: isolated.length,
  isolatedRate: `${isolated.length}/${liveKnowledge.length}`,
  isolatedExamples: isolated.slice(0, 8).map((v) => `${v.label}:${JSON.stringify(v.properties).slice(0, 60)}`),
  provenanceCoverage: `${grounded.length}/${liveKnowledge.length}`,
  sectionProgression: [...new Set(sections)],
  totalAttempts: attempts,
  turnsWithRetries: retriedTurns,
  gateFindings: findings
};

console.log("\n================ TRIAL ANALYSIS ================");
console.log(JSON.stringify(analysis, null, 2));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ messages, turnRecords, graph, analysis }, null, 2));
console.log(`\nfull session written to ${OUT}`);
