const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const SCAN_MARKETS = {
  taiwan: "https://scanner.tradingview.com/taiwan/scan",
  america: "https://scanner.tradingview.com/america/scan",
};
const HISTORY_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const HISTORY_RANGE = "2y";
const HISTORY_INTERVAL = "1d";
const ACCUMULATION_SCAN_CONCURRENCY = 10;
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
const ACCUMULATION_RULE_VALIDATORS = {
  rangeLookback: { min: 30, max: 600, integer: true },
  spikeLookback: { min: 20, max: 300, integer: true },
  highLookback: { min: 20, max: 300, integer: true },
  movingAveragePeriod: { min: 5, max: 250, integer: true },
  volumeAveragePeriod: { min: 5, max: 120, integer: true },
  consolidationLookback: { min: 5, max: 120, integer: true },
  minDaysSinceSpike: { min: 1, max: 120, integer: true },
  minSpikeVolumeMultiple: { min: 1, max: 20 },
  maxPricePosition: { min: 0.05, max: 1 },
  maxPullbackPct: { min: 0.5, max: 50 },
  lowBreakTolerancePct: { min: 0, max: 0.2 },
  maxConsolidationVolumeRatio: { min: 0.05, max: 2 },
  maxDistanceToHighPct: { min: 0.5, max: 50 },
};
const historyCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function average(values) {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function roundMetric(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizeAccumulationRules(rawRules = {}) {
  const normalized = { ...ACCUMULATION_DEFAULT_RULES };

  for (const [key, validator] of Object.entries(ACCUMULATION_RULE_VALIDATORS)) {
    if (rawRules[key] == null || rawRules[key] === "") {
      continue;
    }

    const parsed = Number(rawRules[key]);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid rule: ${key}`);
    }

    const value = validator.integer ? Math.round(parsed) : parsed;
    if (value < validator.min || value > validator.max) {
      throw new Error(`Rule out of range: ${key}`);
    }

    normalized[key] = value;
  }

  if (normalized.minDaysSinceSpike >= normalized.spikeLookback) {
    throw new Error("minDaysSinceSpike must be smaller than spikeLookback");
  }

  if (normalized.consolidationLookback > normalized.spikeLookback) {
    throw new Error("consolidationLookback cannot exceed spikeLookback");
  }

  return normalized;
}

function readJsonBody(req) {
  return new Promise(async (resolve, reject) => {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }

      const body = Buffer.concat(chunks).toString("utf8");
      resolve(body ? JSON.parse(body) : {});
    } catch (error) {
      reject(error);
    }
  });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, error.code === "ENOENT" ? 404 : 500, {
        message: error.code === "ENOENT" ? "Not found" : "File read failed",
      });
      return;
    }

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

async function proxyScan(req, res, market) {
  const scanUrl = SCAN_MARKETS[market];
  if (!scanUrl) {
    sendJson(res, 400, { message: "Unsupported market" });
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const response = await fetch(scanUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await response.text();

  res.writeHead(response.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function toYahooSymbol(symbol, market) {
  const [exchange, code] = String(symbol || "").split(":");
  if (!code) {
    return String(symbol || "");
  }

  if (exchange === "TPEX") {
    return `${code}.TWO`;
  }

  if (exchange === "TWSE" || market === "taiwan") {
    return `${code}.TW`;
  }

  return code.replace(/[./]/g, "-");
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
  const cacheKey = `${market}:${symbol}`;
  const cached = historyCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < HISTORY_CACHE_TTL_MS) {
    return cached.bars;
  }

  const yahooSymbols = buildYahooSymbolCandidates(symbol, market);
  let lastError = new Error("history unavailable");

  for (const yahooSymbol of yahooSymbols) {
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

      historyCache.set(cacheKey, { fetchedAt: now, bars });
      return bars;
    }
  }

  throw lastError;
}

function analyseAccumulationLong(bars, rules) {
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
    const isBullishSpike = spikeBar.close > spikeBar.open && volumeMultiple >= minSpikeVolumeMultiple;
    if (!isBullishSpike) {
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
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        break;
      }

      results[currentIndex] = await iterator(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function handleAccumulationScan(req, res, market) {
  try {
    const body = await readJsonBody(req);
    const rules = normalizeAccumulationRules(body?.rules || {});
    const symbols = Array.isArray(body?.symbols)
      ? [...new Set(body.symbols.filter((symbol) => typeof symbol === "string" && symbol.includes(":")))]
      : [];

    if (!symbols.length) {
      sendJson(res, 400, { message: "No symbols provided" });
      return;
    }

    const startedAt = Date.now();
    const results = await mapWithConcurrency(symbols, ACCUMULATION_SCAN_CONCURRENCY, async (symbol) => {
      try {
        const bars = await fetchHistoryBars(symbol, market);
        const analysis = analyseAccumulationLong(bars, rules);
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

    sendJson(res, 200, {
      market,
      requested: symbols.length,
      matched: results.filter((result) => result.match).length,
      durationMs: Date.now() - startedAt,
      rules,
      results,
    });
  } catch (error) {
    sendJson(res, 400, { message: error.message || "Invalid accumulation request" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/scan") {
      const market = url.searchParams.get("market") || "taiwan";
      await proxyScan(req, res, market);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/accumulation-long") {
      const market = url.searchParams.get("market") || "taiwan";
      await handleAccumulationScan(req, res, market);
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(ROOT, path.normalize(requestedPath));

    if (!filePath.startsWith(ROOT)) {
      sendJson(res, 403, { message: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
  } catch (error) {
    sendJson(res, 500, { message: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
