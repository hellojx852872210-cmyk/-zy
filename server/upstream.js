import { config } from "./config.js";

function getHeaders() {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    authorization: config.authorization,
    version: config.version
  };
}

export async function postUpstream(path, payload = {}) {
  if (!config.authorization) {
    throw new Error("缺少 AIGJ_AUTHORIZATION，请在环境变量中配置");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`上游请求失败：HTTP ${response.status}${text ? ` - ${text}` : ""}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}
