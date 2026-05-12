export function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function extractList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.list)) return raw.data.list;
  if (Array.isArray(raw?.data?.rows)) return raw.data.rows;
  if (Array.isArray(raw?.data?.data)) return raw.data.data;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

function isPhoneLike(value) {
  const text = String(value || "").trim();
  return /^1\d{2}\*+\d{4}$/.test(text) || /^1\d{10}$/.test(text);
}

function pickMasterFromRepairKeys(item) {
  const preferredTypes = ["其他类型", "维修", "师傅", "工程师", "整备"];
  const keyAllowList = ["repair", "master", "engineer", "technician"];

  for (const [key, value] of Object.entries(item || {})) {
    const lowerKey = String(key).toLowerCase();
    if (!keyAllowList.some((k) => lowerKey.includes(k))) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const name = value.name_text || value.name || "";
    const typeText = String(value.type_text || "");
    if (!name || isPhoneLike(name)) continue;

    if (!typeText || preferredTypes.some((k) => typeText.includes(k))) {
      return name;
    }
  }

  return "";
}

function pickMasterName(item) {
  const repairChannelName = String(item.repair_channel?.name || item.repairChannel?.name || "").trim();
  if (repairChannelName && !isPhoneLike(repairChannelName)) return repairChannelName;

  const fromRepairKeys = pickMasterFromRepairKeys(item);
  if (fromRepairKeys) return fromRepairKeys;

  const candidates = [
    item.repair_user?.name_text,
    item.repair_user?.name,
    item.master?.name_text,
    item.master?.name,
    item.engineer?.name_text,
    item.engineer?.name,
    item.from_repair_user?.name_text,
    item.from_repair_user?.name
  ];

  const firstValid = candidates.find((v) => v && !isPhoneLike(v));
  return firstValid || "未分配";
}

function pickTypeText(item) {
  return item.type_text || item.repair_user?.type_text || item.type?.name_text || "-";
}

function pickIsRework(item) {
  return Boolean(item.is_rework ?? item.isRework ?? item.rework_flag ?? item.reworkFlag ?? false);
}

function pickIdentifier(item) {
  return (
    item.imei ||
    item.imei1 ||
    item.sn ||
    item.serial_no ||
    item.serialNo ||
    item.product_no ||
    item.productNo ||
    item.device_no ||
    item.deviceNo ||
    "-"
  );
}

function calcRepairDays(item) {
  const direct = toNumber(item.repair_days ?? item.repairDays);
  if (direct > 0) return direct;

  const startText = item.create_time || item.createTime || item.success_time || item.successTime;
  const startAt = startText ? new Date(startText.replace(" ", "T")) : null;
  if (startAt && !Number.isNaN(startAt.getTime())) {
    const now = new Date();
    const startDate = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = nowDate.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    return Math.max(0, diffDays);
  }

  return toNumber(item.stock_time_text ?? item.warehouse_time_text ?? 0);
}

export function normalizeRows(list, warningDays) {
  return list.map((item, index) => {
    const days = calcRepairDays(item);
    const master = pickMasterName(item);

    return {
      id: item.id ?? `${master}-${index}`,
      master,
      productName: item.product?.name || item.name || "-",
      productNo: item.product_no || item.productNo || "",
      outsideLogId: item.outside_log_id || item.outsideLogId || null,
      repairChannelId: item.repair_channel_id || item.repairChannelId || "",
      repairCharge: item.repair_charge || item.repairCharge || "0",
      identifier: pickIdentifier(item),
      isRework: pickIsRework(item),
      typeText: pickTypeText(item),
      statusText: item.status_text || "-",
      stockStatusText: item.stock_status_text || "-",
      nextStatusText: item.next_status_text || "-",
      days,
      isWarning: days > warningDays
    };
  });
}

export function groupByMaster(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.master)) {
      map.set(row.master, {
        master: row.master,
        total: 0,
        warningCount: 0,
        items: []
      });
    }
    const group = map.get(row.master);
    group.total += 1;
    if (row.isWarning) group.warningCount += 1;
    group.items.push(row);
  });

  const groups = [...map.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      if (Boolean(a.isRework) !== Boolean(b.isRework)) {
        return Number(Boolean(b.isRework)) - Number(Boolean(a.isRework));
      }
      return b.days - a.days || String(a.identifier).localeCompare(String(b.identifier));
    })
  }));

  return groups.sort((a, b) => b.warningCount - a.warningCount || b.total - a.total);
}

export function buildSummary(rows, groups) {
  return {
    total: rows.length,
    warning: rows.filter((row) => row.isWarning).length,
    masters: groups.length
  };
}
