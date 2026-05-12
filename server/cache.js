import { config } from "./config.js";
import { postUpstream } from "./upstream.js";

function buildDefaultPayload() {
  return {
    page: 1,
    limit: 1000,
    value1: "",
    cate_id: "",
    brand_id: "",
    product_id: "",
    channel_id: "",
    product_no: "",
    selected_attr: {}
  };
}

const state = {
  data: null,
  updatedAt: 0,
  inFlight: null,
  lastLatencyMs: 0,
  refreshOkCount: 0,
  refreshFailCount: 0,
  lastError: ""
};

function now() {
  return Date.now();
}

function buildMeta(cache) {
  const ageMs = state.updatedAt ? now() - state.updatedAt : null;
  const expiresAt = state.updatedAt ? state.updatedAt + config.freshTtlMs : null;
  return {
    cache,
    cachedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    ageMs,
    upstreamLatencyMs: state.lastLatencyMs,
    refreshOkCount: state.refreshOkCount,
    refreshFailCount: state.refreshFailCount,
    lastError: state.lastError
  };
}

function getCacheState() {
  if (!state.data || !state.updatedAt) return "EMPTY";
  const ageMs = now() - state.updatedAt;
  if (ageMs <= config.freshTtlMs) return "HIT";
  if (ageMs <= config.staleTtlMs) return "STALE";
  return "EXPIRED";
}

async function refreshRepairList(payload = buildDefaultPayload()) {
  if (state.inFlight) return state.inFlight;

  state.inFlight = (async () => {
    const startedAt = now();
    try {
      const data = await postUpstream(config.repairPath, payload);
      state.data = data;
      state.updatedAt = now();
      state.lastLatencyMs = state.updatedAt - startedAt;
      state.refreshOkCount += 1;
      state.lastError = "";
      return data;
    } catch (error) {
      state.refreshFailCount += 1;
      state.lastError = error.message || "刷新失败";
      throw error;
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
}

export async function getRepairList({ forceRefresh = false, payload = buildDefaultPayload() } = {}) {
  const cacheState = getCacheState();

  if (forceRefresh || cacheState === "EMPTY" || cacheState === "EXPIRED") {
    const data = await refreshRepairList(payload);
    return { data, meta: buildMeta("MISS") };
  }

  if (cacheState === "HIT") {
    return { data: state.data, meta: buildMeta("HIT") };
  }

  refreshRepairList(payload).catch(() => {});
  return { data: state.data, meta: buildMeta("STALE") };
}

export async function forceRefreshRepairList(payload = buildDefaultPayload()) {
  const data = await refreshRepairList(payload);
  return { data, meta: buildMeta("MISS") };
}

export function getHealth() {
  return {
    ok: true,
    upstreamConfigured: Boolean(config.authorization),
    cache: buildMeta(getCacheState())
  };
}
