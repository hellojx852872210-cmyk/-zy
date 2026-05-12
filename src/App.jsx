import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createAdminUser, fetchAdminRecords, fetchAdminUsers, fetchAdvancePaySource, fetchCurrentUser, fetchDashboardHome, fetchManualRework, fetchMasterQualityMetrics, fetchMissingMaterialFeedback, fetchPoolItems, fetchPostInterceptAlerts, fetchRepairList, fetchRepairProductIndex, loginRepairUser, logoutRepairUser, migrateLocalStorageToServer, recordDashboardSubmissions, refreshPostIntercepts, submitMissingMaterialFeedback, submitRepairOrder, toggleManualRework as toggleManualReworkApi, updateMissingMaterialResolved, updatePoolStatus } from "./api/repair";
import { extractList, groupByMaster, normalizeRows } from "./utils/transform";
import reworkBaseline from "./data/rework-baseline.json";

const warningDays = Number(import.meta.env.VITE_WARNING_DAYS || 5);
const refreshIntervalMs = 120000;
const maxRefreshIntervalMs = 300000;

export default function App() {
  const [rawRows, setRawRows] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMaster, setSelectedMaster] = useState("ALL");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [dataSourceText, setDataSourceText] = useState("--");
  const [cacheStateText, setCacheStateText] = useState("--");
  const [backendSyncedAt, setBackendSyncedAt] = useState("");
  const [tokenAlert, setTokenAlert] = useState("");
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "master", masterName: "" });
  const [userFormError, setUserFormError] = useState("");
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const isAdmin = currentUser?.role === "admin";
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [scannedCodes, setScannedCodes] = useState([]);
  const [manualReworkMap, setManualReworkMap] = useState({});
  const [poolItems, setPoolItems] = useState([]);
  const [amountLedger, setAmountLedger] = useState([]);
  const [missingMaterialMap, setMissingMaterialMap] = useState({});
  const [missingHistoryExpandedMap, setMissingHistoryExpandedMap] = useState({});
  const [qualityMetrics, setQualityMetrics] = useState([]);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState("");
  const [postInterceptNotice, setPostInterceptNotice] = useState("");
  const [postInterceptLatestAt, setPostInterceptLatestAt] = useState("");
  const [recordTab, setRecordTab] = useState("submission");
  const [recordFilters, setRecordFilters] = useState({ keyword: "", identifier: "", productNo: "", master: "", startAt: "", endAt: "", page: 1, pageSize: 20 });
  const [recordItems, setRecordItems] = useState([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [expandedInterceptReasons, setExpandedInterceptReasons] = useState({});
  const [showSubmitPanel, setShowSubmitPanel] = useState(false);
  const [submitItems, setSubmitItems] = useState([]);
  const [submitRemark, setSubmitRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [scanNotice, setScanNotice] = useState("");
  const loadingRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const refreshDelayRef = useRef(refreshIntervalMs);
  const postInterceptLatestRef = useRef("");

  const loadData = async (force = false) => {
    if (!force) {
      if (loadingRef.current || document.hidden) return;
    }

    const startedAt = Date.now();
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const payload = {
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
      const [repairResp, manualResp] = await Promise.all([
        fetchRepairList(payload),
        fetchManualRework().catch(() => ({ data: {} }))
      ]);
      const raw = repairResp.raw;
      const list = extractList(raw);
      const rows = normalizeRows(list, warningDays);
      const manualMap = manualResp?.data && typeof manualResp.data === "object" ? manualResp.data : {};
      setManualReworkMap(manualMap);
      const reworkSet = new Set((reworkBaseline.identifiers || []).map((v) => String(v).trim()));
      const pendingRows = rows.filter((row) => {
        const outsideLogId = row.outsideLogId;
        if (outsideLogId === null || outsideLogId === undefined) return true;
        return String(outsideLogId).trim() === "";
      });
      const markedRows = pendingRows.map((row) => {
        const key = String(row.identifier || "").trim();
        const baselineRework = row.identifier !== "-" && reworkSet.has(key);
        const chargeRework = Number(row.repairCharge || 0) > 0;
        const manualState = manualMap?.[key];
        const hasManualOverride = typeof manualState?.enabled === "boolean";
        const manualRework = Boolean(manualState?.enabled);
        return {
          ...row,
          isRework: hasManualOverride ? manualRework : (baselineRework || chargeRework)
        };
      });
      const grouped = groupByMaster(markedRows);
      setRawRows(markedRows);
      setGroups(grouped);
      setLastUpdatedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setDataSourceText(repairResp.source || "--");
      setCacheStateText(repairResp.meta?.cache || "--");
      setBackendSyncedAt(repairResp.meta?.cachedAt ? new Date(repairResp.meta.cachedAt).toLocaleString("zh-CN", { hour12: false }) : "");

      const lastError = String(repairResp.meta?.lastError || "");
      const isTokenFailure = /authorization|401|403|token|未登录|无权限|认证/i.test(lastError);
      setTokenAlert(isTokenFailure ? `爱管机鉴权可能失效：${lastError}` : "");

      const elapsed = Date.now() - startedAt;
      refreshDelayRef.current = elapsed > 5000
        ? Math.min(maxRefreshIntervalMs, refreshDelayRef.current + 60000)
        : refreshIntervalMs;
    } catch (e) {
      setError(e.message || "加载失败");
      refreshDelayRef.current = Math.min(maxRefreshIntervalMs, refreshDelayRef.current + 60000);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    let stopped = false;

    const scheduleNext = () => {
      if (stopped || !currentUser) return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(async () => {
        await loadData(false);
        scheduleNext();
      }, refreshDelayRef.current);
    };

    if (currentUser) {
      loadData(true).finally(scheduleNext);
    }

    const onVisible = () => {
      if (!document.hidden && currentUser) {
        refreshDelayRef.current = refreshIntervalMs;
        loadData(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentUser]);

  const maybeMigrateLocalStorage = async (user) => {
    if (!user?.username) return;
    const migrationKey = `local-storage-${user.username}-v1`;
    const markerKey = `dashboard-migrated:${user.username}`;
    if (localStorage.getItem(markerKey) === migrationKey) return;

    let manualReworkMapPayload = {};
    let amountLedgerPayload = [];
    let poolItemsPayload = [];

    try {
      const raw = localStorage.getItem(`manual-rework-map:${user.username}`);
      manualReworkMapPayload = raw ? JSON.parse(raw) : {};
    } catch {
      manualReworkMapPayload = {};
    }

    try {
      const raw = localStorage.getItem(`repair-amount-ledger:${user.username}`);
      amountLedgerPayload = raw ? JSON.parse(raw) : [];
    } catch {
      amountLedgerPayload = [];
    }

    try {
      const raw = localStorage.getItem(`pool-items:${user.username}`);
      poolItemsPayload = raw ? JSON.parse(raw) : [];
    } catch {
      poolItemsPayload = [];
    }

    const hasPayload = Object.keys(manualReworkMapPayload || {}).length > 0
      || (Array.isArray(amountLedgerPayload) && amountLedgerPayload.length > 0)
      || (Array.isArray(poolItemsPayload) && poolItemsPayload.length > 0);

    if (!hasPayload) {
      localStorage.setItem(markerKey, migrationKey);
      return;
    }

    const resp = await migrateLocalStorageToServer({
      migrationKey,
      manualReworkMap: manualReworkMapPayload,
      amountLedger: amountLedgerPayload,
      poolItems: poolItemsPayload
    });

    if (Number(resp?.code || 0) !== 0) {
      throw new Error(resp?.msg || "历史迁移失败");
    }

    localStorage.setItem(markerKey, migrationKey);
  };

  useEffect(() => {
    let mounted = true;
    fetchCurrentUser()
      .then(async (resp) => {
        if (!mounted) return;
        const user = resp.data || null;
        setCurrentUser(user);
        if (user) {
          await maybeMigrateLocalStorage(user).catch(() => {});
        }
      })
      .catch(() => {
        if (!mounted) return;
        setCurrentUser(null);
      })
      .finally(() => {
        if (!mounted) return;
        setAuthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUser?.username) {
      setManualReworkMap({});
      setPoolItems([]);
      setAmountLedger([]);
      setMissingMaterialMap({});
      setMissingHistoryExpandedMap({});
      return;
    }

    Promise.all([fetchManualRework(), fetchPoolItems(), fetchDashboardHome()])
      .then(([manualResp, poolResp, homeResp]) => {
        setManualReworkMap(manualResp?.data && typeof manualResp.data === "object" ? manualResp.data : {});
        setPoolItems(Array.isArray(poolResp?.data) ? poolResp.data : []);
        const machineDetails = Array.isArray(homeResp?.data?.machineDetails) ? homeResp.data.machineDetails : [];
        setAmountLedger(
          machineDetails
            .filter((item) => item.latestSubmittedAmount !== null && item.latestSubmittedAmount !== undefined)
            .map((item) => ({
              identifier: item.identifier,
              productNo: item.productNo,
              master: item.master,
              isRework: Boolean(item.isRework),
              amount: Number(item.latestSubmittedAmount || 0),
              submittedAt: item.latestSubmittedAt || "",
              paySourceVendor: ""
            }))
        );
      })
      .catch(() => {
        setManualReworkMap({});
        setPoolItems([]);
        setAmountLedger([]);
      });

    setMissingHistoryExpandedMap({});
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.masterName || currentUser?.role === "admin") {
      setSelectedMaster("ALL");
      return;
    }
    setSelectedMaster(currentUser.masterName);
  }, [currentUser]);

  const masters = useMemo(() => groups.map((g) => g.master), [groups]);

  const visibleGroups = useMemo(() => {
    if (!currentUser) return [];
    if (!isAdmin) {
      return groups.filter((g) => g.master === currentUser.masterName);
    }
    if (selectedMaster === "ALL") return groups;
    return groups.filter((g) => g.master === selectedMaster);
  }, [groups, selectedMaster, currentUser, isAdmin]);

  const visibleSummary = useMemo(() => {
    const total = visibleGroups.reduce((sum, g) => sum + g.total, 0);
    const warning = visibleGroups.reduce((sum, g) => sum + g.warningCount, 0);
    return {
      total,
      warning,
      masters: visibleGroups.length
    };
  }, [visibleGroups]);

  const allVisibleItems = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);

  const visibleItemByIdentifier = useMemo(() => {
    const map = new Map();
    allVisibleItems.forEach((item) => {
      const key = String(item.identifier || "");
      if (!key || key === "-") return;
      if (!map.has(key)) map.set(key, item);
    });
    return map;
  }, [allVisibleItems]);

  const matchedItems = useMemo(() => {
    const map = new Map();
    scannedCodes.forEach((identifier) => {
      const exact = visibleItemByIdentifier.get(identifier);
      if (!exact) return;
      const k = String(exact.productNo || exact.id || exact.identifier);
      if (!map.has(k)) map.set(k, exact);
    });
    return [...map.values()];
  }, [visibleItemByIdentifier, scannedCodes]);

  const scanCandidates = useMemo(() => {
    const query = String(scanInput || "").trim();
    if (query.length < 4) return [];
    return allVisibleItems
      .filter((item) => String(item.identifier).includes(query))
      .slice(0, 20);
  }, [allVisibleItems, scanInput]);

  useEffect(() => {
    setCandidateIndex(0);
  }, [scanInput]);

  const unmatchedCodes = useMemo(() => {
    return scannedCodes.filter((identifier) => !visibleItemByIdentifier.has(identifier));
  }, [visibleItemByIdentifier, scannedCodes]);

  const appendScannedCode = (rawCode) => {
    const code = String(rawCode || "").trim();
    if (!code) {
      setScanNotice("添加失败：串码为空");
      return;
    }

    let added = false;
    setScannedCodes((prev) => {
      if (prev.includes(code)) return prev;
      added = true;
      return [...prev, code];
    });

    setScanNotice(added ? `添加成功：${code}` : `添加失败：${code} 已存在`);
  };

  const addCandidateItem = (item) => {
    appendScannedCode(item.identifier);
    setScanInput("");
  };
  const handleScanKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (scanCandidates.length === 0) return;
      setCandidateIndex((prev) => (prev + 1) % scanCandidates.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (scanCandidates.length === 0) return;
      setCandidateIndex((prev) => (prev - 1 + scanCandidates.length) % scanCandidates.length);
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();

    const exact = visibleItemByIdentifier.get(String(scanInput || "").trim());
    if (exact) {
      appendScannedCode(exact.identifier);
      setScanInput("");
      return;
    }

    if (scanCandidates.length >= 1) {
      addCandidateItem(scanCandidates[candidateIndex] || scanCandidates[0]);
      return;
    }

    alert("请先输入至少4位并选择候选机器");
  };

  const openSubmitPanel = (items) => {
    if (!items || items.length === 0) {
      alert("暂无可提交的机器");
      return;
    }

    setSubmitItems((prev) => {
      const map = new Map(prev.map((p) => [String(p.productNo || p.identifier), p]));
      items.forEach((item) => {
        const key = String(item.productNo || item.identifier);
        if (!map.has(key)) {
          map.set(key, {
            ...item,
            submitCharge: item.isRework ? "0" : "30"
          });
        }
      });
      return [...map.values()];
    });

    if (!showSubmitPanel) {
      setSubmitRemark("");
      setShowSubmitPanel(true);
    }
  };

  const clearSubmitPanel = () => {
    setShowSubmitPanel(false);
    setSubmitItems([]);
    setSubmitRemark("");
  };

  const handleBatchSubmit = () => {
    if (matchedItems.length === 0) {
      alert("暂无可提交的匹配机器");
      return;
    }
    openSubmitPanel(matchedItems);
  };

  useEffect(() => {
    if (!showSubmitPanel) return;
    if (matchedItems.length === 0) return;
    openSubmitPanel(matchedItems);
  }, [showSubmitPanel, matchedItems]);

  const submitPreparedItems = async () => {
    if (submitItems.length === 0) {
      alert("没有可提交的数据");
      return;
    }

    setSubmitting(true);
    const success = [];
    const failed = [];

    try {
      const preparedItems = [];

      for (const item of submitItems) {
        if (!item.productNo) {
          failed.push(`${item.productName}: 缺少product_no`);
          continue;
        }
        if (!item.repairChannelId) {
          failed.push(`${item.productName}: 缺少维修渠道`);
          continue;
        }

        let outsideLogId = item.outsideLogId;
        if (outsideLogId === null || outsideLogId === undefined || outsideLogId === "") {
          const repairIndexResp = await fetchRepairProductIndex({
            product_no: [item.productNo],
            repair_type_id: "",
            manage_mode: true,
            type: "append",
            use_product_no: [],
            repair_channel_id: "",
            from: "repair/orders/add"
          });

          if (repairIndexResp.code !== 0) {
            failed.push(`${item.productName}: 获取送修记录失败（${repairIndexResp.msg || "未知错误"}）`);
            continue;
          }

          const productRow = Array.isArray(repairIndexResp.data) ? repairIndexResp.data[0] : null;
          outsideLogId = productRow?.outside_log_id ?? null;
          if (!outsideLogId) {
            failed.push(`${item.productName}: 缺少outside_log_id（送修记录），请先在ERP刷新送修页面后重试`);
            continue;
          }
        }

        const charge = item.isRework ? "0" : String(item.submitCharge || "30").trim();
        if (!charge) {
          failed.push(`${item.productName}: 维修费用为空`);
          continue;
        }

        const mergedRemark = item.isRework
          ? ["返修", submitRemark].filter(Boolean).join("-")
          : submitRemark;

        preparedItems.push({
          ...item,
          outsideLogId,
          submitChargeResolved: charge,
          submitRemarkResolved: mergedRemark
        });
      }

      const groupedByChannel = preparedItems.reduce((acc, item) => {
        const key = String(item.repairChannelId);
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(item);
        return acc;
      }, new Map());

      for (const [channelId, items] of groupedByChannel.entries()) {
        const data = {};
        const totalCharge = items.reduce((sum, item) => sum + Number(item.submitChargeResolved || 0), 0);

        items.forEach((item) => {
          data[item.productNo] = {
            repair_charge: item.submitChargeResolved,
            use_product_no: [],
            dismantle_list: [],
            outside_log_id: item.outsideLogId,
            remark: item.submitRemarkResolved
          };
        });

        const submitPayload = {
          warehouse_id: "",
          currency_id: 12041,
          batch_mode: true,
          with_review_bill: false,
          repair_charge: String(totalCharge),
          remark: submitRemark,
          repair_channel_id: channelId,
          status: 25,
          data,
          order_field: {},
          dismantle_warehouse_id: "",
          payment: [],
          files: [],
          from: "repair/orders/add"
        };

        const submitResp = await submitRepairOrder(submitPayload);
        if (submitResp.code !== 0) {
          items.forEach((item) => {
            failed.push(`${item.productName}: ${submitResp.msg || "提交失败"}`);
          });
          continue;
        }

        const paySourceResp = await fetchAdvancePaySource({
          total_mode: true,
          currency_id: 12041,
          channel_id: Number(channelId),
          route: "/repair/orders/add"
        });

        if (paySourceResp.code !== 0) {
          items.forEach((item) => {
            failed.push(`${item.productName}: ${paySourceResp.msg || "费用联动失败"}`);
          });
          continue;
        }

        const submittedAt = new Date().toISOString();
        const records = items.map((item) => ({
          identifier: item.identifier,
          productNo: item.productNo,
          productName: item.productName,
          master: item.master,
          repairChannelId: item.repairChannelId,
          amount: item.isRework ? 0 : Number(item.submitChargeResolved || 0),
          isRework: Boolean(item.isRework),
          remark: item.submitRemarkResolved,
          outsideLogId: item.outsideLogId,
          submittedAt,
          statusText: item.statusText,
          paySourceVendor: paySourceResp.data?.vendor?.name || ""
        }));

        const recordResp = await recordDashboardSubmissions({ records });
        if (Number(recordResp?.code || 0) !== 0) {
          items.forEach((item) => {
            failed.push(`${item.productName}: ${recordResp?.msg || "持久化失败"}`);
          });
          continue;
        }

        items.forEach((item) => success.push(item.productName));
      }
    } finally {
      setSubmitting(false);
    }

    alert(`提交完成：成功 ${success.length} 台，失败 ${failed.length} 台${failed.length ? `\n${failed.join("\n")}` : ""}`);
    if (success.length > 0) {
      await Promise.all([loadData(true), fetchPoolItems().then((resp) => setPoolItems(Array.isArray(resp?.data) ? resp.data : []))]).catch(() => {});
      clearSubmitPanel();
      setScannedCodes([]);
    }
  };

  const loadAdminUsers = async () => {
    if (!isAdmin) return;
    const resp = await fetchAdminUsers();
    setAdminUsers(Array.isArray(resp.data) ? resp.data : []);
  };

  const loadMissingMaterialMap = async () => {
    if (!currentUser) {
      setMissingMaterialMap({});
      return;
    }
    const resp = await fetchMissingMaterialFeedback();
    setMissingMaterialMap(resp?.data && typeof resp.data === "object" ? resp.data : {});
  };

  const loadQualityMetrics = async () => {
    if (!currentUser) {
      setQualityMetrics([]);
      setQualityError("");
      return;
    }
    setQualityLoading(true);
    setQualityError("");
    try {
      const resp = await fetchMasterQualityMetrics();
      setQualityMetrics(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e) {
      setQualityError(e.message || "质量指标加载失败");
      setQualityMetrics([]);
    } finally {
      setQualityLoading(false);
    }
  };

  const loadAdminRecords = async (overrides = {}) => {
    if (!isAdmin) return;
    const merged = {
      tab: recordTab,
      ...recordFilters,
      ...overrides
    };
    setRecordLoading(true);
    setRecordError("");
    try {
      const resp = await fetchAdminRecords(merged);
      const data = resp?.data || {};
      setRecordItems(Array.isArray(data.items) ? data.items : []);
      setRecordTotal(Number(data.total || 0));
      setRecordFilters((prev) => ({ ...prev, page: Number(data.page || merged.page || 1), pageSize: Number(data.pageSize || merged.pageSize || 20) }));
    } catch (e) {
      setRecordError(e.message || "记录查询失败");
      setRecordItems([]);
      setRecordTotal(0);
    } finally {
      setRecordLoading(false);
    }
  };

  const exportAdminRecords = async () => {
    if (!isAdmin) return;
    try {
      const resp = await fetchAdminRecords({ tab: recordTab, ...recordFilters, export: 1, page: 1, pageSize: 200000 });
      const rows = Array.isArray(resp?.data?.items) ? resp.data.items : [];
      if (rows.length === 0) {
        alert("暂无可导出记录");
        return;
      }
      const headerSet = new Set();
      rows.forEach((row) => Object.keys(row || {}).forEach((key) => headerSet.add(key)));
      const headers = [...headerSet];
      const csvLines = [headers.join(",")];
      rows.forEach((row) => {
        const line = headers.map((key) => {
          const text = String(row?.[key] ?? "").replaceAll("\"", "\"\"");
          return `"${text}"`;
        }).join(",");
        csvLines.push(line);
      });
      const blob = new Blob([`﻿${csvLines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `records-${recordTab}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message || "导出失败");
    }
  };

  const handleRefreshPostIntercepts = async () => {
    try {
      const resp = await refreshPostIntercepts();
      if (Number(resp?.code || 0) !== 0) {
        throw new Error(resp?.msg || "同步失败");
      }
      await loadQualityMetrics();
      alert(`同步完成：拉取 ${resp?.data?.totalPulled || 0} 条，入库 ${resp?.data?.totalSaved || 0} 条，未匹配 ${resp?.data?.unmatchedCount || 0} 条`);
    } catch (e) {
      alert(e.message || "同步失败");
    }
  };

  useEffect(() => {
    if (!isAdmin || !showUserPanel) return;
    loadAdminUsers().catch(() => {
      setAdminUsers([]);
    });
  }, [isAdmin, showUserPanel]);

  useEffect(() => {
    if (!currentUser) {
      setMissingMaterialMap({});
      return;
    }
    loadMissingMaterialMap().catch(() => {
      setMissingMaterialMap({});
    });
  }, [currentUser, groups]);

  useEffect(() => {
    if (!currentUser) {
      setQualityMetrics([]);
      setQualityError("");
      return;
    }
    loadQualityMetrics();
  }, [currentUser, groups]);

  useEffect(() => {
    if (!currentUser) {
      setPostInterceptNotice("");
      setPostInterceptLatestAt("");
      postInterceptLatestRef.current = "";
      return;
    }

    let stopped = false;
    let timer = null;

    const pollAlerts = async () => {
      try {
        const since = postInterceptLatestRef.current;
        const resp = await fetchPostInterceptAlerts(since ? { since } : {});
        const data = resp?.data || {};
        const total = Number(data.total || 0);
        const latestAt = String(data.latestAt || "");
        if (!stopped && latestAt) {
          postInterceptLatestRef.current = latestAt;
          setPostInterceptLatestAt(latestAt);
        }
        if (!stopped && total > 0) {
          const first = data?.items?.[0];
          const imei = String(first?.imei || "").trim();
          setPostInterceptNotice(`检测到 ${total} 条新的后验拦截${imei ? `（最近IMEI：${imei}）` : ""}`);
          await loadQualityMetrics();
        }
      } catch {
      } finally {
        if (!stopped) {
          timer = window.setTimeout(pollAlerts, 60000);
        }
      }
    };

    pollAlerts();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!isAdmin || activeView !== "records") return;
    loadAdminRecords();
  }, [isAdmin, activeView, recordTab]);

  const createUserByAdmin = async (event) => {
    event.preventDefault();
    setUserFormError("");
    setUserSubmitting(true);
    try {
      await createAdminUser(userForm);
      setUserForm({ username: "", password: "", role: "master", masterName: "" });
      await loadAdminUsers();
      alert("用户创建成功");
    } catch (e) {
      setUserFormError(e.message || "创建用户失败");
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setLoginSubmitting(true);
    try {
      const resp = await loginRepairUser(loginUsername.trim(), loginPassword);
      const user = resp.data || null;
      setCurrentUser(user);
      if (user) {
        await maybeMigrateLocalStorage(user).catch(() => {});
      }
      setLoginPassword("");
    } catch (e) {
      setAuthError(e.message || "登录失败");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutRepairUser().catch(() => {});
    setCurrentUser(null);
    setRawRows([]);
    setGroups([]);
    setSubmitItems([]);
    setScannedCodes([]);
    setShowSubmitPanel(false);
    setShowBatchPanel(false);
    setActiveView("dashboard");
  };

  const toggleManualRework = async (identifier, currentlyRework) => {
    if (!identifier || identifier === "-") {
      alert("该机器缺少串码，无法手动标记返修");
      return;
    }

    const confirmText = currentlyRework ? "确认取消返修标记？" : "确认标记为返修？";
    if (!window.confirm(confirmText)) return;

    const nextEnabled = !currentlyRework;

    try {
      const resp = await toggleManualReworkApi({ identifier, enabled: nextEnabled });
      if (Number(resp?.code || 0) !== 0) {
        throw new Error(resp?.msg || "返修标记更新失败");
      }

      const mapResp = await fetchManualRework();
      setManualReworkMap(mapResp?.data && typeof mapResp.data === "object" ? mapResp.data : {});
      await loadData(true);
    } catch (e) {
      alert(e.message || "返修标记更新失败");
    }
  };

  const handleMissingMaterialFeedback = async (item) => {
    const remark = String(window.prompt("请输入缺物料备注") || "").trim();
    if (!remark) {
      alert("备注不能为空");
      return;
    }

    const identifier = String(item.identifier || "").trim();
    if (!identifier || identifier === "-") {
      alert("该机器缺少串码，无法提交缺物料反馈");
      return;
    }

    try {
      const resp = await submitMissingMaterialFeedback({
        productName: item.productName,
        identifier,
        remark
      });

      if (Number(resp?.code || 0) !== 0) {
        throw new Error(resp?.msg || "发送失败");
      }

      const state = resp?.data?.state;
      if (state && typeof state === "object") {
        setMissingMaterialMap((prev) => ({ ...prev, [identifier]: state }));
      } else {
        await loadMissingMaterialMap();
      }

      setMissingHistoryExpandedMap((prev) => ({ ...prev, [identifier]: true }));
      alert("缺物料反馈已发送并记录历史");
    } catch (e) {
      alert(e.message || "缺物料反馈发送失败");
    }
  };

  const toggleMissingHistory = (identifier) => {
    if (!identifier || identifier === "-") return;
    setMissingHistoryExpandedMap((prev) => ({ ...prev, [identifier]: !prev[identifier] }));
  };

  const toggleMissingResolved = async (item) => {
    const identifier = String(item.identifier || "").trim();
    if (!identifier || identifier === "-") {
      alert("该机器缺少串码，无法变更缺料状态");
      return;
    }

    const existing = missingMaterialMap[identifier];
    if (!existing || !Array.isArray(existing.history) || existing.history.length === 0) {
      alert("该机器暂无缺物料历史");
      return;
    }

    const nextResolved = !existing.resolved;
    const confirmText = nextResolved ? "确认标记该缺料需求已解决？" : "确认标记该缺料需求未解决？";
    if (!window.confirm(confirmText)) return;

    updateMissingMaterialResolved({ identifier, resolved: nextResolved })
      .then((resp) => {
        if (Number(resp?.code || 0) !== 0) {
          throw new Error(resp?.msg || "状态更新失败");
        }
        const state = resp?.data?.state;
        if (state && typeof state === "object") {
          setMissingMaterialMap((prev) => ({ ...prev, [identifier]: state }));
        }
      })
      .catch((e) => {
        alert(e.message || "状态更新失败");
      });
  };

  if (authLoading) {
    return (
      <div className="page">
        <div className="empty">登录状态校验中...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="page">
        <section className="submit-panel" style={{ maxWidth: 420, margin: "80px auto" }}>
          <h2>维修看板登录</h2>
          <form onSubmit={handleLogin}>
            <div className="batch-panel-row" style={{ marginTop: 12 }}>
              <input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} placeholder="账号" />
            </div>
            <div className="batch-panel-row" style={{ marginTop: 12 }}>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="密码" />
            </div>
            {authError && <div className="error" style={{ marginTop: 12 }}>{authError}</div>}
            <div className="pool-actions" style={{ marginTop: 16 }}>
              <button type="submit" disabled={loginSubmitting}>{loginSubmitting ? "登录中..." : "登录"}</button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1>送修时长预警看板</h1>
        <div className="toolbar">
          <div className="view-switch">
            <button type="button" className={activeView === "dashboard" ? "tab-btn active" : "tab-btn"} onClick={() => setActiveView("dashboard")}>看板</button>
            <button type="button" className={activeView === "quality" ? "tab-btn active" : "tab-btn"} onClick={() => setActiveView("quality")}>质量分区</button>
            <button type="button" className={activeView === "pool" ? "tab-btn active" : "tab-btn"} onClick={() => setActiveView("pool")}>分货池</button>
            {isAdmin && <button type="button" className={activeView === "records" ? "tab-btn active" : "tab-btn"} onClick={() => setActiveView("records")}>记录查询</button>}
          </div>
          <span>{currentUser.username}{isAdmin ? "（管理员）" : `（${currentUser.masterName}）`}</span>
          {isAdmin ? (
            <select value={selectedMaster} onChange={(e) => setSelectedMaster(e.target.value)}>
              <option value="ALL">全部师傅</option>
              {masters.map((master) => (
                <option value={master} key={master}>
                  {master}
                </option>
              ))}
            </select>
          ) : (
            <span>{currentUser.masterName}</span>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setShowUserPanel((prev) => !prev)}>
              {showUserPanel ? "收起用户管理" : "用户管理"}
            </button>
          )}
          <button type="button" onClick={() => setShowBatchPanel((prev) => !prev)}>
            {showBatchPanel ? "收起批量提交" : "批量扫码提交"}
          </button>
          <button onClick={() => loadData(true)} disabled={loading}>
            {loading ? "刷新中..." : "立即刷新"}
          </button>
          <button type="button" onClick={handleLogout}>退出登录</button>
        </div>
      </header>

      {isAdmin && showUserPanel && (
        <section className="submit-panel">
          <div className="pool-header">
            <h2>用户管理</h2>
          </div>
          <form onSubmit={createUserByAdmin}>
            <div className="batch-panel-row">
              <input placeholder="账号" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
              <input placeholder="密码" type="text" value={userForm.password} onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))} />
              <select value={userForm.role} onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value, masterName: e.target.value === "admin" ? "" : prev.masterName }))}>
                <option value="master">维修师傅账号</option>
                <option value="admin">管理员账号</option>
              </select>
              <input placeholder="绑定师傅名（管理员可留空）" value={userForm.masterName} disabled={userForm.role === "admin"} onChange={(e) => setUserForm((prev) => ({ ...prev, masterName: e.target.value }))} />
              <button type="submit" disabled={userSubmitting}>{userSubmitting ? "创建中..." : "新增用户"}</button>
            </div>
            {userFormError && <div className="error">{userFormError}</div>}
          </form>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>账号</th>
                  <th>角色</th>
                  <th>绑定师傅</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((u) => (
                  <tr key={`user-${u.username}`}>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.masterName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showSubmitPanel && (
        <section className="submit-panel">
          <div className="pool-header">
            <h2>维修金额核对</h2>
            <div className="pool-actions">
              <button type="button" onClick={clearSubmitPanel} disabled={submitting}>取消</button>
              <button type="button" onClick={submitPreparedItems} disabled={submitting}>{submitting ? "提交中..." : "确认提交"}</button>
            </div>
          </div>
          <div className="batch-panel-row">
            <input value={submitRemark} onChange={(e) => setSubmitRemark(e.target.value)} placeholder="统一备注（可空）" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>机器</th>
                  <th>串码</th>
                  <th>返修</th>
                  <th>维修渠道</th>
                  <th>维修金额</th>
                </tr>
              </thead>
              <tbody>
                {submitItems.map((item, idx) => (
                  <tr key={`submit-${item.productNo || item.id || idx}`}>
                    <td>{item.productName}</td>
                    <td>{item.identifier}</td>
                    <td>{item.isRework ? <span className="tag-rework">返修</span> : "-"}</td>
                    <td>{item.master || "-"}</td>
                    <td>
                      <input
                        className="charge-input"
                        value={item.isRework ? "0" : item.submitCharge}
                        disabled={item.isRework || submitting}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSubmitItems((prev) => prev.map((r, i) => (i === idx ? { ...r, submitCharge: v } : r)));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeView === "dashboard" && showBatchPanel && (
        <section className="batch-panel">
          <div className="batch-panel-row">
            <input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScanKeyDown}
              placeholder="输入任意连续4位或更多，显示候选后点选添加"
            />
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("确定要清空已添加的扫码记录吗？")) return;
                setScannedCodes([]);
                setScanNotice("已清空扫码记录");
              }}
            >
              清空
            </button>
            <button type="button" onClick={handleBatchSubmit}>
              批量提交维修
            </button>
          </div>
          {scanCandidates.length > 0 && (
            <div className="fuzzy-candidates">
              <div className="fuzzy-row"><strong>候选项（点选添加）：</strong></div>
              <div className="candidate-list">
                {scanCandidates.map((c, idx) => (
                  <button
                    type="button"
                    key={`candidate-${c.productNo || c.identifier}`}
                    className={idx === candidateIndex ? "fuzzy-tag candidate-btn active" : "fuzzy-tag candidate-btn"}
                    onClick={() => addCandidateItem(c)}
                  >
                    {idx === candidateIndex ? "▶ " : ""}{c.productName} / {c.identifier}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="batch-meta">
            <span>已添加：{scannedCodes.length}</span>
            <span>匹配成功：{matchedItems.length}</span>
            <span className={unmatchedCodes.length > 0 ? "text-danger" : ""}>未匹配：{unmatchedCodes.length}</span>
            {scanNotice && <span className={scanNotice.includes("失败") ? "text-danger" : "text-success"}>{scanNotice}</span>}
          </div>
        </section>
      )}

      {activeView === "dashboard" && (
      <>
      <section className="cards">
        <article className="card">
          <span>总送修数</span>
          <strong>{visibleSummary.total}</strong>
        </article>
        <article className="card warning-card">
          <span>超 {warningDays} 天</span>
          <strong>{visibleSummary.warning}</strong>
        </article>
        <article className="card">
          <span>师傅数量</span>
          <strong>{visibleSummary.masters}</strong>
        </article>
      </section>

      <div className="meta">
        <span>自动刷新：60 秒</span>
        <span>数据来源：{dataSourceText || "--"}</span>
        <span>缓存状态：{cacheStateText || "--"}</span>
        <span>后端同步：{backendSyncedAt || "--"}</span>
        <span>页面更新：{lastUpdatedAt || "--"}</span>
      </div>

      {tokenAlert && (
        <div className="error">
          <div>{tokenAlert}</div>
          <div style={{ marginTop: 6 }}>处理方式：1）在服务器更新 AIGJ_AUTHORIZATION；2）执行 pm2 restart repair-api --update-env；3）点“立即刷新”确认恢复。</div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="groups">
        {visibleGroups.map((group) => (
          <article className="group" key={group.master}>
            <div className="group-header">
              <h2>{group.master}</h2>
              <div className="group-stats">
                <span>总数：{group.total}</span>
                <span className={group.warningCount > 0 ? "text-danger" : ""}>超时：{group.warningCount}</span>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>返修</th>
                    <th>机器</th>
                    <th>串码</th>
                    <th>类型</th>
                    <th>送修状态</th>
                    <th>收货状态</th>
                    <th>下一状态</th>
                    <th>在修天数</th>
                    <th>预警</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const identifier = String(item.identifier || "").trim();
                    const missingState = missingMaterialMap[identifier] || null;
                    const missingHistory = Array.isArray(missingState?.history) ? missingState.history : [];
                    const hasMissingHistory = missingHistory.length > 0;
                    const historyExpanded = Boolean(missingHistoryExpandedMap[identifier]);

                    return (
                      <Fragment key={item.id}>
                        <tr key={item.id} className={item.isWarning ? "row-warning" : ""}>
                          <td>{item.isRework ? <span className="tag-rework">返修</span> : "-"}</td>
                          <td>{item.productName}</td>
                          <td>{item.identifier}</td>
                          <td>{item.typeText}</td>
                          <td>{item.statusText}</td>
                          <td>{item.stockStatusText}</td>
                          <td>{item.nextStatusText}</td>
                          <td>{item.days}</td>
                          <td>
                            <div className="status-stack">
                              {item.isWarning ? <span className="tag-danger">超时</span> : <span className="tag-normal">正常</span>}
                              {hasMissingHistory && (
                                missingState?.resolved
                                  ? <span className="tag-normal">缺料已解决</span>
                                  : <span className="tag-danger">缺料处理中</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="action-buttons">
                              {isAdmin && (
                                <button type="button" className="action-btn" onClick={() => toggleManualRework(item.identifier, item.isRework)}>
                                  {item.isRework ? "取消返修" : "标记返修"}
                                </button>
                              )}
                              <button
                                type="button"
                                className="action-btn"
                                onClick={() => openSubmitPanel([item])}
                              >
                                提交维修
                              </button>
                              <button type="button" className="action-btn" onClick={() => handleMissingMaterialFeedback(item)}>缺物料反馈</button>
                              {hasMissingHistory && (
                                <button type="button" className="action-btn" onClick={() => toggleMissingResolved(item)}>
                                  {missingState?.resolved ? "标记未解决" : "标记已解决"}
                                </button>
                              )}
                              {hasMissingHistory && (
                                <button type="button" className="action-btn" onClick={() => toggleMissingHistory(identifier)}>
                                  {historyExpanded ? "收起历史" : "查看历史"}
                                </button>
                              )}
                              <button type="button" className="action-btn danger" onClick={() => alert(`已点击：报损提交（${item.productName}）`)}>报损提交</button>
                            </div>
                          </td>
                        </tr>
                        {hasMissingHistory && historyExpanded && (
                          <tr key={`${item.id}-missing-history`} className="missing-history-row">
                            <td colSpan={10}>
                              <div className="missing-history-panel">
                                <div className="missing-history-head">
                                  <strong>缺物料历史</strong>
                                  <span>
                                    当前状态：{missingState?.resolved ? "已解决" : "处理中"}
                                    {missingState?.resolvedAt ? `（${new Date(missingState.resolvedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
                                    {missingState?.resolvedBy ? ` / ${missingState.resolvedBy}` : ""}
                                    {missingState?.resolvedAt ? "）" : ""}
                                  </span>
                                </div>
                                <div className="missing-history-list">
                                  {missingHistory.map((entry) => (
                                    <div className="missing-history-item" key={entry.id}>
                                      <span className="missing-history-meta">
                                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "--"}
                                        {entry.createdBy ? ` / ${entry.createdBy}` : ""}
                                      </span>
                                      <span className="missing-history-remark">{entry.remark || "-"}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>

      {!loading && rawRows.length === 0 && !error && <div className="empty">暂无数据</div>}
      </>
      )}

      {activeView === "quality" && (
        <section className="pool-panel">
          {postInterceptNotice && (
            <div className="error" style={{ marginBottom: 12 }}>
              <div>{postInterceptNotice}</div>
              <div className="pool-actions" style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setPostInterceptNotice("")}>我知道了</button>
              </div>
            </div>
          )}
          <div className="pool-header">
            <h2>师傅质量单指标分区</h2>
            <div className="pool-actions">
              {isAdmin && <button type="button" onClick={handleRefreshPostIntercepts}>同步后验拦截</button>}
              <button type="button" onClick={loadQualityMetrics} disabled={qualityLoading}>{qualityLoading ? "刷新中..." : "刷新指标"}</button>
            </div>
          </div>
          <p className="pool-tip">独立分区展示，不影响现有看板和提交流程。后验拦截率分母当前为维修总单量。</p>
          {qualityError && <div className="error">{qualityError}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>师傅</th>
                  <th>总单量</th>
                  <th>平均维修天数</th>
                  <th>P90天数</th>
                  <th>超时率</th>
                  <th>返修率</th>
                  <th>报损率(工单)</th>
                  <th>报损率(金额)</th>
                  <th>后验拦截率</th>
                </tr>
              </thead>
              <tbody>
                {qualityMetrics.map((item) => (
                  <tr key={`quality-${item.master}`}>
                    <td>{item.master}</td>
                    <td>{item.totalJobs}</td>
                    <td>{Number(item.avgDays || 0).toFixed(2)}</td>
                    <td>{Number(item.p90Days || 0).toFixed(2)}</td>
                    <td>{`${(Number(item.timeoutRate || 0) * 100).toFixed(1)}%`}</td>
                    <td>{`${(Number(item.reworkRate || 0) * 100).toFixed(1)}%`}</td>
                    <td>{`${(Number(item.lossOrderRate || 0) * 100).toFixed(1)}%`}</td>
                    <td>{item.repairChargeTotal > 0 ? `${(Number(item.lossAmountRate || 0) * 100).toFixed(1)}%` : "--"}</td>
                    <td>{`${(Number(item.postInterceptRate || 0) * 100).toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!qualityLoading && qualityMetrics.length === 0 && !qualityError && <div className="empty">暂无质量指标数据</div>}
        </section>
      )}

      {activeView === "pool" && (
        <section className="pool-panel">
          <div className="pool-header">
            <h2>分货池</h2>
            <div className="pool-actions">
              <button
                type="button"
                onClick={async () => {
                  const resp = await fetchPoolItems().catch(() => null);
                  if (!resp) return;
                  setPoolItems(Array.isArray(resp?.data) ? resp.data : []);
                }}
              >刷新分货池</button>
            </div>
          </div>
          <p className="pool-tip">来源：提交维修成功后的机器进入分货池，可在此更新分货状态。</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>勾选</th>
                  <th>机器</th>
                  <th>串码</th>
                  <th>当前状态</th>
                  <th>池内状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {poolItems.map((item, idx) => (
                  <tr key={`pool-${item.productNo || item.id || idx}`}>
                    <td><input type="checkbox" /></td>
                    <td>{item.productName}</td>
                    <td>{item.identifier}</td>
                    <td>{item.statusText}</td>
                    <td><span className="tag-normal">{item.poolStatus || "待分货"}</span></td>
                    <td>
                      <div className="action-buttons">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={async () => {
                            try {
                              const resp = await updatePoolStatus({ identifier: item.identifier, productNo: item.productNo, poolStatus: "分货中" });
                              if (Number(resp?.code || 0) !== 0) throw new Error(resp?.msg || "更新失败");
                              const listResp = await fetchPoolItems();
                              setPoolItems(Array.isArray(listResp?.data) ? listResp.data : []);
                            } catch (e) {
                              alert(e.message || "分货状态更新失败");
                            }
                          }}
                        >分货</button>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={async () => {
                            try {
                              const resp = await updatePoolStatus({ identifier: item.identifier, productNo: item.productNo, poolStatus: "已上架" });
                              if (Number(resp?.code || 0) !== 0) throw new Error(resp?.msg || "更新失败");
                              const listResp = await fetchPoolItems();
                              setPoolItems(Array.isArray(listResp?.data) ? listResp.data : []);
                            } catch (e) {
                              alert(e.message || "上架状态更新失败");
                            }
                          }}
                        >上架</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeView === "records" && isAdmin && (
        <section className="pool-panel">
          <div className="pool-header">
            <h2>管理员记录查询</h2>
            <div className="pool-actions">
              <button type="button" onClick={() => loadAdminRecords()}>查询</button>
              <button type="button" onClick={exportAdminRecords}>导出CSV</button>
            </div>
          </div>
          <div className="batch-panel-row" style={{ marginBottom: 12 }}>
            <input placeholder={recordTab === "intercept" ? "关键词（串码/师傅/原因/记录ID）" : "关键词（机器/串码/师傅）"} value={recordFilters.keyword} onChange={(e) => setRecordFilters((prev) => ({ ...prev, keyword: e.target.value, page: 1 }))} />
            <input placeholder="串码查询" value={recordFilters.identifier} onChange={(e) => setRecordFilters((prev) => ({ ...prev, identifier: e.target.value, page: 1 }))} />
            <select value={recordFilters.master} onChange={(e) => setRecordFilters((prev) => ({ ...prev, master: e.target.value, page: 1 }))}>
              <option value="">全部师傅</option>
              {masters.map((master) => (
                <option key={`record-master-${master}`} value={master}>{master}</option>
              ))}
            </select>
            <input type="datetime-local" value={recordFilters.startAt} onChange={(e) => setRecordFilters((prev) => ({ ...prev, startAt: e.target.value, page: 1 }))} />
            <input type="datetime-local" value={recordFilters.endAt} onChange={(e) => setRecordFilters((prev) => ({ ...prev, endAt: e.target.value, page: 1 }))} />
          </div>
          <div className="view-switch" style={{ marginBottom: 12 }}>
            <button type="button" className={recordTab === "submission" ? "tab-btn active" : "tab-btn"} onClick={() => setRecordTab("submission")}>提交流水</button>
            <button type="button" className={recordTab === "amount" ? "tab-btn active" : "tab-btn"} onClick={() => setRecordTab("amount")}>金额台账</button>
            <button type="button" className={recordTab === "pool" ? "tab-btn active" : "tab-btn"} onClick={() => setRecordTab("pool")}>分货池</button>
            <button type="button" className={recordTab === "rework" ? "tab-btn active" : "tab-btn"} onClick={() => setRecordTab("rework")}>返修标记</button>
            <button type="button" className={recordTab === "intercept" ? "tab-btn active" : "tab-btn"} onClick={() => setRecordTab("intercept")}>后验查询</button>
          </div>
          {recordError && <div className="error">{recordError}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                {recordTab === "intercept" ? (
                  <tr>
                    <th>串码</th>
                    <th>匹配师傅</th>
                    <th>拦截原因</th>
                    <th>拦截时间</th>
                    <th>入库时间</th>
                    <th>图片链接</th>
                    <th>源记录ID</th>
                  </tr>
                ) : (
                  <tr>
                    <th>串码</th>
                    <th>产品编码</th>
                    <th>机器</th>
                    <th>师傅</th>
                    <th>金额/状态</th>
                    <th>时间</th>
                    <th>操作人</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {recordItems.map((item, idx) => (
                  recordTab === "intercept" ? (
                    <tr key={`record-${item.sourceRecordId || item.imei || idx}`}>
                      <td>{item.imei || "-"}</td>
                      <td>{item.matchedMaster || "-"}</td>
                      <td>
                        {(() => {
                          const reason = String(item.reason || "");
                          const key = String(item.sourceRecordId || item.imei || idx);
                          const expanded = Boolean(expandedInterceptReasons[key]);
                          const shortReason = reason.length > 40 ? `${reason.slice(0, 40)}...` : reason;
                          return (
                            <div>
                              <span>{expanded ? reason : (shortReason || "-")}</span>
                              {reason.length > 40 && (
                                <button
                                  type="button"
                                  className="action-btn"
                                  style={{ marginLeft: 8 }}
                                  onClick={() => setExpandedInterceptReasons((prev) => ({ ...prev, [key]: !prev[key] }))}
                                >
                                  {expanded ? "收起" : "展开"}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td>{item.interceptedAt || "-"}</td>
                      <td>{item.createdAt || "-"}</td>
                      <td>{item.imageUrl ? <a href={item.imageUrl} target="_blank" rel="noreferrer">查看图片</a> : "-"}</td>
                      <td>{item.sourceRecordId || "-"}</td>
                    </tr>
                  ) : (
                    <tr key={`record-${item.id || item.identifier || idx}`}>
                      <td>{item.identifier || "-"}</td>
                      <td>{item.productNo || "-"}</td>
                      <td>{item.productName || "-"}</td>
                      <td>{item.master || "-"}</td>
                      <td>{recordTab === "pool" ? (item.poolStatus || "-") : (recordTab === "rework" ? (item.enabled ? "返修" : "非返修") : (item.amount ?? "-"))}</td>
                      <td>{item.submittedAt || item.updatedAt || "-"}</td>
                      <td>{item.submittedBy || item.updatedBy || "-"}</td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
          <div className="pool-actions" style={{ marginTop: 12 }}>
            <span>共 {recordTotal} 条</span>
            <button
              type="button"
              disabled={recordLoading || recordFilters.page <= 1}
              onClick={() => {
                const nextPage = Math.max(1, Number(recordFilters.page || 1) - 1);
                setRecordFilters((prev) => ({ ...prev, page: nextPage }));
                loadAdminRecords({ page: nextPage });
              }}
            >上一页</button>
            <button
              type="button"
              disabled={recordLoading || (Number(recordFilters.page || 1) * Number(recordFilters.pageSize || 20) >= recordTotal)}
              onClick={() => {
                const nextPage = Number(recordFilters.page || 1) + 1;
                setRecordFilters((prev) => ({ ...prev, page: nextPage }));
                loadAdminRecords({ page: nextPage });
              }}
            >下一页</button>
          </div>
        </section>
      )}
    </div>
  );
}
