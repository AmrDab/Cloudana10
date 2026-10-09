"""Builds client/src/pages/home/paper/map.json: the homepage's dotted world map (flat projection, SVG units).

    python scripts/home/build-map.py

Offline and deterministic. Land comes from the coastline rings already in the repo
(client/src/components/cld/globe/land.json, Natural Earth 1:110m, closed rings in tenths of a degree). Three layers:
a staggered dot grid over land, darker unlabelled points weighted by the metro list below (decorative texture, never
live nodes), and a few great-circle arcs between well-known cities that the page animates.
"""
import json, math, random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAND = ROOT / "client/src/components/cld/globe/land.json"
OUT = ROOT / "client/src/pages/home/paper/map.json"

# (lon, lat, weight, continent)
METROS = [
    # North America
    (-74.0, 40.7, 19, "na"), (-118.2, 34.1, 13, "na"), (-87.6, 41.9, 9, "na"), (-95.4, 29.8, 7, "na"), (-96.8, 32.8, 7, "na"),
    (-77.0, 38.9, 6, "na"), (-80.2, 25.8, 6, "na"), (-75.2, 39.95, 6, "na"), (-84.4, 33.7, 6, "na"), (-71.1, 42.4, 5, "na"),
    (-122.4, 37.8, 5, "na"), (-112.1, 33.4, 5, "na"), (-122.3, 47.6, 4, "na"), (-83.0, 42.3, 4, "na"), (-93.3, 45.0, 3.5, "na"),
    (-117.2, 32.7, 3.3, "na"), (-104.99, 39.7, 3, "na"), (-90.2, 38.6, 2.8, "na"), (-79.4, 43.7, 6.5, "na"), (-73.6, 45.5, 4.3, "na"),
    (-123.1, 49.3, 2.6, "na"), (-114.1, 51.0, 1.5, "na"), (-75.7, 45.4, 1.4, "na"), (-99.1, 19.4, 22, "na"), (-103.3, 20.7, 5, "na"),
    (-100.3, 25.7, 5, "na"), (-98.2, 19.0, 3, "na"), (-90.5, 14.6, 3, "na"), (-84.1, 9.9, 1.4, "na"), (-79.5, 9.0, 1.9, "na"),
    (-82.4, 23.1, 2.1, "na"), (-69.9, 18.5, 3.5, "na"), (-66.1, 18.4, 2, "na"), (-97.7, 30.3, 2.3, "na"), (-86.8, 36.2, 2, "na"),
    (-81.7, 41.5, 2, "na"), (-111.9, 40.8, 1.2, "na"), (-115.1, 36.2, 2.3, "na"), (-149.9, 61.2, 0.4, "na"), (-157.9, 21.3, 1, "na"),
    # South America
    (-46.6, -23.6, 22, "sa"), (-58.4, -34.6, 15, "sa"), (-43.2, -22.9, 13, "sa"), (-77.0, -12.0, 11, "sa"), (-74.1, 4.7, 11, "sa"),
    (-70.7, -33.4, 7, "sa"), (-43.9, -19.9, 6, "sa"), (-66.9, 10.5, 3, "sa"), (-75.6, 6.2, 4, "sa"), (-78.5, -0.2, 2, "sa"),
    (-79.9, -2.2, 3, "sa"), (-38.5, -3.7, 4, "sa"), (-34.9, -8.1, 4, "sa"), (-38.5, -13.0, 4, "sa"), (-51.2, -30.0, 4, "sa"),
    (-49.3, -25.4, 3.5, "sa"), (-47.9, -15.8, 4.5, "sa"), (-60.0, -3.1, 2.2, "sa"), (-48.5, -1.5, 2.2, "sa"), (-56.2, -34.9, 1.8, "sa"),
    (-57.6, -25.3, 2.3, "sa"), (-68.1, -16.5, 1.8, "sa"), (-63.2, -17.8, 1.8, "sa"), (-64.2, -31.4, 1.6, "sa"), (-71.5, -16.4, 1.1, "sa"),
    # Europe
    (-0.1, 51.5, 14, "eu"), (2.35, 48.86, 12, "eu"), (37.6, 55.8, 17, "eu"), (28.98, 41.0, 15, "eu"), (-3.7, 40.4, 7, "eu"),
    (13.4, 52.5, 6, "eu"), (12.5, 41.9, 4.3, "eu"), (9.2, 45.5, 5, "eu"), (2.2, 41.4, 5.5, "eu"), (6.8, 51.3, 10, "eu"),
    (4.9, 52.4, 7, "eu"), (4.35, 50.85, 2.5, "eu"), (8.7, 50.1, 5.5, "eu"), (11.6, 48.1, 3, "eu"), (16.4, 48.2, 2.9, "eu"),
    (19.0, 47.5, 3.3, "eu"), (21.0, 52.2, 3.1, "eu"), (14.4, 50.1, 2.7, "eu"), (30.5, 50.45, 3.5, "eu"), (30.3, 59.9, 6, "eu"),
    (23.7, 37.98, 3.6, "eu"), (26.1, 44.4, 2.3, "eu"), (23.3, 42.7, 1.6, "eu"), (20.5, 44.8, 1.7, "eu"), (-9.1, 38.7, 2.9, "eu"),
    (-8.6, 41.15, 1.7, "eu"), (-6.3, 53.35, 2, "eu"), (-2.2, 53.5, 2.8, "eu"), (-1.9, 52.5, 2.9, "eu"), (-4.25, 55.86, 1.7, "eu"),
    (12.6, 55.7, 2, "eu"), (18.1, 59.3, 2.4, "eu"), (10.75, 59.9, 1.5, "eu"), (24.9, 60.2, 1.5, "eu"), (8.5, 47.4, 1.6, "eu"),
    (4.8, 45.75, 2.3, "eu"), (5.4, 43.3, 1.9, "eu"), (14.25, 40.85, 3.1, "eu"), (10.0, 53.55, 3.3, "eu"), (27.6, 53.9, 2, "eu"),
    (49.1, 55.8, 1.3, "eu"), (44.0, 56.3, 1.3, "eu"), (39.7, 47.2, 1.2, "eu"), (60.6, 56.8, 1.5, "eu"), (-0.4, 39.5, 1.6, "eu"),
    # Africa
    (31.2, 30.0, 21, "af"), (3.4, 6.5, 15, "af"), (15.3, -4.3, 15, "af"), (28.0, -26.2, 10, "af"), (36.8, -1.3, 5, "af"),
    (39.3, -6.8, 7, "af"), (38.75, 9.0, 5, "af"), (-0.2, 5.6, 3, "af"), (-4.0, 5.3, 5.5, "af"), (-17.4, 14.7, 3.5, "af"),
    (-7.6, 33.6, 4, "af"), (3.06, 36.75, 3, "af"), (10.2, 36.8, 2.5, "af"), (13.2, 32.9, 1.2, "af"), (32.5, 15.6, 6, "af"),
    (32.6, 0.35, 3.6, "af"), (30.1, -1.95, 1.3, "af"), (18.4, -33.9, 4.7, "af"), (31.0, -29.9, 3.6, "af"), (13.2, -8.8, 9, "af"),
    (11.5, 3.9, 4, "af"), (9.7, 4.05, 3.9, "af"), (7.5, 9.05, 3.6, "af"), (8.5, 12.0, 4.2, "af"), (3.9, 7.4, 3.8, "af"),
    (-1.5, 12.4, 3, "af"), (-8.0, 12.65, 2.8, "af"), (2.1, 13.5, 1.4, "af"), (45.3, 2.05, 2.6, "af"), (47.5, -18.9, 3.6, "af"),
    (31.05, -17.8, 2.3, "af"), (28.3, -15.4, 3, "af"), (33.8, -13.95, 1.2, "af"), (32.6, -25.95, 1.8, "af"), (29.9, 31.2, 5.5, "af"),
    (-13.2, 8.5, 1.3, "af"), (-10.8, 6.3, 1.5, "af"), (2.4, 6.4, 2, "af"), (1.2, 6.15, 2, "af"), (39.7, -4.05, 1.4, "af"),
    # Asia
    (139.7, 35.7, 37, "as"), (135.5, 34.7, 19, "as"), (77.2, 28.6, 32, "as"), (72.9, 19.1, 21, "as"), (121.5, 31.2, 28, "as"),
    (116.4, 39.9, 21, "as"), (90.4, 23.8, 22, "as"), (88.4, 22.6, 15, "as"), (67.0, 24.9, 16, "as"), (74.3, 31.5, 13, "as"),
    (113.3, 23.1, 19, "as"), (114.1, 22.5, 13, "as"), (114.2, 22.3, 7.5, "as"), (106.6, 29.6, 16, "as"), (104.1, 30.7, 9, "as"),
    (114.3, 30.6, 9, "as"), (108.9, 34.3, 8, "as"), (118.8, 32.1, 9, "as"), (120.2, 30.3, 9, "as"), (117.2, 39.1, 13, "as"),
    (123.4, 41.8, 8, "as"), (126.6, 45.75, 6, "as"), (113.6, 34.75, 8, "as"), (117.0, 36.65, 6, "as"), (120.4, 36.1, 6, "as"),
    (119.3, 26.1, 6, "as"), (112.9, 28.2, 6, "as"), (102.7, 25.05, 5, "as"), (127.0, 37.6, 25, "as"), (129.1, 35.2, 3.4, "as"),
    (121.5, 25.05, 7, "as"), (120.3, 22.6, 2.8, "as"), (130.4, 33.6, 2.5, "as"), (136.9, 35.2, 9, "as"), (141.35, 43.06, 2.6, "as"),
    (106.8, -6.2, 33, "as"), (112.75, -7.25, 9, "as"), (107.6, -6.9, 8, "as"), (98.7, 3.6, 4.5, "as"), (110.4, -7.0, 3, "as"),
    (121.0, 14.6, 24, "as"), (123.9, 10.3, 3, "as"), (125.6, 7.1, 2, "as"), (100.5, 13.75, 17, "as"), (106.7, 10.8, 14, "as"),
    (105.85, 21.0, 9, "as"), (96.2, 16.8, 6, "as"), (104.9, 11.55, 2.3, "as"), (101.7, 3.1, 8, "as"), (103.8, 1.35, 6, "as"),
    (80.3, 13.1, 11, "as"), (77.6, 12.97, 13, "as"), (78.5, 17.4, 10, "as"), (72.6, 23.0, 8, "as"), (73.85, 18.5, 7, "as"),
    (75.8, 26.9, 4, "as"), (80.9, 26.85, 4, "as"), (85.1, 25.6, 2.5, "as"), (76.3, 9.95, 3, "as"), (79.85, 6.9, 5.6, "as"),
    (85.3, 27.7, 3, "as"), (73.05, 33.7, 2.2, "as"), (69.2, 34.55, 4.5, "as"), (51.4, 35.7, 9, "as"), (59.6, 36.3, 3.3, "as"),
    (51.7, 32.65, 2.2, "as"), (44.4, 33.3, 7.5, "as"), (46.7, 24.7, 7.5, "as"), (39.2, 21.5, 4.7, "as"), (55.3, 25.2, 3.5, "as"),
    (51.5, 25.3, 1.5, "as"), (47.98, 29.4, 3, "as"), (35.5, 33.9, 2.4, "as"), (36.3, 33.5, 2.5, "as"), (35.9, 31.95, 4.6, "as"),
    (34.8, 32.1, 4, "as"), (32.85, 39.9, 5.5, "as"), (27.1, 38.4, 3, "as"), (44.5, 40.2, 1.1, "as"), (49.9, 40.4, 2.3, "as"),
    (69.3, 41.3, 2.6, "as"), (76.9, 43.25, 2, "as"), (71.4, 51.15, 1.2, "as"), (82.9, 55.0, 1.6, "as"), (73.4, 55.0, 1.1, "as"),
    (92.9, 56.0, 1.1, "as"), (104.3, 52.3, 0.7, "as"), (131.9, 43.1, 0.7, "as"), (106.9, 47.9, 1.5, "as"), (87.6, 43.8, 4, "as"),
    (44.2, 15.35, 3, "as"), (58.4, 23.6, 1.5, "as"), (45.0, 12.8, 1, "as"),
    # Oceania
    (151.2, -33.9, 5.3, "oc"), (144.96, -37.8, 5.1, "oc"), (153.0, -27.5, 2.6, "oc"), (115.9, -31.95, 2.1, "oc"),
    (138.6, -34.9, 1.4, "oc"), (149.1, -35.3, 0.5, "oc"), (147.3, -42.9, 0.25, "oc"), (130.8, -12.45, 0.15, "oc"),
    (174.8, -36.85, 1.7, "oc"), (174.8, -41.3, 0.4, "oc"), (172.6, -43.5, 0.4, "oc"), (147.2, -9.45, 0.4, "oc"),
    (178.4, -18.1, 0.2, "oc"), (151.75, -32.9, 0.5, "oc"), (145.8, -16.9, 0.15, "oc"),
]

# Natural Earth's 1:110m land has no lake holes; keep points out of the big inland waters.
WATER = [
    (46.8, 36.8, 54.2, 47.0),  # Caspian Sea (lon0, lat0, lon1, lat1)
    (-92.2, 46.4, -84.4, 49.0),  # Lake Superior
    (-88.0, 41.6, -85.4, 46.1),  # Lake Michigan
    (-84.6, 43.0, -79.9, 46.3),  # Lake Huron
    (-83.5, 41.4, -78.9, 42.85),  # Lake Erie
    (-79.8, 43.2, -76.1, 44.2),  # Lake Ontario
    (31.6, -3.0, 34.0, 0.4),  # Lake Victoria
    (29.0, -8.8, 31.2, -3.3),  # Lake Tanganyika
    (34.4, -14.4, 35.3, -9.5),  # Lake Malawi
    (103.7, 51.4, 109.9, 55.8),  # Lake Baikal (box; trims a little shore)
]


def load_rings():
    rings = []
    for s in json.loads(LAND.read_text(encoding="utf-8")):
        pts = [(s[i] / 10, s[i + 1] / 10) for i in range(0, len(s), 2)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        rings.append((min(xs), min(ys), max(xs), max(ys), pts))
    return rings


def on_land(lon, lat, rings):
    """Even-odd ray cast over every coastline ring (closed to within half a degree)."""
    if lat < -56 or lat > 72:
        return False  # no Antarctica / high Arctic
    for x0, y0, x1, y1 in WATER:
        if x0 <= lon <= x1 and y0 <= lat <= y1:
            return False
    inside = False
    for bx0, by0, bx1, by1, pts in rings:
        if lon < bx0 or lon > bx1 or lat < by0 or lat > by1:
            continue
        j = len(pts) - 1
        for i in range(len(pts)):
            xi, yi = pts[i]
            xj, yj = pts[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def gc_deg(a, b):
    (lo1, la1), (lo2, la2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dl = math.radians(lo2 - lo1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def ambient_points(rings):
    rnd = random.Random(20261008)
    rings = load_rings()
    pts = []
    MIN_SEP = 0.5  # degrees between any two points

    def add(lon, lat, g):
        if not on_land(lon, lat, rings):
            return False
        for q in pts:
            if abs(q[1] - lat) < MIN_SEP and gc_deg(q, (lon, lat)) < MIN_SEP:
                return False
        pts.append((lon, lat))
        return True

    # Metro clusters: count ~ sqrt(weight), spread ~ sqrt(weight).
    for lon, lat, w, g in METROS:
        want = max(1, round(0.62 * math.sqrt(w)))
        sigma = 0.5 + 0.28 * math.sqrt(w)
        got = tries = 0
        while got < want and tries < want * 30:
            tries += 1
            dlat = rnd.gauss(0, sigma)
            dlon = rnd.gauss(0, sigma) / max(0.3, math.cos(math.radians(lat)))
            if add(((lon + dlon + 180) % 360) - 180, lat + dlat, g):
                got += 1

    # Sparse background: uniform on the sphere, kept with a probability that falls off with distance to a metro.
    target = len(pts) + 55
    tries = 0
    while len(pts) < target and tries < 200000:
        tries += 1
        lon = rnd.uniform(-180, 180)
        lat = math.degrees(math.asin(rnd.uniform(-1, 1)))
        best, bg = 1e9, "eu"
        for mlon, mlat, _, g in METROS:
            if abs(mlat - lat) > best:
                continue
            d = gc_deg((mlon, mlat), (lon, lat))
            if d < best:
                best, bg = d, g
        if rnd.random() < 0.03 + 0.7 * math.exp(-best / 6):
            add(lon, lat, bg)

    return pts


# Flat projection used by the page (viewBox 0 0 W H).
W, H = 1000, 470
LON0, LON1, LAT0, LAT1 = -170, 190, 75, -58


def xy(lon, lat):
    lon = lon + 360 if lon < LON0 else lon
    return (lon - LON0) / (LON1 - LON0) * W, 10 + (lat - LAT0) / (LAT1 - LAT0) * (H - 20)


def land_grid(rings, step=1.6):
    pts, lat = [], -56.0
    while lat <= 72:
        lon = -180.0 + (step / 2 if int((lat + 90) / step) % 2 else 0)
        while lon < 180:
            if on_land(lon, lat, rings):
                pts.append((lon, lat))
            lon += step
        lat += step
    return pts


def dots(points):
    """One SVG path of zero-length segments: drawn as dots with a round line cap."""
    return "".join("M%.1f %.1fh0" % xy(lon, lat) for lon, lat in points)


# (lon, lat) — the arcs are illustrative links between cities, not a claim about where nodes run.
HUBS = [(-74.0, 40.7), (-0.1, 51.5), (36.8, -1.3), (103.8, 1.35), (139.7, 35.7), (-46.6, -23.5), (77.6, 12.97),
        (-122.4, 37.8), (8.7, 50.1), (151.2, -33.9), (3.4, 6.5), (-99.1, 19.4)]
PAIRS = [(0, 1), (1, 2), (1, 6), (6, 3), (3, 4), (0, 7), (5, 0), (1, 10), (8, 6), (3, 9), (11, 5), (7, 4)]


def arc(a, b, n=48, lift=20):
    v = lambda lo, la: (math.cos(math.radians(la)) * math.cos(math.radians(lo)),
                        math.cos(math.radians(la)) * math.sin(math.radians(lo)), math.sin(math.radians(la)))
    p, q = v(*a), v(*b)
    om = math.acos(max(-1, min(1, sum(i * j for i, j in zip(p, q)))))
    out = []
    for i in range(n + 1):
        t = i / n
        s1, s2 = math.sin((1 - t) * om) / math.sin(om), math.sin(t * om) / math.sin(om)
        x, y, z = (s1 * p[k] + s2 * q[k] for k in range(3))
        px, py = xy(math.degrees(math.atan2(y, x)), math.degrees(math.asin(z)))
        out.append((px, py - math.sin(math.pi * t) * lift))
    if max(abs(out[k + 1][0] - out[k][0]) for k in range(n)) > W / 5:
        return None  # wraps around the map edge
    return "M" + " L".join("%.1f %.1f" % c for c in out)


def main():
    rings = load_rings()
    data = {
        "source": "scripts/home/build-map.py — Natural Earth 1:110m land; decorative, not live nodes.",
        "w": W,
        "h": H,
        "land": dots(land_grid(rings)),
        "ambient": dots(ambient_points(rings)),
        "hubs": [[round(c, 1) for c in xy(*h)] for h in HUBS],
        "arcs": [d for d in (arc(HUBS[i], HUBS[j]) for i, j in PAIRS) if d],
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} — {len(data['arcs'])} arcs, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
