export type RealtimeStatus = "idle" | "connecting" | "connected";

export const REALTIME_SILENCE_UNTIL_USER_PROMPT =
  "The app speaks the opening line separately. Do not initiate the conversation. Stay silent until you receive a patient audio transcript, then answer only that patient turn.";

/**
 * The one composition of the voice agent's instructions, shared by the token
 * route (session creation) and the mid-call session.update path (page.tsx after
 * each extraction), so the two can never drift. `note` is the interview-state
 * briefing derived from the live graph; the session starts without one because
 * the graph starts empty.
 */
export function voiceInstructions(agentPrompt: string, note?: string | null): string {
  const base = `${agentPrompt}\n\nRealtime voice rule: ${REALTIME_SILENCE_UNTIL_USER_PROMPT}`;
  return note ? `${base}\n\n${note}` : base;
}

type RealtimeCallbacks = {
  onStatus: (status: RealtimeStatus) => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError: (message: string) => void;
  domainId?: string;
};

type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  part?: {
    transcript?: string;
    text?: string;
  };
  response?: {
    id?: string;
    status?: string;
    output?: Array<{
      content?: Array<{
        transcript?: string;
        text?: string;
      }>;
    }>;
  };
};

export class OpenAIRealtimeSession {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private assistantTranscript = "";
  private assistantResponsesBlocked = false;
  private lastAssistantTranscript = "";
  private lastAssistantTranscriptAt = 0;
  private responseInFlight = false;
  private pendingAssistantTurns = 0;
  private userTranscriptBuffer: string[] = [];
  private userTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
  private responseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private userTranscriptSettleUntil = 0;
  private needsResponseAfterSettle = false;

  // How long after the last transcript fragment before we answer. Experts pause
  // mid-thought; 700ms answered fragments like "All that needs to be done in a".
  private static readonly USER_TRANSCRIPT_SETTLE_MS = 1200;

  constructor(private callbacks: RealtimeCallbacks) {}

  async start(): Promise<void> {
    this.callbacks.onStatus("connecting");
    try {
      const tokenUrl = this.callbacks.domainId
        ? `/api/realtime/token?domain=${encodeURIComponent(this.callbacks.domainId)}`
        : "/api/realtime/token";
      const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
      if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
      const tokenPayload = await tokenResponse.json();
      const token = extractRealtimeToken(tokenPayload);
      if (!token) throw new Error("Realtime token response did not include a client secret.");

      const peer = new RTCPeerConnection();
      this.peer = peer;

      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      peer.ontrack = (event) => {
        if (this.audio) this.audio.srcObject = event.streams[0];
      };

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);

      this.channel = peer.createDataChannel("oai-events");
      this.channel.addEventListener("open", () => {
        this.callbacks.onStatus("connected");
        // Belt-and-braces against any missed event: if a user turn is owed an
        // answer and nothing is in flight, ask for one. Cheap no-op otherwise.
        this.watchdogTimer = setInterval(() => this.requestResponseIfReady(), 1500);
      });
      this.channel.addEventListener("message", (event) => this.handleEvent(event.data));
      this.channel.addEventListener("close", () => this.callbacks.onStatus("idle"));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp"
        }
      });
      if (!sdpResponse.ok) throw new Error(await sdpResponse.text());
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text()
      });
    } catch (error) {
      this.stop();
      this.callbacks.onError(error instanceof Error ? error.message : "Realtime voice failed.");
      this.callbacks.onStatus("idle");
    }
  }

  stop(): void {
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audio) this.audio.srcObject = null;
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.audio = null;
    this.assistantTranscript = "";
    this.assistantResponsesBlocked = false;
    this.lastAssistantTranscript = "";
    this.lastAssistantTranscriptAt = 0;
    this.responseInFlight = false;
    this.pendingAssistantTurns = 0;
    this.clearUserTranscriptTimer();
    if (this.responseRetryTimer) {
      clearTimeout(this.responseRetryTimer);
      this.responseRetryTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.userTranscriptBuffer = [];
    this.userTranscriptSettleUntil = 0;
    this.needsResponseAfterSettle = false;
    this.callbacks.onStatus("idle");
  }

  setMicrophoneMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  setAssistantResponsesBlocked(blocked: boolean): void {
    this.assistantResponsesBlocked = blocked;
  }

  private handleEvent(raw: string): void {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    if (event.type === "error") {
      const message = event.error?.message ?? "Realtime API returned an error.";
      // A cancel that raced a completed response is harmless bookkeeping noise,
      // not something to show the interviewee.
      if (/no active response/i.test(message)) {
        console.warn("[chatgraph realtime]", message);
        return;
      }
      this.callbacks.onError(message);
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      // TRUE barge-in: the microphone heard the expert start speaking. With
      // interrupt_response enabled the server truncates the assistant's audio
      // itself; the client mirrors that by cancelling its in-flight response so
      // the two sides agree. This is the ONLY place a response is cancelled —
      // transcription events must never cancel (see queueUserTranscript).
      if (this.responseInFlight) {
        this.cancelResponse();
        this.responseInFlight = false;
        this.assistantTranscript = "";
      }
      // The expert is speaking: hold any pending response until their words
      // arrive and settle, otherwise a retry can answer a half-spoken thought.
      this.userTranscriptSettleUntil = Date.now() + OpenAIRealtimeSession.USER_TRANSCRIPT_SETTLE_MS;
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = event.transcript?.trim();
      if (text) {
        this.callbacks.onUserTranscript(text);
      }
      return;
    }

    if (event.type === "response.created") {
      // The server no longer auto-creates responses (create_response: false), so
      // every response here is one this client requested. The old gating cancelled
      // "unsolicited" responses, but the server's auto-response raced ahead of the
      // transcript event, so it cancelled legitimate answers and stalled the
      // interview until the expert said "continue".
      if (this.assistantResponsesBlocked) {
        this.cancelResponse(event.response?.id);
        return;
      }
      this.responseInFlight = true;
      return;
    }

    if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.output_text.delta"
    ) {
      this.assistantTranscript += event.delta ?? "";
      return;
    }

    if (
      event.type === "response.output_audio_transcript.done" ||
      event.type === "response.output_text.done" ||
      event.type === "response.content_part.done"
    ) {
      const text = (event.transcript ?? event.part?.transcript ?? event.part?.text)?.trim();
      if (text) this.assistantTranscript = text;
      return;
    }

    if (event.type === "response.done") {
      this.responseInFlight = false;
      if (this.assistantResponsesBlocked) {
        this.assistantTranscript = "";
        return;
      }
      if (event.response?.status && event.response.status !== "completed") {
        // A cancelled or failed response still owes the user an answer. Without
        // re-arming here the session deadlocked: pendingAssistantTurns stayed
        // positive, nothing ever called response.create again, and the interview
        // sat silent until the user prompted it with "continue".
        this.assistantTranscript = "";
        if (this.pendingAssistantTurns > 0) {
          this.needsResponseAfterSettle = true;
          this.scheduleResponseRetry();
        }
        return;
      }
      const text = (extractResponseTranscript(event) || this.assistantTranscript).trim();
      this.assistantTranscript = "";
      if (text) this.emitAssistantTranscript(text);
      this.pendingAssistantTurns = Math.max(0, this.pendingAssistantTurns - 1);
      this.needsResponseAfterSettle = false;
      // Any transcription that arrived while this response was speaking was
      // record-only (see queueUserTranscript): flush it now so the transcript
      // and extraction see the text, without requesting another response —
      // the answer that just finished already covered that audio.
      this.flushUserTranscript();
    }
  }

  private queueUserTranscript(text: string): void {
    this.userTranscriptBuffer.push(text);

    // A transcription that lands while the assistant is already answering is
    // LAGGING PAPERWORK, not an interruption: Whisper delivers text seconds
    // after the audio, and the in-flight response was generated from the full
    // audio the model actually heard. The previous code treated this as a
    // barge-in and cancelled the response — the assistant audibly started one
    // sentence, cut off mid-word, and then spoke a different one (only the
    // second reaching the transcript). Late text is therefore record-only: it
    // is flushed for the transcript/extraction when the response completes,
    // and no additional response is requested for it.
    if (this.responseInFlight) {
      return;
    }

    if (this.pendingAssistantTurns === 0) this.pendingAssistantTurns = 1;
    this.userTranscriptSettleUntil = Date.now() + OpenAIRealtimeSession.USER_TRANSCRIPT_SETTLE_MS;
    this.needsResponseAfterSettle = true;

    this.clearUserTranscriptTimer();
    this.userTranscriptTimer = setTimeout(() => {
      this.flushUserTranscript();
      this.requestResponseIfReady();
    }, OpenAIRealtimeSession.USER_TRANSCRIPT_SETTLE_MS);
  }

  private flushUserTranscript(): void {
    if (this.userTranscriptBuffer.length === 0) return;
    const text = this.userTranscriptBuffer.join(" ").replace(/\s+/g, " ").trim();
    this.userTranscriptBuffer = [];
    if (text) this.callbacks.onUserTranscript(text);
  }

  private requestResponseIfReady(): void {
    if (
      !this.needsResponseAfterSettle ||
      this.assistantResponsesBlocked ||
      this.responseInFlight ||
      this.pendingAssistantTurns === 0 ||
      Date.now() < this.userTranscriptSettleUntil ||
      this.channel?.readyState !== "open"
    ) {
      return;
    }

    this.needsResponseAfterSettle = false;
    this.channel.send(JSON.stringify({ type: "response.create" }));
  }

  private scheduleResponseRetry(): void {
    if (this.responseRetryTimer) clearTimeout(this.responseRetryTimer);
    const settleRemaining = Math.max(0, this.userTranscriptSettleUntil - Date.now());
    this.responseRetryTimer = setTimeout(() => {
      this.responseRetryTimer = null;
      this.requestResponseIfReady();
    }, settleRemaining + 150);
  }

  private clearUserTranscriptTimer(): void {
    if (this.userTranscriptTimer) {
      clearTimeout(this.userTranscriptTimer);
      this.userTranscriptTimer = null;
    }
  }

  /**
   * Replace the session instructions mid-call. Used after each extracted turn
   * to hand the voice interviewer the current interview-state briefing — the
   * graph steering the conversation is the point of the feedback loop, and the
   * realtime API only takes instructions via session.update.
   */
  updateInstructions(instructions: string): void {
    if (this.channel?.readyState !== "open") return;
    this.channel.send(JSON.stringify({ type: "session.update", session: { instructions } }));
  }

  private cancelResponse(responseId?: string): void {
    if (this.channel?.readyState !== "open") return;
    this.channel.send(JSON.stringify({
      type: "response.cancel",
      ...(responseId ? { response_id: responseId } : {})
    }));
  }

  private emitAssistantTranscript(text: string): void {
    const normalized = normalizeTranscript(text);
    if (!normalized) return;

    const now = Date.now();
    if (normalized === this.lastAssistantTranscript && now - this.lastAssistantTranscriptAt < 2000) {
      return;
    }

    this.lastAssistantTranscript = normalized;
    this.lastAssistantTranscriptAt = now;
    this.callbacks.onAssistantTranscript(text);
  }
}

function extractRealtimeToken(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.value === "string") return payload.value;
  const clientSecret = payload.client_secret;
  if (isRecord(clientSecret) && typeof clientSecret.value === "string") {
    return clientSecret.value;
  }
  return "";
}

function extractResponseTranscript(event: RealtimeServerEvent): string {
  const pieces: string[] = [];
  for (const output of event.response?.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.transcript) pieces.push(content.transcript);
      else if (content.text) pieces.push(content.text);
    }
  }
  return pieces.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
