/**
 * Graph-quality trial: a fixed corpus of hard utterances run through the REAL
 * production pipeline — deployed extractor prompt, deployed governed extractor,
 * deployed gate — asserting the properties a knowledge graph has to have to be
 * usable, not just admissible.
 *
 *   node --import ./scripts/ts-alias-hooks.mjs scripts/graph_quality_trial.mjs [outfile]
 *
 * Unlike product_trial.mjs, the expert side is SCRIPTED rather than simulated.
 * A simulated expert says something different every run, so a regression and a
 * mood swing look identical. Here the input is fixed, so a change in the output
 * is a change in the system.
 *
 * Every case is an edge case the live product actually got wrong:
 *   - several distinct facts in a single reply (the reported defect)
 *   - a fact that must connect to one stated three turns earlier
 *   - a restatement that must supersede rather than duplicate
 *   - filler and interview logistics that must produce nothing
 *
 * What it asserts, from lib/graph-quality.ts so the thresholds match what the
 * download bundle reports:
 *   CAPTURE      every expected concept present somewhere in the graph
 *   CONNECTIVITY the full graph is one reachable body; no fact without a relation
 *   LABELS       no sentence sitting in a name slot, no contentless fact
 *   IDENTITY     no two live facts of a label sharing a name
 *
 * The corpus is synthetic — a persona written for this file — so nothing here
 * is subject interview content.
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

import { getDomain } from "@/lib/domains";
import { mergeDelta } from "@/lib/schema";
import { extractGovernedDelta } from "@/lib/server/extract-governed";
import { gateContract } from "@/lib/gate/contract";
import { graphQuality } from "@/lib/graph-quality";
import { keyText } from "@/lib/gate/gate";

for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : []) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, idx).trim();
  if (!process.env[key]) process.env[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const OUT = process.argv[2] ?? path.join(
  "/tmp/claude-1000/-workspaces-Chatgraph-V2/7d6c85b0-e91c-40e4-8dc9-0781310611d9/scratchpad",
  "graph-quality-trial.json"
);

const DOMAIN = getDomain("hospitality");
const CONTRACT = gateContract("hospitality");

/**
 * `expect` lists concepts the utterance plainly contains. Each entry is a set of
 * alternative spellings; the concept counts as captured when any of them appears
 * in a fact's name or properties. Deliberately generous about wording and strict
 * about presence: the question is "did this fact survive at all", not "did the
 * extractor phrase it the way I would have".
 */
const CORPUS = [
  {
    ask: "To get us grounded — what's your role, what kind of hospitality business is it, and how long have you run it?",
    say: "I am the general manager, the company runs a fairly large chain of hotels so I look after all of them, and I have been doing this for 10 years now",
    expect: [["general manager"], ["hotel chain", "chain of hotels", "large hotel"], ["10 years", "ten years"]],
    note: "the reported defect: three facts in one reply"
  },
  {
    ask: "What would you say makes the operation especially successful?",
    say: "Honestly it's the arrival. The first ninety seconds decide the whole stay. If someone walks in tired and we make them stand at a desk filling forms, we've lost them, and no breakfast buffet is going to win that back.",
    expect: [["arrival", "first ninety seconds", "ninety seconds"], ["tired"], ["desk", "forms", "filling forms"]],
    note: "a principle plus the signal it keys off plus the failure it avoids"
  },
  {
    ask: "How do you handle check-in timing?",
    say: "Official check-in is three PM but that's mostly fiction. I keep two rooms cleaned and ready by eleven every single day, because the early arrivals are the ones who are most fragile. I never charge for it.",
    expect: [["three pm", "3pm", "3 pm", "15:00"], ["two rooms", "eleven"], ["never charge", "no charge", "free", "earlyCheckInFee=false", "earlyCheckInFee=no"]],
    note: "policy, deviation from policy, and a fee rule in one breath"
  },
  {
    ask: "Tell me about a time something went wrong.",
    say: "We had a booking system failure last summer that double-booked four rooms on the same night. I walked each guest to a competitor myself, paid the difference, and sent them a note the next week. Three of those four have come back since.",
    expect: [["double", "double-booked", "booking system"], ["competitor", "walked", "paid the difference"], ["come back", "returned", "three of those four"]],
    note: "failure, recovery action, and outcome — must link, not float"
  },
  {
    ask: "How do you read a guest when they walk in?",
    say: "Luggage and pace. Someone dragging a big case slowly at four in the afternoon has had a bad journey and needs quiet and speed. Someone with a small bag walking fast is here for work and wants the key in their hand and nothing else.",
    expect: [["luggage", "pace"], ["bad journey", "quiet", "tired"], ["work", "business", "key in their hand"]],
    note: "one signal, two personas read off it"
  },
  {
    ask: "What's your biggest operational constraint?",
    say: "Solo shifts. Between two and six in the afternoon there's one person on the desk, and that's exactly when check-ins stack up. Everything I've built about arrivals has to survive one pair of hands.",
    expect: [["solo", "one person", "single"], ["two and six", "afternoon"], ["check-in", "arrivals", "stack"]],
    note: "a constraint that must connect back to the arrival principle stated earlier"
  },
  {
    ask: "Anything you'd add about early arrivals specifically?",
    say: "Actually let me correct something. I said two rooms ready by eleven — it's three rooms now, we changed it last spring after a bad August.",
    expect: [["three rooms"]],
    note: "restatement: must supersede the earlier policy, not sit beside it"
  },
  {
    ask: "Shall we move on?",
    say: "Yeah.",
    expect: [],
    expectEmpty: true,
    note: "filler: must produce nothing"
  },
  {
    ask: "Before we continue — any preference on how I ask these?",
    say: "Keep the questions short please, and let's not spend too long on each one.",
    expect: [],
    expectEmpty: true,
    note: "interview logistics: must produce nothing"
  }
];

/**
 * What a turn actually DID to the graph. A turn that re-emits a fact already
 * stored, with identical content, changes nothing and is harmless; a turn that
 * adds or rewrites one is what "must produce nothing" is really about. Measuring
 * the change rather than the delta size keeps the assertion on the harm.
 */
const fingerprint = (g) =>
  new Map(Object.values(g.vertices).map((v) => [v.id, JSON.stringify(v.properties)]));
const diffFingerprint = (before, after) => {
  const added = [];
  const modified = [];
  for (const [id, props] of after) {
    if (!before.has(id)) added.push(id);
    else if (before.get(id) !== props) modified.push(id);
  }
  return { added, modified };
};

const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const now = Date.now();
let graph = {
  vertices: Object.fromEntries(DOMAIN.initialVertices.map((v) => [v.id, v])),
  edges: Object.fromEntries((DOMAIN.initialEdges ?? []).map((e) => [e.id, e]))
};
const messages = [{ id: "m0", role: "assistant", content: DOMAIN.openingLine, createdAt: now }];
const turnRecords = [];

for (const [index, item] of CORPUS.entries()) {
  const turn = index + 1;
  messages.push({ id: `a${turn}`, role: "assistant", content: item.ask, createdAt: now + turn * 2000 });
  const userMessage = { id: `u${turn}`, role: "user", content: item.say, createdAt: now + turn * 2000 + 500 };
  messages.push(userMessage);

  const before = fingerprint(graph);
  const { delta, warnings, gate } = await extractGovernedDelta(openai, item.say, {
    domainId: "hospitality",
    messages,
    graph
  });
  graph = mergeDelta(graph, delta);
  const changed = diffFingerprint(before, fingerprint(graph));
  turnRecords.push({ turn, userMessageId: userMessage.id, userText: item.say, delta, warnings, gate, note: item.note, changed });

  const facts = delta.vertices.filter((v) => CONTRACT.knowledgeLabels.has(v.label));
  const skipped = gate?.skippedAsFiller || gate?.skippedAsFragment;
  process.stdout.write(
    `turn ${String(turn).padStart(2)}  ${skipped ? "skipped" : `${facts.length} facts`}  ${item.note}\n`
  );
}

// --- scoring -----------------------------------------------------------------
const quality = graphQuality(graph, "hospitality");

// Everything the graph now "says", for concept presence checks.
// Everything the graph "says". Booleans and numbers render as key=value pairs:
// "I never charge for it" is captured as earlyCheckInFee=false, and a haystack
// of strings alone reported that capture as a miss.
const haystack = Object.values(graph.vertices)
  .filter((v) => CONTRACT.knowledgeLabels.has(v.label))
  .map((v) =>
    normalize(
      Object.entries(v.properties)
        .map(([k, x]) => (typeof x === "string" ? x : `${k}=${String(x)}`))
        .join(" ")
    )
  )
  .join(" | ");

const captureRows = [];
for (const [index, item] of CORPUS.entries()) {
  for (const alternatives of item.expect) {
    const found = alternatives.some((phrase) => haystack.includes(normalize(phrase)));
    captureRows.push({ turn: index + 1, concept: alternatives[0], found });
  }
}
const captured = captureRows.filter((r) => r.found).length;

const emptyExpected = CORPUS.map((item, index) => ({ item, turn: index + 1 }))
  .filter(({ item }) => item.expectEmpty)
  .map(({ turn }) => {
    const record = turnRecords[turn - 1];
    const facts = record.delta.vertices.filter((v) => CONTRACT.knowledgeLabels.has(v.label));
    const touchedFacts = [...record.changed.added, ...record.changed.modified]
      .filter((id) => CONTRACT.knowledgeLabels.has(graph.vertices[id]?.label));
    return {
      turn,
      reEmitted: facts.length,
      names: facts.map((v) => keyText(v.properties, CONTRACT.vertexSpecs.get(v.label))),
      changedTheGraph: touchedFacts
    };
  });

const findings = {};
for (const record of turnRecords) {
  for (const attempt of record.gate?.attempts ?? []) {
    for (const f of attempt.findings ?? []) {
      const key = `${f.ruleId}/${f.severity}/${f.action}`;
      findings[key] = (findings[key] ?? 0) + 1;
    }
  }
}

const report = {
  capture: { captured, total: captureRows.length, missed: captureRows.filter((r) => !r.found) },
  connectivity: {
    knowledgeVertices: quality.knowledgeVertices,
    semanticEdges: quality.semanticEdges,
    fullGraphComponents: quality.fullGraphComponents,
    semanticComponents: quality.components,
    largestComponent: quality.largestComponent,
    connectedShare: Number(quality.connectedShare.toFixed(3)),
    isolated: quality.isolated
  },
  labels: {
    sentenceNamed: quality.sentenceNamed,
    idShapedNames: quality.idShapedNames,
    contentless: quality.contentless
  },
  identity: { duplicateNames: quality.duplicateNames, supersededFacts: quality.supersededFacts },
  grounding: { groundedKnowledge: quality.groundedKnowledge, groundedSemanticEdges: quality.groundedSemanticEdges },
  silenceExpected: emptyExpected,
  gateFindings: findings
};

console.log("\n================ GRAPH QUALITY TRIAL ================");
console.log(JSON.stringify(report, null, 2));

console.log("\n---------------- FACTS ----------------");
for (const v of Object.values(graph.vertices)) {
  if (!CONTRACT.knowledgeLabels.has(v.label)) continue;
  console.log(`  ${v.label.padEnd(24)} ${JSON.stringify(keyText(v.properties, CONTRACT.vertexSpecs.get(v.label)))}`);
}
console.log("\n---------------- RELATIONSHIPS ----------------");
const plumbing = new Set([...CONTRACT.provenanceEdgeLabels, "supersededBy", "hasSection", "hasEpisode", "hasSession"]);
for (const e of Object.values(graph.edges)) {
  if (plumbing.has(e.label)) continue;
  const a = graph.vertices[e.out];
  const b = graph.vertices[e.in];
  if (!a || !b) continue;
  const nameOf = (v) => keyText(v.properties, CONTRACT.vertexSpecs.get(v.label)) || v.label;
  console.log(`  ${nameOf(a)} --${e.label}--> ${nameOf(b)}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ report, graph, turnRecords }, null, 2));
console.log(`\nfull session written to ${OUT}`);

// --- thresholds --------------------------------------------------------------
const failures = [];
const captureRate = captured / Math.max(1, captureRows.length);
if (captureRate < 0.8) failures.push(`capture ${captured}/${captureRows.length} below 80%`);
// The whole graph, provenance spine included, must be one reachable body.
// The SEMANTIC subgraph is only reported: expert knowledge arrives in topic
// clusters, and fusing them would mean asserting relations the expert never did.
if (quality.fullGraphComponents > 1) {
  failures.push(`${quality.fullGraphComponents} disconnected components in the full graph; it must be one`);
}
if (quality.isolated.length > 0) failures.push(`${quality.isolated.length} facts with no relationship at all`);
if (quality.sentenceNamed.length > 0) failures.push(`${quality.sentenceNamed.length} facts named by a sentence`);
if (quality.idShapedNames.length > 0) failures.push(`${quality.idShapedNames.length} facts named by an identifier`);
if (quality.contentless.length > 0) failures.push(`${quality.contentless.length} contentless facts`);
if (quality.duplicateNames.length > 0) failures.push(`${quality.duplicateNames.length} duplicate-named facts`);
for (const row of emptyExpected) {
  if (row.changedTheGraph.length > 0) {
    failures.push(`turn ${row.turn} must not change the graph, but touched ${row.changedTheGraph.join(", ")}`);
  }
}

console.log("\n================ VERDICT ================");
if (failures.length === 0) {
  console.log(
    `PASS — capture ${captured}/${captureRows.length}, one connected graph of ${quality.knowledgeVertices} facts ` +
    `in ${quality.components} topic cluster(s).`
  );
} else {
  console.log(`FAIL (${failures.length})`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
