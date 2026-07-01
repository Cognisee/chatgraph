export type RealtimeStatus = "idle" | "connecting" | "connected";

type RealtimeCallbacks = {
  onStatus: (status: RealtimeStatus) => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError: (message: string) => void;
  initialAssistantText?: string;
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
  private pendingInitialAssistantText = "";
  private initialAssistantRequested = false;
  private lastAssistantTranscript = "";
  private lastAssistantTranscriptAt = 0;

  constructor(private callbacks: RealtimeCallbacks) {
    this.pendingInitialAssistantText = callbacks.initialAssistantText?.trim() ?? "";
  }

  async start(): Promise<void> {
    this.callbacks.onStatus("connecting");
    try {
      const tokenResponse = await fetch("/api/realtime/token", { cache: "no-store" });
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
        window.setTimeout(() => this.speakInitialAssistantText(), 250);
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
    this.pendingInitialAssistantText = "";
    this.initialAssistantRequested = false;
    this.lastAssistantTranscript = "";
    this.lastAssistantTranscriptAt = 0;
    this.callbacks.onStatus("idle");
  }

  private handleEvent(raw: string): void {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    if (event.type === "error") {
      this.callbacks.onError(event.error?.message ?? "Realtime API returned an error.");
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = event.transcript?.trim();
      if (text) this.callbacks.onUserTranscript(text);
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
      if (event.response?.status && event.response.status !== "completed") {
        this.assistantTranscript = "";
        return;
      }
      const text = (extractResponseTranscript(event) || this.assistantTranscript).trim();
      this.assistantTranscript = "";
      if (text) this.emitAssistantTranscript(text);
    }
  }

  private speakInitialAssistantText(): void {
    if (
      !this.pendingInitialAssistantText ||
      this.initialAssistantRequested ||
      this.channel?.readyState !== "open"
    ) {
      return;
    }
    this.initialAssistantRequested = true;
    this.channel.send(JSON.stringify({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `Say exactly this sentence and nothing else: ${JSON.stringify(this.pendingInitialAssistantText)}`
      }
    }));
  }

  private emitAssistantTranscript(text: string): void {
    const normalized = normalizeTranscript(text);
    if (!normalized) return;

    if (this.pendingInitialAssistantText && normalized === normalizeTranscript(this.pendingInitialAssistantText)) {
      this.pendingInitialAssistantText = "";
      this.lastAssistantTranscript = normalized;
      this.lastAssistantTranscriptAt = Date.now();
      return;
    }

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
