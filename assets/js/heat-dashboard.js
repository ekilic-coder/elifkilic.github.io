/**
 * ClimaCoder Heat Dashboard — Open-Meteo powered, client-side
 * Fetches ERA5 historical data, current conditions, and CMIP6 projections
 * Computes heat index and renders Plotly charts
 *
 * Usage: HeatDashboard.init({ lat, lon, name, containerId })
 */
const HeatDashboard = (() => {
  /* ---- Heat index (Steadman / NWS regression) ---- */
  function heatIndex(T_c, RH) {
    const T = T_c * 9 / 5 + 32; // to Fahrenheit
    if (T < 80) return T_c;
    let HI = -42.379 + 2.04901523*T + 10.14333127*RH
      - 0.22475541*T*RH - 0.00683783*T*T - 0.05481717*RH*RH
      + 0.00122874*T*T*RH + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH;
    if (RH < 13 && T >= 80 && T <= 112)
      HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    if (RH > 85 && T >= 80 && T <= 87)
      HI += ((RH - 85) / 10) * ((87 - T) / 5);
    return (HI - 32) * 5 / 9; // back to Celsius
  }

  /* ---- Risk zone from heat index (C) ---- */
  function riskZone(hi) {
    if (hi < 27) return { label: "Safe", color: "#4caf50" };
    if (hi < 32) return { label: "Caution", color: "#ffeb3b" };
    if (hi < 39) return { label: "Extreme Caution", color: "#ff9800" };
    if (hi < 51) return { label: "Danger", color: "#f44336" };
    return { label: "Extreme Danger", color: "#b71c1c" };
  }

  /* ---- Fetch helpers ---- */
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${url}`);
    return r.json();
  }

  /* ---- Current conditions ---- */
  async function fetchCurrent(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m`
      + `&timezone=auto`;
    return fetchJSON(url);
  }

  /* ---- Historical (last 5 years daily) ---- */
  async function fetchHistorical(lat, lon) {
    const now = new Date();
    const end = `${now.getFullYear() - 1}-12-31`;
    const start = `${now.getFullYear() - 6}-01-01`;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
      + `&start_date=${start}&end_date=${end}`
      + `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min`
      + `&timezone=auto`;
    return fetchJSON(url);
  }

  /* ---- Long-term annual trend (1960-present) ---- */
  async function fetchLongTerm(lat, lon) {
    const end = `${new Date().getFullYear() - 1}-12-31`;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
      + `&start_date=1960-01-01&end_date=${end}`
      + `&daily=temperature_2m_max,apparent_temperature_max`
      + `&timezone=auto`;
    return fetchJSON(url);
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

  /* ---- Aggregate daily data to monthly ---- */
  function toMonthly(dates, values) {
    const months = {};
    dates.forEach((d, i) => {
      if (values[i] == null) return;
      const key = d.slice(0, 7); // "YYYY-MM"
      if (!months[key]) months[key] = [];
      months[key].push(values[i]);
    });
    const keys = Object.keys(months).sort();
    return {
      labels: keys,
      means: keys.map(k => months[k].reduce((a, b) => a + b, 0) / months[k].length),
      maxes: keys.map(k => Math.max(...months[k]))
    };
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

  /* ---- Seasonal heat calendar (month x metric) ---- */
  function seasonalCalendar(dates, tmax, atmax) {
    const byMonth = Array.from({ length: 12 }, () => ({ t: [], at: [] }));
    dates.forEach((d, i) => {
      if (tmax[i] == null) return;
      const m = parseInt(d.slice(5, 7), 10) - 1;
      byMonth[m].t.push(tmax[i]);
      if (atmax[i] != null) byMonth[m].at.push(atmax[i]);
    });
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return {
      months: monthNames,
      avgMax: byMonth.map(b => b.t.length ? b.t.reduce((a, c) => a + c, 0) / b.t.length : null),
      avgApparent: byMonth.map(b => b.at.length ? b.at.reduce((a, c) => a + c, 0) / b.at.length : null),
      daysAbove35: byMonth.map(b => b.at.length ? b.at.filter(v => v >= 35).length / (b.at.length / 5) : 0) // avg per year (5yr)
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

  /* ---- Render: current conditions card ---- */
  function renderCurrent(container, data, name) {
    const c = data.current;
    const hi = heatIndex(c.temperature_2m, c.relative_humidity_2m);
    const zone = riskZone(hi);
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#e65100">${c.temperature_2m.toFixed(1)}°C</div>
          <div style="font-size:0.8rem;color:#666">Temperature</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#0066cc">${c.relative_humidity_2m}%</div>
          <div style="font-size:0.8rem;color:#666">Humidity</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:#e65100">${c.apparent_temperature.toFixed(1)}°C</div>
          <div style="font-size:0.8rem;color:#666">Feels Like</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:2rem;font-weight:800;color:${zone.color}">${hi.toFixed(1)}°C</div>
          <div style="font-size:0.8rem;color:#666">Heat Index</div>
        </div>
        <div style="background:white;border-radius:12px;padding:1.2rem;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
          <div style="font-size:1.1rem;font-weight:800;color:${zone.color};padding:0.3rem 0">${zone.label}</div>
          <div style="font-size:0.8rem;color:#666">Risk Level</div>
        </div>
      </div>
      <p style="color:#999;font-size:0.8rem;text-align:center">Live data for ${name} via Open-Meteo (ERA5 reanalysis)</p>`;
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
      title: { text: "Seasonal Heat Profile (5-Year Average)", font: { size: 14 } },
      barmode: "group",
      yaxis: { title: "Temperature (°C)" },
      legend: { orientation: "h", y: -0.2 },
      shapes: [{
        type: "line", x0: -0.5, x1: 11.5, y0: 35, y1: 35,
        line: { color: "red", width: 1.5, dash: "dash" }
      }],
      annotations: [{
        x: 11, y: 35, text: "Danger (35°C)", showarrow: false,
        font: { size: 10, color: "red" }, yshift: 10
      }]
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: long-term warming trend ---- */
  function renderTrend(divId, yearly) {
    // Simple linear regression for trendline
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
        name: `Trend (+${warming}°C)`, type: "scatter", mode: "lines",
        line: { color: "#d32f2f", width: 2, dash: "dash" } }
    ];
    const layout = {
      ...layoutBase,
      title: { text: `Long-Term Warming (1960\u2013Present): +${warming}°C`, font: { size: 14 } },
      yaxis: { title: "Avg Daily Max Temp (°C)" },
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
    // If we have the base key without model suffix
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
      yaxis: { title: "Annual Avg Max Temp (°C)" },
      xaxis: { title: "" },
      legend: { orientation: "h", y: -0.2 },
      shapes: [{
        type: "rect", x0: 2025, x1: 2050, y0: 0, y1: 1, yref: "paper",
        fillcolor: "rgba(244,67,54,0.06)", line: { width: 0 }
      }]
    };
    Plotly.newPlot(divId, traces, layout, config);
  }

  /* ---- Render: monthly heatmap (recent years) ---- */
  function renderMonthlyHeatmap(divId, data) {
    const dates = data.daily.time;
    const tmax = data.daily.temperature_2m_max;
    const atmax = data.daily.apparent_temperature_max;

    // Build year x month grid of apparent temperature max
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
      colorbar: { title: "°C", thickness: 15 }
    }];
    const layout = {
      ...layoutBase,
      title: { text: "Monthly Peak Apparent Temperature (°C)", font: { size: 14 } },
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
      { x: yrs, y: yrs.map(y => years[y].d35), name: "\u226535°C", type: "bar",
        marker: { color: "rgba(255,152,0,0.7)" } },
      { x: yrs, y: yrs.map(y => years[y].d40), name: "\u226540°C", type: "bar",
        marker: { color: "rgba(244,67,54,0.7)" } },
      { x: yrs, y: yrs.map(y => years[y].d45), name: "\u226545°C", type: "bar",
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

  /* ---- Main init ---- */
  async function init({ lat, lon, name, containerId }) {
    const root = document.getElementById(containerId);
    if (!root) return;
    root.innerHTML = `
      <div id="hd-current" style="margin-bottom:1.5rem"></div>
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
        Projections: CMIP6 HighResMIP |
        Heat index: NWS/Steadman equation
      </p>`;

    // Show loading state
    document.getElementById("hd-current").innerHTML =
      '<p style="text-align:center;color:#999;padding:2rem">Loading live data for ' + name + '...</p>';

    try {
      const [current, hist, longTerm, proj] = await Promise.all([
        fetchCurrent(lat, lon),
        fetchHistorical(lat, lon),
        fetchLongTerm(lat, lon),
        fetchProjections(lat, lon)
      ]);

      renderCurrent(document.getElementById("hd-current"), current, name);

      const cal = seasonalCalendar(
        hist.daily.time, hist.daily.temperature_2m_max, hist.daily.apparent_temperature_max
      );
      renderSeasonal("hd-seasonal", cal);
      renderMonthlyHeatmap("hd-heatmap", hist);
      renderDangerDays("hd-danger", hist);

      const yearly = toYearly(longTerm.daily.time, longTerm.daily.temperature_2m_max);
      renderTrend("hd-trend", yearly);

      renderProjections("hd-projections", proj);
    } catch (err) {
      root.innerHTML = `<div style="background:#fff3e0;padding:2rem;border-radius:12px;text-align:center">
        <p style="color:#e65100;font-weight:600">Unable to load dashboard data</p>
        <p style="color:#888;font-size:0.9rem">${err.message}</p>
      </div>`;
    }
  }

  return { init };
})();
