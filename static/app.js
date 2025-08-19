// Brand: Phytoguard
// - Fix freeze when switching metrics by keeping dataset array reference and updating label
// - Support "Single" vs "All" display modes
// - Mobile-friendly sizing and reconnection handling

let singleChart;
let singleLabels = [];
let singleData = [];
let currentMetric = "humidity";

const el = (id) => document.getElementById(id);
const fmt = (x, d=1) => (x === undefined || x === null) ? "—" : (typeof x === "number" ? x.toFixed(d) : x);

const METRICS = [
  { key: "humidity", label: "Humidity (%)", decimals: 1 },
  { key: "temperature", label: "Temperature (°C)", decimals: 1 },
  { key: "ph", label: "pH", decimals: 2 },
  { key: "conductivity", label: "EC (μS/cm)", decimals: 0 },
  { key: "nitrogen", label: "Nitrogen (mg/kg)", decimals: 0 },
  { key: "phosphorus", label: "Phosphorus (mg/kg)", decimals: 0 },
  { key: "potassium", label: "Potassium (mg/kg)", decimals: 0 },
];

// Small charts state for "All" view
const smallCharts = {}; // key -> {chart, labels, data}

function setStatus(text, ok) {
  const pill = el("statusPill");
  pill.textContent = text;
  pill.className = "pill " + (ok ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300");
}

async function initStatus() {
  try {
    const r = await fetch("/status");
    const s = await r.json();
    setStatus(s.simulating ? "Simulated" : "Live", !s.simulating);
    el("comPort").textContent = s.com_port || "—";
    el("baudrate").textContent = s.baudrate || "—";
  } catch (e) {
    setStatus("Unknown", false);
  }
}

function updateCards(d) {
  el("valHumidity").textContent = fmt(d.humidity);
  el("valTemp").textContent = fmt(d.temperature);
  el("valPh").textContent = fmt(d.ph, 2);
  el("valEC").textContent = fmt(d.conductivity, 0);
  el("valN").textContent = fmt(d.nitrogen, 0);
  el("valP").textContent = fmt(d.phosphorus, 0);
  el("valK").textContent = fmt(d.potassium, 0);
  el("valID").textContent = d.sensor_id ?? "—";
  el("lastUpdated").textContent = d.timestamp ? new Date(d.timestamp).toLocaleString() : "—";
}

function makeLineChart(ctx, labelsRef, dataRef, label="Value") {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: labelsRef,
      datasets: [{
        label,
        data: dataRef,
        fill: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { display: true, ticks: { maxTicksLimit: 6 } },
        y: { display: true }
      }
    }
  });
}

function ensureSingleChart() {
  if (singleChart) return;
  const ctx = el("lineChart").getContext("2d");
  singleChart = makeLineChart(ctx, singleLabels, singleData, "Value");
}

function pushToArrayWithLimit(arr, value, limit=300) {
  arr.push(value);
  if (arr.length > limit) arr.shift();
}

function pushToSingle(d) {
  const ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  pushToArrayWithLimit(singleLabels, ts);
  pushToArrayWithLimit(singleData, d[currentMetric] ?? null);
  singleChart.update();
}

function pushToSmallCharts(d) {
  const ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  METRICS.forEach(m => {
    const sc = smallCharts[m.key];
    if (!sc) return;
    pushToArrayWithLimit(sc.labels, ts);
    pushToArrayWithLimit(sc.data, d[m.key] ?? null);
    sc.chart.update();
  });
}

async function preloadHistory() {
  const r = await fetch("/history");
  const arr = await r.json();
  // rebuild single
  singleLabels.splice(0);
  singleData.splice(0);
  arr.forEach(d => {
    if (!d.timestamp) return;
    const ts = new Date(d.timestamp).toLocaleTimeString();
    singleLabels.push(ts);
    singleData.push(d[currentMetric] ?? null);
  });
  if (arr.length) updateCards(arr[arr.length-1]);
  // rebuild small charts
  Object.values(smallCharts).forEach(sc => {
    sc.labels.splice(0); sc.data.splice(0);
  });
  arr.forEach(d => {
    const ts = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : "";
    METRICS.forEach(m => {
      const sc = smallCharts[m.key];
      if (!sc) return;
      sc.labels.push(ts);
      sc.data.push(d[m.key] ?? null);
    });
  });
  if (singleChart) singleChart.update();
  Object.values(smallCharts).forEach(sc => sc.chart.update());
}

function attachSSE() {
  const ev = new EventSource("/stream");
  ev.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      updateCards(d);
      pushToSingle(d);
      pushToSmallCharts(d);
    } catch (_e) {}
  };
  ev.onerror = () => { setStatus("Disconnected", false); };
  ev.onopen = () => { initStatus(); };
}

function onMetricChange() {
  currentMetric = el("metricSelect").value;
  // Update dataset label (fixes UX & ensures no freeze due to mislabel)
  const meta = METRICS.find(m => m.key === currentMetric);
  if (singleChart) {
    singleChart.data.datasets[0].label = meta ? meta.label : "Value";
  }
  preloadHistory(); // rebuild arrays while keeping references
}

function switchDisplayMode(mode) {
  const single = el("singleChartSection");
  const multi = el("multiChartSection");
  const rowSel = el("metricSelectorRow");
  if (mode === "all") {
    single.classList.add("hidden");
    multi.classList.remove("hidden");
    rowSel.classList.add("hidden");
    el("btnAll").classList.add("bg-white","dark:bg-neutral-900");
    el("btnSingle").classList.remove("bg-white","dark:bg-neutral-900");
  } else {
    single.classList.remove("hidden");
    multi.classList.add("hidden");
    rowSel.classList.remove("hidden");
    el("btnSingle").classList.add("bg-white","dark:bg-neutral-900");
    el("btnAll").classList.remove("bg-white","dark:bg-neutral-900");
  }
}

function initSmallCharts() {
  METRICS.forEach(m => {
    const canvas = el("ch_" + m.key);
    if (!canvas) return;
    const labels = [];
    const data = [];
    const chart = makeLineChart(canvas.getContext("2d"), labels, data, m.label);
    smallCharts[m.key] = { chart, labels, data };
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await initStatus();
  ensureSingleChart();
  initSmallCharts();
  await preloadHistory();
  attachSSE();

  el("metricSelect").addEventListener("change", onMetricChange);
  el("btnSingle").addEventListener("click", () => switchDisplayMode("single"));
  el("btnAll").addEventListener("click", () => switchDisplayMode("all"));
  // default: single mode active
  switchDisplayMode("single");
});
