import { emptyGraph } from "./schema";
import type { ChatSession } from "./types";
import { OPENING_LINE } from "./prompts";

const DB_NAME = "chatgraph-browser";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const SESSION_KEY = "default";

export function defaultSession(): ChatSession {
  return {
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: OPENING_LINE,
        createdAt: Date.now()
      }
    ],
    graph: emptyGraph(),
    settings: {
      voiceEnabled: true,
      autoSpeak: true
    }
  };
}

export async function loadSession(): Promise<ChatSession> {
  const db = await openDb();
  const value = await requestToPromise<ChatSession | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(SESSION_KEY)
  );
  db.close();
  return value ?? defaultSession();
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await openDb();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(session, SESSION_KEY)
  );
  db.close();
}

export async function clearSession(): Promise<ChatSession> {
  const session = defaultSession();
  await saveSession(session);
  return session;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
