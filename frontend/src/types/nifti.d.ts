declare module 'nifti-reader-js' {
  export function isCompressed(data: ArrayBuffer): boolean;
  export function isNIFTI(data: ArrayBuffer): boolean;
  export function readHeader(data: ArrayBuffer): NIFTI1 | NIFTI2 | null;
  export function readImage(header: NIFTI1 | NIFTI2, data: ArrayBuffer): ArrayBuffer;

  export class NIFTI1 {
    static TYPE_UINT8: number;
    static TYPE_INT16: number;
    static TYPE_INT32: number;
    static TYPE_FLOAT32: number;
    static TYPE_FLOAT64: number;
    static TYPE_RGB24: number;

    dims: number[];
    pixDims: number[];
    datatypeCode: number;
    numBitsPerVoxel: number;
    scl_slope: number;
    scl_inter: number;
    qform_code: number;
    sform_code: number;
    quatern_b: number;
    quatern_c: number;
    quatern_d: number;
    qoffset_x: number;
    qoffset_y: number;
    qoffset_z: number;
    affine: number[][];
  }

  export class NIFTI2 extends NIFTI1 {}
}

declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array): Uint8Array;
}
