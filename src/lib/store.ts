// A tiny file-backed store. Sideline runs as one process (one team per deploy),
// so a JSON file plus a serialized write queue is all the database it needs.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AppState } from "./types.ts";
import { seedState } from "./seed.ts";

const DATA_DIR = process.env.SIDELINE_DATA_DIR || join(process.cwd(), ".data");
const FILE = join(DATA_DIR, "state.json");

interface StoreGlobal {
  __sidelineState?: AppState;
  __sidelineQueue?: Promise<unknown>;
}
const g = globalThis as unknown as StoreGlobal;

function load(): AppState {
  if (g.__sidelineState) return g.__sidelineState;
  if (existsSync(FILE)) {
    try {
      g.__sidelineState = JSON.parse(readFileSync(FILE, "utf8")) as AppState;
      return g.__sidelineState;
    } catch {
      // fall through to a fresh seed if the file is unreadable
    }
  }
  g.__sidelineState = seedState();
  persist(g.__sidelineState);
  return g.__sidelineState;
}

function persist(state: AppState) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE);
}

export function readState(): AppState {
  return load();
}

/** Run a mutation with exclusive access; writes the file once it resolves. */
export function mutate<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
  const prev = g.__sidelineQueue ?? Promise.resolve();
  const next = prev.then(async () => {
    const state = load();
    const result = await fn(state);
    persist(state);
    return result;
  });
  g.__sidelineQueue = next.catch(() => undefined);
  return next;
}

export function resetState(): Promise<AppState> {
  return mutate((state) => {
    const fresh = seedState();
    Object.assign(state, fresh);
    return state;
  });
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
