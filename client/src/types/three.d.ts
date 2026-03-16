declare module "three" {
  export const FrontSide: number;
  export class BufferGeometry {}
  export class BufferAttribute {}
  export class MeshStandardMaterial {}
  export class Mesh {}
}

declare namespace JSX {
  interface IntrinsicElements {
    mesh: any;
    bufferGeometry: any;
    bufferAttribute: any;
    meshStandardMaterial: any;
  }
}
