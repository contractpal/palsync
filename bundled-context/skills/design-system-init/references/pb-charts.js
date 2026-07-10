/* pb-charts.js - optional Chart.js adapter for showcase/demo pals.
   Chart.js is loaded by the page shell with:
   <c:resource source="chartjs" version="4.0.0" name="chart.js"/>
   If window.Chart is absent, this file silently no-ops so projects can omit
   Chart.js entirely. */

function chartThemeRoot(canvas) {
  return canvas.closest("[data-theme], [data-preset]") || document.documentElement;
}

function readColor(name, root) {
  return getComputedStyle(root || document.documentElement).getPropertyValue(name).trim();
}

function alphaColor(color, alpha) {
  if (!color) return "rgba(37,99,235," + alpha + ")";
  if (color.charAt(0) === "#") {
    var hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (hex.length === 6) {
      var r = parseInt(hex.slice(0, 2), 16);
      var g = parseInt(hex.slice(2, 4), 16);
      var b = parseInt(hex.slice(4, 6), 16);
      return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }
  }
  if (color.indexOf("rgb(") === 0) return color.replace("rgb(", "rgba(").replace(")", "," + alpha + ")");
  return color;
}

function parseSeries(raw) {
  return (raw || "").split(";").filter(Boolean).map(function (chunk) {
    var parts = chunk.split(":");
    var nums = (parts[1] || "").split(",").filter(Boolean).map(function (n) { return parseFloat(n); });
    return { label: (parts[0] || "").trim(), data: nums };
  });
}

function chartPalette(root) {
  return [
    readColor("--ds-primary", root) || "#18181b",
    readColor("--ds-accent", root) || "#2563eb",
    readColor("--ds-success", root) || "#15803d",
    readColor("--ds-warning", root) || "#b45309",
    readColor("--ds-danger", root) || "#b42318"
  ];
}

function applyHeight(canvas) {
  var raw = canvas.getAttribute("data-pb-height");
  var height = parseInt(raw, 10);
  if (!height || height < 80) return;
  canvas.style.height = height + "px";
  if (canvas.parentElement) canvas.parentElement.style.height = height + "px";
}

function commonOptions(root, type) {
  var textSoft = readColor("--ds-text-soft", root) || "#6b7280";
  var border = readColor("--ds-border", root) || "#e1e5eb";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduce ? false : undefined,
    plugins: {
      legend: { labels: { color: textSoft, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
      tooltip: { displayColors: false }
    }
  };
  if (type !== "doughnut") {
    options.scales = {
      x: { grid: { color: alphaColor(border, 0.55) }, ticks: { color: textSoft } },
      y: { grid: { color: alphaColor(border, 0.55) }, ticks: { color: textSoft } }
    };
  }
  if (type === "doughnut") {
    options.cutout = "62%";
  }
  return options;
}

function buildDatasets(canvas, root, type) {
  var series = parseSeries(canvas.getAttribute("data-pb-series"));
  var palette = chartPalette(root);
  if (type === "doughnut") {
    var source = series[0] || { label: "", data: [] };
    return [{
      label: source.label,
      data: source.data,
      borderWidth: 0,
      backgroundColor: source.data.map(function (_, index) { return palette[index % palette.length]; }),
      hoverOffset: 8
    }];
  }
  return series.map(function (s, index) {
    var color = palette[index % palette.length];
    return {
      label: s.label,
      data: s.data,
      borderColor: color,
      backgroundColor: type === "bar" ? alphaColor(color, 0.82) : alphaColor(color, 0.14),
      borderRadius: type === "bar" ? 8 : 0,
      borderWidth: type === "bar" ? 0 : 2,
      tension: type === "line" ? 0.35 : 0,
      fill: type === "line" && canvas.getAttribute("data-pb-fill") === "true"
    };
  });
}

function destroyChart(canvas) {
  if (typeof window.Chart === "undefined") return;
  var existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
  if (existing) existing.destroy();
}

function buildChart(canvas) {
  if (typeof window.Chart === "undefined") return;
  var type = canvas.getAttribute("data-pb-chart") || "line";
  if (type !== "line" && type !== "bar" && type !== "doughnut") type = "line";
  var root = chartThemeRoot(canvas);
  var labels = (canvas.getAttribute("data-pb-labels") || "").split("|").filter(Boolean);
  applyHeight(canvas);
  destroyChart(canvas);
  new window.Chart(canvas, {
    type: type,
    data: { labels: labels, datasets: buildDatasets(canvas, root, type) },
    options: commonOptions(root, type)
  });
}

function scan(root) {
  if (typeof window.Chart === "undefined") return;
  var scope = root || document;
  var list = scope.querySelectorAll ? scope.querySelectorAll("[data-pb-chart]") : [];
  Array.prototype.forEach.call(list, buildChart);
}

function rebuildAll() {
  scan(document);
}

scan(document);

new MutationObserver(function (muts) {
  muts.forEach(function (m) {
    m.addedNodes.forEach(function (node) { if (node.nodeType === 1) scan(node); });
  });
}).observe(document.body, { childList: true, subtree: true });

new MutationObserver(function (muts) {
  muts.forEach(function (m) {
    if (m.type === "attributes" && (m.attributeName === "data-theme" || m.attributeName === "data-preset")) rebuildAll();
  });
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-preset"] });

new MutationObserver(function (muts) {
  muts.forEach(function (m) {
    if (m.type === "attributes" && (m.attributeName === "data-theme" || m.attributeName === "data-preset")) rebuildAll();
  });
}).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-theme", "data-preset"] });

window.pbCharts = { scan: scan, rebuild: rebuildAll };
