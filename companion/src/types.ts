export const ALL_TOKEN_SCOPES = [
  "library:read",
  "stream:read",
  "metadata:write",
  "library:manage",
] as const;

export type TokenScope = (typeof ALL_TOKEN_SCOPES)[number];

export type DeviceToken = {
  createdAt: string;
  hash: string;
  id: string;
  label: string;
  scopes: TokenScope[];
  tailscaleLogin?: string;
};

export type PasswordVerifier = {
  hash: string;
  salt: string;
};

export type CompanionConfig = {
  adminPassword?: PasswordVerifier;
  apiPort: number;
  adminPort: number;
  configVersion: 2;
  libraryRoots: string[];
  serverId: string;
  tokens: DeviceToken[];
};

export type IndexedTrack = {
  album?: string;
  albumArtist?: string;
  artist: string;
  artwork?: {
    data: Uint8Array;
    mimeType: string;
  };
  extension: string;
  filePath: string;
  genre?: string;
  id: string;
  name: string;
  size: number;
  track?: number;
  year?: number;
};

export type PublicTrack = Omit<IndexedTrack, "artwork" | "filePath"> & {
  hasArtwork: boolean;
};
