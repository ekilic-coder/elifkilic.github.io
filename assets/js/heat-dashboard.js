/**
 * ClimaCoder Heat Dashboard — Open-Meteo + EHI-N* powered, client-side
 * Uses pre-computed EHI-N* lookup tables (Kilic, UC Berkeley) for physiological
 * heat stress assessment alongside ERA5 climate data and CMIP6 projections.
 *
 * Usage: HeatDashboard.init({ lat, lon, name, containerId })
 */
const HeatDashboard = (() => {
  /* ---- EHI-N* lookup table (loaded asynchronously) ---- */
  let ehiTable = null;

  async function loadEHITable() {
    try {
      const r = await fetch("/assets/data/ehi_lookup_trimmed.json");
      if (r.ok) ehiTable = await r.json();
    } catch (_) { /* silently fall back to NWS */ }
  }

  /**
   * Look up EHI-N* from pre-computed table with bilinear interpolation.
   * level: "light" (180 W/m²), "moderate" (300 W/m²), or "heavy" (350 W/m²)
   * Returns EHI in °C, or null if out of range.
   */
  function ehiLookup(T_c, RH, level) {
    if (!ehiTable || !ehiTable[level]) return null;
    const tbl = ehiTable[level];
    // Clamp to table range
    const t = Math.max(20, Math.min(55, T_c));
    const rh = Math.max(10, Math.min(100, Math.round(RH)));
    // Find bounding integer temps
    const tLow = Math.floor(t);
    const tHigh = Math.ceil(t);
    const rhStr = String(rh);
    const tLowStr = String(tLow);
    const tHighStr = String(tHigh);
    if (!tbl[tLowStr] || !tbl[tLowStr][rhStr]) return null;
    if (tLow === tHigh) return tbl[tLowStr][rhStr];
    if (!tbl[tHighStr] || !tbl[tHighStr][rhStr]) return tbl[tLowStr][rhStr];
    // Linear interpolation between integer temperatures
    const frac = t - tLow;
    return tbl[tLowStr][rhStr] * (1 - frac) + tbl[tHighStr][rhStr] * frac;
  }

  /* ---- NWS Heat Index (Steadman regression) — kept as comparison baseline ---- */
  function heatIndexNWS(T_c, RH) {
    const T = T_c * 9 / 5 + 32;
    if (T < 80) return T_c;
    let HI = -42.379 + 2.04901523*T + 10.14333127*RH
      - 0.22475541*T*RH - 0.00683783*T*T - 0.05481717*RH*RH
      + 0.00122874*T*T*RH + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH;
    if (RH < 13 && T >= 80 && T <= 112)
      HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    if (RH > 85 && T >= 80 && T <= 87)
      HI += ((RH - 85) / 10) * ((87 - T) / 5);
    return (HI - 32) * 5 / 9;
  }

  /* ---- EHI-N* risk zones (from heatindex.html zone definitions) ---- */
  function ehiRiskZone(ehi) {
    if (ehi < 32) return { label: "Safe", color: "#4caf50" };
    if (ehi < 35) return { label: "Caution", color: "#ffeb3b" };
    if (ehi < 39) return { label: "Extreme Caution", color: "#ff9800" };
    if (ehi < 42) return { label: "Danger", color: "#f44336" };
    return { label: "Extreme Danger", color: "#b71c1c" };
  }

  /* ---- NWS risk zones (traditional) ---- */
  function nwsRiskZone(hi) {
    if (hi < 27) return { label: "Safe", color: "#4caf50" };
    if (hi < 32) return { label: "Caution", color: "#ffeb3b" };
    if (hi < 39) return { label: "Extreme Caution", color: "#ff9800" };
    if (hi < 51) return { label: "Danger", color: "#f44336" };
    return { label: "Extreme Danger", color: "#b71c1c" };
  }

  /* ---- Fetch helpers ---- */
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchJSON(url, retries = 4) {
    for (let i = 0; i < retries; i++) {
      const r = await fetch(url);
      if (r.ok) return r.json();
      if (r.status === 429 && i < retries - 1) {
        await delay(3000 * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error(`API rate limit (${r.status}) \u2014 try refreshing in a minute`);
    }
  }

  /* ---- Current conditions (forecast endpoint) ---- */
  async function fetchCurrent(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m`
      + `&timezone=auto`;
    return fetchJSON(url);
  }

  /* ---- Historical (last 3 years daily) ---- */
  async function fetchHistorical(lat, lon) {
    const now = new Date();
    const end = `${now.getFullYear() - 1}-12-31`;
    const start = `${now.getFullYear() - 4}-01-01`;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
      + `&start_date=${start}&end_date=${end}`
      + `&daily=temperature_2m_max,apparent_temperature_max`
      + `&timezone=auto`;
    return fetchJSON(url);
  }

  /* ---- Long-term annual trend — chunked into 15-year segments ---- */
  async function fetchLongTerm(lat, lon) {
    const endYear = new Date().getFullYear() - 1;
    const startYear = 1980;
    const chunkSize = 15;
    const allDates = [], allTmax = [];

    for (let y = startYear; y <= endYear; y += chunkSize) {
      const s = `${y}-01-01`;
      const e = `${Math.min(y + chunkSize - 1, endYear)}-12-31`;
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
        + `&start_date=${s}&end_date=${e}`
        + `&daily=temperature_2m_max`
        + `&timezone=auto`;
      const chunk = await fetchJSON(url);
      allDates.push(...chunk.daily.time);
      allTmax.push(...chunk.daily.temperature_2m_max);
      if (y + chunkSize <= endYear) await delay(2500);
    }
    return { daily: { time: allDates, temperature_2m_max: allTmax } };
  }

  /* ---- CMIP6 climate projections ---- */
  async function fetchProjections(lat, lon) {
    const url = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lon}`
      + `&start_date=1950-01-01&end_date=2050-12-31`
      + `&models=CMCC_CM2_VHR4,MRI_AGCM3_2_S,EC_Earth3P_HR`
      + `&daily=temperature_2m_max,temperature_2m_min`
      + `&timezone=auto`;
    return fetchJSON(url);
  }

  /* ---- Aggregate daily data to yearly ---- */
  function toYearly(dates, values) {
    const years = {};
    dates.forEach((d, i) => {
      if (values[i] == null) return;
      const y = d.slice(0, 4);
      if (!years[y]) years[y] = [];
      years[y].push(values[i]);
    });
    const keys = Object.keys(years).sort();
    return {
      labels: keys.map(Number),
      means: keys.map(k => years[k].reduce((a, b) => a + b, 0) / years[k].length)
    };
  }

  /* ---- Seasonal heat calendar ---- */
  function seasonalCalendar(dates, tmax, atmax) {
    const byMonth = Array.from({ length: 12 }, () => ({ t: [], at: [] }));
    dates.forEach((d, i) => {
      if (tmax[i] == null) return;
      const m = parseInt(d.slice(5, 7), 10) - 1;
      byMonth[m].t.push(tmax[i]);
      if (atmax[i] != null) byMonth[m].at.push(atmax[i]);
    });
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const nYears = new Set(dates.map(d => d.slice(0,4))).size || 1;
    return {
      months: monthNames,
      avgMax: byMonth.map(b => b.t.length ? b.t.reduce((a, c) => a + c, 0) / b.t.length : null),
      avgApparent: byMonth.map(b => b.at.length ? b.at.reduce((a, c) => a + c, 0) / b.at.length : null),
      daysAbove35: byMonth.map(b => b.at.length ? b.at.filter(v => v >= 35).length / nYears : 0)
    };
  }

  /* ---- Plotly defaults ---- */
  const layoutBase = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.85)",
    font: { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", size: 12 },
    margin: { t: 40, r: 20, b: 50, l: 55 },
    autosize: true
  };
  const config = { responsive: true, displayModeBar: false };

  /* ---- Render: current conditions card with EHI-N* ---- */
  function renderCurrent(container, data, name) {
    const c = data.current;
    const nws = heatIndexNWS(c.temperature_2m, c.relative_humidity_2m);
    const nwsZone = nwsRiskZone(nws);

    // EHI-N* at different work intensities
    const ehiLight = ehiLookup(c.temperature_2m, c.relative_humidity_2m, "light");
    const ehiMod = ehiLookup(c.temperature_2m, c.relative_humidity_2m, "moderate");
    const ehiHeavy = ehiLookup(c.temperature_2m, c.relative_humidity_2m, "heavy");

    const hasEHI = ehiLight !== null;
    const heavyZone = hasEHI ? ehiRiskZone(ehiHeavy) : nwsZone;

    // Build EHI comparison row if lookup table loaded
    let ehiRow = "";
    if (hasEHI) {
      const lz = ehiRiskZone(ehiLight), mz = ehiRiskZone(ehiMod), hz = ehiRiskZone(ehiHeavy);
      ehiRow = `
      <div style="margin-top:0.5rem;display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem">
        <div style="background:white;border-radius:10px;padding:1rem;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-top:3px solid ${lz.color}">
          <div style="font-size:1.4rem;font-weight:800;color:${lz.color}">${ehiLight.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.75rem;color:#666">EHI-N* Light (180 W/m\u00b2)</div>
          <div style="font-size:0.7rem;font-weight:700;color:${lz.color};margin-top:0.2rem">${lz.label}</div>
        </div>
        <div style="background:white;border-radius:10px;padding:1rem;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-top:3px solid ${mz.color}">
          <div style="font-size:1.4rem;font-weight:800;color:${mz.color}">${ehiMod.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.75rem;color:#666">EHI-N* Moderate (300 W/m\u00b2)</div>
          <div style="font-size:0.7rem;font-weight:700;color:${mz.color};margin-top:0.2rem">${mz.label}</div>
        </div>
        <div style="background:white;border-radius:10px;padding:1rem;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-top:3px solid ${hz.color}">
          <div style="font-size:1.4rem;font-weight:800;color:${hz.color}">${ehiHeavy.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.75rem;color:#666">EHI-N* Heavy (350 W/m\u00b2)</div>
          <div style="font-size:0.7rem;font-weight:700;color:${hz.color};margin-top:0.2rem">${hz.label}</div>
        </div>
      </div>`;
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:0.5rem">
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#e65100">${c.temperature_2m.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.8rem;color:#666">Temperature</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#0066cc">${c.relative_humidity_2m}%</div>
          <div style="font-size:0.8rem;color:#666">Humidity</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#e65100">${c.apparent_temperature.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.8rem;color:#666">Feels Like</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:${nwsZone.color}">${nws.toFixed(1)}\u00b0C</div>
          <div style="font-size:0.8rem;color:#666">NWS Heat Index</div>
        </div>
      </div>
      ${ehiRow}
      <p style="color:#999;font-size:0.8rem;text-align:center;margin-top:1rem">
        Live data for ${name} via Open-Meteo | EHI-N* from
        <a href="/research/heatindex.html" style="color:#999">Kili\u00e7 (UC Berkeley)</a>
      </p>`;
  }

  /* ---- Render: index comparison chart ---- */
  function renderIndexComparison(divId, temp, rh) {
    if (!ehiTable) {
      showChartError(divId, "EHI-N* lookup table not available.");
      return;
    }
    // Sweep temperature from 20 to 50 at current RH
    const temps = [];
    for (let t = 20; t <= 50; t += 1) temps.push(t);
    const rhClamped = Math.max(10, Math.min(100, Math.round(rh)));

    const nwsVals = temps.map(t => +heatIndexNWS(t, rhClamped).toFixed(1));
    const ehiLightVals = temps.map(t => { const v = ehiLookup(t, rhClamped, "light"); return v !== null ? +v.toFixed(1) : null; });
    const ehiModVals = temps.map(t => { const v = ehiLookup(t, rhClamped, "moderate"); return v !== null ? +v.toFixed(1) : null; });
    const ehiHeavyVals = temps.map(t => { const v = ehiLookup(t, rhClamped, "heavy"); return v !== null ? +v.toFixed(1) : null; });

    const traces = [
      { x: temps, y: nwsVals, name: "NWS Heat Index", type: "scatter", mode: "lines",
        line: { color: "#999", width: 2, dash: "dot" } },
      { x: temps, y: ehiLightVals, name: "EHI-N* Light (180 W/m\u00b2)", type: "scatter", mode: "lines",
        line: { color: "#4caf50", width: 2 } },
      { x: temps, y: ehiModVals, name: "EHI-N* Moderate (300 W/m\u00b2)", type: "scatter", mode: "lines",
        line: { color: "#ff9800", width: 2 } },
      { x: temps, y: ehiHeavyVals, name: "EHI-N* Heavy (350 W/m\u00b2)", type: "scatter", mode: "lines",
        line: { color: "#f44336", width: 2 } }
    ];

    // Add marker for current temperature
    if (temp >= 20 && temp <= 50) {
      traces.push({
        x: [temp], y: [heatIndexNWS(temp, rhClamped).toFixed(1)],
        name: "Current", type: "scatter", mode: "markers",
        marker: { size: 12, color: "#333", symbol: "diamond" },
        showlegend: false
      });
    }

    const layout = {
      ...layoutBase,
      title: { text: `Index Comparison at ${rhClamped}% RH: NWS vs EHI-N*`, font: { size: 14 } },
      xaxis: { title: "Air Temperature (\u00b0C)" },
      yaxis: { title: "Heat Index (\u00b0C)" },
      legend: { orientation: "h", y: -0.25, font: { size: 10 } },
      shapes: [
        { type: "line", x0: 20, x1: 50, y0: 35, y1: 35,
          line: { color: "#ff9800", width: 1, dash: "dash" } },
        { type: "line", x0: 20, x1: 50, y0: 42, y1: 42,
          line: { color: "#f44336", width: 1, dash: "dash" } }
      ],
      annotations: [
        { x: 49, y: 35, text: "EHI Caution", showarrow: false,
          font: { size: 9, color: "#ff9800" }, yshift: 8 },
        { x: 49, y: 42, text: "EHI Danger", showarrow: false,
          font: { size: 9, color: "#f44336" }, yshift: 8 }
      ]
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: seasonal heat calendar ---- */
  function renderSeasonal(divId, cal) {
    const traces = [
      { x: cal.months, y: cal.avgMax, name: "Avg Daily Max", type: "bar",
        marker: { color: "rgba(255,152,0,0.7)" } },
      { x: cal.months, y: cal.avgApparent, name: "Avg Apparent Max", type: "bar",
        marker: { color: "rgba(244,67,54,0.7)" } }
    ];
    const layout = {
      ...layoutBase,
      title: { text: "Seasonal Heat Profile (3-Year Average)", font: { size: 14 } },
      barmode: "group",
      yaxis: { title: "Temperature (\u00b0C)" },
      legend: { orientation: "h", y: -0.2 },
      shapes: [{
        type: "line", x0: -0.5, x1: 11.5, y0: 35, y1: 35,
        line: { color: "red", width: 1.5, dash: "dash" }
      }],
      annotations: [{
        x: 11, y: 35, text: "Danger (35\u00b0C)", showarrow: false,
        font: { size: 10, color: "red" }, yshift: 10
      }]
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: long-term warming trend ---- */
  function renderTrend(divId, yearly) {
    const n = yearly.labels.length;
    const xm = yearly.labels.reduce((a, b) => a + b, 0) / n;
    const ym = yearly.means.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    yearly.labels.forEach((x, i) => {
      num += (x - xm) * (yearly.means[i] - ym);
      den += (x - xm) ** 2;
    });
    const slope = num / den;
    const intercept = ym - slope * xm;
    const trendY = yearly.labels.map(x => slope * x + intercept);
    const warming = (slope * (yearly.labels[n-1] - yearly.labels[0])).toFixed(1);

    const traces = [
      { x: yearly.labels, y: yearly.means.map(v => +v.toFixed(2)),
        name: "Annual Avg Max", type: "scatter", mode: "lines",
        line: { color: "#ff9800", width: 1.5 } },
      { x: yearly.labels, y: trendY.map(v => +v.toFixed(2)),
        name: `Trend (+${warming}\u00b0C)`, type: "scatter", mode: "lines",
        line: { color: "#d32f2f", width: 2, dash: "dash" } }
    ];
    const layout = {
      ...layoutBase,
      title: { text: `Long-Term Warming (1980\u2013Present): +${warming}\u00b0C`, font: { size: 14 } },
      yaxis: { title: "Avg Daily Max Temp (\u00b0C)" },
      xaxis: { title: "" },
      legend: { orientation: "h", y: -0.2 }
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: CMIP6 projections ---- */
  function renderProjections(divId, data) {
    const models = Object.keys(data.daily).filter(k => k.startsWith("temperature_2m_max"));
    if (models.length === 0) return;
    const traces = [];
    const colors = ["#1976d2", "#388e3c", "#f57c00"];
    models.forEach((key, i) => {
      const modelName = key.replace("temperature_2m_max_", "").replace(/_/g, " ");
      const yearly = toYearly(data.daily.time, data.daily[key]);
      traces.push({
        x: yearly.labels, y: yearly.means.map(v => +v.toFixed(2)),
        name: modelName || "Model", type: "scatter", mode: "lines",
        line: { color: colors[i % colors.length], width: 1.5 }
      });
    });
    if (data.daily.temperature_2m_max) {
      const yearly = toYearly(data.daily.time, data.daily.temperature_2m_max);
      traces.unshift({
        x: yearly.labels, y: yearly.means.map(v => +v.toFixed(2)),
        name: "Multi-Model Mean", type: "scatter", mode: "lines",
        line: { color: "#333", width: 2.5 }
      });
    }
    const layout = {
      ...layoutBase,
      title: { text: "Climate Projections to 2050 (CMIP6 HighResMIP)", font: { size: 14 } },
      yaxis: { title: "Annual Avg Max Temp (\u00b0C)" },
      xaxis: { title: "" },
      legend: { orientation: "h", y: -0.2 },
      shapes: [{
        type: "rect", x0: 2025, x1: 2050, y0: 0, y1: 1, yref: "paper",
        fillcolor: "rgba(244,67,54,0.06)", line: { width: 0 }
      }]
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: monthly heatmap ---- */
  function renderMonthlyHeatmap(divId, data) {
    const dates = data.daily.time;
    const atmax = data.daily.apparent_temperature_max;

    const years = {};
    dates.forEach((d, i) => {
      if (atmax[i] == null) return;
      const y = d.slice(0, 4);
      const m = parseInt(d.slice(5, 7), 10) - 1;
      if (!years[y]) years[y] = Array(12).fill(null).map(() => []);
      years[y][m].push(atmax[i]);
    });
    const yLabels = Object.keys(years).sort();
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const z = yLabels.map(y =>
      monthNames.map((_, m) => years[y][m].length ? Math.max(...years[y][m]) : null)
    );
    const traces = [{
      z, x: monthNames, y: yLabels, type: "heatmap",
      colorscale: [
        [0, "#fff9c4"], [0.25, "#ffe082"], [0.5, "#ff9800"],
        [0.75, "#f44336"], [1, "#b71c1c"]
      ],
      colorbar: { title: "\u00b0C", thickness: 15 }
    }];
    const layout = {
      ...layoutBase,
      title: { text: "Monthly Peak Apparent Temperature (\u00b0C)", font: { size: 14 } },
      yaxis: { title: "", autorange: "reversed" },
      xaxis: { title: "" }
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Danger-days chart ---- */
  function renderDangerDays(divId, data) {
    const dates = data.daily.time;
    const atmax = data.daily.apparent_temperature_max;
    const years = {};
    dates.forEach((d, i) => {
      if (atmax[i] == null) return;
      const y = d.slice(0, 4);
      if (!years[y]) years[y] = { total: 0, d35: 0, d40: 0, d45: 0 };
      years[y].total++;
      if (atmax[i] >= 35) years[y].d35++;
      if (atmax[i] >= 40) years[y].d40++;
      if (atmax[i] >= 45) years[y].d45++;
    });
    const yrs = Object.keys(years).sort().map(Number);
    const traces = [
      { x: yrs, y: yrs.map(y => years[y].d35), name: "\u226535\u00b0C", type: "bar",
        marker: { color: "rgba(255,152,0,0.7)" } },
      { x: yrs, y: yrs.map(y => years[y].d40), name: "\u226540\u00b0C", type: "bar",
        marker: { color: "rgba(244,67,54,0.7)" } },
      { x: yrs, y: yrs.map(y => years[y].d45), name: "\u226545\u00b0C", type: "bar",
        marker: { color: "rgba(183,28,28,0.7)" } }
    ];
    const layout = {
      ...layoutBase,
      title: { text: "Days Per Year Exceeding Apparent Temp Thresholds", font: { size: 14 } },
      barmode: "overlay",
      yaxis: { title: "Days" },
      legend: { orientation: "h", y: -0.2 }
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Show error in a chart placeholder ---- */
  function showChartError(divId, msg) {
    const el = document.getElementById(divId);
    if (el) el.innerHTML = `<p style="color:#e65100;text-align:center;padding:2rem;font-size:0.9rem">${msg}</p>`;
  }

  /* ---- Main init ---- */
  async function init({ lat, lon, name, containerId }) {
    const root = document.getElementById(containerId);
    if (!root) return;
    root.innerHTML = `
      <div id="hd-current" style="margin-bottom:1.5rem"></div>
      <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-bottom:1.5rem">
        <div id="hd-comparison" style="height:340px"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
        <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div id="hd-seasonal" style="height:320px"></div>
        </div>
        <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div id="hd-heatmap" style="height:320px"></div>
        </div>
      </div>
      <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-bottom:1.5rem">
        <div id="hd-danger" style="height:300px"></div>
      </div>
      <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-bottom:1.5rem">
        <div id="hd-trend" style="height:300px"></div>
      </div>
      <div style="background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-bottom:1rem">
        <div id="hd-projections" style="height:300px"></div>
      </div>
      <p style="color:#999;font-size:0.75rem;text-align:center;margin-top:1rem">
        Data: ERA5 reanalysis via <a href="https://open-meteo.com" target="_blank" style="color:#999">Open-Meteo</a> |
        EHI-N*: <a href="/research/heatindex.html" style="color:#999">Kili\u00e7, UC Berkeley</a> |
        Projections: CMIP6 HighResMIP
      </p>`;

    // Show loading state
    document.getElementById("hd-current").innerHTML =
      '<p style="text-align:center;color:#999;padding:2rem">Loading live data for ' + name + '...</p>';
    ["hd-comparison","hd-seasonal","hd-heatmap","hd-danger","hd-trend","hd-projections"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p style="text-align:center;color:#ccc;padding:2rem">Loading...</p>';
    });

    // Load EHI-N* lookup table in parallel with first API calls
    const ehiPromise = loadEHITable();

    // --- Phase 1: Current conditions + projections ---
    try {
      const [current, proj] = await Promise.all([
        fetchCurrent(lat, lon),
        fetchProjections(lat, lon),
        ehiPromise
      ]);
      renderCurrent(document.getElementById("hd-current"), current, name);
      renderIndexComparison("hd-comparison", current.current.temperature_2m, current.current.relative_humidity_2m);
      renderProjections("hd-projections", proj);
    } catch (err) {
      await ehiPromise; // ensure EHI table loads even if API fails
      document.getElementById("hd-current").innerHTML =
        '<p style="color:#e65100;text-align:center;padding:1rem">Could not load current conditions.</p>';
      showChartError("hd-comparison", "Could not load index comparison.");
      showChartError("hd-projections", "Could not load projections.");
    }

    // --- Phase 2: Historical archive ---
    await delay(1000);
    try {
      const hist = await fetchHistorical(lat, lon);
      const cal = seasonalCalendar(
        hist.daily.time, hist.daily.temperature_2m_max, hist.daily.apparent_temperature_max
      );
      renderSeasonal("hd-seasonal", cal);
      renderMonthlyHeatmap("hd-heatmap", hist);
      renderDangerDays("hd-danger", hist);
    } catch (err) {
      showChartError("hd-seasonal", "Could not load seasonal data. Try refreshing in a minute.");
      showChartError("hd-heatmap", "Could not load heatmap data.");
      showChartError("hd-danger", "Could not load danger-days data.");
    }

    // --- Phase 3: Long-term trend ---
    await delay(2000);
    try {
      const longTerm = await fetchLongTerm(lat, lon);
      const yearly = toYearly(longTerm.daily.time, longTerm.daily.temperature_2m_max);
      renderTrend("hd-trend", yearly);
    } catch (err) {
      showChartError("hd-trend", "Could not load long-term trend. Try refreshing in a minute.");
    }
  }

  return { init };
})();
