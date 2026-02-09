import { useState, useEffect, useRef } from 'react';
import { getMeshUrl } from '../api';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { computeGeometryCenter, centerGeometry } from '../utils/geometryUtils';

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

  // Store raw (uncentered) geometries
  const rawBrainRef = useRef<THREE.BufferGeometry | null>(null);
  const rawTumorRef = useRef<THREE.BufferGeometry | null>(null);
  const hasCenteredRef = useRef(false);

  // Center both meshes together using brain as reference
  const centerMeshesTogether = () => {
    const rawBrain = rawBrainRef.current;
    if (!rawBrain) return;

    const center = computeGeometryCenter(rawBrain);

    setBrain({
      geometry: centerGeometry(rawBrain, center),
      loading: false,
      error: null,
    });

    const rawTumor = rawTumorRef.current;
    if (rawTumor) {
      setTumor({
        geometry: centerGeometry(rawTumor, center),
        loading: false,
        error: null,
      });
    }

    hasCenteredRef.current = true;
  };

  useEffect(() => {
    if (!studyId) {
      return;
    }

    // Reset state
    hasCenteredRef.current = false;
    rawBrainRef.current = null;
    rawTumorRef.current = null;

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
            // Compute normals but DON'T center yet
            geometry.computeVertexNormals();

            // Store raw geometry
            rawBrainRef.current = geometry;

            // Try to center if we have both, or just brain if tumor doesn't exist
            // We'll wait a bit for tumor to load first
            setTimeout(() => {
              if (!hasCenteredRef.current && rawBrainRef.current) {
                centerMeshesTogether();
              }
            }, 500);

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

    // Load tumor mesh (may not exist for all studies)
    setTumor(prev => ({ ...prev, loading: true, error: null }));
    const tumorUrl = getMeshUrl(studyId, 'tumor.stl');

    fetch(tumorUrl)
      .then(response => {
        if (!response.ok) {
          // If tumor doesn't exist (404), that's okay - just don't load it
          if (response.status === 404) {
            console.log('No tumor mesh found for this study');
            setTumor({
              geometry: null,
              loading: false,
              error: null,
            });
            return null;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        if (!blob) return; // No tumor file exists

        const objectUrl = URL.createObjectURL(blob);

        loader.load(
          objectUrl,
          (geometry) => {
            // Compute normals but DON'T center yet
            geometry.computeVertexNormals();

            // Store raw geometry
            rawTumorRef.current = geometry;

            // Center both together now that tumor is loaded
            if (rawBrainRef.current && !hasCenteredRef.current) {
              centerMeshesTogether();
            }

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
          error: null, // Don't show error if tumor doesn't exist
        });
      });

  }, [studyId]);

  return { brain, tumor };
}
