import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const defaultStorePath = path.resolve(process.cwd(), "server-data", "post-intercepts.json");
const storePath = path.resolve(config.postInterceptStorePath || defaultStorePath);

function ensureDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeEntry(raw) {
  const imei = toText(raw?.imei);
  const interceptedAt = toText(raw?.interceptedAt);
  const reason = toText(raw?.reason);
  const sourceRecordId = toText(raw?.sourceRecordId);
  const matchedMaster = toText(raw?.matchedMaster);
  const imageUrl = toText(raw?.imageUrl);
  const createdAt = toText(raw?.createdAt);
  if (!imei || !interceptedAt || !reason) return null;
  return {
    imei,
    interceptedAt,
    reason,
    sourceRecordId,
    matchedMaster,
    imageUrl,
    createdAt: createdAt || new Date().toISOString()
  };
}

function makeDedupKey(entry) {
  return `${entry.imei}__${entry.interceptedAt}__${entry.reason}`;
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(storePath)) return { events: [], updatedAt: null };
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw.trim()) return { events: [], updatedAt: null };
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed?.events) ? parsed.events : [];
    const events = [];
    const keySet = new Set();
    for (const item of source) {
      const normalized = normalizeEntry(item);
      if (!normalized) continue;
      const key = makeDedupKey(normalized);
      if (keySet.has(key)) continue;
      keySet.add(key);
      events.push(normalized);
    }
    return {
      events,
      updatedAt: toText(parsed?.updatedAt) || null
    };
  } catch {
    return { events: [], updatedAt: null };
  }
}

let store = readStore();

function writeStore() {
  ensureDir();
  const next = {
    events: store.events,
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
  store = next;
}

export function listPostInterceptEvents() {
  return {
    events: Array.isArray(store.events) ? [...store.events] : [],
    updatedAt: store.updatedAt || null
  };
}

export function replacePostInterceptEvents(events) {
  const source = Array.isArray(events) ? events : [];
  const normalized = [];
  const keySet = new Set();

  for (const item of source) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    const key = makeDedupKey(entry);
    if (keySet.has(key)) continue;
    keySet.add(key);
    normalized.push(entry);
  }

  store = {
    events: normalized,
    updatedAt: new Date().toISOString()
  };
  writeStore();
  return listPostInterceptEvents();
}
