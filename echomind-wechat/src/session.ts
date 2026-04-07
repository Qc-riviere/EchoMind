import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_DIR = path.join(os.homedir(), ".echomind-wechat");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface Session {
  state: "idle" | "chatting";
  conversationId?: string;
  thoughtId?: string;
  lastActivity: string;
}

const sessions = new Map<string, Session>();

function sessionFile(userId: string): string {
  return path.join(SESSIONS_DIR, `${userId}.json`);
}

export function getSession(userId: string): Session {
  // Check in-memory cache first
  let session = sessions.get(userId);

  // Try loading from disk
  if (!session) {
    try {
      const data = fs.readFileSync(sessionFile(userId), "utf-8");
      session = JSON.parse(data) as Session;
    } catch {
      session = { state: "idle", lastActivity: new Date().toISOString() };
    }
    sessions.set(userId, session);
  }

  // Auto-expire chatting sessions after 30 min idle
  if (session.state === "chatting") {
    const lastActive = new Date(session.lastActivity).getTime();
    if (Date.now() - lastActive > IDLE_TIMEOUT_MS) {
      session.state = "idle";
      delete session.conversationId;
      delete session.thoughtId;
    }
  }

  return session;
}

export function updateSession(userId: string, patch: Partial<Session>): Session {
  const session = getSession(userId);
  Object.assign(session, patch, { lastActivity: new Date().toISOString() });
  sessions.set(userId, session);

  // Persist
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(sessionFile(userId), JSON.stringify(session, null, 2));

  return session;
}

export function clearSession(userId: string): void {
  updateSession(userId, {
    state: "idle",
    conversationId: undefined,
    thoughtId: undefined,
  });
}
