import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  ALL_TOKEN_SCOPES,
  type CompanionConfig,
  type DeviceToken,
  type PasswordVerifier,
  type TokenScope,
} from "./types.js";

const dataDirectory =
  process.env.HOME_AUDIO_PLAYER_DATA_DIR ??
  path.join(
    process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
    "HomeAudioPlayerCompanion",
  );
const configPath = path.join(dataDirectory, "config.json");

const defaultConfig = (): CompanionConfig => ({
  adminPort: 47831,
  apiPort: 47832,
  configVersion: 2,
  libraryRoots: [],
  serverId: randomUUID(),
  tokens: [],
});

function isPasswordVerifier(value: unknown): value is PasswordVerifier {
  if (!value || typeof value !== "object") return false;
  const verifier = value as Partial<PasswordVerifier>;
  return typeof verifier.hash === "string" && typeof verifier.salt === "string";
}

function isToken(value: unknown): value is DeviceToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<DeviceToken>;
  return (
    typeof token.createdAt === "string" &&
    typeof token.hash === "string" &&
    typeof token.id === "string" &&
    typeof token.label === "string" &&
    Array.isArray(token.scopes) &&
    token.scopes.every((scope) =>
      (ALL_TOKEN_SCOPES as readonly string[]).includes(scope as TokenScope),
    ) &&
    (token.tailscaleLogin === undefined || typeof token.tailscaleLogin === "string")
  );
}

export function normalizeConfig(value: unknown): CompanionConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Partial<CompanionConfig> & { tokenHashes?: unknown };
  const baseIsValid =
    typeof config.adminPort === "number" &&
    typeof config.apiPort === "number" &&
    Array.isArray(config.libraryRoots) &&
    config.libraryRoots.every((root) => typeof root === "string") &&
    typeof config.serverId === "string";
  if (!baseIsValid) return null;

  if (
    config.configVersion === 2 &&
    Array.isArray(config.tokens) &&
    config.tokens.every(isToken) &&
    (config.adminPassword === undefined || isPasswordVerifier(config.adminPassword))
  ) {
    return config as CompanionConfig;
  }

  if (
    Array.isArray(config.tokenHashes) &&
    config.tokenHashes.every((hash) => typeof hash === "string")
  ) {
    return {
      adminPort: config.adminPort!,
      apiPort: config.apiPort!,
      configVersion: 2,
      libraryRoots: config.libraryRoots as string[],
      serverId: config.serverId!,
      tokens: config.tokenHashes.map((hash, index) => ({
        createdAt: new Date(0).toISOString(),
        hash,
        id: `legacy-${index + 1}`,
        label: `Legacy paired device ${index + 1}`,
        scopes: [...ALL_TOKEN_SCOPES],
      })),
    };
  }

  return null;
}

export async function loadConfig(): Promise<CompanionConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    const config = normalizeConfig(parsed);
    if (!config) return defaultConfig();
    if (
      !("configVersion" in (parsed as object)) ||
      "tokenHashes" in (parsed as object)
    ) {
      await saveConfig(config);
    }
    return config;
  } catch {
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: CompanionConfig) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function getDataDirectory() {
  return dataDirectory;
}
