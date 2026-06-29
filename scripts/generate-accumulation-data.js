const fs = require("fs/promises");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "data");
const HISTORY_RANGE = "2y";
const HISTORY_INTERVAL = "1d";
const HISTORY_CONCURRENCY = 10;
const YAHOO_HISTORY_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
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

const MARKET_CONFIG = {
  taiwan: {
    market: "taiwan",
    outputName: "accumulation-taiwan.json",
    locale: "zh_TW",
    fetchRange: 3000,
    filter: [{ left: "exchange", operation: "in_range", right: ["TWSE", "TPEX"] }],
  },
  america: {
    market: "america",
    outputName: "accumulation-america.json",
    locale: "en",
    fetchRange: 15000,
    filter: [],
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

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
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

function normalizeRow(item) {
  const [exchange, code] = item.s.split(":");
  const [, description, close, closeTime, change, perfWeek, perfMonth, perfThreeMonth, perfSixMonth, volatilityWeek, relativeVolume, sma50, sma150, sma200, sma20, high52w, low52w, rsi, technicalRating, marketCap, type, analystRating] =
    item.d;

  return {
    symbol: item.s,
    exchange,
    code,
    name: description || code,
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
    distance52wHighPct: percentBelow(high52w, close),
    rangePosition52w: positionWithinRange(close, low52w, high52w),
  };
}

function shouldAnalyzeAccumulationHistory(row, rules = ACCUMULATION_DEFAULT_RULES) {
  if (row.type !== "stock" || row.close == null) {
    return false;
  }

  const candidatePricePositionMax = Math.min(rules.maxPricePosition + 0.2, 0.9);
  const candidateDistanceToHighMax = Math.max(rules.maxDistanceToHighPct + 25, 15);

  return (
    row.rangePosition52w != null &&
    row.rangePosition52w <= candidatePricePositionMax &&
    row.distance52wHighPct != null &&
    row.distance52wHighPct <= candidateDistanceToHighMax
  );
}

function buildYahooSymbolCandidates(symbol, market) {
  const [exchange, code] = String(symbol || "").split(":");
  if (!code) {
    return [String(symbol || "")];
  }

  if (exchange === "TPEX") {
    return [`${code}.TWO`, `${code}.TW`];
  }

  if (exchange === "TWSE") {
    return [`${code}.TW`];
  }

  if (market === "taiwan") {
    return [`${code}.TW`, `${code}.TWO`];
  }

  return [code.replace(/[./]/g, "-")];
}

async function fetchHistoryBars(symbol, market) {
  let lastError = new Error("history unavailable");

  for (const yahooSymbol of buildYahooSymbolCandidates(symbol, market)) {
    for (const host of YAHOO_HISTORY_HOSTS) {
      const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
      url.searchParams.set("range", HISTORY_RANGE);
      url.searchParams.set("interval", HISTORY_INTERVAL);
      url.searchParams.set("includePrePost", "false");
      url.searchParams.set("events", "div,splits");

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        lastError = new Error(`history ${response.status}`);
        if ([404, 405].includes(response.status)) {
          continue;
        }

        throw lastError;
      }

      const json = await response.json();
      const result = json?.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const timestamps = result?.timestamp;
      if (!result || !quote || !Array.isArray(timestamps)) {
        lastError = new Error("history payload invalid");
        continue;
      }

      const bars = timestamps
        .map((timestamp, index) => ({
          timestamp,
          open: quote.open?.[index],
          high: quote.high?.[index],
          low: quote.low?.[index],
          close: quote.close?.[index],
          volume: quote.volume?.[index],
        }))
        .filter(
          (bar) =>
            [bar.open, bar.high, bar.low, bar.close, bar.volume].every((value) => Number.isFinite(value)) &&
            bar.volume >= 0,
        );

      if (!bars.length) {
        lastError = new Error("history empty");
        continue;
      }

      return bars;
    }
  }

  throw lastError;
}

function analyseAccumulationLong(bars, rules = ACCUMULATION_DEFAULT_RULES) {
  const {
    rangeLookback,
    spikeLookback,
    highLookback,
    movingAveragePeriod,
    volumeAveragePeriod,
    consolidationLookback,
    minDaysSinceSpike,
    minSpikeVolumeMultiple,
    maxPricePosition,
    maxPullbackPct,
    lowBreakTolerancePct,
    maxConsolidationVolumeRatio,
    maxDistanceToHighPct,
  } = rules;

  const requiredBars = Math.max(rangeLookback, highLookback + 1, movingAveragePeriod, volumeAveragePeriod + spikeLookback);
  if (bars.length < requiredBars) {
    return { match: false, reason: "not_enough_history" };
  }

  const latest = bars[bars.length - 1];
  const rangeBars = bars.slice(-rangeLookback);
  const rangeLow = Math.min(...rangeBars.map((bar) => bar.low));
  const rangeHigh = Math.max(...rangeBars.map((bar) => bar.high));
  if (!(rangeHigh > rangeLow)) {
    return { match: false, reason: "flat_range" };
  }

  const pricePosition = (latest.close - rangeLow) / (rangeHigh - rangeLow);
  if (pricePosition > maxPricePosition) {
    return { match: false, reason: "range_position" };
  }

  const recentCloseAverage = average(bars.slice(-movingAveragePeriod).map((bar) => bar.close));
  if (recentCloseAverage == null || latest.close <= recentCloseAverage) {
    return { match: false, reason: "below_ma60" };
  }

  const priorHighBars = bars.slice(-(highLookback + 1), -1);
  if (priorHighBars.length < highLookback) {
    return { match: false, reason: "not_enough_high_bars" };
  }

  const priorHigh = Math.max(...priorHighBars.map((bar) => bar.high));
  const distanceToHighPct = ((priorHigh - latest.close) / priorHigh) * 100;
  if (!(distanceToHighPct > 0 && distanceToHighPct <= maxDistanceToHighPct)) {
    return { match: false, reason: "distance_to_high" };
  }

  let bestMatch = null;
  const spikeStartIndex = Math.max(volumeAveragePeriod, bars.length - spikeLookback);
  const spikeEndIndex = bars.length - minDaysSinceSpike - 1;

  for (let index = spikeStartIndex; index <= spikeEndIndex; index += 1) {
    const spikeBar = bars[index];
    const averageVolume = average(bars.slice(index - volumeAveragePeriod, index).map((bar) => bar.volume));
    if (!averageVolume) {
      continue;
    }

    const volumeMultiple = spikeBar.volume / averageVolume;
    if (!(spikeBar.close > spikeBar.open && volumeMultiple >= minSpikeVolumeMultiple)) {
      continue;
    }

    const daysSinceSpike = bars.length - 1 - index;
    const pullbackPct = Math.max(0, ((spikeBar.close - latest.close) / spikeBar.close) * 100);
    if (pullbackPct > maxPullbackPct) {
      continue;
    }

    const consolidationBars = bars.slice(Math.max(index + 1, bars.length - consolidationLookback));
    if (!consolidationBars.length) {
      continue;
    }

    const consolidationLow = Math.min(...consolidationBars.map((bar) => bar.low));
    if (consolidationLow < spikeBar.low * (1 - lowBreakTolerancePct)) {
      continue;
    }

    const consolidationAvgVolume = average(consolidationBars.map((bar) => bar.volume));
    const consolidationVolumeRatio = consolidationAvgVolume / spikeBar.volume;
    if (!(consolidationVolumeRatio < maxConsolidationVolumeRatio)) {
      continue;
    }

    const score =
      volumeMultiple * 100 -
      pullbackPct * 6 -
      distanceToHighPct * 8 +
      Math.min(daysSinceSpike, 25);

    const candidate = {
      match: true,
      details: {
        pricePosition250Pct: roundMetric(pricePosition * 100),
        distanceTo120HighPct: roundMetric(distanceToHighPct),
        ma60: roundMetric(recentCloseAverage),
        daysSinceSpike,
        spikeVolumeMultiple: roundMetric(volumeMultiple),
        spikeClose: roundMetric(spikeBar.close),
        spikeLow: roundMetric(spikeBar.low),
        pullbackFromSpikeClosePct: roundMetric(pullbackPct),
        consolidationAvgVolumeRatio: roundMetric(consolidationVolumeRatio),
      },
      score,
    };

    if (!bestMatch || candidate.score > bestMatch.score) {
      bestMatch = candidate;
    }
  }

  return bestMatch || { match: false, reason: "no_valid_spike" };
}

async function mapWithConcurrency(items, limit, iterator) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await iterator(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function fetchMarketSnapshot(config) {
  const payload = {
    filter: [{ left: "type", operation: "equal", right: "stock" }, ...config.filter],
    options: { lang: config.locale },
    range: [0, config.fetchRange],
    sort: { sortBy: "name", sortOrder: "asc" },
    columns: COLUMNS,
  };

  const response = await fetch(`https://scanner.tradingview.com/${config.market}/scan`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`snapshot ${config.market} ${response.status}`);
  }

  const json = await response.json();
  return (json.data || []).map(normalizeRow);
}

async function generateMarketFile(config) {
  const snapshotRows = await fetchMarketSnapshot(config);
  const candidates = snapshotRows.filter((row) => shouldAnalyzeAccumulationHistory(row)).map((row) => row.symbol);
  const startedAt = Date.now();
  const results = await mapWithConcurrency(candidates, HISTORY_CONCURRENCY, async (symbol) => {
    try {
      const bars = await fetchHistoryBars(symbol, config.market);
      const analysis = analyseAccumulationLong(bars);
      return {
        symbol,
        match: analysis.match,
        details: analysis.details || null,
        reason: analysis.reason || null,
      };
    } catch (error) {
      return {
        symbol,
        match: false,
        details: null,
        reason: error.message || "history_failed",
      };
    }
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    market: config.market,
    rules: ACCUMULATION_DEFAULT_RULES,
    snapshotCount: snapshotRows.length,
    candidateCount: candidates.length,
    requested: candidates.length,
    matched: results.filter((result) => result.match).length,
    durationMs: Date.now() - startedAt,
    results: results.filter((result) => result.match),
  };

  const outputPath = path.join(OUTPUT_DIR, config.outputName);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Wrote ${outputPath} with ${payload.matched} matches from ${payload.candidateCount} candidates.`);
}

async function main() {
  const requestedMarket = process.argv[2];
  const markets = requestedMarket ? [requestedMarket] : Object.keys(MARKET_CONFIG);

  for (const market of markets) {
    const config = MARKET_CONFIG[market];
    if (!config) {
      throw new Error(`Unsupported market: ${market}`);
    }

    await generateMarketFile(config);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
