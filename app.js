/* global L, Papa, turf */

"use strict";

const DATA_FILES = { accidents: "src/accidents.csv", paths: "src/path.csv" };
const DEFAULT_RADIUS = 250;

const state = {
  radius: DEFAULT_RADIUS,
  points: [],
  accidents: [],
  endpoints: [],
  routes: [],
  zones: [],
  map: null,
  layers: {},
  debounceTimer: null,
};

const ui = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheUi();
  initialiseMap();
  bindControls();
  updateRadiusDisplay(DEFAULT_RADIUS);

  try {
    const [pointRows, pathRows] = await Promise.all([
      fetchCsv(DATA_FILES.accidents),
      fetchCsv(DATA_FILES.paths),
    ]);

    prepareData(pointRows, pathRows);
    renderStaticLayers();
    await recalculateRisk(true);
    fitToData();
    setStatus(`Ready · ${state.routes.length} route records matched`, "ready");
  } catch (error) {
    console.error(error);
    setStatus("Data loading failed", "error");
    ui.errorMessage.textContent = error.message || "The CSV files could not be loaded.";
    ui.errorPanel.hidden = false;
  }
}

function cacheUi() {
  [
    "sidebar", "sidebarToggle", "radiusInput", "radiusOutput", "caseCount", "accidentCount",
    "zoneCount", "maxIntensity", "toggleZones", "toggleAccidents", "toggleRiskPaths",
    "toggleRoutes", "toggleEndpoints", "processingPill", "statusDot", "statusText",
    "errorPanel", "errorMessage",
  ].forEach((id) => { ui[id] = document.getElementById(id); });
}

function initialiseMap() {
  const baseMaps = {
    "Carto Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }),
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }),
    "Topographic": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap",
    }),
    "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
    }),
  };

  state.map = L.map("map", {
    center: [23.82, 90.42],
    zoom: 9,
    zoomControl: false,
    preferCanvas: true,
    layers: [baseMaps["Carto Light"]],
  });

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  L.control.layers(baseMaps, null, { position: "topright", collapsed: true }).addTo(state.map);

  state.map.createPane("routesPane");
  state.map.getPane("routesPane").style.zIndex = 410;
  state.map.createPane("zonesPane");
  state.map.getPane("zonesPane").style.zIndex = 420;
  state.map.createPane("riskRoutesPane");
  state.map.getPane("riskRoutesPane").style.zIndex = 430;
  state.map.createPane("pointsPane");
  state.map.getPane("pointsPane").style.zIndex = 440;

  state.layers.routes = L.layerGroup();
  state.layers.zones = L.layerGroup().addTo(state.map);
  state.layers.riskPaths = L.layerGroup().addTo(state.map);
  state.layers.accidents = L.layerGroup().addTo(state.map);
  state.layers.endpoints = L.layerGroup();
}

function bindControls() {
  ui.sidebarToggle.addEventListener("click", () => {
    const collapsed = ui.sidebar.classList.toggle("is-collapsed");
    ui.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    window.setTimeout(() => state.map.invalidateSize(), 230);
  });

  ui.radiusInput.addEventListener("input", (event) => {
    const radius = Number(event.target.value);
    updateRadiusDisplay(radius);
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      state.radius = radius;
      recalculateRisk(false);
    }, 320);
  });

  bindLayerToggle(ui.toggleZones, "zones");
  bindLayerToggle(ui.toggleAccidents, "accidents");
  bindLayerToggle(ui.toggleRiskPaths, "riskPaths");
  bindLayerToggle(ui.toggleRoutes, "routes");
  bindLayerToggle(ui.toggleEndpoints, "endpoints");
}

function bindLayerToggle(control, layerName) {
  control.addEventListener("change", () => {
    const layer = state.layers[layerName];
    if (control.checked) layer.addTo(state.map);
    else layer.removeFrom(state.map);
  });
}

function updateRadiusDisplay(radius) {
  ui.radiusOutput.textContent = radius >= 1000 ? `${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km` : `${radius} m`;
  const min = Number(ui.radiusInput.min);
  const max = Number(ui.radiusInput.max);
  const percent = ((radius - min) / (max - min)) * 100;
  ui.radiusInput.style.setProperty("--range-progress", `${percent}%`);
}

async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  const text = await response.text();
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) {
    const serious = parsed.errors.find((item) => item.type !== "FieldMismatch");
    if (serious) throw new Error(`${url}: ${serious.message}`);
  }
  return parsed.data;
}

function prepareData(pointRows, pathRows) {
  assertColumns(pointRows, ["File", "Layer", "Marker", "Stop Number", "Longitude", "Latitude"], DATA_FILES.accidents);
  assertColumns(pathRows, ["File", "Layer", "WKT"], DATA_FILES.paths);

  state.points = pointRows
    .map((row) => ({
      ...row,
      lon: Number(row.Longitude),
      lat: Number(row.Latitude),
      marker: String(row.Marker || "").trim().toUpperCase(),
      stopNumber: Number(row["Stop Number"]),
    }))
    .filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat));

  state.accidents = state.points.filter((row) => row.marker === "B" || row.stopNumber === 2);
  state.endpoints = state.points.filter((row) => row.marker === "A" || row.marker === "C" || row.stopNumber === 1 || row.stopNumber === 3);

  const pointByFile = new Map();
  state.points.forEach((point) => {
    if (!pointByFile.has(point.File)) pointByFile.set(point.File, []);
    pointByFile.get(point.File).push(point);
  });

  state.routes = pathRows.map((row) => {
    const coordinates = parseLineString(row.WKT);
    return {
      ...row,
      coordinates,
      matchedPoints: pointByFile.get(row.File) || [],
    };
  }).filter((route) => route.coordinates.length > 1);

  if (!state.accidents.length) throw new Error("No Marker B / Stop Number 2 accident records were found.");
  if (!state.routes.length) throw new Error("No valid LINESTRING route geometries were found in path.csv.");

  const distinctCases = new Set([...state.accidents.map((row) => row.File), ...state.routes.map((row) => row.File)]);
  ui.caseCount.textContent = distinctCases.size.toLocaleString();
  ui.accidentCount.textContent = state.accidents.length.toLocaleString();
}

function assertColumns(rows, columns, fileName) {
  if (!rows.length) throw new Error(`${fileName} contains no records.`);
  const available = new Set(Object.keys(rows[0]));
  const missing = columns.filter((column) => !available.has(column));
  if (missing.length) throw new Error(`${fileName} is missing: ${missing.join(", ")}.`);
}

function parseLineString(wkt) {
  if (!wkt || typeof wkt !== "string") return [];
  const match = wkt.trim().match(/^LINESTRING\s*(?:Z\s*)?\((.*)\)$/i);
  if (!match) return [];
  return match[1].split(",").map((pair) => {
    const values = pair.trim().split(/\s+/).map(Number);
    return [values[0], values[1]];
  }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function renderStaticLayers() {
  state.layers.accidents.clearLayers();
  state.accidents.forEach((point) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      pane: "pointsPane",
      radius: 5.5,
      color: "#ffffff",
      weight: 2,
      fillColor: "#cf2029",
      fillOpacity: 1,
    });
    marker.bindTooltip(pointTooltip(point, "Accident point"), tooltipOptions());
    marker.addTo(state.layers.accidents);
  });

  state.layers.endpoints.clearLayers();
  state.endpoints.forEach((point) => {
    const isStart = point.marker === "A" || point.stopNumber === 1;
    const marker = L.marker([point.lat, point.lon], {
      pane: "pointsPane",
      icon: L.divIcon({
        className: `endpoint-icon ${isStart ? "start" : "destination"}`,
        html: isStart ? "A" : "C",
        iconSize: [24, 24],
      }),
    });
    marker.bindTooltip(pointTooltip(point, isStart ? "Journey start" : "Destination"), tooltipOptions());
    marker.addTo(state.layers.endpoints);
  });

  state.layers.routes.clearLayers();
  state.routes.forEach((route) => {
    const line = L.polyline(route.coordinates.map(([lon, lat]) => [lat, lon]), {
      pane: "routesPane",
      color: "#36555b",
      weight: 2.2,
      opacity: 0.55,
      lineCap: "round",
      lineJoin: "round",
    });
    line.bindTooltip(routeTooltip(route, null), tooltipOptions());
    line.addTo(state.layers.routes);
  });
}

async function recalculateRisk(firstRender) {
  setProcessing(true);
  await nextFrame();

  try {
    state.zones = buildRiskZones(state.accidents, state.radius);
    renderRiskZones();
    renderRiskPaths();

    const peak = state.zones.reduce((max, zone) => Math.max(max, zone.properties.count), 0);
    ui.zoneCount.textContent = state.zones.length.toLocaleString();
    ui.maxIntensity.textContent = peak.toLocaleString();
    if (!firstRender) setStatus(`Updated for ${formatDistance(state.radius)} radius`, "ready");
  } catch (error) {
    console.error(error);
    setStatus("Risk calculation failed", "error");
  } finally {
    setProcessing(false);
  }
}

function buildRiskZones(points, radius) {
  const parent = points.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const join = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (haversineMeters([points[i].lon, points[i].lat], [points[j].lon, points[j].lat]) <= radius * 2) join(i, j);
    }
  }

  const groups = new Map();
  points.forEach((point, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(point);
  });

  return [...groups.values()].map((members, zoneIndex) => {
    const buffers = members.map((point) => turf.buffer(
      turf.point([point.lon, point.lat]),
      radius,
      { units: "meters", steps: 24 },
    ));

    let geometry;
    try {
      geometry = buffers.length === 1 ? buffers[0] : turf.union(turf.featureCollection(buffers));
    } catch (error) {
      console.warn("A buffer group could not be dissolved; rendering its polygons together instead", error);
      geometry = turf.multiPolygon(buffers.map((buffer) => buffer.geometry.coordinates));
    }

    geometry.properties = {
      zoneId: zoneIndex + 1,
      count: members.length,
      files: members.map((point) => point.File),
      layers: [...new Set(members.map((point) => point.Layer))],
      radius,
    };
    return geometry;
  });
}

function renderRiskZones() {
  state.layers.zones.clearLayers();
  const geojson = L.geoJSON(turf.featureCollection(state.zones), {
    pane: "zonesPane",
    style: (feature) => {
      const color = riskColor(feature.properties.count);
      return { color, weight: 1.3, opacity: 0.94, fillColor: color, fillOpacity: 0.52 };
    },
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(zoneTooltip(feature.properties), tooltipOptions());
    },
  });
  geojson.addTo(state.layers.zones);
}

function renderRiskPaths() {
  state.layers.riskPaths.clearLayers();

  state.routes.forEach((route) => {
    let activeRun = null;
    const flushRun = () => {
      if (!activeRun || activeRun.coords.length < 2) return;
      const color = riskColor(activeRun.count);
      const line = L.polyline(activeRun.coords.map(([lon, lat]) => [lat, lon]), {
        pane: "riskRoutesPane",
        color: "#ffffff",
        weight: 7 + Math.min(activeRun.count, 5) * 0.45,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      });
      const coloredLine = L.polyline(activeRun.coords.map(([lon, lat]) => [lat, lon]), {
        pane: "riskRoutesPane",
        color,
        weight: 3.7 + Math.min(activeRun.count, 5) * 0.45,
        opacity: 0.96,
        lineCap: "round",
        lineJoin: "round",
      });
      coloredLine.bindTooltip(routeTooltip(route, activeRun.count), tooltipOptions());
      line.addTo(state.layers.riskPaths);
      coloredLine.addTo(state.layers.riskPaths);
    };

    for (let i = 0; i < route.coordinates.length - 1; i += 1) {
      const start = route.coordinates[i];
      const end = route.coordinates[i + 1];
      const count = segmentRiskCount(start, end, state.accidents, state.radius);

      if (count === 0) {
        flushRun();
        activeRun = null;
      } else if (activeRun && activeRun.count === count) {
        activeRun.coords.push(end);
      } else {
        flushRun();
        activeRun = { count, coords: [start, end] };
      }
    }
    flushRun();
  });
}

function segmentRiskCount(start, end, accidents, radius) {
  const averageLat = (start[1] + end[1]) / 2;
  const latPadding = radius / 110540;
  const lonPadding = radius / (111320 * Math.max(0.2, Math.cos(averageLat * Math.PI / 180)));
  const minLon = Math.min(start[0], end[0]) - lonPadding;
  const maxLon = Math.max(start[0], end[0]) + lonPadding;
  const minLat = Math.min(start[1], end[1]) - latPadding;
  const maxLat = Math.max(start[1], end[1]) + latPadding;

  let count = 0;
  accidents.forEach((point) => {
    if (point.lon < minLon || point.lon > maxLon || point.lat < minLat || point.lat > maxLat) return;
    if (pointToSegmentMeters([point.lon, point.lat], start, end) <= radius) count += 1;
  });
  return count;
}

function pointToSegmentMeters(point, start, end) {
  const referenceLat = ((point[1] + start[1] + end[1]) / 3) * Math.PI / 180;
  const lonScale = 111320 * Math.cos(referenceLat);
  const latScale = 110540;
  const ax = (start[0] - point[0]) * lonScale;
  const ay = (start[1] - point[1]) * latScale;
  const bx = (end[0] - point[0]) * lonScale;
  const by = (end[1] - point[1]) * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function haversineMeters(a, b) {
  const earthRadius = 6371008.8;
  const toRadians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRadians;
  const dLon = (b[0] - a[0]) * toRadians;
  const lat1 = a[1] * toRadians;
  const lat2 = b[1] * toRadians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function riskColor(count) {
  if (count >= 8) return "#bd0026";
  if (count >= 5) return "#f03b20";
  if (count >= 3) return "#fd8d3c";
  if (count >= 2) return "#feb24c";
  return "#fed976";
}

function riskLabel(count) {
  if (count >= 8) return "Critical";
  if (count >= 5) return "Very high";
  if (count >= 3) return "High";
  if (count >= 2) return "Elevated";
  return "Observed";
}

function pointTooltip(point, heading) {
  return tooltipHtml(heading, [
    ["File", point.File],
    ["Layer", point.Layer],
    ["Location", point["Point Name"] || "—"],
    ["Position", `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`],
  ]);
}

function routeTooltip(route, count) {
  const rows = [
    ["File", escapeHtml(route.File)],
    ["Layer", escapeHtml(route.Layer)],
  ];
  if (count !== null) {
    rows.unshift(["Risk", `<span class="risk-chip" style="background:${riskColor(count)}">${riskLabel(count)} · ${count} ${count === 1 ? "accident" : "accidents"}</span>`]);
    rows.push(["Radius", formatDistance(state.radius)]);
  }
  return tooltipHtml(count === null ? "Journey path" : "Risky route section", rows, true);
}

function zoneTooltip(properties) {
  const files = properties.files.slice(0, 5).map(escapeHtml).join("<br>");
  const more = properties.files.length > 5 ? `<br>+${properties.files.length - 5} more` : "";
  return tooltipHtml(`Risk zone ${properties.zoneId}`, [
    ["Intensity", `<span class="risk-chip" style="background:${riskColor(properties.count)}">${riskLabel(properties.count)} · ${properties.count}</span>`],
    ["Radius", formatDistance(properties.radius)],
    ["Files", `${files}${more}`],
  ], true);
}

function tooltipHtml(heading, rows, allowSafeHtml = false) {
  const body = rows.map(([label, value]) => {
    const renderedValue = allowSafeHtml ? String(value ?? "—") : escapeHtml(value ?? "—");
    return `<div class="tooltip-row"><span>${escapeHtml(label)}</span><span>${renderedValue}</span></div>`;
  }).join("");
  return `<div class="tooltip-content"><div class="tooltip-head">${escapeHtml(heading)}</div><div class="tooltip-body">${body}</div></div>`;
}

function tooltipOptions() {
  return { className: "map-tooltip", sticky: true, direction: "top", opacity: 1 };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character]);
}

function formatDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 ? 1 : 0)} km` : `${metres} m`;
}

function fitToData() {
  const bounds = L.latLngBounds(state.points.map((point) => [point.lat, point.lon]));
  if (bounds.isValid()) state.map.fitBounds(bounds.pad(0.06), { maxZoom: 13 });
}

function setProcessing(active) {
  ui.processingPill.classList.toggle("visible", active);
  ui.radiusInput.disabled = active;
}

function setStatus(text, type) {
  ui.statusText.textContent = text;
  ui.statusDot.className = `status-dot ${type || ""}`;
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
}
