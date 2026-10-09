// Graph + world lookups shared by the shell (dock, search, panel, breadcrumb).
import { NODE_INDEX, pathTo } from "./graph";
import type { NodeId, UNode } from "./types";
import { placeOf } from "./world";

const parentOf = (id: NodeId) => (NODE_INDEX as Record<NodeId, UNode | undefined>)[id]?.parent;

/** City the node sits in on the globe (leaves: their topic's city); undefined for the core. */
export const cityOf = (id: NodeId): string | undefined => placeOf(id, parentOf)?.city;

/** The region a node belongs to (itself for a region); undefined for the core or an unknown id. */
export const regionOf = (id: NodeId): UNode | undefined => pathTo(id)[1];
