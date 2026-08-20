# Risk Zone Analysis

An interactive browser map built from `accidents.csv` and `path.csv`.

## Run it

From the repository root, start a small local web server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000/WebApp/](http://localhost:8000/WebApp/) in a browser. An internet connection is needed for the basemap tiles and the pinned Leaflet, Papa Parse, and Turf libraries.

## How the analysis works

- **Accident points:** records where `Marker = B` or `Stop Number = 2`.
- **Journey endpoints:** `A` / stop 1 is the start and `C` / stop 3 is the destination.
- **Risk zones:** each accident receives a geodesic buffer using the selected radius. Touching or overlapping buffers are grouped and unioned into a polygon. The polygon intensity is the number of accident records in that connected zone.
- **Risky route sections:** every route segment from `path.csv` is compared with all accident points. A segment is shown when it comes within the chosen radius of at least one accident, and its color is based on the number of nearby accidents.
- **Matching and tooltips:** routes and point records are matched on `File`. Hovering an accident point, journey path, or risky path shows its `File` and `Layer` values.

The radius can be changed from 50 m to 20 km. Use the sidebar switches to show or hide risk zones, accident points, risky paths, complete paths, and endpoints. Use the layers button in the map's upper-right corner to change the basemap.

## Files

- `index.html` — application shell and controls
- `styles.css` — responsive visual design
- `app.js` — CSV parsing, spatial analysis, and map rendering
- `src/accidents.csv` — the WebApp's local journey point data
- `src/path.csv` — the WebApp's local WKT route data

The interface uses an OS-safe `Arial, Helvetica, sans-serif` font stack.
