import { NextResponse } from "next/server";
import { getDomain } from "@/lib/domains";
import { voiceInstructions } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";

export async function GET(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  const domainId = new URL(request.url).searchParams.get("domain") ?? undefined;
  const domain = getDomain(domainId);

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: process.env.CHATGRAPH_REALTIME_MODEL || DEFAULT_REALTIME_MODEL,
        instructions: voiceInstructions(domain.agentPrompt),
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en"
            },
            turn_detection: {
              type: "semantic_vad",
              // Low eagerness: wait longer before deciding the speaker finished —
              // experts pause mid-thought, and cutting them off loses knowledge.
              eagerness: "low",
              // The client is the only party that requests responses. With server
              // auto-response on, response.created raced ahead of the transcript
              // event and the client cancelled legitimate responses — the cause of
              // stalls and "Cancellation failed: no active response found".
              create_response: false,
              interrupt_response: true
            }
          },
          output: {
            voice: process.env.CHATGRAPH_REALTIME_VOICE || DEFAULT_REALTIME_VOICE
          }
        }
      }
    })
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to create OpenAI Realtime client secret." },
      { status: response.status }
    );
  }

  return NextResponse.json(await response.json());
}
