import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { forceRefreshRepairList, getHealth, getRepairList } from "./cache.js";
import { postUpstream } from "./upstream.js";

async function postJsonUrl(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`飞书通知失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  return response.json().catch(() => ({}));
}
import { createSession, getSessionUser, clearSession, setSessionCookie, clearSessionCookie } from "./session.js";
import { createUser, hasUsers, listUsersSafe, verifyUser } from "./users.js";
import { appendMissingMaterialFeedback, listMissingMaterialByIdentifiers, setMissingMaterialResolved } from "./missing-material-store.js";
import { listPostInterceptEvents } from "./post-intercept-store.js";
import { refreshPostInterceptEvents } from "./post-intercept-sync.js";
import { replaceImeiMasterMap } from "./imei-master-map-store.js";

const postInterceptAutoSyncIntervalMs = Math.max(60000, Number(process.env.POST_INTERCEPT_AUTO_SYNC_INTERVAL_MS || 120000));
import { getDashboardSummary, migrateFromLocalStorage, recordSubmissions, upsertManualRework, upsertPoolStatus } from "./dashboard-store.js";
import { extractList, normalizeRows } from "../src/utils/transform.js";

const warningDays = Number(process.env.VITE_WARNING_DAYS || 5);

function buildRepairOrderPayloadForMasterMap(page = 1) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 45);
  const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return {
    page,
    limit: 200,
    value1: "",
    cate_id: "",
    brand_id: "",
    product_id: "",
    product_no: "",
    self_user: false,
    success_time: [toYmd(start), toYmd(end)],
    selected_attr: {},
    order_no: "",
    repair_type_id: [],
    imei: []
  };
}

const repairOrderListCache = {
  rows: [],
  updatedAt: 0,
  inFlight: null
};

const repairOrderListCacheTtlMs = 120000;

async function fetchRepairOrderListForMasterMap() {
  const all = [];
  let page = 1;

  while (true) {
    const payload = buildRepairOrderPayloadForMasterMap(page);
    const resp = await postUpstream(config.repairOrderPath, payload);
    const rows = extractList(resp);
    all.push(...rows);

    const lastPage = Number(resp?.data?.last_page || 0);
    if (!lastPage || page >= lastPage || rows.length === 0) break;
    page += 1;
  }

  return all;
}

async function refreshRepairOrderListCache() {
  if (repairOrderListCache.inFlight) return repairOrderListCache.inFlight;
  repairOrderListCache.inFlight = (async () => {
    try {
      const rows = await fetchRepairOrderListForMasterMap();
      repairOrderListCache.rows = Array.isArray(rows) ? rows : [];
      repairOrderListCache.updatedAt = Date.now();
      return repairOrderListCache.rows;
    } finally {
      repairOrderListCache.inFlight = null;
    }
  })();
  return repairOrderListCache.inFlight;
}

function getRepairOrderListCache() {
  const age = Date.now() - Number(repairOrderListCache.updatedAt || 0);
  const hasFresh = repairOrderListCache.rows.length > 0 && age <= repairOrderListCacheTtlMs;
  if (!hasFresh) {
    refreshRepairOrderListCache().catch(() => {});
  }
  return repairOrderListCache.rows;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": config.allowedOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体 JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function unauthorized(res) {
  sendJson(res, 401, { code: 401, msg: "未登录或会话已失效" });
}

function getAuthedUser(req, res) {
  const session = getSessionUser(req);
  if (!session?.user) {
    unauthorized(res);
    return null;
  }
  return session.user;
}

function filterListByUser(rawData, user) {
  if (!rawData || user.role === "admin") return rawData;

  const list = extractList(rawData);
  const normalized = normalizeRows(list, warningDays);
  const allowed = new Set(
    normalized
      .filter((row) => row.master === user.masterName)
      .map((row) => String(row.productNo || row.identifier || ""))
      .filter(Boolean)
  );

  const filteredList = list.filter((item) => {
    const productNo = String(item.product_no || item.productNo || "");
    const identifier = String(item.imei || item.imei1 || item.sn || item.serial_no || item.serialNo || item.device_no || item.deviceNo || "");
    return allowed.has(productNo) || allowed.has(identifier);
  });

  if (Array.isArray(rawData?.data?.data)) {
    return {
      ...rawData,
      data: {
        ...rawData.data,
        data: filteredList
      }
    };
  }

  if (Array.isArray(rawData?.data?.rows)) {
    return {
      ...rawData,
      data: {
        ...rawData.data,
        rows: filteredList
      }
    };
  }

  if (Array.isArray(rawData?.data?.list)) {
    return {
      ...rawData,
      data: {
        ...rawData.data,
        list: filteredList
      }
    };
  }

  if (Array.isArray(rawData?.data)) {
    return {
      ...rawData,
      data: filteredList
    };
  }

  if (Array.isArray(rawData?.rows)) {
    return {
      ...rawData,
      rows: filteredList
    };
  }

  if (Array.isArray(rawData?.list)) {
    return {
      ...rawData,
      list: filteredList
    };
  }

  if (Array.isArray(rawData)) return filteredList;
  return rawData;
}

function ensureWriteScope(payload, currentList, user) {
  if (user.role === "admin") return;

  const normalized = normalizeRows(currentList, warningDays);
  const ownProductNos = new Set(
    normalized.filter((row) => row.master === user.masterName).map((row) => String(row.productNo || "")).filter(Boolean)
  );

  const dataEntries = payload?.data && typeof payload.data === "object" ? Object.keys(payload.data) : [];
  for (const productNo of dataEntries) {
    if (!ownProductNos.has(String(productNo))) {
      throw new Error(`越权提交：机器 ${productNo} 不属于当前账号`);
    }
  }
}

function buildVisibleIdentifierSet(currentList, user) {
  if (user.role === "admin") return null;
  const normalized = normalizeRows(currentList, warningDays);
  return new Set(
    normalized
      .filter((row) => row.master === user.masterName)
      .map((row) => String(row.identifier || "").trim())
      .filter((v) => v && v !== "-")
  );
}

function assertIdentifierAccessible(identifier, visibleSet, user) {
  if (user.role === "admin") return;
  if (!visibleSet || !visibleSet.has(identifier)) {
    throw new Error("越权操作：该机器不属于当前账号");
  }
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)] || 0;
}

function toRate(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function toTimestamp(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeIdentifierKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits || raw;
}

function isPhoneLike(value) {
  const text = String(value || "").trim();
  return /^1\d{2}\*+\d{4}$/.test(text) || /^1\d{10}$/.test(text);
}

function pickExplicitMaster(item) {
  const candidates = [
    item?.repair_user?.name_text,
    item?.repair_user?.name,
    item?.master?.name_text,
    item?.master?.name,
    item?.engineer?.name_text,
    item?.engineer?.name,
    item?.from_repair_user?.name_text,
    item?.from_repair_user?.name,
    item?.last_repair_user?.name_text,
    item?.last_repair_user?.name
  ];
  const hit = candidates.find((v) => String(v || "").trim() && !isPhoneLike(v));
  return String(hit || "").trim();
}

function pickChannelMaster(item) {
  const name = String(item?.repair_channel?.name_text || item?.repair_channel?.name || "").trim();
  if (!name || isPhoneLike(name)) return "";
  return name;
}

function pickItemIdentifier(item) {
  const raw = String(item?.imei || item?.imei1 || item?.sn || item?.serial_no || item?.serialNo || item?.device_no || item?.deviceNo || "").trim();
  if (!raw) return "";
  return normalizeIdentifierKey(raw);
}

function pickItemProductNo(item) {
  return String(item?.product_no || item?.productNo || "").trim();
}

function pickItemTime(item) {
  return toTimestamp(item?.create_time || item?.createTime || item?.success_time || item?.successTime || item?.updated_at || item?.updatedAt || item?.submittedAt);
}

function buildSupplierHistoryByDevice(orderList) {
  const map = new Map();

  for (const item of Array.isArray(orderList) ? orderList : []) {
    const supplier = pickChannelMaster(item);
    if (!supplier) continue;

    const keys = [pickItemIdentifier(item), pickItemProductNo(item)].filter(Boolean);
    if (keys.length === 0) continue;

    const time = pickItemTime(item);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ supplier, time });
    }
  }

  for (const [key, list] of map.entries()) {
    list.sort((a, b) => a.time - b.time || a.supplier.localeCompare(b.supplier));
    map.set(key, list);
  }

  return map;
}

function applySupplierReworkToOutsideList(outsideList, orderList) {
  const historyMap = buildSupplierHistoryByDevice(orderList);

  return (Array.isArray(outsideList) ? outsideList : []).map((item) => {
    const supplier = pickChannelMaster(item);
    const identifierKey = pickItemIdentifier(item);
    const productNoKey = pickItemProductNo(item);

    const history = (identifierKey && historyMap.get(identifierKey)) || (productNoKey && historyMap.get(productNoKey)) || [];

    if (!supplier || history.length === 0) {
      return { ...item, is_rework: false, isRework: false };
    }

    const earliestSupplier = history[0]?.supplier || "";
    if (!earliestSupplier || earliestSupplier !== supplier) {
      return { ...item, is_rework: false, isRework: false };
    }

    const hasPriorRecord = history.some((entry, idx) => idx > 0 && entry.supplier === supplier);
    return { ...item, is_rework: hasPriorRecord, isRework: hasPriorRecord };
  });
}

function replaceDataList(rawData, nextList) {
  const list = Array.isArray(nextList) ? nextList : [];

  if (Array.isArray(rawData?.data?.data)) {
    return { ...rawData, data: { ...rawData.data, data: list } };
  }
  if (Array.isArray(rawData?.data?.rows)) {
    return { ...rawData, data: { ...rawData.data, rows: list } };
  }
  if (Array.isArray(rawData?.data?.list)) {
    return { ...rawData, data: { ...rawData.data, list } };
  }
  if (Array.isArray(rawData?.data)) {
    return { ...rawData, data: list };
  }
  if (Array.isArray(rawData?.rows)) {
    return { ...rawData, rows: list };
  }
  if (Array.isArray(rawData?.list)) {
    return { ...rawData, list };
  }
  if (Array.isArray(rawData)) return list;
  return rawData;
}

function matchesKeyword(item, keyword) {
  if (!keyword) return true;
  const text = [
    item?.identifier,
    item?.productNo,
    item?.productName,
    item?.master,
    item?.updatedBy,
    item?.submittedBy,
    item?.imei,
    item?.matchedMaster,
    item?.reason,
    item?.sourceRecordId,
    item?.imageUrl
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  return text.includes(keyword);
}

function buildAdminRecordItems(summary, tab) {
  if (tab === "amount") return Array.isArray(summary.amountLedger) ? summary.amountLedger : [];
  if (tab === "pool") return Array.isArray(summary.poolItems) ? summary.poolItems : [];
  if (tab === "rework") {
    return Object.entries(summary.manualReworkMap || {}).map(([identifier, value]) => ({
      identifier,
      enabled: Boolean(value?.enabled),
      updatedAt: value?.updatedAt || "",
      updatedBy: value?.updatedBy || ""
    }));
  }
  if (tab === "intercept") return listPostInterceptEvents().events;
  return Array.isArray(summary.submissionLedger) ? summary.submissionLedger : [];
}

function buildMasterByIdentifierMap(currentList) {
  const rows = normalizeRows(currentList, warningDays);
  const map = new Map();
  rows.forEach((row) => {
    const identifier = String(row.identifier || "").trim();
    if (!identifier || identifier === "-") return;
    const master = String(row.master || "");
    const normalizedKey = normalizeIdentifierKey(identifier);
    if (!map.has(identifier)) map.set(identifier, master);
    if (normalizedKey && !map.has(normalizedKey)) map.set(normalizedKey, master);
  });
  return map;
}

function buildInterceptAlerts(events, visibleSet, sinceTs) {
  const filtered = (Array.isArray(events) ? events : []).filter((event) => {
    const imei = String(event?.imei || "").trim();
    if (!imei) return false;
    if (visibleSet && !visibleSet.has(imei)) return false;
    const ts = toTimestamp(event?.interceptedAt || event?.createdAt);
    if (sinceTs && ts <= sinceTs) return false;
    return true;
  }).sort((a, b) => toTimestamp(b?.interceptedAt || b?.createdAt) - toTimestamp(a?.interceptedAt || a?.createdAt));

  const latestAt = filtered.length > 0 ? String(filtered[0]?.interceptedAt || filtered[0]?.createdAt || "") : "";
  return {
    total: filtered.length,
    latestAt,
    items: filtered.slice(0, 50)
  };
}

function buildMasterMetrics(rows, visibleSet, postInterceptEvents) {
  const groups = new Map();

  for (const row of rows) {
    const identifier = String(row.identifier || "").trim();
    if (!identifier || identifier === "-") continue;
    if (visibleSet && !visibleSet.has(identifier)) continue;

    const master = String(row.master || "未分配");
    if (!groups.has(master)) {
      groups.set(master, {
        master,
        totalJobs: 0,
        warningJobs: 0,
        reworkJobs: 0,
        lossJobs: 0,
        lossAmountTotal: 0,
        repairChargeTotal: 0,
        postInterceptJobs: 0,
        days: []
      });
    }

    const metric = groups.get(master);
    metric.totalJobs += 1;
    metric.days.push(Number(row.days || 0));
    if (row.isWarning) metric.warningJobs += 1;
    if (row.isRework) metric.reworkJobs += 1;

    const repairCharge = Number(String(row.repairCharge || "0").replace(/[^\d.-]/g, ""));
    metric.repairChargeTotal += Number.isFinite(repairCharge) ? repairCharge : 0;
  }

  const rowByIdentifier = new Map();
  for (const row of rows) {
    const identifier = String(row.identifier || "").trim();
    if (!identifier || identifier === "-") continue;
    if (visibleSet && !visibleSet.has(identifier)) continue;
    const normalizedKey = normalizeIdentifierKey(identifier);
    if (!rowByIdentifier.has(identifier)) rowByIdentifier.set(identifier, row);
    if (normalizedKey && !rowByIdentifier.has(normalizedKey)) rowByIdentifier.set(normalizedKey, row);
  }

  for (const event of postInterceptEvents) {
    const imei = String(event?.imei || "").trim();
    if (!imei) continue;
    if (visibleSet && !visibleSet.has(imei)) continue;
    const row = rowByIdentifier.get(imei) || rowByIdentifier.get(normalizeIdentifierKey(imei));
    if (!row) continue;
    const master = String(row.master || "未分配");
    const metric = groups.get(master);
    if (!metric) continue;
    metric.postInterceptJobs += 1;
  }

  const result = [...groups.values()].map((item) => {
    const avgDays = item.totalJobs ? item.days.reduce((sum, d) => sum + d, 0) / item.totalJobs : 0;
    const p90Days = percentile(item.days, 90);
    return {
      master: item.master,
      totalJobs: item.totalJobs,
      avgDays,
      p90Days,
      timeoutRate: toRate(item.warningJobs, item.totalJobs),
      reworkRate: toRate(item.reworkJobs, item.totalJobs),
      lossOrderRate: toRate(item.lossJobs, item.totalJobs),
      lossAmountRate: toRate(item.lossAmountTotal, item.repairChargeTotal),
      postInterceptRate: toRate(item.postInterceptJobs, item.totalJobs),
      warningJobs: item.warningJobs,
      reworkJobs: item.reworkJobs,
      postInterceptJobs: item.postInterceptJobs,
      lossJobs: item.lossJobs,
      lossAmountTotal: item.lossAmountTotal,
      repairChargeTotal: item.repairChargeTotal
    };
  });

  return result.sort((a, b) => b.postInterceptRate - a.postInterceptRate || b.timeoutRate - a.timeoutRate || b.totalJobs - a.totalJobs);
}

function buildDashboardHome(rows, visibleSet, missingMaterialMap, dashboardSummary) {
  const visibleRows = rows.filter((row) => {
    const identifier = String(row.identifier || "").trim();
    if (!identifier || identifier === "-") return false;
    if (visibleSet && !visibleSet.has(identifier)) return false;
    return true;
  });

  const manualReworkMap = dashboardSummary.manualReworkMap || {};
  const poolItems = Array.isArray(dashboardSummary.poolItems) ? dashboardSummary.poolItems : [];
  const amountLedger = Array.isArray(dashboardSummary.amountLedger) ? dashboardSummary.amountLedger : [];

  const poolByKey = new Map();
  poolItems.forEach((item) => {
    const idKey = String(item.identifier || "").trim();
    const noKey = String(item.productNo || "").trim();
    if (idKey && !poolByKey.has(idKey)) poolByKey.set(idKey, item);
    if (noKey && !poolByKey.has(noKey)) poolByKey.set(noKey, item);
  });

  const machineDetails = visibleRows.map((row) => {
    const identifier = String(row.identifier || "").trim();
    const productNo = String(row.productNo || "").trim();
    const manual = manualReworkMap[identifier];
    const pool = poolByKey.get(identifier) || poolByKey.get(productNo) || null;
    const missing = missingMaterialMap[identifier] || null;

    const latestAmount = amountLedger.find((item) => {
      const idKey = String(item.identifier || "").trim();
      const noKey = String(item.productNo || "").trim();
      return (idKey && idKey === identifier) || (noKey && noKey === productNo);
    }) || null;

    return {
      ...row,
      isRework: typeof manual?.enabled === "boolean" ? manual.enabled : row.isRework,
      poolStatus: pool?.poolStatus || "待分货",
      hasMissingMaterial: Boolean(missing && Array.isArray(missing.history) && missing.history.length > 0),
      missingMaterialResolved: Boolean(missing?.resolved),
      latestSubmittedAmount: latestAmount?.amount ?? null,
      latestSubmittedAt: latestAmount?.submittedAt || null
    };
  });

  const byMaster = new Map();
  for (const row of machineDetails) {
    const master = String(row.master || "未分配");
    if (!byMaster.has(master)) {
      byMaster.set(master, {
        master,
        totalJobs: 0,
        warningJobs: 0,
        reworkJobs: 0,
        poolPending: 0,
        missingPending: 0,
        amountTotal: 0
      });
    }
    const g = byMaster.get(master);
    g.totalJobs += 1;
    if (row.isWarning) g.warningJobs += 1;
    if (row.isRework) g.reworkJobs += 1;
    if (row.poolStatus !== "已上架") g.poolPending += 1;
    if (row.hasMissingMaterial && !row.missingMaterialResolved) g.missingPending += 1;
    g.amountTotal += Number(row.latestSubmittedAmount || 0);
  }

  const masterStats = [...byMaster.values()].sort((a, b) => b.totalJobs - a.totalJobs || b.warningJobs - a.warningJobs);

  const summaryCards = {
    totalJobs: machineDetails.length,
    warningJobs: machineDetails.filter((row) => row.isWarning).length,
    masters: masterStats.length,
    reworkJobs: machineDetails.filter((row) => row.isRework).length,
    poolPending: machineDetails.filter((row) => row.poolStatus !== "已上架").length,
    missingPending: machineDetails.filter((row) => row.hasMissingMaterial && !row.missingMaterialResolved).length,
    amountTotal: masterStats.reduce((sum, row) => sum + Number(row.amountTotal || 0), 0)
  };

  return {
    summaryCards,
    masterStats,
    machineDetails
  };
}

let postInterceptAutoSyncRunning = false;

async function runPostInterceptAutoSync() {
  if (postInterceptAutoSyncRunning) return;
  postInterceptAutoSyncRunning = true;
  try {
    const repairOrderList = await fetchRepairOrderListForMasterMap();
    const masterByIdentifierMap = buildMasterByIdentifierMap(repairOrderList);
    await refreshPostInterceptEvents(masterByIdentifierMap);
  } catch (error) {
    console.error(`[post-intercept-auto-sync] ${error?.message || "同步失败"}`);
  } finally {
    postInterceptAutoSyncRunning = false;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/local-api/health") {
      sendJson(res, 200, { code: 0, msg: "ok", data: getHealth() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/auth/login") {
      if (!hasUsers()) {
        sendJson(res, 500, { code: 500, msg: "未配置维修账号，请设置 REPAIR_USERS_JSON" });
        return;
      }
      const body = await readJsonBody(req);
      const user = verifyUser(body.username, body.password);
      if (!user) {
        sendJson(res, 401, { code: 401, msg: "账号或密码错误" });
        return;
      }
      const sid = createSession(user);
      setSessionCookie(res, sid);
      sendJson(res, 200, { code: 0, msg: "ok", data: user });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/auth/logout") {
      clearSession(req);
      clearSessionCookie(res);
      sendJson(res, 200, { code: 0, msg: "ok" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/auth/me") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      sendJson(res, 200, { code: 0, msg: "ok", data: user });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/admin/users") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可访问" });
        return;
      }
      sendJson(res, 200, { code: 0, msg: "ok", data: listUsersSafe() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/admin/users") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可新增用户" });
        return;
      }
      const payload = await readJsonBody(req);
      const created = createUser(payload || {});
      sendJson(res, 200, { code: 0, msg: "ok", data: created });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/admin/imei-master-map/replace") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可导入映射" });
        return;
      }

      const payload = await readJsonBody(req);
      const map = payload?.map && typeof payload.map === "object" ? payload.map : null;
      if (!map) {
        sendJson(res, 400, { code: 400, msg: "map 不能为空对象" });
        return;
      }

      const saved = replaceImeiMasterMap(map);
      sendJson(res, 200, {
        code: 0,
        msg: "ok",
        data: {
          total: Object.keys(saved.map || {}).length,
          updatedAt: saved.updatedAt || null
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/admin/records") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可访问" });
        return;
      }

      const tab = String(url.searchParams.get("tab") || "submission").trim();
      const keyword = String(url.searchParams.get("keyword") || "").trim().toLowerCase();
      const master = String(url.searchParams.get("master") || "").trim();
      const identifier = String(url.searchParams.get("identifier") || "").trim().toLowerCase();
      const productNo = String(url.searchParams.get("productNo") || "").trim().toLowerCase();
      const startAt = String(url.searchParams.get("startAt") || "").trim();
      const endAt = String(url.searchParams.get("endAt") || "").trim();
      const exportMode = String(url.searchParams.get("export") || "").trim() === "1";
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));

      const summary = getDashboardSummary();
      const baseItems = buildAdminRecordItems(summary, tab);
      const startTs = toTimestamp(startAt);
      const endTs = toTimestamp(endAt);

      const filtered = baseItems.filter((item) => {
        if (!matchesKeyword(item, keyword)) return false;

        const masterField = tab === "intercept" ? String(item?.matchedMaster || "") : String(item?.master || "");
        if (master && masterField !== master) return false;

        const identifierField = tab === "intercept" ? String(item?.imei || "") : String(item?.identifier || "");
        if (identifier && !identifierField.toLowerCase().includes(identifier)) return false;

        if (productNo && !String(item?.productNo || "").toLowerCase().includes(productNo)) return false;

        const timeText = tab === "intercept"
          ? String(item?.interceptedAt || item?.createdAt || "")
          : String(item?.submittedAt || item?.updatedAt || "");
        const ts = toTimestamp(timeText);
        if (startTs && ts && ts < startTs) return false;
        if (endTs && ts && ts > endTs) return false;
        return true;
      });

      const sorted = [...filtered].sort((a, b) => {
        const ta = tab === "intercept" ? toTimestamp(a?.interceptedAt || a?.createdAt) : toTimestamp(a?.submittedAt || a?.updatedAt);
        const tb = tab === "intercept" ? toTimestamp(b?.interceptedAt || b?.createdAt) : toTimestamp(b?.submittedAt || b?.updatedAt);
        return tb - ta;
      });

      if (exportMode) {
        sendJson(res, 200, {
          code: 0,
          msg: "ok",
          data: {
            items: sorted,
            total: sorted.length,
            page: 1,
            pageSize: sorted.length,
            tab
          }
        });
        return;
      }

      const start = (page - 1) * pageSize;
      const items = sorted.slice(start, start + pageSize);

      sendJson(res, 200, {
        code: 0,
        msg: "ok",
        data: {
          items,
          total: sorted.length,
          page,
          pageSize,
          tab
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/repair/list") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const result = await getRepairList();
      const outsideList = extractList(result.data);
      const orderList = getRepairOrderListCache();
      const withSupplierRework = applySupplierReworkToOutsideList(outsideList, orderList);
      const mergedData = replaceDataList(result.data, withSupplierRework);
      const scoped = filterListByUser(mergedData, user);
      sendJson(res, 200, { code: 0, msg: "ok", data: scoped, meta: result.meta });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/repair/list/refresh") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可刷新缓存" });
        return;
      }
      const payload = await readJsonBody(req);
      const result = await forceRefreshRepairList(payload);
      sendJson(res, 200, { code: 0, msg: "ok", data: result.data, meta: result.meta });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/repair/orders/add") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const current = await getRepairList();
      ensureWriteScope(payload, extractList(current.data), user);
      const data = await postUpstream("/api/v1/repair/orders/add", payload);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/finance/advance_payout/pay_source") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const data = await postUpstream("/api/v1/finance/advance_payout/pay_source", payload);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/repair/product/index") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const current = await getRepairList();
      const currentList = extractList(current.data);
      if (user.role !== "admin") {
        const normalized = normalizeRows(currentList, warningDays);
        const ownProductNos = new Set(normalized.filter((row) => row.master === user.masterName).map((row) => String(row.productNo || "")).filter(Boolean));
        const reqProductNos = Array.isArray(payload?.product_no) ? payload.product_no.map((v) => String(v)) : [];
        if (reqProductNos.some((v) => !ownProductNos.has(v))) {
          sendJson(res, 403, { code: 403, msg: "越权查询：包含非本人机器" });
          return;
        }
      }
      const data = await postUpstream("/api/v1/repair/product/index", payload);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/feedback/missing-material") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const current = await getRepairList();
      const visibleSet = buildVisibleIdentifierSet(extractList(current.data), user);
      const data = listMissingMaterialByIdentifiers(visibleSet);
      sendJson(res, 200, { code: 0, msg: "ok", data });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/feedback/missing-material") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const productName = String(payload?.productName || "").trim();
      const identifier = String(payload?.identifier || "").trim();
      const remark = String(payload?.remark || "").trim();

      if (!productName) {
        sendJson(res, 400, { code: 400, msg: "productName 不能为空" });
        return;
      }
      if (!identifier) {
        sendJson(res, 400, { code: 400, msg: "identifier 不能为空" });
        return;
      }
      if (!remark) {
        sendJson(res, 400, { code: 400, msg: "remark 不能为空" });
        return;
      }

      const current = await getRepairList();
      const visibleSet = buildVisibleIdentifierSet(extractList(current.data), user);
      assertIdentifierAccessible(identifier, visibleSet, user);

      const state = appendMissingMaterialFeedback({
        identifier,
        productName,
        remark,
        createdBy: user.username
      });

      const nowText = new Date().toLocaleString("zh-CN", { hour12: false });
      const text = [
        "【缺物料反馈】",
        `机器型号：${productName}`,
        `串码：${identifier}`,
        `备注：${remark}`,
        `提交人：${user.username}`,
        `时间：${nowText}`
      ].join("\n");

      let webhookStatus = "skipped";
      let webhookMsg = "";

      if (config.feishuWebhookUrl) {
        try {
          const feishuResp = await postJsonUrl(config.feishuWebhookUrl, {
            msg_type: "text",
            content: {
              text
            }
          });
          if (Number(feishuResp?.code || 0) !== 0) {
            webhookStatus = "failed";
            webhookMsg = `飞书返回失败：${feishuResp?.msg || "未知错误"}`;
          } else {
            webhookStatus = "sent";
          }
        } catch (error) {
          webhookStatus = "failed";
          webhookMsg = error?.message || "飞书发送失败";
        }
      }

      sendJson(res, 200, { code: 0, msg: "ok", data: { identifier, state, webhookStatus, webhookMsg } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/feedback/missing-material/resolve") {
      const user = getAuthedUser(req, res);
      if (!user) return;

      const payload = await readJsonBody(req);
      const identifier = String(payload?.identifier || "").trim();
      const resolved = Boolean(payload?.resolved);

      if (!identifier) {
        sendJson(res, 400, { code: 400, msg: "identifier 不能为空" });
        return;
      }

      const current = await getRepairList();
      const visibleSet = buildVisibleIdentifierSet(extractList(current.data), user);
      assertIdentifierAccessible(identifier, visibleSet, user);

      const state = setMissingMaterialResolved({
        identifier,
        resolved,
        resolvedBy: user.username
      });

      sendJson(res, 200, { code: 0, msg: "ok", data: { identifier, state } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/dashboard/home") {
      const user = getAuthedUser(req, res);
      if (!user) return;

      const current = await getRepairList();
      const currentList = extractList(current.data);
      const rows = normalizeRows(currentList, warningDays);
      const visibleSet = buildVisibleIdentifierSet(currentList, user);
      const missingMaterialMap = listMissingMaterialByIdentifiers(visibleSet);
      const dashboardSummary = getDashboardSummary();
      const data = buildDashboardHome(rows, visibleSet, missingMaterialMap, dashboardSummary);
      sendJson(res, 200, { code: 0, msg: "ok", data, migration: dashboardSummary.migration });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/dashboard/submissions/record") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const records = Array.isArray(payload?.records) ? payload.records : [];

      const current = await getRepairList();
      const currentList = extractList(current.data);
      if (user.role !== "admin") {
        const visibleSet = buildVisibleIdentifierSet(currentList, user);
        for (const row of records) {
          const identifier = String(row?.identifier || "").trim();
          if (!identifier) continue;
          assertIdentifierAccessible(identifier, visibleSet, user);
        }
      }

      const result = recordSubmissions(records, user.username);
      sendJson(res, 200, { code: 0, msg: "ok", data: result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/dashboard/manual-rework") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const current = await getRepairList();
      const currentList = extractList(current.data);
      const visibleSet = buildVisibleIdentifierSet(currentList, user);
      const allMap = getDashboardSummary().manualReworkMap;
      if (user.role === "admin") {
        sendJson(res, 200, { code: 0, msg: "ok", data: allMap });
        return;
      }
      const scoped = {};
      for (const [identifier, value] of Object.entries(allMap)) {
        if (visibleSet && visibleSet.has(identifier)) {
          scoped[identifier] = value;
        }
      }
      sendJson(res, 200, { code: 0, msg: "ok", data: scoped });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/dashboard/manual-rework/toggle") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const identifier = String(payload?.identifier || "").trim();
      const enabled = Boolean(payload?.enabled);
      if (!identifier) {
        sendJson(res, 400, { code: 400, msg: "identifier 不能为空" });
        return;
      }

      const current = await getRepairList();
      const visibleSet = buildVisibleIdentifierSet(extractList(current.data), user);
      assertIdentifierAccessible(identifier, visibleSet, user);

      const state = upsertManualRework(identifier, enabled, user.username);
      sendJson(res, 200, { code: 0, msg: "ok", data: { identifier, state } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/dashboard/pool") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const current = await getRepairList();
      const currentList = extractList(current.data);
      const visibleSet = buildVisibleIdentifierSet(currentList, user);
      const poolItems = getDashboardSummary().poolItems;
      if (user.role === "admin") {
        sendJson(res, 200, { code: 0, msg: "ok", data: poolItems });
        return;
      }
      const scoped = poolItems.filter((item) => {
        const identifier = String(item.identifier || "").trim();
        return visibleSet && identifier && visibleSet.has(identifier);
      });
      sendJson(res, 200, { code: 0, msg: "ok", data: scoped });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/dashboard/pool/status") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可更新分货池状态" });
        return;
      }
      const payload = await readJsonBody(req);
      const state = upsertPoolStatus({
        identifier: payload?.identifier,
        productNo: payload?.productNo,
        poolStatus: payload?.poolStatus,
        updatedBy: user.username
      });
      sendJson(res, 200, { code: 0, msg: "ok", data: state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/dashboard/migrate-local-storage") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = await readJsonBody(req);
      const migrationKey = String(payload?.migrationKey || "").trim();
      if (!migrationKey) {
        sendJson(res, 400, { code: 400, msg: "migrationKey 不能为空" });
        return;
      }

      const result = migrateFromLocalStorage({
        migrationKey,
        importedBy: user.username,
        manualReworkMap: payload?.manualReworkMap,
        amountLedger: payload?.amountLedger,
        poolItems: payload?.poolItems
      });
      sendJson(res, 200, { code: 0, msg: "ok", data: result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/quality/master-metrics") {
      const user = getAuthedUser(req, res);
      if (!user) return;

      const current = await getRepairList();
      const currentList = extractList(current.data);
      const rows = normalizeRows(currentList, warningDays);
      const visibleSet = buildVisibleIdentifierSet(currentList, user);
      const postInterceptEvents = listPostInterceptEvents().events;
      const metrics = buildMasterMetrics(rows, visibleSet, postInterceptEvents);
      sendJson(res, 200, { code: 0, msg: "ok", data: metrics });
      return;
    }

    if (req.method === "GET" && url.pathname === "/local-api/quality/post-intercepts/alerts") {
      const user = getAuthedUser(req, res);
      if (!user) return;

      const since = String(url.searchParams.get("since") || "").trim();
      const sinceTs = toTimestamp(since);

      const current = await getRepairList();
      const currentList = extractList(current.data);
      const visibleSet = buildVisibleIdentifierSet(currentList, user);
      const eventStore = listPostInterceptEvents();
      const data = buildInterceptAlerts(eventStore.events, visibleSet, sinceTs);
      sendJson(res, 200, { code: 0, msg: "ok", data: { ...data, updatedAt: eventStore.updatedAt || null } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/local-api/quality/post-intercepts/refresh") {
      const user = getAuthedUser(req, res);
      if (!user) return;
      if (user.role !== "admin") {
        sendJson(res, 403, { code: 403, msg: "仅管理员可同步后验拦截数据" });
        return;
      }

      const repairOrderList = await fetchRepairOrderListForMasterMap();
      const masterByIdentifierMap = buildMasterByIdentifierMap(repairOrderList);

      const summary = await refreshPostInterceptEvents(masterByIdentifierMap);
      sendJson(res, 200, { code: 0, msg: "ok", data: summary });
      return;
    }

    sendJson(res, 404, { code: 404, msg: "Not Found" });
  } catch (error) {
    const message = error.message || "服务异常";
    const isForbidden = /越权/.test(message);
    sendJson(res, isForbidden ? 403 : 500, { code: isForbidden ? 403 : 500, msg: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`local backend ready at http://${config.host}:${config.port}`);
  refreshRepairOrderListCache().catch(() => {});
  runPostInterceptAutoSync();
  setInterval(runPostInterceptAutoSync, postInterceptAutoSyncIntervalMs);
  setInterval(() => {
    refreshRepairOrderListCache().catch(() => {});
  }, repairOrderListCacheTtlMs);
});
