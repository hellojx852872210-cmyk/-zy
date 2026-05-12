import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const defaultStorePath = path.resolve(process.cwd(), "server-data", "missing-material.json");
const storePath = path.resolve(config.missingMaterialStorePath || defaultStorePath);

function ensureDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};

  for (const [identifier, rawState] of Object.entries(source)) {
    const key = String(identifier || "").trim();
    if (!key) continue;
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const history = Array.isArray(state.history) ? state.history : [];

    normalized[key] = {
      history: history
        .map((entry) => ({
          id: String(entry?.id || "").trim(),
          remark: String(entry?.remark || "").trim(),
          createdAt: String(entry?.createdAt || "").trim(),
          createdBy: String(entry?.createdBy || "").trim(),
          productName: String(entry?.productName || "").trim()
        }))
        .filter((entry) => entry.id && entry.remark),
      resolved: Boolean(state.resolved),
      resolvedAt: state.resolvedAt ? String(state.resolvedAt) : null,
      resolvedBy: state.resolvedBy ? String(state.resolvedBy) : null,
      updatedAt: String(state.updatedAt || "").trim()
    };
  }

  return normalized;
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(storePath)) return {};
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return {};
  }
}

let store = readStore();

function writeStore() {
  ensureDir();
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
}

export function listMissingMaterialByIdentifiers(allowedIdentifiers = null) {
  if (!allowedIdentifiers) return store;
  const result = {};
  for (const [identifier, state] of Object.entries(store)) {
    if (allowedIdentifiers.has(identifier)) {
      result[identifier] = state;
    }
  }
  return result;
}

export function appendMissingMaterialFeedback({ identifier, productName, remark, createdBy }) {
  const key = String(identifier || "").trim();
  if (!key) throw new Error("identifier 不能为空");

  const now = new Date().toISOString();
  const current = store[key] || { history: [], resolved: false, resolvedAt: null, resolvedBy: null, updatedAt: now };
  const history = Array.isArray(current.history) ? current.history : [];

  const nextState = {
    history: [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        remark: String(remark || "").trim(),
        createdAt: now,
        createdBy: String(createdBy || "").trim(),
        productName: String(productName || "").trim()
      },
      ...history
    ],
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    updatedAt: now
  };

  store[key] = nextState;
  writeStore();
  return nextState;
}

export function setMissingMaterialResolved({ identifier, resolved, resolvedBy }) {
  const key = String(identifier || "").trim();
  if (!key) throw new Error("identifier 不能为空");
  const current = store[key];
  if (!current) throw new Error("该机器暂无缺物料历史");

  const now = new Date().toISOString();
  const nextResolved = Boolean(resolved);
  const nextState = {
    ...current,
    resolved: nextResolved,
    resolvedAt: nextResolved ? now : null,
    resolvedBy: nextResolved ? String(resolvedBy || "").trim() : null,
    updatedAt: now
  };

  store[key] = nextState;
  writeStore();
  return nextState;
}
