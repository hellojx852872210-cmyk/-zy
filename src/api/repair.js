const USE_LOCAL_BACKEND = import.meta.env.VITE_USE_LOCAL_BACKEND !== "false";
const LOCAL_API_BASE_URL = import.meta.env.VITE_LOCAL_API_BASE_URL || "";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const API_PATH = import.meta.env.VITE_API_PATH || "/api/v1/repair/outside/index";
const API_AUTHORIZATION = import.meta.env.VITE_API_AUTHORIZATION || "";
const API_VERSION = import.meta.env.VITE_API_VERSION || "2026050701";

function getHeaders() {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    authorization: API_AUTHORIZATION,
    version: API_VERSION
  };
}

async function postJson(path, payload) {
  if (!API_AUTHORIZATION) {
    throw new Error("缺少 VITE_API_AUTHORIZATION，请在 .env 中配置");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`请求失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  return response.json();
}

async function localGet(path) {
  const response = await fetch(`${LOCAL_API_BASE_URL}${path}`, {
    credentials: "include"
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`本地服务请求失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }
  return response.json();
}

async function localPost(path, payload) {
  const response = await fetch(`${LOCAL_API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`本地服务请求失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  return response.json();
}

export async function fetchRepairList(payload = {}) {
  if (USE_LOCAL_BACKEND) {
    const response = await localGet("/local-api/repair/list");
    return {
      raw: response.data,
      meta: response.meta || null,
      source: "爱管机（经本地中间层缓存）"
    };
  }
  const raw = await postJson(API_PATH, payload);
  return {
    raw,
    meta: null,
    source: "爱管机直连"
  };
}

export async function loginRepairUser(username, password) {
  return localPost("/local-api/auth/login", { username, password });
}

export async function logoutRepairUser() {
  return localPost("/local-api/auth/logout", {});
}

export async function fetchCurrentUser() {
  return localGet("/local-api/auth/me");
}

export async function fetchAdminUsers() {
  return localGet("/local-api/admin/users");
}

export async function createAdminUser(payload) {
  return localPost("/local-api/admin/users", payload || {});
}

export async function submitRepairOrder(payload = {}) {
  if (USE_LOCAL_BACKEND) {
    return localPost("/local-api/repair/orders/add", payload);
  }
  return postJson("/api/v1/repair/orders/add", payload);
}

export async function fetchAdvancePaySource(payload = {}) {
  if (USE_LOCAL_BACKEND) {
    return localPost("/local-api/finance/advance_payout/pay_source", payload);
  }
  return postJson("/api/v1/finance/advance_payout/pay_source", payload);
}

export async function fetchRepairProductIndex(payload = {}) {
  if (USE_LOCAL_BACKEND) {
    return localPost("/local-api/repair/product/index", payload);
  }
  return postJson("/api/v1/repair/product/index", payload);
}

export async function submitMissingMaterialFeedback(payload = {}) {
  return localPost("/local-api/feedback/missing-material", payload);
}

export async function fetchMissingMaterialFeedback() {
  return localGet("/local-api/feedback/missing-material");
}

export async function updateMissingMaterialResolved(payload = {}) {
  return localPost("/local-api/feedback/missing-material/resolve", payload);
}

export async function fetchMasterQualityMetrics() {
  return localGet("/local-api/quality/master-metrics");
}

export async function refreshPostIntercepts() {
  return localPost("/local-api/quality/post-intercepts/refresh", {});
}

export async function fetchPostInterceptAlerts(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  const path = query.toString() ? `/local-api/quality/post-intercepts/alerts?${query.toString()}` : "/local-api/quality/post-intercepts/alerts";
  return localGet(path);
}

export async function fetchDashboardHome() {
  return localGet("/local-api/dashboard/home");
}

export async function recordDashboardSubmissions(payload = {}) {
  return localPost("/local-api/dashboard/submissions/record", payload);
}

export async function fetchManualRework() {
  return localGet("/local-api/dashboard/manual-rework");
}

export async function toggleManualRework(payload = {}) {
  return localPost("/local-api/dashboard/manual-rework/toggle", payload);
}

export async function fetchPoolItems() {
  return localGet("/local-api/dashboard/pool");
}

export async function updatePoolStatus(payload = {}) {
  return localPost("/local-api/dashboard/pool/status", payload);
}

export async function migrateLocalStorageToServer(payload = {}) {
  return localPost("/local-api/dashboard/migrate-local-storage", payload);
}

export async function fetchAdminRecords(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  const path = query.toString() ? `/local-api/admin/records?${query.toString()}` : "/local-api/admin/records";
  return localGet(path);
}
