// Wrapper around echomind-server's /api/token/* endpoints. Account JSON is
// encrypted with an AES-256-GCM key that lives in the OS keychain (Windows
// Credential Manager / macOS Keychain), so the .enc files on disk are useless
// without the host user's logon session.
//
// Bot calls these instead of writing plaintext JSON. Server must be running
// before the bot reads/writes tokens (already enforced by bridge_start_server
// being called before bridge_start_daemon in the desktop app).

const SERVER = process.env.ECHOMIND_SERVER || "http://127.0.0.1:8765";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${path} ${resp.status}: ${text}`);
  }
  return (await resp.json()) as T;
}

export async function encryptString(plaintext: string): Promise<string> {
  const { envelope } = await postJson<{ envelope: string }>(
    "/api/token/encrypt",
    { plaintext },
  );
  return envelope;
}

export async function decryptString(envelope: string): Promise<string> {
  const { plaintext } = await postJson<{ plaintext: string }>(
    "/api/token/decrypt",
    { envelope },
  );
  return plaintext;
}
