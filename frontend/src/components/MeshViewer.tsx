import { useRef, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useMeshes } from '../hooks/useMeshes';
import { MeshState } from '../types';

interface MeshViewerProps {
  studyId: string | null; // For NIfTI-generated meshes
  stlFile: string | null; // For direct STL viewing
  meshState: MeshState;
  cameraDistance: number;
}

interface MeshObjectProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  opacity: number;
  visible: boolean;
}

function MeshObject({ geometry, color, opacity, visible }: MeshObjectProps) {
  if (!geometry || !visible) return null;

  return (
    <mesh geometry={geometry}>
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

function Scene({ studyId, stlFile, meshState, cameraDistance }: MeshViewerProps) {
  const { brain, tumor } = useMeshes(studyId);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const [stlGeometry, setStlGeometry] = useState<THREE.BufferGeometry | null>(null);

  // Load STL file if provided
  useEffect(() => {
    if (!stlFile) {
      setStlGeometry(null);
      return;
    }

    const loader = new STLLoader();
    loader.load(
      stlFile,
      (geometry) => {
        geometry.center();
        geometry.computeVertexNormals();
        setStlGeometry(geometry);
      },
      undefined,
      (error) => {
        console.error('Error loading STL file:', error);
      }
    );

    return () => {
      if (stlGeometry) {
        stlGeometry.dispose();
      }
    };
  }, [stlFile]);

  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.position.z = cameraDistance;
    }
  }, [cameraDistance]);

  return (
    <>
      {/* Camera */}
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={[0, 0, cameraDistance]}
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

      {/* Render based on mode */}
      {stlFile && stlGeometry ? (
        // Direct STL file viewing
        <mesh geometry={stlGeometry}>
          <meshStandardMaterial
            color="#ff6b4a"
            side={THREE.DoubleSide}
            flatShading={false}
            metalness={0.2}
            roughness={0.4}
          />
        </mesh>
      ) : (
        // NIfTI-generated meshes (brain + tumor)
        <>
          {brain.geometry && (
            <MeshObject
              geometry={brain.geometry}
              color={meshState.brain.color}
              opacity={meshState.brain.opacity}
              visible={meshState.brain.visible}
            />
          )}

          {tumor.geometry && (
            <MeshObject
              geometry={tumor.geometry}
              color={meshState.tumor.color}
              opacity={meshState.tumor.opacity}
              visible={meshState.tumor.visible}
            />
          )}

          {/* Loading indicators */}
          {(brain.loading || tumor.loading) && (
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[5, 32, 32]} />
              <meshStandardMaterial color="#ff6b4a" wireframe />
            </mesh>
          )}
        </>
      )}

      {/* Orbit controls */}
      <OrbitControls
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

export default function MeshViewer({ studyId, stlFile, meshState, cameraDistance }: MeshViewerProps) {
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
        stlFile={stlFile}
        meshState={meshState}
        cameraDistance={cameraDistance}
      />
    </Canvas>
  );
}
