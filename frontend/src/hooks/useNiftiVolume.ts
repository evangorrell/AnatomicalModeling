import { useState, useEffect } from 'react';
import * as nifti from 'nifti-reader-js';
import pako from 'pako';

export interface NiftiVolume {
  data: Float32Array | Int16Array | Uint8Array;
  dims: [number, number, number]; // [x, y, z] dimensions
  pixDims: [number, number, number]; // voxel spacing in mm
  min: number;
  max: number;
  header: nifti.NIFTI1 | nifti.NIFTI2;
}

export interface UseNiftiVolumeResult {
  volume: NiftiVolume | null;
  loading: boolean;
  error: string | null;
}

export function useNiftiVolume(file: File | null): UseNiftiVolumeResult {
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setVolume(null);
      return;
    }

    const loadNifti = async () => {
      setLoading(true);
      setError(null);

      try {
        const arrayBuffer = await file.arrayBuffer();
        let data = arrayBuffer;

        // Decompress if gzipped
        if (nifti.isCompressed(data)) {
          const decompressed = pako.inflate(new Uint8Array(data));
          data = decompressed.buffer as ArrayBuffer;
        }

        // Check if valid NIfTI
        if (!nifti.isNIFTI(data)) {
          throw new Error('Not a valid NIfTI file');
        }

        // Read header
        const header = nifti.readHeader(data);
        if (!header) {
          throw new Error('Failed to read NIfTI header');
        }

        // Read image data
        const imageData = nifti.readImage(header, data);

        // Get dimensions (first 3 dims, ignore time if 4D)
        const dims: [number, number, number] = [
          header.dims[1],
          header.dims[2],
          header.dims[3],
        ];

        // Get voxel spacing
        const pixDims: [number, number, number] = [
          header.pixDims[1],
          header.pixDims[2],
          header.pixDims[3],
        ];

        // Convert to typed array based on datatype
        let typedData: Float32Array | Int16Array | Uint8Array;

        switch (header.datatypeCode) {
          case nifti.NIFTI1.TYPE_UINT8:
            typedData = new Uint8Array(imageData);
            break;
          case nifti.NIFTI1.TYPE_INT16:
            typedData = new Int16Array(imageData);
            break;
          case nifti.NIFTI1.TYPE_FLOAT32:
            typedData = new Float32Array(imageData);
            break;
          case nifti.NIFTI1.TYPE_FLOAT64:
            // Convert float64 to float32
            const float64 = new Float64Array(imageData);
            typedData = new Float32Array(float64);
            break;
          default:
            // Default to int16
            typedData = new Int16Array(imageData);
        }

        // Calculate min/max for windowing
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < typedData.length; i++) {
          const val = typedData[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        console.log('NIfTI loaded:', {
          dims,
          pixDims,
          datatype: header.datatypeCode,
          min,
          max,
          totalVoxels: typedData.length,
        });

        setVolume({
          data: typedData,
          dims,
          pixDims,
          min,
          max,
          header,
        });
      } catch (err: unknown) {
        console.error('Failed to load NIfTI:', err);
        setError(err instanceof Error ? err.message : 'Failed to load NIfTI file');
      } finally {
        setLoading(false);
      }
    };

    loadNifti();
  }, [file]);

  return { volume, loading, error };
}

// Helper function to get a slice from the volume
export function getSlice(
  volume: NiftiVolume,
  plane: 'axial' | 'coronal' | 'sagittal',
  sliceIndex: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const { data, dims, min, max } = volume;
  const [dimX, dimY, dimZ] = dims;
  const range = max - min || 1;

  let width: number;
  let height: number;
  let sliceArray: number[];

  if (plane === 'axial') {
    // X-Y plane at slice Z
    width = dimX;
    height = dimY;
    sliceArray = new Array(width * height * 4);
    const z = Math.min(Math.max(0, sliceIndex), dimZ - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = x + y * dimX + z * dimX * dimY;
        const dstIdx = (x + (height - 1 - y) * width) * 4; // Flip Y for display
        const val = Math.round(((data[srcIdx] - min) / range) * 255);
        sliceArray[dstIdx] = val;
        sliceArray[dstIdx + 1] = val;
        sliceArray[dstIdx + 2] = val;
        sliceArray[dstIdx + 3] = 255;
      }
    }
  } else if (plane === 'coronal') {
    // X-Z plane at slice Y
    width = dimX;
    height = dimZ;
    sliceArray = new Array(width * height * 4);
    const y = Math.min(Math.max(0, sliceIndex), dimY - 1);

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = x + y * dimX + z * dimX * dimY;
        const dstIdx = (x + (height - 1 - z) * width) * 4; // Flip Z for display
        const val = Math.round(((data[srcIdx] - min) / range) * 255);
        sliceArray[dstIdx] = val;
        sliceArray[dstIdx + 1] = val;
        sliceArray[dstIdx + 2] = val;
        sliceArray[dstIdx + 3] = 255;
      }
    }
  } else {
    // sagittal: Y-Z plane at slice X
    width = dimY;
    height = dimZ;
    sliceArray = new Array(width * height * 4);
    const x = Math.min(Math.max(0, sliceIndex), dimX - 1);

    for (let z = 0; z < height; z++) {
      for (let y = 0; y < width; y++) {
        const srcIdx = x + y * dimX + z * dimX * dimY;
        const dstIdx = (y + (height - 1 - z) * width) * 4; // Flip Z for display
        const val = Math.round(((data[srcIdx] - min) / range) * 255);
        sliceArray[dstIdx] = val;
        sliceArray[dstIdx + 1] = val;
        sliceArray[dstIdx + 2] = val;
        sliceArray[dstIdx + 3] = 255;
      }
    }
  }

  return { data: new Uint8ClampedArray(sliceArray), width, height };
}
