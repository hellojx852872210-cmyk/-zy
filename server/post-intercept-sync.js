import { config } from "./config.js";
import { replacePostInterceptEvents } from "./post-intercept-store.js";
import { getImeiMasterMap } from "./imei-master-map-store.js";

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDateText(value) {
  const text = toText(value);
  if (!text) return "";
  const date = new Date(text.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString();
}

async function fetchTenantToken() {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("服务器未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
  }
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      app_id: config.feishuAppId,
      app_secret: config.feishuAppSecret
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`获取飞书 tenant token 失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (Number(payload?.code || 0) !== 0 || !payload?.tenant_access_token) {
    throw new Error(`获取飞书 tenant token 失败：${payload?.msg || "未知错误"}`);
  }

  return payload.tenant_access_token;
}

function pickFieldText(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return "";
  if (typeof fieldValue === "string" || typeof fieldValue === "number") return String(fieldValue).trim();
  if (Array.isArray(fieldValue)) {
    const first = fieldValue[0];
    if (typeof first === "string" || typeof first === "number") return String(first).trim();
    if (first && typeof first === "object") {
      return toText(first.text || first.name || first.value || first.link || first.url || first.tmp_url || first.download_url);
    }
  }
  if (typeof fieldValue === "object") {
    return toText(fieldValue.text || fieldValue.name || fieldValue.value || fieldValue.link || fieldValue.url || fieldValue.tmp_url || fieldValue.download_url);
  }
  return "";
}

function pickImageUrl(fields) {
  const values = Object.values(fields || {});
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const url = toText(item.tmp_url || item.url || item.download_url || item.link);
      if (url) return url;
    }
  }
  return "";
}

async function fetchAllRecords(tenantToken) {
  if (!config.feishuBitableAppToken || !config.feishuBitableTableId) {
    throw new Error("服务器未配置 FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID");
  }

  const all = [];
  let pageToken = "";

  while (true) {
    const params = new URLSearchParams();
    params.set("page_size", "500");
    if (config.feishuBitableViewId) params.set("view_id", config.feishuBitableViewId);
    if (pageToken) params.set("page_token", pageToken);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(config.feishuBitableAppToken)}/tables/${encodeURIComponent(config.feishuBitableTableId)}/records?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`读取飞书多维表格失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
    }

    const payload = await response.json().catch(() => ({}));
    if (Number(payload?.code || 0) !== 0) {
      throw new Error(`读取飞书多维表格失败：${payload?.msg || "未知错误"}`);
    }

    const records = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    all.push(...records);

    if (!payload?.data?.has_more) break;
    pageToken = String(payload?.data?.page_token || "");
    if (!pageToken) break;
  }

  return all;
}

export async function refreshPostInterceptEvents(masterByIdentifierMap) {
  const tenantToken = await fetchTenantToken();
  const records = await fetchAllRecords(tenantToken);
  const imeiMap = getImeiMasterMap().map || {};

  const events = [];
  let unmatchedCount = 0;

  for (const record of records) {
    const fields = record?.fields && typeof record.fields === "object" ? record.fields : {};
    const imei = pickFieldText(fields[config.feishuFieldImei]);
    const reason = pickFieldText(fields[config.feishuFieldInterceptReason]);
    const interceptedAtRaw = pickFieldText(fields[config.feishuFieldInterceptTime]);
    const interceptedAt = normalizeDateText(interceptedAtRaw);
    const imageUrl = pickImageUrl(fields);

    if (!imei || !reason || !interceptedAt) continue;

    const imeiDigits = imei.replace(/\D/g, "");
    const mappedMaster = toText(imeiMap[imeiDigits] || imeiMap[imei]);
    const matchedMaster = toText(masterByIdentifierMap.get(imei) || masterByIdentifierMap.get(imeiDigits) || mappedMaster);
    if (!matchedMaster) unmatchedCount += 1;

    events.push({
      imei,
      reason,
      interceptedAt,
      sourceRecordId: toText(record?.record_id),
      matchedMaster,
      imageUrl,
      createdAt: new Date().toISOString()
    });
  }

  const saved = replacePostInterceptEvents(events);
  return {
    totalPulled: records.length,
    totalSaved: saved.events.length,
    unmatchedCount,
    updatedAt: saved.updatedAt
  };
}
