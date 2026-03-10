import { useMemo, useState, useEffect } from "react";
import * as THREE from "three";

const EARTH_RADIUS = 2;
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";

// Convert lat/lon to 3D positions on sphere
function geoToSphere(coord: [number, number], radius: number): [number, number, number] {
  const [lon, lat] = coord;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  
  return [x, y, z];
}

// Convert TopoJSON arcs to coordinates
function topoToGeo(topoData: any, arc: number[]): [number, number][] {
  const coordinates: [number, number][] = [];
  let x = 0, y = 0;
  
  for (let i = 0; i < arc.length; i += 2) {
    x += arc[i];
    y += arc[i + 1];
    // TopoJSON uses quantized coordinates, need to unquantize
    const lon = (x / topoData.transform.scale[0]) + topoData.transform.translate[0];
    const lat = (y / topoData.transform.scale[1]) + topoData.transform.translate[1];
    coordinates.push([lon, lat]);
  }
  
  return coordinates;
}

export function EarthGeography() {
  const [geoData, setGeoData] = useState<any>(null);

  useEffect(() => {
    fetch(GEO_URL)
      .then((res) => res.json())
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Error loading geography:", err));
  }, []);

  const { positions, indices } = useMemo(() => {
    if (!geoData) return { positions: new Float32Array(0), indices: new Uint16Array(0) };
    
    try {
      const positions: number[] = [];
      const indices: number[] = [];
      let vertexIndex = 0;

      // TopoJSON structure: data.objects.land.geometries
      const land = geoData.objects.land;
      if (!land || !land.geometries) {
        return { positions: new Float32Array(0), indices: new Uint16Array(0) };
      }

      land.geometries.forEach((feature: any) => {
        if (feature.type === "Polygon" || feature.type === "MultiPolygon") {
          const arcs = feature.arcs;
          
          if (feature.type === "Polygon") {
            arcs.forEach((ring: number[]) => {
              const startIndex = vertexIndex;
              const coords = topoToGeo(geoData, geoData.arcs[Math.abs(ring[0])]);
              
              coords.forEach((coord: [number, number]) => {
                const [x, y, z] = geoToSphere(coord, EARTH_RADIUS);
                positions.push(x, y, z);
                vertexIndex++;
              });
              
              // Create triangles (fan triangulation)
              for (let i = 1; i < coords.length - 1; i++) {
                indices.push(startIndex, startIndex + i, startIndex + i + 1);
              }
            });
          } else if (feature.type === "MultiPolygon") {
            arcs.forEach((polygon: number[][]) => {
              polygon.forEach((ring: number[]) => {
                const startIndex = vertexIndex;
                const coords = topoToGeo(geoData, geoData.arcs[Math.abs(ring[0])]);
                
                coords.forEach((coord: [number, number]) => {
                  const [x, y, z] = geoToSphere(coord, EARTH_RADIUS);
                  positions.push(x, y, z);
                  vertexIndex++;
                });
                
                // Create triangles
                for (let i = 1; i < coords.length - 1; i++) {
                  indices.push(startIndex, startIndex + i, startIndex + i + 1);
                }
              });
            });
          }
        }
      });

      return {
        positions: new Float32Array(positions),
        indices: new Uint16Array(indices),
      };
    } catch (error) {
      console.error("Error parsing geography data:", error);
      return { positions: new Float32Array(0), indices: new Uint16Array(0) };
    }
  }, [geoData]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          count={indices.length}
          array={indices}
          itemSize={1}
        />
      </bufferGeometry>
      <meshStandardMaterial
        color="#64748b"
        roughness={0.9}
        metalness={0.05}
        side={THREE.FrontSide}
        emissive="#475569"
        emissiveIntensity={0.1}
      />
    </mesh>
  );
}
