import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CONNECTION_KEY = "home-audio-player.remote-connection.v1";
const TOKEN_KEY = "home-audio-player.remote-token.v1";

export type RemoteConnection = {
  baseUrl: string;
  lastSyncAt?: string;
  serverId: string;
  syncEpoch?: string;
  syncRevision?: number;
};

export type RemoteLibrarySync =
  | { connection: RemoteConnection; mode: "full"; tracks: RemoteTrackDto[] }
  | {
      connection: RemoteConnection;
      deletes: string[];
      mode: "delta";
      upserts: RemoteTrackDto[];
    };

export type RemoteTrackDto = {
  album?: string;
  albumArtist?: string;
  artist: string;
  extension: string;
  genre?: string;
  hasArtwork: boolean;
  id: string;
  name: string;
  size: number;
  track?: number;
  year?: number;
};

export type RemoteDirectoryListing = {
  currentPath: string | null;
  directories: { name: string; path: string }[];
  parentPath: string | null;
  selectedPaths: string[];
};

export type RemoteEditableMetadata = {
  album: string;
  artist: string;
  genre: string;
  name: string;
  track?: number;
  year?: number;
};

type RemoteChangesPage = {
  deletes: string[];
  nextSince: number | null;
  resetRequired: boolean;
  revision: number;
  serverId: string;
  upserts: RemoteTrackDto[];
};

type HealthResponse = {
  apiVersion: number;
  serverId: string;
  trackCount: number;
};

function normalizeBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
  ) {
    throw new Error("Use the private HTTPS address shown by Tailscale Serve.");
  }
  return url.toString().replace(/\/$/, "");
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;
  if (!response.ok) {
    throw new Error(
      body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
        ? body.error
        : `Companion request failed (${response.status}).`,
    );
  }
  return body as T;
}

export async function loadRemoteConnection() {
  const [stored, token] = await Promise.all([
    AsyncStorage.getItem(CONNECTION_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  if (!stored || !token) return { connection: null, token: null };
  try {
    const parsed = JSON.parse(stored) as Partial<RemoteConnection>;
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.serverId !== "string"
    ) {
      return { connection: null, token: null };
    }
    return { connection: parsed as RemoteConnection, token };
  } catch {
    return { connection: null, token: null };
  }
}

export async function pairRemoteServer(baseUrlInput: string, code: string) {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const health = await readJson<HealthResponse>(
    await fetch(`${baseUrl}/api/v1/health`),
  );
  if (health.apiVersion !== 1) {
    throw new Error("This companion uses an unsupported API version.");
  }
  const paired = await readJson<{ serverId: string; token: string }>(
    await fetch(`${baseUrl}/api/v1/pair`, {
      body: JSON.stringify({ code: code.trim(), label: "HomeAudioPlayer mobile" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  if (paired.serverId !== health.serverId) {
    throw new Error("The companion identity changed during pairing.");
  }
  const connection: RemoteConnection = {
    baseUrl,
    serverId: paired.serverId,
  };
  await Promise.all([
    AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(connection)),
    SecureStore.setItemAsync(TOKEN_KEY, paired.token),
  ]);
  return { connection, token: paired.token };
}

export async function testRemoteConnection(
  connection: RemoteConnection,
  token: string,
) {
  const response = await fetch(`${connection.baseUrl}/api/v1/library?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await readJson(response);
}

export async function fetchRemoteLibrary(
  connection: RemoteConnection,
  token: string,
) {
  const tracks: RemoteTrackDto[] = [];
  let offset: number | null = 0;
  let syncEpoch: string | undefined;
  let syncRevision: number | undefined;
  while (offset !== null) {
    const page: {
      epoch?: string;
      items: RemoteTrackDto[];
      nextOffset: number | null;
      revision?: number;
      serverId: string;
    } = await readJson(
      await fetch(
        `${connection.baseUrl}/api/v1/library?offset=${offset}&limit=500`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    if (page.serverId !== connection.serverId) {
      throw new Error("The connected companion identity no longer matches.");
    }
    if (offset === 0) {
      syncEpoch = page.epoch;
      syncRevision = page.revision;
    }
    tracks.push(...page.items);
    offset = page.nextOffset;
  }
  const updated: RemoteConnection = {
    baseUrl: connection.baseUrl,
    lastSyncAt: new Date().toISOString(),
    serverId: connection.serverId,
    ...(typeof syncEpoch === "string" && typeof syncRevision === "number"
      ? { syncEpoch, syncRevision }
      : {}),
  };
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(updated));
  return { connection: updated, tracks };
}

async function fetchRemoteChanges(
  connection: RemoteConnection,
  token: string,
): Promise<RemoteLibrarySync | null> {
  const { syncEpoch, syncRevision } = connection;
  if (typeof syncEpoch !== "string" || typeof syncRevision !== "number") {
    return null;
  }

  const changes = new Map<string, RemoteTrackDto | null>();
  let since: number | null = syncRevision;
  let revision = syncRevision;
  while (since !== null) {
    const response: Response = await fetch(
      `${connection.baseUrl}/api/v1/library/changes?since=${since}&epoch=${encodeURIComponent(syncEpoch)}&limit=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) return null;
    const page: RemoteChangesPage = await readJson<RemoteChangesPage>(response);
    if (page.serverId !== connection.serverId) {
      throw new Error("The connected companion identity no longer matches.");
    }
    if (page.resetRequired) return null;
    for (const item of page.upserts) changes.set(item.id, item);
    for (const id of page.deletes) changes.set(id, null);
    revision = page.revision;
    since = page.nextSince;
  }

  const updated: RemoteConnection = {
    ...connection,
    lastSyncAt: new Date().toISOString(),
    syncRevision: revision,
  };
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(updated));
  const upserts: RemoteTrackDto[] = [];
  const deletes: string[] = [];
  for (const [id, item] of changes) {
    if (item) upserts.push(item);
    else deletes.push(id);
  }
  return { connection: updated, deletes, mode: "delta", upserts };
}

export async function syncRemoteLibrary(
  connection: RemoteConnection,
  token: string,
  options: { forceFull?: boolean } = {},
): Promise<RemoteLibrarySync> {
  const delta = options.forceFull ? null : await fetchRemoteChanges(connection, token);
  if (delta) return delta;
  const full = await fetchRemoteLibrary(connection, token);
  return { ...full, mode: "full" };
}

export async function fetchRemoteDirectories(
  connection: RemoteConnection,
  token: string,
  directoryPath?: string,
) {
  const query = directoryPath
    ? `?path=${encodeURIComponent(directoryPath)}`
    : "";
  return readJson<RemoteDirectoryListing>(
    await fetch(`${connection.baseUrl}/api/v1/directories${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

export async function updateRemoteLibraryRoots(
  connection: RemoteConnection,
  token: string,
  paths: string[],
) {
  return readJson<{ count: number; selectedPaths: string[] }>(
    await fetch(`${connection.baseUrl}/api/v1/library/roots`, {
      body: JSON.stringify({ paths }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
}

export async function updateRemoteTrackMetadata(
  connection: RemoteConnection,
  token: string,
  trackId: string,
  metadata: RemoteEditableMetadata,
) {
  return readJson<{ track: RemoteTrackDto }>(
    await fetch(
      `${connection.baseUrl}/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`,
      {
        body: JSON.stringify(metadata),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    ),
  );
}

export async function disconnectRemoteServer(
  connection: RemoteConnection,
  token: string,
  localOnly = false,
) {
  if (!localOnly) {
    const response = await fetch(`${connection.baseUrl}/api/v1/session`, {
      headers: { Authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    if (!response.ok && response.status !== 401) {
      await readJson(response);
    }
  }
  await Promise.all([
    AsyncStorage.removeItem(CONNECTION_KEY),
    SecureStore.deleteItemAsync(TOKEN_KEY),
  ]);
}

export function remoteStreamUrl(connection: RemoteConnection, trackId: string) {
  return `${connection.baseUrl}/api/v1/tracks/${encodeURIComponent(trackId)}/stream`;
}

export function remoteArtworkUrl(
  connection: RemoteConnection,
  trackId: string,
) {
  return `${connection.baseUrl}/api/v1/tracks/${encodeURIComponent(trackId)}/artwork`;
}
