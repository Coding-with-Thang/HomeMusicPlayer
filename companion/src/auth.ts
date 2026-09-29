import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import type { DeviceToken, PasswordVerifier, TokenScope } from "./types.js";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);

type PairingCode = {
  attemptsRemaining: number;
  expiresAt: number;
  value: string;
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function findToken(token: string, tokens: DeviceToken[]) {
  const candidate = Buffer.from(hashToken(token), "hex");
  return tokens.find((stored) => {
    const expected = Buffer.from(stored.hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function tokenHasScope(token: DeviceToken, scope: TokenScope) {
  return token.scopes.includes(scope);
}

export async function createPasswordVerifier(password: string): Promise<PasswordVerifier> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

export async function verifyPassword(password: string, verifier: PasswordVerifier) {
  const hash = (await scryptAsync(password, Buffer.from(verifier.salt, "hex"), 32)) as Buffer;
  return hashesMatch(hash.toString("hex"), verifier.hash);
}

export function createBootstrapCode() {
  return randomBytes(12).toString("base64url");
}

type AdminSession = {
  csrfToken: string;
  expiresAt: number;
};

export class AdminSessionManager {
  private readonly sessions = new Map<string, AdminSession>();

  create() {
    const id = randomBytes(32).toString("base64url");
    const session = {
      csrfToken: randomBytes(24).toString("base64url"),
      expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    };
    this.sessions.set(id, session);
    return { id, ...session };
  }

  get(id: string | undefined) {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  delete(id: string | undefined) {
    if (id) this.sessions.delete(id);
  }
}

export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maximum = 6,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  allow(key: string) {
    const cutoff = Date.now() - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((time) => time > cutoff);
    this.attempts.set(key, recent);
    return recent.length < this.maximum;
  }

  recordFailure(key: string) {
    const recent = this.attempts.get(key) ?? [];
    recent.push(Date.now());
    this.attempts.set(key, recent);
  }

  reset(key: string) {
    this.attempts.delete(key);
  }
}

export class PairingManager {
  private activeCode: PairingCode | null = null;

  createCode() {
    this.activeCode = {
      attemptsRemaining: 6,
      expiresAt: Date.now() + PAIRING_TTL_MS,
      value: randomInt(0, 1_000_000).toString().padStart(6, "0"),
    };
    return {
      code: this.activeCode.value,
      expiresAt: new Date(this.activeCode.expiresAt).toISOString(),
    };
  }

  exchange(code: string) {
    const active = this.activeCode;
    if (!active || active.expiresAt <= Date.now() || active.attemptsRemaining <= 0) {
      this.activeCode = null;
      return null;
    }

    active.attemptsRemaining -= 1;
    const supplied = Buffer.from(code);
    const expected = Buffer.from(active.value);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    this.activeCode = null;
    return randomBytes(32).toString("base64url");
  }
}
