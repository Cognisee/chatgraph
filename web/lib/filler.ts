/**
 * Deterministic filler detection, shared by the product and the evaluation
 * harness so "eligible turn" means the same thing in both. A filler turn is
 * navigation or acknowledgment — it carries no extractable knowledge, and the
 * live audit showed extraction on such turns fabricates facts and mutates
 * existing ones ("Continue" turns re-emitted and corrupted prior concepts).
 */

const FILLER_PATTERN =
  /^(okay|ok|no|sounds great|let'?s go|yeah)?[,! ]*(continue|move on|next question|no[, ]*move on|let'?s move( on)?|go on|that would be it|no|yes|sorry,? you can just move on|i want to continue|you want to continue\??|yeah continue please|yeah,? let'?s continue|no,? i think this is it)[.! ]*$/i;

const SHORT_ACKS =
  /^(ok|okay|yes|yeah|no|sure|continue|move on|next|thanks?|thank you|world)$/i;

export function isFillerTurn(text: string): boolean {
  const value = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!value) return true;
  if (/^(okay,? sounds great\.? let'?s go|sounds great\.? let'?s go|sure,? let'?s (go|start|begin)( ahead)?)$/i.test(value)) return true;
  const words = value.split(" ");
  if (words.length <= 3 && words.every((word) => SHORT_ACKS.test(word.replace(/[.,!?]/g, "")))) return true;
  return FILLER_PATTERN.test(value);
}

/**
 * A turn that arrives cut off mid-sentence ("So if it's in Japan, then our
 * check-in time is"). Extracting from a fragment mints facts whose property
 * values can only come from surrounding context — the live trial produced a
 * CheckInPolicy with times quoted from the PREVIOUS turn, which then superseded
 * the previous turn's correct policy. The interviewer separately asks the
 * expert to finish the thought, so the completed content arrives next turn and
 * nothing is lost by skipping.
 *
 * Deliberately conservative: only short turns (ASR cutoffs are short) whose
 * last word is a function word that cannot end an English sentence.
 */
// Deliberately excludes verb particles (in, on, up, out: "they walk in" is a
// complete sentence) and strandable prepositions (of, for, at: "taken care of").
// Only words that essentially never end an English sentence qualify.
const FRAGMENT_ENDINGS = new Set([
  "a", "an", "the",
  "is", "are", "was", "were", "am", "be", "being",
  "has", "have", "had", "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "and", "or", "but", "because", "whether", "if",
  "my", "our", "your", "their",
  "into", "onto", "to",
  "which", "whose", "very"
]);

export function isFragmentTurn(text: string): boolean {
  const value = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!value) return false;
  const words = value.split(" ");
  if (words.length < 2 || words.length > 12) return false;
  const last = words[words.length - 1].toLowerCase().replace(/[.,!?;:]+$/, "");
  return FRAGMENT_ENDINGS.has(last);
}
