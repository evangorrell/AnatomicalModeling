import { useState, useEffect } from 'react';
import { getMeshUrl } from '../api';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

interface MeshData {
  geometry: THREE.BufferGeometry | null;
  loading: boolean;
  error: string | null;
}

interface UseMeshesResult {
  brain: MeshData;
  tumor: MeshData;
}

export function useMeshes(studyId: string | null): UseMeshesResult {
  const [brain, setBrain] = useState<MeshData>({
    geometry: null,
    loading: false,
    error: null,
  });

  const [tumor, setTumor] = useState<MeshData>({
    geometry: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!studyId) {
      return;
    }

    const loader = new STLLoader();

    // Load brain mesh
    setBrain(prev => ({ ...prev, loading: true, error: null }));
    const brainUrl = getMeshUrl(studyId, 'brain.stl');

    fetch(brainUrl)
      .then(response => response.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);

        loader.load(
          objectUrl,
          (geometry) => {
            // Center and compute normals
            geometry.center();
            geometry.computeVertexNormals();

            setBrain({
              geometry,
              loading: false,
              error: null,
            });

            // Clean up object URL
            URL.revokeObjectURL(objectUrl);
          },
          undefined,
          (error) => {
            console.error('Error loading brain mesh:', error);
            setBrain({
              geometry: null,
              loading: false,
              error: 'Failed to load brain mesh',
            });
            URL.revokeObjectURL(objectUrl);
          }
        );
      })
      .catch(error => {
        console.error('Error fetching brain mesh:', error);
        setBrain({
          geometry: null,
          loading: false,
          error: 'Failed to fetch brain mesh',
        });
      });

    // Load tumor mesh
    setTumor(prev => ({ ...prev, loading: true, error: null }));
    const tumorUrl = getMeshUrl(studyId, 'tumor.stl');

    fetch(tumorUrl)
      .then(response => response.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);

        loader.load(
          objectUrl,
          (geometry) => {
            // Center and compute normals
            geometry.center();
            geometry.computeVertexNormals();

            setTumor({
              geometry,
              loading: false,
              error: null,
            });

            // Clean up object URL
            URL.revokeObjectURL(objectUrl);
          },
          undefined,
          (error) => {
            console.error('Error loading tumor mesh:', error);
            setTumor({
              geometry: null,
              loading: false,
              error: 'Failed to load tumor mesh',
            });
            URL.revokeObjectURL(objectUrl);
          }
        );
      })
      .catch(error => {
        console.error('Error fetching tumor mesh:', error);
        setTumor({
          geometry: null,
          loading: false,
          error: 'Failed to fetch tumor mesh',
        });
      });

  }, [studyId]);

  return { brain, tumor };
}
