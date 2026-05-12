import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const defaultStorePath = path.resolve(process.cwd(), "server-data", "imei-master-map.json");
const storePath = path.resolve(config.imeiMasterMapStorePath || defaultStorePath);

function ensureDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeImei(value) {
  const text = toText(value);
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  return digits || text;
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(storePath)) return { map: {}, updatedAt: null };
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw.trim()) return { map: {}, updatedAt: null };
    const parsed = JSON.parse(raw);
    const src = parsed?.map && typeof parsed.map === "object" ? parsed.map : {};
    const map = {};
    for (const [k, v] of Object.entries(src)) {
      const key = normalizeImei(k);
      const master = toText(v);
      if (!key || !master) continue;
      map[key] = master;
    }
    return { map, updatedAt: toText(parsed?.updatedAt) || null };
  } catch {
    return { map: {}, updatedAt: null };
  }
}

let store = readStore();

function writeStore() {
  ensureDir();
  const next = {
    map: store.map,
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
  store = next;
}

export function getImeiMasterMap() {
  return {
    map: { ...store.map },
    updatedAt: store.updatedAt || null
  };
}

export function replaceImeiMasterMap(nextMap) {
  const src = nextMap && typeof nextMap === "object" ? nextMap : {};
  const map = {};
  for (const [k, v] of Object.entries(src)) {
    const key = normalizeImei(k);
    const master = toText(v);
    if (!key || !master) continue;
    map[key] = master;
  }
  store = { map, updatedAt: new Date().toISOString() };
  writeStore();
  return getImeiMasterMap();
}
