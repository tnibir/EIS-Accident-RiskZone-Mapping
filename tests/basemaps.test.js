const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("every selectable basemap uses an approved keyless tile service", () => {
  const tileLayers = [];
  let mapOptions;
  let selectableMaps;
  const map = {
    createPane() {},
    getPane() { return { style: {} }; },
  };
  const layerGroup = { addTo() { return this; } };
  const L = {
    tileLayer(url, options) {
      const layer = { url, options };
      tileLayers.push(layer);
      return layer;
    },
    map(_element, options) {
      mapOptions = options;
      return map;
    },
    control: {
      zoom() { return { addTo() {} }; },
      layers(baseMaps) {
        selectableMaps = baseMaps;
        return { addTo() {} };
      },
    },
    layerGroup() { return { ...layerGroup }; },
  };
  const context = vm.createContext({
    L,
    Papa: {},
    turf: {},
    document: { addEventListener() {} },
    window: {},
    console,
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInContext(`${source}\ninitialiseMap();`, context);

  assert.deepEqual(Object.keys(selectableMaps), ["Carto Light", "OpenStreetMap", "Topographic"]);
  assert.equal(mapOptions.layers[0], selectableMaps.OpenStreetMap);

  const approvedTemplates = new Set([
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  ]);
  tileLayers.forEach(({ url, options }) => {
    assert.ok(approvedTemplates.has(url), `unexpected tile template: ${url}`);
    assert.match(url, /^https:\/\//);
    assert.doesNotMatch(url, /[?&](?:api_?key|key|token|access_?token)=/i);
    assert.ok(options.attribution.trim(), `missing attribution for ${url}`);
  });
});
