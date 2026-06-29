const SCAN_PROXY_URL = "/api/scan";
const ACCUMULATION_PROXY_URL = "/api/accumulation-long";
const TABLE_COLUMN_COUNT = 13;
const ACCUMULATION_DEFAULT_RULES = {
  rangeLookback: 250,
  spikeLookback: 120,
  highLookback: 120,
  movingAveragePeriod: 60,
  volumeAveragePeriod: 50,
  consolidationLookback: 20,
  minDaysSinceSpike: 15,
  minSpikeVolumeMultiple: 3,
  maxPricePosition: 0.45,
  maxPullbackPct: 12,
  lowBreakTolerancePct: 0.02,
  maxConsolidationVolumeRatio: 0.45,
  maxDistanceToHighPct: 8,
};
const ACCUMULATION_RULE_FIELD_DEFINITIONS = [
  { key: "rangeLookback", type: "integer" },
  { key: "spikeLookback", type: "integer" },
  { key: "highLookback", type: "integer" },
  { key: "movingAveragePeriod", type: "integer" },
  { key: "volumeAveragePeriod", type: "integer" },
  { key: "consolidationLookback", type: "integer" },
  { key: "minDaysSinceSpike", type: "integer" },
  { key: "minSpikeVolumeMultiple", type: "float" },
  { key: "maxPricePosition", type: "percentRatio" },
  { key: "maxPullbackPct", type: "float" },
  { key: "lowBreakTolerancePct", type: "percentRatio" },
  { key: "maxConsolidationVolumeRatio", type: "percentRatio" },
  { key: "maxDistanceToHighPct", type: "float" },
];
const UNIVERSE_CONFIG = {
  TAIWAN: {
    key: "TAIWAN",
    label: "台股",
    screenerLabel: "TradingView 台股掃描",
    titleLabel: "台股 / 美股型態條件雷達",
    scanMarket: "taiwan",
    scanUrl: "https://scanner.tradingview.com/taiwan/scan",
    screenerUrl: "https://tw.tradingview.com/screener/",
    locale: "zh_TW",
    fetchRange: 3000,
    marketOptions: [
      { value: "ALL", label: "全部交易所" },
      { value: "TWSE", label: "上市 TWSE" },
      { value: "TPEX", label: "上櫃 TPEX" },
    ],
  },
  US: {
    key: "US",
    label: "美股",
    screenerLabel: "TradingView 美股掃描",
    titleLabel: "台股 / 美股型態條件雷達",
    scanMarket: "america",
    scanUrl: "https://scanner.tradingview.com/america/scan",
    screenerUrl: "https://www.tradingview.com/screener/",
    locale: "en",
    fetchRange: 15000,
    marketOptions: [
      { value: "ALL", label: "全部交易所" },
      { value: "NASDAQ", label: "NASDAQ" },
      { value: "NYSE", label: "NYSE" },
      { value: "AMEX", label: "AMEX" },
      { value: "OTC", label: "OTC" },
    ],
  },
};
const COLUMNS = [
  "name",
  "description",
  "close",
  "time",
  "change",
  "Perf.W",
  "Perf.1M",
  "Perf.3M",
  "Perf.6M",
  "Volatility.W",
  "relative_volume_10d_calc",
  "SMA50",
  "SMA150",
  "SMA200",
  "SMA20",
  "price_52_week_high",
  "price_52_week_low",
  "RSI",
  "Recommend.All",
  "market_cap_basic",
  "type",
  "AnalystRating",
];

const MATCH_DEFINITIONS = [
  { key: "bullWeekMatch", filterValue: "BULL_WEEK", label: "多頭本周大跌", badgeClass: "badge-bull-week" },
  { key: "bullMonthMatch", filterValue: "BULL_MONTH", label: "多頭本月大跌", badgeClass: "badge-bull-month" },
  { key: "bearWeekMatch", filterValue: "BEAR_WEEK", label: "空頭本周大漲", badgeClass: "badge-bear-week" },
  { key: "bearMonthMatch", filterValue: "BEAR_MONTH", label: "空頭本月大漲", badgeClass: "badge-bear-month" },
  { key: "cupHandleMatch", filterValue: "CUP_HANDLE", label: "杯柄型態", badgeClass: "badge-cup-handle" },
  { key: "strongCupVcpMatch", filterValue: "STRONG_CUP_VCP", label: "強勢杯柄 / VCP", badgeClass: "badge-strong-cup-vcp" },
  { key: "breakoutConfirmMatch", filterValue: "BREAKOUT_CONFIRM", label: "突破確認", badgeClass: "badge-breakout-confirm" },
  { key: "roundingBottomMatch", filterValue: "ROUNDING_BOTTOM", label: "圓弧底 / 深杯轉強", badgeClass: "badge-rounding-bottom" },
  { key: "lowAccumulationLongMatch", filterValue: "LOW_ACCUM_LONG", label: "低檔吸籌長多", badgeClass: "badge-low-accumulation" },
];

function selectAny(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function makeAccumulationAnalysisState(status = "idle") {
  return {
    status,
    universe: null,
    candidateCount: 0,
    matchedCount: 0,
    durationMs: null,
    error: null,
  };
}

const state = {
  loading: false,
  universe: "TAIWAN",
  rows: [],
  filteredRows: [],
  lastUpdated: null,
  previewHideTimer: null,
  requestId: 0,
  accumulationAnalysis: makeAccumulationAnalysisState(),
  accumulationRules: { ...ACCUMULATION_DEFAULT_RULES },
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  universeFilter: document.querySelector("#universeFilter"),
  statusText: document.querySelector("#statusText"),
  bullWeekCount: selectAny(["#bullWeekCount", "#weekCount"]),
  bullMonthCount: selectAny(["#bullMonthCount", "#monthCount"]),
  bearWeekCount: selectAny(["#bearWeekCount", "#bothCount"]),
  bearMonthCount: document.querySelector("#bearMonthCount"),
  cupHandleCount: document.querySelector("#cupHandleCount"),
  strongCupVcpCount: document.querySelector("#strongCupVcpCount"),
  breakoutConfirmCount: document.querySelector("#breakoutConfirmCount"),
  roundingBottomCount: document.querySelector("#roundingBottomCount"),
  lowAccumulationCount: document.querySelector("#lowAccumulationCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  searchInput: document.querySelector("#searchInput"),
  marketFilter: document.querySelector("#marketFilter"),
  matchFilter: document.querySelector("#matchFilter"),
  sortMode: document.querySelector("#sortMode"),
  analystFilter: document.querySelector("#analystFilter"),
  distance20Min: document.querySelector("#distance20Min"),
  distance20Max: document.querySelector("#distance20Max"),
  resultMeta: document.querySelector("#resultMeta"),
  stockTableBody: document.querySelector("#stockTableBody"),
  rowTemplate: document.querySelector("#rowTemplate"),
  preview: document.querySelector("#chartPreview"),
  previewSymbol: document.querySelector("#previewSymbol"),
  previewName: document.querySelector("#previewName"),
  previewLink: document.querySelector("#previewLink"),
  previewFrame: document.querySelector("#previewFrame"),
  protocolWarning: document.querySelector("#protocolWarning"),
  pageTitle: document.querySelector("#pageTitle"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  screenerLink: document.querySelector("#screenerLink"),
  accumulationRuleInputs: Array.from(document.querySelectorAll("[data-accumulation-rule]")),
  accumulationRerunButton: document.querySelector("#accumulationRerunButton"),
  accumulationResetButton: document.querySelector("#accumulationResetButton"),
};

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setHtml(element, value) {
  if (element) {
    element.innerHTML = value;
  }
}

function ruleFieldDefinition(key) {
  return ACCUMULATION_RULE_FIELD_DEFINITIONS.find((field) => field.key === key) || null;
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return formatNumber(value, value >= 1000 ? 0 : 2);
}

function formatCloseDate(epochSeconds) {
  if (epochSeconds == null || Number.isNaN(epochSeconds)) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(new Date(epochSeconds * 1000));
}

function marketLabel(exchange) {
  const labels = {
    TWSE: "上市 TWSE",
    TPEX: "上櫃 TPEX",
    NASDAQ: "NASDAQ",
    NYSE: "NYSE",
    AMEX: "AMEX",
    OTC: "OTC",
  };

  return labels[exchange] || exchange;
}

function distancePercent(close, average) {
  if (close == null || average == null || !average) {
    return null;
  }

  return ((close - average) / average) * 100;
}

function percentBelow(reference, value) {
  if (reference == null || value == null || !reference) {
    return null;
  }

  return ((reference - value) / reference) * 100;
}

function positionWithinRange(value, min, max) {
  if (value == null || min == null || max == null || max <= min) {
    return null;
  }

  return (value - min) / (max - min);
}

function technicalRatingAtLeastNeutral(value) {
  return value != null && !Number.isNaN(value) && value >= 0;
}

function getNumberClass(value) {
  if (value == null || Number.isNaN(value)) {
    return "neutral";
  }

  if (value < 0) {
    return "negative";
  }

  if (value > 0) {
    return "positive";
  }

  return "neutral";
}

function getAnalystBand(rating) {
  if (!rating) {
    return null;
  }

  const map = {
    StrongBuy: { value: "STRONG_BUY", label: "強力買入", tone: "positive", rank: 5 },
    Buy: { value: "BUY", label: "買入", tone: "positive", rank: 4 },
    Neutral: { value: "NEUTRAL", label: "中立", tone: "neutral", rank: 3 },
    Sell: { value: "SELL", label: "賣出", tone: "negative", rank: 2 },
    StrongSell: { value: "STRONG_SELL", label: "強力賣出", tone: "negative", rank: 1 },
    NoRating: { value: "NO_RATING", label: "無評級", tone: "neutral", rank: 0 },
  };

  return map[rating] || { value: "NO_RATING", label: rating, tone: "neutral", rank: 0 };
}

function updateRowMatchState(row) {
  row.anyBullMatch = row.bullWeekMatch || row.bullMonthMatch;
  row.anyBearMatch = row.bearWeekMatch || row.bearMonthMatch;
  row.anyMatch =
    row.anyBullMatch ||
    row.anyBearMatch ||
    row.cupHandleMatch ||
    row.strongCupVcpMatch ||
    row.breakoutConfirmMatch ||
    row.roundingBottomMatch ||
    row.lowAccumulationLongMatch;

  return row;
}

function activeAccumulationAnalysis() {
  const analysis = state.accumulationAnalysis;
  if (analysis.universe !== state.universe) {
    return makeAccumulationAnalysisState();
  }

  return analysis;
}

function formatAccumulationBadgeTitle(row) {
  const details = row.lowAccumulationMeta;
  if (!details) {
    return "";
  }

  return [
    `250日區間位置 ${formatNumber(details.pricePosition250Pct)}%`,
    `距120日高 ${formatNumber(details.distanceTo120HighPct)}%`,
    `大量倍數 ${formatNumber(details.spikeVolumeMultiple)}x`,
    `距大量日 ${details.daysSinceSpike} 根K`,
    `回檔 ${formatNumber(details.pullbackFromSpikeClosePct)}%`,
  ].join(" / ");
}

function formatRuleInputValue(key, value) {
  const definition = ruleFieldDefinition(key);
  if (!definition) {
    return String(value ?? "");
  }

  if (definition.type === "integer") {
    return String(Math.round(value));
  }

  if (definition.type === "percentRatio") {
    return String(Number((value * 100).toFixed(2)));
  }

  return String(Number(value.toFixed(2)));
}

function parseRuleInputValue(input, fallbackValue) {
  const definition = ruleFieldDefinition(input.dataset.accumulationRule);
  const rawValue = input.value.trim();
  if (!definition || !rawValue) {
    return fallbackValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  if (definition.type === "integer") {
    return Math.round(parsed);
  }

  if (definition.type === "percentRatio") {
    return parsed / 100;
  }

  return parsed;
}

function applyAccumulationRulesToInputs(rules = ACCUMULATION_DEFAULT_RULES) {
  els.accumulationRuleInputs.forEach((input) => {
    const key = input.dataset.accumulationRule;
    if (!key || rules[key] == null) {
      return;
    }

    input.value = formatRuleInputValue(key, rules[key]);
  });
}

function readAccumulationRulesFromInputs() {
  const nextRules = { ...ACCUMULATION_DEFAULT_RULES };

  els.accumulationRuleInputs.forEach((input) => {
    const key = input.dataset.accumulationRule;
    if (!key || !(key in nextRules)) {
      return;
    }

    nextRules[key] = parseRuleInputValue(input, nextRules[key]);
  });

  return nextRules;
}

function clearAccumulationMatches() {
  state.rows = state.rows.map((row) =>
    row.lowAccumulationLongMatch || row.lowAccumulationMeta
      ? updateRowMatchState({
          ...row,
          lowAccumulationLongMatch: false,
          lowAccumulationMeta: null,
        })
      : row,
  );
}

function buildWidgetUrl(symbol) {
  const params = new URLSearchParams({
    frameElementId: "tv_hover_preview",
    symbol,
    interval: "D",
    hidesidetoolbar: "1",
    symboledit: "0",
    saveimage: "0",
    toolbarbg: "f8f2e8",
    studies: "[]",
    theme: "light",
    style: "1",
    timezone: "Asia/Taipei",
    withdateranges: "0",
    hide_side_toolbar: "1",
    allow_symbol_change: "0",
    details: "0",
    hotlist: "0",
    calendar: "0",
    locale: "zh_TW",
  });

  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function buildSymbolPageUrl(symbol) {
  return `https://tw.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function getUniverseConfig(universe = state.universe) {
  return UNIVERSE_CONFIG[universe] || UNIVERSE_CONFIG.TAIWAN;
}

function populateMarketFilter() {
  if (!els.marketFilter) {
    return;
  }

  const { marketOptions } = getUniverseConfig();
  const previousValue = els.marketFilter.value;
  els.marketFilter.innerHTML = marketOptions
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");

  const hasPreviousValue = marketOptions.some((option) => option.value === previousValue);
  els.marketFilter.value = hasPreviousValue ? previousValue : "ALL";
}

function syncUniverseUi() {
  const config = getUniverseConfig();

  if (els.universeFilter) {
    els.universeFilter.value = state.universe;
  }

  if (els.pageTitle) {
    els.pageTitle.textContent = config.titleLabel;
  }

  if (els.pageEyebrow) {
    els.pageEyebrow.textContent = config.screenerLabel;
  }

  if (els.screenerLink) {
    els.screenerLink.href = config.screenerUrl;
  }

  populateMarketFilter();
}

function normaliseRow(item) {
  const [exchange, code] = item.s.split(":");
  const [
    name,
    description,
    close,
    closeTime,
    change,
    perfWeek,
    perfMonth,
    perfThreeMonth,
    perfSixMonth,
    volatilityWeek,
    relativeVolume,
    sma50,
    sma150,
    sma200,
    sma20,
    high52w,
    low52w,
    rsi,
    technicalRating,
    marketCap,
    type,
    analystRating,
  ] = item.d;

  const isStock = type === "stock" && close != null;
  const bullWeekMatch = isStock && close > sma200 && perfWeek != null && perfWeek <= -5;
  const bullMonthMatch = isStock && close > sma200 && perfMonth != null && perfMonth <= -10;
  const bearWeekMatch = isStock && close < sma200 && perfWeek != null && perfWeek >= 5;
  const bearMonthMatch = isStock && close < sma200 && perfMonth != null && perfMonth >= 10;
  const distance52wHighPct = percentBelow(high52w, close);
  const distance52wLowPct = distancePercent(close, low52w);
  const cupHandleMatch =
    isStock &&
    sma50 != null &&
    sma150 != null &&
    sma200 != null &&
    high52w != null &&
    perfSixMonth != null &&
    rsi != null &&
    close > sma50 &&
    close > sma150 &&
    close > sma200 &&
    distance52wHighPct != null &&
    distance52wHighPct < 20 &&
    perfSixMonth > 0 &&
    rsi >= 50 &&
    rsi <= 70;
  const strongCupVcpMatch =
    isStock &&
    sma50 != null &&
    sma150 != null &&
    sma200 != null &&
    high52w != null &&
    perfSixMonth != null &&
    rsi != null &&
    relativeVolume != null &&
    close > sma50 &&
    close > sma150 &&
    close > sma200 &&
    sma50 > sma150 &&
    distance52wHighPct != null &&
    distance52wHighPct < 20 &&
    perfSixMonth > 10 &&
    rsi >= 50 &&
    rsi <= 70 &&
    relativeVolume < 1.2;
  const breakoutConfirmMatch =
    isStock &&
    sma20 != null &&
    sma50 != null &&
    high52w != null &&
    change != null &&
    relativeVolume != null &&
    rsi != null &&
    close > sma20 &&
    close > sma50 &&
    change > 2 &&
    relativeVolume > 1.5 &&
    rsi >= 60 &&
    rsi <= 75 &&
    distance52wHighPct != null &&
    distance52wHighPct < 10;
  const roundingBottomMatch =
    isStock &&
    sma50 != null &&
    perfMonth != null &&
    perfThreeMonth != null &&
    low52w != null &&
    rsi != null &&
    relativeVolume != null &&
    close > sma50 &&
    perfMonth > 0 &&
    perfThreeMonth > 5 &&
    distance52wLowPct != null &&
    distance52wLowPct > 30 &&
    rsi >= 50 &&
    rsi <= 70 &&
    relativeVolume > 1.0 &&
    technicalRatingAtLeastNeutral(technicalRating);
  const analystBand = getAnalystBand(analystRating);

  return updateRowMatchState({
    id: item.s,
    symbol: item.s,
    exchange,
    code,
    name: description || name || code,
    shortName: name || code,
    close,
    closeTime,
    change,
    perfWeek,
    perfMonth,
    perfThreeMonth,
    perfSixMonth,
    volatilityWeek,
    relativeVolume,
    sma50,
    sma150,
    sma200,
    sma20,
    high52w,
    low52w,
    rsi,
    technicalRating,
    marketCap,
    type,
    analystRating,
    analystBand,
    bullWeekMatch,
    bullMonthMatch,
    bearWeekMatch,
    bearMonthMatch,
    cupHandleMatch,
    strongCupVcpMatch,
    breakoutConfirmMatch,
    roundingBottomMatch,
    lowAccumulationLongMatch: false,
    lowAccumulationMeta: null,
    distanceSma200Pct: distancePercent(close, sma200),
    distanceSma20Pct: distancePercent(close, sma20),
    distance52wHighPct,
    distance52wLowPct,
  });
}

async function fetchStocks() {
  const config = getUniverseConfig();
  const payload = {
    filter: [{ left: "type", operation: "equal", right: "stock" }],
    options: { lang: config.locale },
    range: [0, config.fetchRange],
    sort: { sortBy: "name", sortOrder: "asc" },
    columns: COLUMNS,
  };

  if (config.key === "TAIWAN") {
    payload.filter.push({ left: "exchange", operation: "in_range", right: ["TWSE", "TPEX"] });
  }

  let response;

  try {
    response = await fetch(`${SCAN_PROXY_URL}?market=${encodeURIComponent(config.scanMarket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`proxy ${response.status}`);
    }
  } catch {
    response = await fetch(config.scanUrl, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    throw new Error(`資料請求失敗 (${response.status})`);
  }

  const json = await response.json();

  if (!Array.isArray(json.data)) {
    throw new Error("資料格式不正確");
  }

  return json.data.map(normaliseRow);
}

function shouldAnalyzeAccumulationHistory(row, rules = state.accumulationRules) {
  if (row.type !== "stock" || row.close == null) {
    return false;
  }

  const rangePosition = positionWithinRange(row.close, row.low52w, row.high52w);
  const candidatePricePositionMax = Math.min(rules.maxPricePosition + 0.2, 0.9);
  const candidateDistanceToHighMax = Math.max(rules.maxDistanceToHighPct + 25, 15);
  return (
    rangePosition != null &&
    rangePosition <= candidatePricePositionMax &&
    row.distance52wHighPct != null &&
    row.distance52wHighPct <= candidateDistanceToHighMax
  );
}

function currentAccumulationMarket() {
  return getUniverseConfig().scanMarket;
}

async function scanAccumulationLongMatches(requestId) {
  clearAccumulationMatches();
  const candidates = state.rows.filter((row) => shouldAnalyzeAccumulationHistory(row, state.accumulationRules)).map((row) => row.symbol);
  state.accumulationAnalysis = {
    status: "loading",
    universe: state.universe,
    candidateCount: candidates.length,
    matchedCount: 0,
    durationMs: null,
    error: null,
  };
  updateSummary(state.rows);
  applyFilters();

  if (!candidates.length) {
    state.accumulationAnalysis = {
      status: "ready",
      universe: state.universe,
      candidateCount: 0,
      matchedCount: 0,
      durationMs: 0,
      error: null,
    };
    updateSummary(state.rows);
    applyFilters();
    return;
  }

  try {
    const response = await fetch(`${ACCUMULATION_PROXY_URL}?market=${encodeURIComponent(currentAccumulationMarket())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: candidates, rules: state.accumulationRules }),
    });

    if (!response.ok) {
      throw new Error(`history ${response.status}`);
    }

    const payload = await response.json();
    if (requestId !== state.requestId) {
      return;
    }

    if (payload.rules) {
      state.accumulationRules = { ...state.accumulationRules, ...payload.rules };
      applyAccumulationRulesToInputs(state.accumulationRules);
    }

    const resultMap = new Map((payload.results || []).map((result) => [result.symbol, result]));
    state.rows = state.rows.map((row) => {
      const result = resultMap.get(row.symbol);
      if (!result) {
        return row;
      }

      return updateRowMatchState({
        ...row,
        lowAccumulationLongMatch: Boolean(result.match),
        lowAccumulationMeta: result.details || null,
      });
    });

    state.accumulationAnalysis = {
      status: "ready",
      universe: state.universe,
      candidateCount: payload.requested || candidates.length,
      matchedCount: payload.matched || 0,
      durationMs: payload.durationMs || null,
      error: null,
    };
    updateSummary(state.rows);
    applyFilters();

    const baseCount = state.rows.length.toLocaleString("zh-TW");
    const matchedCount = state.accumulationAnalysis.matchedCount.toLocaleString("zh-TW");
    setText(
      els.statusText,
      `更新完成，共取得 ${baseCount} 檔${getUniverseConfig().label}資料；低檔吸籌長多歷史結構掃描完成，候選 ${candidates.length.toLocaleString("zh-TW")} 檔、命中 ${matchedCount} 檔。`,
    );
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    state.accumulationAnalysis = {
      status: "failed",
      universe: state.universe,
      candidateCount: candidates.length,
      matchedCount: 0,
      durationMs: null,
      error: error.message,
    };
    updateSummary(state.rows);
    applyFilters();
    setText(
      els.statusText,
      `快照更新完成，但低檔吸籌長多歷史結構掃描失敗：${error.message}。其他條件仍可正常使用。`,
    );
  }
}

function rerunAccumulationAnalysis() {
  if (state.loading || !state.rows.length) {
    return;
  }

  state.accumulationRules = readAccumulationRulesFromInputs();
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setText(els.statusText, "正在依照新的低檔吸籌長多參數重跑歷史結構分析...");
  void scanAccumulationLongMatches(requestId);
}

function updateSummary(rows) {
  setText(els.bullWeekCount, rows.filter((row) => row.bullWeekMatch).length.toLocaleString("zh-TW"));
  setText(els.bullMonthCount, rows.filter((row) => row.bullMonthMatch).length.toLocaleString("zh-TW"));
  setText(els.bearWeekCount, rows.filter((row) => row.bearWeekMatch).length.toLocaleString("zh-TW"));
  setText(els.bearMonthCount, rows.filter((row) => row.bearMonthMatch).length.toLocaleString("zh-TW"));
  setText(els.cupHandleCount, rows.filter((row) => row.cupHandleMatch).length.toLocaleString("zh-TW"));
  setText(els.strongCupVcpCount, rows.filter((row) => row.strongCupVcpMatch).length.toLocaleString("zh-TW"));
  setText(els.breakoutConfirmCount, rows.filter((row) => row.breakoutConfirmMatch).length.toLocaleString("zh-TW"));
  setText(els.roundingBottomCount, rows.filter((row) => row.roundingBottomMatch).length.toLocaleString("zh-TW"));
  const accumulation = activeAccumulationAnalysis();
  if (accumulation.status === "ready") {
    setText(els.lowAccumulationCount, rows.filter((row) => row.lowAccumulationLongMatch).length.toLocaleString("zh-TW"));
  } else if (accumulation.status === "loading") {
    setText(els.lowAccumulationCount, "...");
  } else {
    setText(els.lowAccumulationCount, "—");
  }
}

function parseInputNumber(input) {
  const value = input.value.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesRange(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return min == null && max == null;
  }

  if (min != null && value < min) {
    return false;
  }

  if (max != null && value > max) {
    return false;
  }

  return true;
}

function matchesMode(row, matchMode) {
  if (matchMode === "ALL_STOCKS") {
    return true;
  }

  if (matchMode === "MATCHED_ALL") {
    return row.anyMatch;
  }

  if (matchMode === "BULL_ALL") {
    return row.anyBullMatch;
  }

  if (matchMode === "BEAR_ALL") {
    return row.anyBearMatch;
  }

  if (matchMode === "BULL_WEEK") {
    return row.bullWeekMatch;
  }

  if (matchMode === "BULL_MONTH") {
    return row.bullMonthMatch;
  }

  if (matchMode === "BEAR_WEEK") {
    return row.bearWeekMatch;
  }

  if (matchMode === "BEAR_MONTH") {
    return row.bearMonthMatch;
  }

  if (matchMode === "CUP_HANDLE") {
    return row.cupHandleMatch;
  }

  if (matchMode === "STRONG_CUP_VCP") {
    return row.strongCupVcpMatch;
  }

  if (matchMode === "BREAKOUT_CONFIRM") {
    return row.breakoutConfirmMatch;
  }

  if (matchMode === "ROUNDING_BOTTOM") {
    return row.roundingBottomMatch;
  }

  if (matchMode === "LOW_ACCUM_LONG") {
    return row.lowAccumulationLongMatch;
  }

  return row.anyMatch;
}

function matchesAnalystFilter(row, analystFilter) {
  if (analystFilter === "ALL") {
    return true;
  }

  return row.analystBand?.value === analystFilter;
}

function applyFilters() {
  const keyword = els.searchInput?.value.trim().toLowerCase() || "";
  const market = els.marketFilter?.value || "ALL";
  const matchMode = els.matchFilter?.value || "ALL_STOCKS";
  const sortMode = els.sortMode?.value || "AUTO";
  const analystFilter = els.analystFilter?.value || "ALL";
  const distance20Min = parseInputNumber(els.distance20Min);
  const distance20Max = parseInputNumber(els.distance20Max);

  const filtered = state.rows.filter((row) => {
    if (!matchesMode(row, matchMode)) {
      return false;
    }

    if (market !== "ALL" && row.exchange !== market) {
      return false;
    }

    if (!matchesAnalystFilter(row, analystFilter)) {
      return false;
    }

    if (!matchesRange(row.distanceSma20Pct, distance20Min, distance20Max)) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const haystack = `${row.code} ${row.name} ${row.shortName} ${row.exchange}`.toLowerCase();
    return haystack.includes(keyword);
  });

  const sorted = [...filtered].sort((left, right) => compareRows(left, right, sortMode, matchMode));
  state.filteredRows = sorted;
  renderRows(sorted);
  const accumulation = activeAccumulationAnalysis();
  const accumulationSuffix =
    accumulation.status === "loading"
      ? `；低檔吸籌長多分析中（候選 ${accumulation.candidateCount.toLocaleString("zh-TW")} 檔）`
      : accumulation.status === "ready"
        ? `；低檔吸籌長多命中 ${accumulation.matchedCount.toLocaleString("zh-TW")} 檔`
        : "";
  setText(
    els.resultMeta,
    `${getUniverseConfig().label}顯示 ${sorted.length.toLocaleString("zh-TW")} 檔 / 原始掃描 ${state.rows.length.toLocaleString("zh-TW")} 檔${accumulationSuffix}`,
  );
}

function effectiveSortMode(sortMode, matchMode) {
  if (sortMode !== "AUTO") {
    return sortMode;
  }

  if (matchMode === "ALL_STOCKS") {
    return "DISTANCE_SMA200_ASC";
  }

  if (matchMode === "BULL_WEEK") {
    return "BULL_WEEK";
  }

  if (matchMode === "BULL_MONTH") {
    return "BULL_MONTH";
  }

  if (matchMode === "BEAR_WEEK") {
    return "BEAR_WEEK";
  }

  if (matchMode === "BEAR_MONTH") {
    return "BEAR_MONTH";
  }

  if (matchMode === "CUP_HANDLE") {
    return "CUP_HANDLE";
  }

  if (matchMode === "STRONG_CUP_VCP") {
    return "STRONG_CUP_VCP";
  }

  if (matchMode === "BREAKOUT_CONFIRM") {
    return "BREAKOUT_CONFIRM";
  }

  if (matchMode === "ROUNDING_BOTTOM") {
    return "ROUNDING_BOTTOM";
  }

  if (matchMode === "LOW_ACCUM_LONG") {
    return "LOW_ACCUM_LONG";
  }

  return "DISTANCE_SMA200_ASC";
}

function compareNumeric(a, b, { direction = "asc", absolute = false } = {}) {
  if (a == null || Number.isNaN(a)) {
    return b == null || Number.isNaN(b) ? 0 : 1;
  }

  if (b == null || Number.isNaN(b)) {
    return -1;
  }

  const left = absolute ? Math.abs(a) : a;
  const right = absolute ? Math.abs(b) : b;
  return direction === "desc" ? right - left : left - right;
}

function compareRows(left, right, sortMode, matchMode) {
  const effectiveMode = effectiveSortMode(sortMode, matchMode);

  if (effectiveMode === "BULL_WEEK") {
    return (
      compareNumeric(left.perfWeek, right.perfWeek) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BEAR_WEEK") {
    return (
      compareNumeric(left.perfWeek, right.perfWeek, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BULL_MONTH") {
    return (
      compareNumeric(left.perfMonth, right.perfMonth) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BEAR_MONTH") {
    return (
      compareNumeric(left.perfMonth, right.perfMonth, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "DISTANCE_SMA20_ASC") {
    return (
      compareNumeric(left.distanceSma20Pct, right.distanceSma20Pct, { absolute: true }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "RATING_DESC") {
    return (
      compareNumeric(left.analystBand?.rank, right.analystBand?.rank, { direction: "desc" }) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "RATING_ASC") {
    return (
      compareNumeric(left.analystBand?.rank, right.analystBand?.rank) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "VOL_DESC") {
    return (
      compareNumeric(left.volatilityWeek, right.volatilityWeek, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "CUP_HANDLE") {
    return (
      compareNumeric(left.distance52wHighPct, right.distance52wHighPct) ||
      compareNumeric(left.perfSixMonth, right.perfSixMonth, { direction: "desc" }) ||
      compareNumeric(left.rsi, right.rsi, { direction: "desc" }) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "STRONG_CUP_VCP") {
    return (
      compareNumeric(left.distance52wHighPct, right.distance52wHighPct) ||
      compareNumeric(left.perfSixMonth, right.perfSixMonth, { direction: "desc" }) ||
      compareNumeric(left.relativeVolume, right.relativeVolume) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "BREAKOUT_CONFIRM") {
    return (
      compareNumeric(left.change, right.change, { direction: "desc" }) ||
      compareNumeric(left.relativeVolume, right.relativeVolume, { direction: "desc" }) ||
      compareNumeric(left.distance52wHighPct, right.distance52wHighPct) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "ROUNDING_BOTTOM") {
    return (
      compareNumeric(left.perfThreeMonth, right.perfThreeMonth, { direction: "desc" }) ||
      compareNumeric(left.distance52wLowPct, right.distance52wLowPct, { direction: "desc" }) ||
      compareNumeric(left.relativeVolume, right.relativeVolume, { direction: "desc" }) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  if (effectiveMode === "LOW_ACCUM_LONG") {
    return (
      compareNumeric(left.lowAccumulationMeta?.distanceTo120HighPct, right.lowAccumulationMeta?.distanceTo120HighPct) ||
      compareNumeric(left.lowAccumulationMeta?.pullbackFromSpikeClosePct, right.lowAccumulationMeta?.pullbackFromSpikeClosePct) ||
      compareNumeric(left.lowAccumulationMeta?.spikeVolumeMultiple, right.lowAccumulationMeta?.spikeVolumeMultiple, {
        direction: "desc",
      }) ||
      compareNumeric(left.lowAccumulationMeta?.daysSinceSpike, right.lowAccumulationMeta?.daysSinceSpike) ||
      left.code.localeCompare(right.code, "zh-Hant")
    );
  }

  return (
    compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true }) ||
    compareNumeric(left.distanceSma20Pct, right.distanceSma20Pct, { absolute: true }) ||
    left.code.localeCompare(right.code, "zh-Hant")
  );
}

function renderRows(rows) {
  if (!els.stockTableBody) {
    return;
  }

  els.stockTableBody.innerHTML = "";

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const accumulation = activeAccumulationAnalysis();
    let emptyMessage = "沒有符合目前條件的股票。";
    if ((els.matchFilter?.value || "ALL_STOCKS") === "LOW_ACCUM_LONG") {
      if (accumulation.status === "loading") {
        emptyMessage = "低檔吸籌長多歷史結構掃描中，請稍候...";
      } else if (accumulation.status === "failed") {
        emptyMessage = "低檔吸籌長多歷史結構掃描失敗，請重新整理後再試。";
      }
    }

    emptyRow.innerHTML = `<td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">${emptyMessage}</td>`;
    els.stockTableBody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td class="match-cell"></td>
      <td class="symbol-cell"></td>
      <td class="number-cell close-cell"></td>
      <td class="close-date-cell"></td>
      <td class="number-cell week-cell"></td>
      <td class="number-cell month-cell"></td>
      <td class="number-cell vol-cell"></td>
      <td class="rating-cell"></td>
      <td class="number-cell sma-cell"></td>
      <td class="number-cell distance200-cell"></td>
      <td class="number-cell sma20-cell"></td>
      <td class="number-cell distance20-cell"></td>
      <td class="market-cell"></td>
    `;
    const matchCell = node.querySelector(".match-cell");
    const symbolCell = node.querySelector(".symbol-cell");
    const closeCell = node.querySelector(".close-cell");
    const closeDateCell = node.querySelector(".close-date-cell");
    const weekCell = node.querySelector(".week-cell");
    const monthCell = node.querySelector(".month-cell");
    const volCell = node.querySelector(".vol-cell");
    const ratingCell = node.querySelector(".rating-cell");
    const smaCell = node.querySelector(".sma-cell");
    const distance200Cell = node.querySelector(".distance200-cell");
    const sma20Cell = node.querySelector(".sma20-cell");
    const distance20Cell = node.querySelector(".distance20-cell");
    const marketCell = node.querySelector(".market-cell");

    matchCell.appendChild(buildMatchBadges(row));
    symbolCell.appendChild(buildSymbolButton(row));
    setText(closeCell, formatPrice(row.close));
    setText(closeDateCell, formatCloseDate(row.closeTime));
    setText(weekCell, formatPercent(row.perfWeek));
    setText(monthCell, formatPercent(row.perfMonth));
    setText(volCell, formatPercent(row.volatilityWeek));
    if (ratingCell) {
      ratingCell.appendChild(buildRatingCell(row));
    }
    setText(smaCell, formatPrice(row.sma200));
    setText(distance200Cell, formatPercent(row.distanceSma200Pct));
    setText(sma20Cell, formatPrice(row.sma20));
    setText(distance20Cell, formatPercent(row.distanceSma20Pct));
    setHtml(marketCell, `<span class="market-chip">${marketLabel(row.exchange)}</span>`);

    if (weekCell) weekCell.className = `number-cell week-cell ${getNumberClass(row.perfWeek)}`;
    if (monthCell) monthCell.className = `number-cell month-cell ${getNumberClass(row.perfMonth)}`;
    if (volCell) volCell.className = `number-cell vol-cell ${getNumberClass(row.volatilityWeek)}`;
    if (distance200Cell) distance200Cell.className = `number-cell distance200-cell ${getNumberClass(row.distanceSma200Pct)}`;
    if (distance20Cell) distance20Cell.className = `number-cell distance20-cell ${getNumberClass(row.distanceSma20Pct)}`;

    fragment.appendChild(node);
  });

  els.stockTableBody.appendChild(fragment);
}

function buildMatchBadges(row) {
  const wrap = document.createElement("div");
  wrap.className = "match-badges";

  MATCH_DEFINITIONS.forEach((definition) => {
    if (row[definition.key]) {
      const title = definition.key === "lowAccumulationLongMatch" ? formatAccumulationBadgeTitle(row) : "";
      wrap.appendChild(makeBadge(definition.label, definition.badgeClass, title));
    }
  });

  return wrap;
}

function makeBadge(text, className, title = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = text;
  if (title) {
    badge.title = title;
  }
  return badge;
}

function buildRatingCell(row) {
  const wrap = document.createElement("div");
  wrap.className = "rating-stack";

  if (!row.analystBand) {
    wrap.innerHTML = '<strong class="neutral">無評級</strong>';
    return wrap;
  }

  const label = document.createElement("strong");
  label.className = row.analystBand.tone;
  label.textContent = row.analystBand.label;
  wrap.append(label);
  return wrap;
}

function buildSymbolButton(row) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "symbol-button";
  button.dataset.symbol = row.symbol;
  button.dataset.name = row.name;

  button.innerHTML = `<strong>${row.code}</strong><span>${row.name}</span>`;

  button.addEventListener("mouseenter", (event) => showPreview(event.currentTarget, row));
  button.addEventListener("focus", (event) => showPreview(event.currentTarget, row));
  button.addEventListener("mouseleave", schedulePreviewHide);
  button.addEventListener("blur", schedulePreviewHide);
  button.addEventListener("click", () => {
    window.open(buildSymbolPageUrl(row.symbol), "_blank", "noopener,noreferrer");
  });

  return button;
}

function showPreview(anchor, row) {
  clearTimeout(state.previewHideTimer);
  if (!els.preview || !els.previewSymbol || !els.previewName || !els.previewLink || !els.previewFrame) {
    return;
  }

  els.preview.classList.remove("hidden");
  setText(els.previewSymbol, row.symbol);
  setText(els.previewName, row.name);
  els.previewLink.href = buildSymbolPageUrl(row.symbol);

  const nextSrc = buildWidgetUrl(row.symbol);
  if (els.previewFrame.src !== nextSrc) {
    els.previewFrame.src = nextSrc;
  }

  positionPreview(anchor);
}

function positionPreview(anchor) {
  const rect = anchor.getBoundingClientRect();
  const previewRect = els.preview.getBoundingClientRect();
  const width = previewRect.width || 390;
  const height = previewRect.height || 320;

  let left = rect.right + 18;
  let top = rect.top - 8;

  if (left + width > window.innerWidth - 12) {
    left = Math.max(12, rect.left - width - 18);
  }

  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - height - 12);
  }

  els.preview.style.left = `${left}px`;
  els.preview.style.top = `${top}px`;
}

function schedulePreviewHide() {
  clearTimeout(state.previewHideTimer);
  state.previewHideTimer = window.setTimeout(() => {
    els.preview.classList.add("hidden");
  }, 180);
}

async function refreshData() {
  if (state.loading) {
    return;
  }

  const config = getUniverseConfig();
  state.accumulationRules = readAccumulationRulesFromInputs();
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  state.loading = true;
  state.accumulationAnalysis = {
    ...makeAccumulationAnalysisState("idle"),
    universe: state.universe,
  };
  if (els.refreshButton) {
    els.refreshButton.disabled = true;
  }
  setText(els.statusText, `更新中，正在向 TradingView 取得最新${config.label}掃描資料...`);
  setHtml(
    els.stockTableBody,
    `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">正在更新資料...</td></tr>`,
  );

  try {
    const rows = await fetchStocks();
    if (requestId !== state.requestId) {
      return;
    }

    state.rows = rows;
    state.lastUpdated = new Date();

    updateSummary(state.rows);
    applyFilters();

    const timeText = new Intl.DateTimeFormat("zh-TW", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Taipei",
    }).format(state.lastUpdated);

    setText(els.lastUpdated, timeText);
    setText(
      els.statusText,
      `快照更新完成，共取得 ${state.rows.length.toLocaleString("zh-TW")} 檔${config.label}資料；正在分析低檔吸籌長多歷史結構...`,
    );
    void scanAccumulationLongMatches(requestId);
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    setText(els.statusText, `更新失敗：${error.message}`);
    setHtml(
      els.stockTableBody,
      `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">資料更新失敗，請稍後再試。</td></tr>`,
    );
  } finally {
    state.loading = false;
    if (els.refreshButton) {
      els.refreshButton.disabled = false;
    }
  }
}

function bindEvents() {
  els.refreshButton?.addEventListener("click", refreshData);
  els.accumulationRerunButton?.addEventListener("click", rerunAccumulationAnalysis);
  els.accumulationResetButton?.addEventListener("click", () => {
    applyAccumulationRulesToInputs(ACCUMULATION_DEFAULT_RULES);
    state.accumulationRules = { ...ACCUMULATION_DEFAULT_RULES };
    if (state.rows.length && !state.loading) {
      rerunAccumulationAnalysis();
    }
  });
  els.universeFilter?.addEventListener("change", () => {
    state.universe = els.universeFilter.value || "TAIWAN";
    syncUniverseUi();
    refreshData();
  });
  els.searchInput?.addEventListener("input", applyFilters);
  els.marketFilter?.addEventListener("change", applyFilters);
  els.matchFilter?.addEventListener("change", applyFilters);
  els.sortMode?.addEventListener("change", applyFilters);
  els.analystFilter?.addEventListener("change", applyFilters);
  els.distance20Min?.addEventListener("input", applyFilters);
  els.distance20Max?.addEventListener("input", applyFilters);
  els.accumulationRuleInputs.forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        rerunAccumulationAnalysis();
      }
    });
  });
  els.preview?.addEventListener("mouseenter", () => clearTimeout(state.previewHideTimer));
  els.preview?.addEventListener("mouseleave", schedulePreviewHide);
  window.addEventListener("scroll", () => els.preview?.classList.add("hidden"), { passive: true });
  window.addEventListener("resize", () => els.preview?.classList.add("hidden"));
}

function initWarnings() {
  if (window.location.protocol === "file:") {
    els.protocolWarning?.classList.remove("hidden");
    setText(
      els.statusText,
      "偵測到你是直接開啟檔案。請先用本地 HTTP 伺服器開啟這個資料夾，才能抓 TradingView 最新資料。",
    );
    setText(els.lastUpdated, "請改用本地伺服器");
    setHtml(
      els.stockTableBody,
      `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">請用本地伺服器開啟，建議使用 \`node server.js\`。</td></tr>`,
    );
    return false;
  }

  return true;
}

window.stockRadar = {
  refreshData,
  rerunAccumulationAnalysis,
  setUniverse(universe) {
    if (!UNIVERSE_CONFIG[universe]) {
      return;
    }

    state.universe = universe;
    syncUniverseUi();
    refreshData();
  },
  get state() {
    return state;
  },
  showPreviewBySymbol(symbol) {
    const row = state.filteredRows.find((item) => item.symbol === symbol);
    const trigger = document.querySelector(`.symbol-button[data-symbol="${symbol}"]`);
    if (row && trigger) {
      showPreview(trigger, row);
    }
  },
};

applyAccumulationRulesToInputs(state.accumulationRules);
syncUniverseUi();
bindEvents();
if (initWarnings()) {
  refreshData();
}
