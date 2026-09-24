/** API 访问层：统一带上访问口令；遇到 401 时引导用户输入口令后重试一次。 */

const TOKEN_KEY = "wo.accessToken";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = getToken();
  const url = token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : path;
  const resp = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (resp.status === 401 && !retried) {
    const input = window.prompt("本服务设置了访问口令，请输入：");
    if (input !== null) {
      setToken(input.trim());
      return request(path, init, true);
    }
  }
  return resp;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await request(path, init);
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export async function apiStream(
  path: string,
  body: unknown,
  onLine: (obj: Record<string, unknown>) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<void> {
  const token = getToken();
  const url = token ? `${path}?token=${encodeURIComponent(token)}` : path;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (resp.status === 401 && !retried) {
    const input = window.prompt("本服务设置了访问口令，请输入：");
    if (input !== null) {
      setToken(input.trim());
      return apiStream(path, body, onLine, signal, true);
    }
  }
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const b = await resp.json();
      if (b?.error) detail = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("浏览器不支持流式读取");

  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onLine(JSON.parse(line.slice(6)));
        } catch {
          /* 忽略坏帧 */
        }
      }
    }
  }
}
