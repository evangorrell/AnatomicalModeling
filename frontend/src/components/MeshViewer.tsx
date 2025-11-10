import { useRef, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useMeshes } from '../hooks/useMeshes';
import { MeshState } from '../types';
import { verifyAssignmentByVolume } from '../utils/meshAnalysis';

interface MeshViewerProps {
  studyId: string | null; // For NIfTI-generated meshes
  stlFiles: { brain: string | null; tumor: string | null }; // For direct STL viewing
  meshState: MeshState;
  onZoomHandlersReady?: (handlers: { zoomIn: () => void; zoomOut: () => void; getCurrentZoom: () => number }) => void;
}

interface MeshObjectProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  opacity: number;
  visible: boolean;
}

function MeshObject({ geometry, color, opacity, visible }: MeshObjectProps) {
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} visible={visible}>
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
        flatShading={false}
        metalness={0.2}
        roughness={0.4}
      />
    </mesh>
  );
}

function Scene({ studyId, stlFiles, meshState, onZoomHandlersReady }: MeshViewerProps) {
  const { brain: niftiBrain, tumor: niftiTumor } = useMeshes(studyId);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<any>(null);
  const [stlBrainGeometry, setStlBrainGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [stlTumorGeometry, setStlTumorGeometry] = useState<THREE.BufferGeometry | null>(null);

  // Load STL brain file if provided
  useEffect(() => {
    if (!stlFiles.brain) {
      setStlBrainGeometry(null);
      return;
    }

    const loader = new STLLoader();
    loader.load(
      stlFiles.brain,
      (geometry) => {
        geometry.center();
        geometry.computeVertexNormals();
        setStlBrainGeometry(geometry);
      },
      undefined,
      (error) => {
        console.error('Error loading brain STL file:', error);
      }
    );

    return () => {
      if (stlBrainGeometry) {
        stlBrainGeometry.dispose();
      }
    };
  }, [stlFiles.brain]);

  // Load STL tumor file if provided
  useEffect(() => {
    if (!stlFiles.tumor) {
      setStlTumorGeometry(null);
      return;
    }

    const loader = new STLLoader();
    loader.load(
      stlFiles.tumor,
      (geometry) => {
        geometry.center();
        geometry.computeVertexNormals();
        setStlTumorGeometry(geometry);
      },
      undefined,
      (error) => {
        console.error('Error loading tumor STL file:', error);
      }
    );

    return () => {
      if (stlTumorGeometry) {
        stlTumorGeometry.dispose();
      }
    };
  }, [stlFiles.tumor]);

  // Verify brain/tumor assignment using volume analysis after both are loaded
  const hasVerifiedRef = useRef(false);
  useEffect(() => {
    if (stlBrainGeometry && stlTumorGeometry && !hasVerifiedRef.current) {
      hasVerifiedRef.current = true;

      const { shouldSwap, brainVolume, tumorVolume } = verifyAssignmentByVolume(
        stlBrainGeometry,
        stlTumorGeometry
      );

      if (shouldSwap) {
        console.warn('⚠️ Volume analysis suggests brain/tumor assignment should be swapped!');
        console.warn(`Current "brain" volume: ${brainVolume.toFixed(2)}, "tumor" volume: ${tumorVolume?.toFixed(2)}`);
        console.warn('Consider swapping the file assignments.');

        // Automatically swap - create new state to trigger re-render
        setStlBrainGeometry(stlTumorGeometry.clone());
        setStlTumorGeometry(stlBrainGeometry.clone());

        console.log('✅ Automatically swapped brain and tumor based on volume analysis');
      } else {
        console.log('✅ Volume analysis confirms correct brain/tumor assignment');
        console.log(`Brain volume: ${brainVolume.toFixed(2)}, Tumor volume: ${tumorVolume?.toFixed(2)}`);
      }
    }
  }, [stlBrainGeometry, stlTumorGeometry]);

  // Expose zoom handlers to parent component
  useEffect(() => {
    if (cameraRef.current && controlsRef.current && onZoomHandlersReady) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;

      const handlers = {
        zoomIn: () => {
          // Move camera closer along current view direction
          const target = controls.target;
          const direction = new THREE.Vector3().subVectors(camera.position, target);
          const currentDistance = direction.length();
          const newDistance = Math.max(50, currentDistance - 20); // Min distance 50

          direction.normalize().multiplyScalar(newDistance);
          camera.position.copy(target).add(direction);
          controls.update();
        },
        zoomOut: () => {
          // Move camera farther along current view direction
          const target = controls.target;
          const direction = new THREE.Vector3().subVectors(camera.position, target);
          const currentDistance = direction.length();
          const newDistance = Math.min(500, currentDistance + 20); // Max distance 500

          direction.normalize().multiplyScalar(newDistance);
          camera.position.copy(target).add(direction);
          controls.update();
        },
        getCurrentZoom: () => {
          const target = controls.target;
          return camera.position.distanceTo(target);
        }
      };

      onZoomHandlersReady(handlers);
    }
  }, [onZoomHandlersReady]);

  return (
    <>
      {/* Camera - static initial position, controlled via refs */}
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={[0, 0, 200]}
        fov={50}
      />

      {/* Lights */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1.0}
        castShadow
      />
      <directionalLight
        position={[-10, -10, -5]}
        intensity={0.4}
      />
      <pointLight position={[0, 10, 0]} intensity={0.3} />

      {/* Subtle grid floor */}
      <gridHelper
        args={[200, 20, '#4a6fa5', '#2d4a6e']}
        position={[0, -100, 0]}
      />

      {/* Render brain mesh (from either STL or NIfTI) */}
      {(stlBrainGeometry || niftiBrain.geometry) && (
        <MeshObject
          geometry={stlBrainGeometry || niftiBrain.geometry}
          color={meshState.brain.color}
          opacity={meshState.brain.opacity}
          visible={meshState.brain.visible}
        />
      )}

      {/* Render tumor mesh (from either STL or NIfTI) */}
      {(stlTumorGeometry || niftiTumor.geometry) && (
        <MeshObject
          geometry={stlTumorGeometry || niftiTumor.geometry}
          color={meshState.tumor.color}
          opacity={meshState.tumor.opacity}
          visible={meshState.tumor.visible}
        />
      )}

      {/* Loading indicators (only for NIfTI mode) */}
      {(niftiBrain.loading || niftiTumor.loading) && (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[5, 32, 32]} />
          <meshStandardMaterial color="#ff6b4a" wireframe />
        </mesh>
      )}

      {/* Orbit controls */}
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        panSpeed={0.5}
        minDistance={50}
        maxDistance={500}
      />
    </>
  );
}

export default function MeshViewer({ studyId, stlFiles, meshState, onZoomHandlersReady }: MeshViewerProps) {
  return (
    <Canvas
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0f1e2e 0%, #1a2f45 100%)'
      }}
      shadows
    >
      <Scene
        studyId={studyId}
        stlFiles={stlFiles}
        meshState={meshState}
        onZoomHandlersReady={onZoomHandlersReady}
      />
    </Canvas>
  );
}
