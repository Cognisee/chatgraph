# Cognisee — Making Tacit Expertise Computable

*[ screen capture of the live interview + graph ]*

### Demo overview

A person describes, in their own words, something they know but have not fully written down — here, the particulars of their own chronic condition: two distinct headache patterns, a visual aura that is hard to articulate ("zigzagging rainbows… eyes closed, sometimes open… usually when I'm exercising"), and triggers inferred over years. While they speak, a conversational agent conducts a structured interview, and a second model builds a typed knowledge graph in real time — entity by entity, relation by relation — into a live store.

The output is not a transcript or a summary but a structured, typed record: each entity and relationship is traceable to the utterance that produced it.

### The role of the schema

The interview is not open-ended capture. A domain expert designs the knowledge-graph schema beforehand — the entities, relationships, and attributes that matter in the field. That schema serves two functions during a session: it informs the interviewing agent what to ask about, and it constrains how the second model interprets each answer, mapping spoken responses to the schema's defined types.

Because every session is recorded against the same expert-defined vocabulary, records from separate interviews — and separate people — can be combined. The shared schema is what makes knowledge captured across sessions composable rather than a set of disconnected notes.

### Context

Much of the knowledge that governs consequential work in medicine, defense, law, and industry is tacit and situated, and is largely not recorded in text — what Polanyi summarized as knowing more than we can tell. Documentation tends to capture the residue of expertise rather than its substance. Language models work well over the documented layer; BCG's 2025 study of 1,250+ firms reported roughly 5% achieving AI value at scale, attributing the gap to institutional and governance factors rather than model access. Cognitive Task Analysis research finds that structured elicitation surfaces 40–70% of task-critical steps that experts omit when explaining their work informally. The demo applies that form of elicitation in an automated, real-time setting.

### Scope and representation

Headache disorders are an example domain, not the product. The elicitation loop is domain-neutral: changing the schema and the interviewer prompt directs the same machinery at other fields, such as surgical judgment, compliance reasoning, or field diagnostics.

The property graph shown is one of several representations Cognisee uses. It was chosen for the demo because property graphs are straightforward to visualize. Depending on context, the same knowledge may instead be represented as RDF, labeled hypergraphs, or modal structures capturing necessity and possibility, deontic modes such as obligation and permission, degrees of belief, and provenance.

### Properties of the captured knowledge

Knowledge captured this way carries provenance and consent from the point of capture, which bears on its use in regulated settings. Because the traces originate in expert interviews rather than public text, they are not available by scraping. Cognisee's broader research program treats the central claim — that structured tacit elicitation yields records more faithful than self-authored documentation — as a hypothesis to be tested rather than assumed.
