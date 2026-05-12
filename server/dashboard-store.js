import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const defaultStorePath = path.resolve(process.cwd(), "server-data", "dashboard-records.json");
const storePath = path.resolve(config.dashboardStorePath || defaultStorePath);

function ensureDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyStore() {
  return {
    schemaVersion: 1,
    migration: {
      localStorageImportedAt: null,
      importedBy: null,
      migrationKey: null
    },
    submissionLedger: [],
    amountLedger: [],
    poolItems: [],
    manualReworkMap: {},
    updatedAt: null
  };
}

function normalizeStore(raw) {
  const base = emptyStore();
  const src = raw && typeof raw === "object" ? raw : {};

  const submissionLedger = Array.isArray(src.submissionLedger) ? src.submissionLedger : [];
  const amountLedger = Array.isArray(src.amountLedger) ? src.amountLedger : [];
  const poolItems = Array.isArray(src.poolItems) ? src.poolItems : [];
  const manualReworkMap = src.manualReworkMap && typeof src.manualReworkMap === "object" ? src.manualReworkMap : {};

  return {
    schemaVersion: 1,
    migration: {
      localStorageImportedAt: toText(src?.migration?.localStorageImportedAt) || null,
      importedBy: toText(src?.migration?.importedBy) || null,
      migrationKey: toText(src?.migration?.migrationKey) || null
    },
    submissionLedger: submissionLedger
      .map((item) => ({
        id: toText(item?.id),
        identifier: toText(item?.identifier),
        productNo: toText(item?.productNo),
        productName: toText(item?.productName),
        master: toText(item?.master),
        repairChannelId: toText(item?.repairChannelId),
        amount: toNumber(item?.amount),
        isRework: Boolean(item?.isRework),
        remark: toText(item?.remark),
        outsideLogId: toText(item?.outsideLogId),
        submittedAt: toText(item?.submittedAt),
        submittedBy: toText(item?.submittedBy)
      }))
      .filter((item) => item.identifier || item.productNo),
    amountLedger: amountLedger
      .map((item) => ({
        id: toText(item?.id),
        identifier: toText(item?.identifier),
        productNo: toText(item?.productNo),
        master: toText(item?.master),
        isRework: Boolean(item?.isRework),
        amount: toNumber(item?.amount),
        submittedAt: toText(item?.submittedAt),
        submittedBy: toText(item?.submittedBy),
        paySourceVendor: toText(item?.paySourceVendor)
      }))
      .filter((item) => item.identifier || item.productNo),
    poolItems: poolItems
      .map((item) => ({
        id: toText(item?.id),
        identifier: toText(item?.identifier),
        productNo: toText(item?.productNo),
        productName: toText(item?.productName),
        master: toText(item?.master),
        statusText: toText(item?.statusText),
        poolStatus: toText(item?.poolStatus) || "待分货",
        submittedAt: toText(item?.submittedAt),
        updatedAt: toText(item?.updatedAt),
        updatedBy: toText(item?.updatedBy)
      }))
      .filter((item) => item.identifier || item.productNo),
    manualReworkMap: Object.fromEntries(
      Object.entries(manualReworkMap)
        .map(([k, v]) => [toText(k), { enabled: Boolean(v?.enabled ?? v), updatedAt: toText(v?.updatedAt), updatedBy: toText(v?.updatedBy) }])
        .filter(([k]) => Boolean(k))
    ),
    updatedAt: toText(src.updatedAt) || null
  };
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(storePath)) return emptyStore();
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw.trim()) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

let store = readStore();

function writeStore() {
  ensureDir();
  store.updatedAt = new Date().toISOString();
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, storePath);
}

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDashboardStore() {
  return normalizeStore(store);
}

export function getDashboardSummary() {
  return {
    migration: { ...store.migration },
    submissionLedger: [...store.submissionLedger],
    amountLedger: [...store.amountLedger],
    poolItems: [...store.poolItems],
    manualReworkMap: { ...store.manualReworkMap },
    updatedAt: store.updatedAt
  };
}

export function upsertManualRework(identifier, enabled, username) {
  const key = toText(identifier);
  if (!key) throw new Error("identifier 不能为空");
  store.manualReworkMap[key] = {
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
    updatedBy: toText(username)
  };
  writeStore();
  return store.manualReworkMap[key];
}

export function upsertPoolStatus({ identifier, productNo, poolStatus, updatedBy }) {
  const idKey = toText(identifier);
  const noKey = toText(productNo);
  const nextStatus = toText(poolStatus) || "待分货";
  if (!idKey && !noKey) throw new Error("identifier 或 productNo 至少提供一个");

  const idx = store.poolItems.findIndex((item) => (idKey && item.identifier === idKey) || (noKey && item.productNo === noKey));
  const now = new Date().toISOString();

  if (idx >= 0) {
    store.poolItems[idx] = {
      ...store.poolItems[idx],
      poolStatus: nextStatus,
      updatedAt: now,
      updatedBy: toText(updatedBy)
    };
    writeStore();
    return store.poolItems[idx];
  }

  const created = {
    id: nextId(),
    identifier: idKey,
    productNo: noKey,
    productName: "",
    master: "",
    statusText: "",
    poolStatus: nextStatus,
    submittedAt: now,
    updatedAt: now,
    updatedBy: toText(updatedBy)
  };
  store.poolItems.unshift(created);
  writeStore();
  return created;
}

export function recordSubmissions(records, username) {
  const list = Array.isArray(records) ? records : [];
  const now = new Date().toISOString();

  const dedup = new Set(store.submissionLedger.map((item) => `${item.identifier}__${item.productNo}__${item.amount}__${item.outsideLogId}`));

  let inserted = 0;
  for (const row of list) {
    const identifier = toText(row?.identifier);
    const productNo = toText(row?.productNo);
    if (!identifier && !productNo) continue;

    const submittedAt = toText(row?.submittedAt) || now;
    const amount = toNumber(row?.amount);
    const outsideLogId = toText(row?.outsideLogId);
    const key = `${identifier}__${productNo}__${amount}__${outsideLogId}`;
    if (dedup.has(key)) continue;
    dedup.add(key);

    const submission = {
      id: nextId(),
      identifier,
      productNo,
      productName: toText(row?.productName),
      master: toText(row?.master),
      repairChannelId: toText(row?.repairChannelId),
      amount,
      isRework: Boolean(row?.isRework),
      remark: toText(row?.remark),
      outsideLogId: toText(row?.outsideLogId),
      submittedAt,
      submittedBy: toText(username)
    };

    const amountRow = {
      id: nextId(),
      identifier,
      productNo,
      master: toText(row?.master),
      isRework: Boolean(row?.isRework),
      amount,
      submittedAt,
      submittedBy: toText(username),
      paySourceVendor: toText(row?.paySourceVendor)
    };

    store.submissionLedger.unshift(submission);
    store.amountLedger.unshift(amountRow);

    const poolIdx = store.poolItems.findIndex((item) => item.productNo === productNo || (identifier && item.identifier === identifier));
    if (poolIdx >= 0) {
      store.poolItems[poolIdx] = {
        ...store.poolItems[poolIdx],
        identifier,
        productNo,
        productName: toText(row?.productName),
        master: toText(row?.master),
        statusText: toText(row?.statusText),
        poolStatus: toText(store.poolItems[poolIdx].poolStatus) || "待分货",
        submittedAt,
        updatedAt: now,
        updatedBy: toText(username)
      };
    } else {
      store.poolItems.unshift({
        id: nextId(),
        identifier,
        productNo,
        productName: toText(row?.productName),
        master: toText(row?.master),
        statusText: toText(row?.statusText),
        poolStatus: "待分货",
        submittedAt,
        updatedAt: now,
        updatedBy: toText(username)
      });
    }

    inserted += 1;
  }

  if (inserted > 0) writeStore();
  return { inserted };
}

export function migrateFromLocalStorage({ migrationKey, importedBy, manualReworkMap, amountLedger, poolItems }) {
  const key = toText(migrationKey);
  if (!key) throw new Error("migrationKey 不能为空");
  if (store.migration.migrationKey === key) {
    return { migrated: false, reason: "same_migration_key" };
  }

  const now = new Date().toISOString();

  const manual = manualReworkMap && typeof manualReworkMap === "object" ? manualReworkMap : {};
  for (const [identifier, enabled] of Object.entries(manual)) {
    const id = toText(identifier);
    if (!id) continue;
    store.manualReworkMap[id] = {
      enabled: Boolean(enabled),
      updatedAt: now,
      updatedBy: toText(importedBy)
    };
  }

  const amounts = Array.isArray(amountLedger) ? amountLedger : [];
  const amountDedup = new Set(store.amountLedger.map((item) => `${item.identifier}__${item.productNo}__${item.submittedAt}__${item.amount}`));
  for (const row of amounts) {
    const identifier = toText(row?.identifier);
    const productNo = toText(row?.productNo);
    if (!identifier && !productNo) continue;
    const amount = toNumber(row?.amount);
    const submittedAt = toText(row?.submittedAt) || now;
    const k = `${identifier}__${productNo}__${submittedAt}__${amount}`;
    if (amountDedup.has(k)) continue;
    amountDedup.add(k);
    store.amountLedger.unshift({
      id: nextId(),
      identifier,
      productNo,
      master: toText(row?.master),
      isRework: Boolean(row?.isRework),
      amount,
      submittedAt,
      submittedBy: toText(importedBy),
      paySourceVendor: toText(row?.paySourceVendor)
    });
  }

  const pools = Array.isArray(poolItems) ? poolItems : [];
  for (const row of pools) {
    const identifier = toText(row?.identifier);
    const productNo = toText(row?.productNo);
    if (!identifier && !productNo) continue;
    const idx = store.poolItems.findIndex((item) => item.productNo === productNo || (identifier && item.identifier === identifier));
    const next = {
      id: nextId(),
      identifier,
      productNo,
      productName: toText(row?.productName),
      master: toText(row?.master),
      statusText: toText(row?.statusText),
      poolStatus: toText(row?.poolStatus) || "待分货",
      submittedAt: toText(row?.submittedAt) || now,
      updatedAt: now,
      updatedBy: toText(importedBy)
    };
    if (idx >= 0) {
      store.poolItems[idx] = { ...store.poolItems[idx], ...next };
    } else {
      store.poolItems.unshift(next);
    }
  }

  store.migration = {
    localStorageImportedAt: now,
    importedBy: toText(importedBy),
    migrationKey: key
  };
  writeStore();
  return { migrated: true, importedAt: now };
}
