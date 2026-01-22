declare module "react-simple-maps" {
  import type { ReactNode } from "react";
  export type Point = [number, number];
  export interface ComposableMapProps {
    projectionConfig?: { rotate?: [number, number, number] };
    children?: ReactNode;
    className?: string;
  }
  export interface ZoomableGroupProps {
    zoom?: number;
    center?: Point;
    onMoveEnd?: (pos: { coordinates: Point; zoom: number }) => void;
    filterZoomEvent?: (e: Event) => boolean;
    children?: ReactNode;
  }
  type GeoItem = { rsmKey: string; [k: string]: unknown };
  export interface GeographiesProps {
    geography: string;
    children?: (props: { geographies: GeoItem[] }) => ReactNode;
  }
  export interface GeographyProps {
    geography: GeoItem;
    key?: string;
    fill?: string;
    stroke?: string;
    className?: string;
    style?: { default?: object; hover?: object; pressed?: object };
  }
  export interface MarkerProps {
    coordinates: Point;
    children?: ReactNode;
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element;
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;
  export function Geographies(props: GeographiesProps): JSX.Element;
  export function Geography(props: GeographyProps): JSX.Element;
  export function Marker(props: MarkerProps): JSX.Element;
}
