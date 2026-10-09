"""Builds client/src/pages/home/universe/world/world.json: where each region/topic of the homepage universe sits on
Earth, the real driving route from each region to its topics (OpenStreetMap via the OSRM demo router, simplified),
and the undersea-cable links between continents. Run once when the map's places change:

    python scripts/universe/build-world.py

The OSRM demo server is rate-limited and for light use only; this script makes ~104 requests, 0.4 s apart
(cached hub routes are reused when a raw cache file is passed).
"""
import json, math, time, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "client/src/pages/home/universe/world/world.json"

# node id -> (lon, lat, city). Regions sit on six continents; each topic sits in a city reachable by road from its region.
PLACES = {
    "run": (-74.006, 40.713, "New York"), "run-compute": (-71.06, 42.36, "Boston"), "run-hosting": (-75.17, 39.95, "Philadelphia"),
    "run-storage": (-77.04, 38.91, "Washington"), "run-security": (-79.99, 40.44, "Pittsburgh"), "run-coming": (-73.57, 45.50, "Montreal"),
    "run-console": (-79.38, 43.65, "Toronto"), "run-roadmap": (-73.76, 42.65, "Albany"),
    "settle": (-0.128, 51.507, "London"), "settle-split": (2.352, 48.857, "Paris"), "settle-epochs": (4.904, 52.368, "Amsterdam"),
    "settle-subsidy": (4.352, 50.847, "Brussels"), "settle-contracts": (8.682, 50.111, "Frankfurt"), "settle-price": (-3.189, 55.953, "Edinburgh"),
    "settle-sim": (-2.244, 53.483, "Manchester"),
    "provide": (36.822, -1.292, "Nairobi"), "provide-home": (32.582, 0.347, "Kampala"), "provide-fleet": (39.208, -6.792, "Dar es Salaam"),
    "provide-earnings": (39.668, -4.043, "Mombasa"), "provide-agent": (38.757, 9.005, "Addis Ababa"),
    "verify": (103.82, 1.352, "Singapore"), "verify-browser": (101.69, 3.139, "Kuala Lumpur"), "verify-cupow": (100.50, 13.756, "Bangkok"),
    "verify-orchestrator": (100.33, 5.414, "Penang"), "verify-onchain": (104.92, 11.556, "Phnom Penh"), "verify-lab": (106.63, 10.823, "Ho Chi Minh City"),
    "security": (139.69, 35.69, "Tokyo"), "security-keys": (135.50, 34.69, "Osaka"), "security-checks": (136.91, 35.18, "Nagoya"),
    "security-building": (140.87, 38.27, "Sendai"), "security-planned": (132.46, 34.39, "Hiroshima"), "security-custody": (135.77, 35.01, "Kyoto"),
    "network": (-46.63, -23.55, "São Paulo"), "net-nodes": (-43.17, -22.91, "Rio de Janeiro"), "net-work": (-43.94, -19.92, "Belo Horizonte"),
    "net-cld": (-49.27, -25.43, "Curitiba"), "net-status": (-47.88, -15.79, "Brasília"), "net-api": (-51.23, -30.03, "Porto Alegre"),
}
REGIONS = ["run", "settle", "provide", "verify", "security", "network"]
# Everything interconnects (owner): every region is cabled to every other region (great circles between continents)...
CABLES = [(a, b) for i, a in enumerate(REGIONS) for b in REGIONS[i + 1:]]


def region_of(topic: str) -> str:
    return "network" if topic.startswith("net-") else topic.split("-")[0]


def simplify(pts, tol):
    """Douglas-Peucker on lon/lat degrees."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-12
    best, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def route(a, b, cache):
    key = f"{a}|{b}"
    if key in cache:
        return cache[key]
    (x1, y1, _), (x2, y2, _) = PLACES[a], PLACES[b]
    url = f"https://router.project-osrm.org/route/v1/driving/{x1},{y1};{x2},{y2}?overview=full&geometries=geojson"
    data = json.load(urllib.request.urlopen(url, timeout=60))
    time.sleep(0.4)
    return data["routes"][0]["geometry"]["coordinates"]


RAW = Path(__file__).resolve().parent / ".osrm-cache.json"  # raw routes, gitignored; delete to re-fetch


def main(raw_cache=None):
    cache = json.loads(RAW.read_text(encoding="utf-8")) if RAW.exists() else {}
    if raw_cache:
        for t, c in json.load(open(raw_cache))["roads"].items():
            cache.setdefault(f"{region_of(t)}|{t}", c)
    # ...and inside each region every place is joined to every other by road: hub -> topic and topic <-> topic.
    pairs = []
    for r in REGIONS:
        group = [r] + [t for t in PLACES if "-" in t and region_of(t) == r]
        pairs += [(a, b) for i, a in enumerate(group) for b in group[i + 1:]]
    roads = []
    for a, b in pairs:
        coords = cache[f"{a}|{b}"] = route(a, b, cache)
        s = simplify(coords, 0.01)
        roads.append({"from": a, "to": b, "coords": [[round(x, 3), round(y, 3)] for x, y in s]})
    out = {
        "source": "Roads: © OpenStreetMap contributors, routed with OSRM. Simplified (Douglas-Peucker, 0.01°).",
        "places": {k: {"lon": v[0], "lat": v[1], "city": v[2]} for k, v in PLACES.items()},
        "roads": roads,
        "cables": [{"from": a, "to": b} for a, b in CABLES],
    }
    RAW.write_text(json.dumps(cache), encoding="utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} — {len(roads)} roads, {sum(len(r['coords']) for r in roads)} points, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
