import type { SnapshotPayload } from "../types";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function pingApi(baseUrl: string) {
  return request<{ status: string; timestamp: string }>(baseUrl, "/health");
}

export async function pullSnapshot(baseUrl: string) {
  return request<SnapshotPayload>(baseUrl, "/workspace/snapshot");
}

export async function pushSnapshot(baseUrl: string, payload: SnapshotPayload) {
  return request<SnapshotPayload>(baseUrl, "/workspace/snapshot", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

