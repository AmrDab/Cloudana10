// The hero's dotted world map (data: scripts/home/build-map.py). Light travels along the arcs and the city dots
// pulse; both are CSS animations and stop under prefers-reduced-motion. Decorative: no node is a live machine.
import map from "./map.json";

export function WorldMap() {
  return (
    <svg viewBox={`0 0 ${map.w} ${map.h}`} className="pp-world" aria-hidden="true">
      <path d={map.land} className="pp-land" />
      <path d={map.ambient} className="pp-ambient" />
      {map.arcs.map((d, i) => (
        <g key={i}>
          <path d={d} className="pp-arc" />
          <path d={d} pathLength={1} className="pp-streak" style={{ animationDuration: `${5 + (i % 4)}s`, animationDelay: `${-i * 1.3}s` }} />
        </g>
      ))}
      {map.hubs.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={6.5} className="pp-ring" style={{ animationDelay: `${-i * 0.7}s` }} />
          <circle cx={x} cy={y} r={2.6} className="pp-hub" />
        </g>
      ))}
    </svg>
  );
}
