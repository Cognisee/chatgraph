import { NextResponse } from "next/server";
import { MEDICAL_AGENT_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

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
        instructions: MEDICAL_AGENT_PROMPT,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en"
            },
            turn_detection: {
              type: "semantic_vad"
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
