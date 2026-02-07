import { useRef, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useMeshes } from '../hooks/useMeshes';
import { MeshState } from '../types';
import { verifyAssignmentByVolume } from '../utils/meshAnalysis';

// Zoom limits: 3% to 110%
// percentage = ((500 - distance) / 450) * 100
// distance = 500 - (percentage / 100) * 450
const MIN_ZOOM_DISTANCE = 500 - (110 / 100) * 450; // ~5 (110%)
const MAX_ZOOM_DISTANCE = 500 - (3 / 100) * 450;   // ~486.5 (3%)

interface MeshViewerProps {
  studyId: string | null; // For NIfTI-generated meshes
  stlFiles: { brain: string | null; tumor: string | null }; // For direct STL viewing
  meshState: MeshState;
  onZoomHandlersReady?: (handlers: { zoomIn: () => void; zoomOut: () => void; getCurrentZoom: () => number; setZoomDistance: (distance: number) => void }) => void;
  onZoomChange?: (zoomDistance: number) => void; // Called when zoom changes (scroll, etc.)
  // Crosshair planes for quad-view
  crosshairPosition?: { x: number; y: number; z: number }; // Normalized -1 to 1
  showCrosshairPlanes?: boolean;
  showGrid?: boolean;
  volumeDims?: [number, number, number];
  voxelSpacing?: [number, number, number];
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

// Simple yellow crosshair lines for quad-view synchronization
interface CrosshairLinesProps {
  position: { x: number; y: number; z: number }; // Normalized -1 to 1
  size: number; // Size of the lines
}

function CrosshairLines({ position, size }: CrosshairLinesProps) {
  const halfSize = size / 2;

  // Convert normalized position to actual coordinates
  // Negate X to fix sagittal tracking direction
  const posX = -position.x * halfSize;
  const posY = position.y * halfSize;
  const posZ = position.z * halfSize;

  // Use key to force re-render when position changes (buffer geometry doesn't auto-update)
  const posKey = `${posX.toFixed(2)}-${posY.toFixed(2)}-${posZ.toFixed(2)}`;
  
  const color = '#ffff00'
  const opacity = 0.6;

  return (
    <group key={posKey}>
      {/* X-axis line (left-right) - yellow */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([-halfSize, posY, posZ, halfSize, posY, posZ])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      </line>
      {/* Y-axis line (up-down) - yellow */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([posX, -halfSize, posZ, posX, halfSize, posZ])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      </line>
      {/* Z-axis line (front-back) - yellow */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([posX, posY, -halfSize, posX, posY, halfSize])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#f1c40f" linewidth={2} />
      </line>
    </group>
  );
}

function Scene({ studyId, stlFiles, meshState, onZoomHandlersReady, onZoomChange, crosshairPosition, showCrosshairPlanes, showGrid = true, volumeDims, voxelSpacing }: MeshViewerProps) {
  const { brain: niftiBrain, tumor: niftiTumor } = useMeshes(studyId);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<any>(null);
  const [stlBrainGeometry, setStlBrainGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [stlTumorGeometry, setStlTumorGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [rawBrainGeometry, setRawBrainGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [rawTumorGeometry, setRawTumorGeometry] = useState<THREE.BufferGeometry | null>(null);

  // Load STL brain file if provided (without centering yet)
  useEffect(() => {
    if (!stlFiles.brain) {
      setRawBrainGeometry(null);
      setStlBrainGeometry(null);
      return;
    }

    const loader = new STLLoader();
    loader.load(
      stlFiles.brain,
      (geometry) => {
        geometry.computeVertexNormals();
        // DON'T center yet - store raw geometry
        setRawBrainGeometry(geometry);
      },
      undefined,
      (error) => {
        console.error('Error loading brain STL file:', error);
      }
    );

    return () => {
      if (rawBrainGeometry) {
        rawBrainGeometry.dispose();
      }
    };
  }, [stlFiles.brain]);

  // Load STL tumor file if provided (without centering yet)
  useEffect(() => {
    if (!stlFiles.tumor) {
      setRawTumorGeometry(null);
      setStlTumorGeometry(null);
      return;
    }

    const loader = new STLLoader();
    loader.load(
      stlFiles.tumor,
      (geometry) => {
        geometry.computeVertexNormals();
        // DON'T center yet - store raw geometry
        setRawTumorGeometry(geometry);
      },
      undefined,
      (error) => {
        console.error('Error loading tumor STL file:', error);
      }
    );

    return () => {
      if (rawTumorGeometry) {
        rawTumorGeometry.dispose();
      }
    };
  }, [stlFiles.tumor]);

  // Center meshes - use brain as reference if available, otherwise center tumor alone
  useEffect(() => {
    // Need at least one mesh to center
    if (!rawBrainGeometry && !rawTumorGeometry) {
      return;
    }

    // Determine the reference geometry for centering
    const referenceGeometry = rawBrainGeometry || rawTumorGeometry;
    if (!referenceGeometry) return;

    referenceGeometry.computeBoundingBox();
    const refBox = referenceGeometry.boundingBox;
    if (!refBox) return;

    const center = new THREE.Vector3();
    refBox.getCenter(center);

    console.log('Centering meshes using reference center:', center);

    // Center brain if it exists
    if (rawBrainGeometry) {
      const centeredBrain = rawBrainGeometry.clone();
      centeredBrain.translate(-center.x, -center.y, -center.z);
      setStlBrainGeometry(centeredBrain);
    }

    // Center tumor if it exists (using same offset to preserve relative position)
    if (rawTumorGeometry) {
      const centeredTumor = rawTumorGeometry.clone();
      centeredTumor.translate(-center.x, -center.y, -center.z);
      setStlTumorGeometry(centeredTumor);

      // Log tumor's position for verification
      centeredTumor.computeBoundingBox();
      const tumorBox = centeredTumor.boundingBox;
      if (tumorBox) {
        const tumorCenter = new THREE.Vector3();
        tumorBox.getCenter(tumorCenter);
        console.log('Tumor center after centering:', tumorCenter);
      }
    }
  }, [rawBrainGeometry, rawTumorGeometry]);

  // Verify brain/tumor assignment using volume analysis after both raw geometries are loaded
  const hasVerifiedRef = useRef(false);
  useEffect(() => {
    if (rawBrainGeometry && rawTumorGeometry && !hasVerifiedRef.current) {
      hasVerifiedRef.current = true;

      const { shouldSwap, brainVolume, tumorVolume } = verifyAssignmentByVolume(
        rawBrainGeometry,
        rawTumorGeometry
      );

      if (shouldSwap) {
        console.warn('⚠️ Volume analysis suggests brain/tumor assignment should be swapped!');
        console.warn(`Current "brain" volume: ${brainVolume.toFixed(2)}, "tumor" volume: ${tumorVolume?.toFixed(2)}`);

        // Swap the raw geometries (the centering effect will re-run)
        const tempBrain = rawBrainGeometry;
        setRawBrainGeometry(rawTumorGeometry);
        setRawTumorGeometry(tempBrain);

        console.log('✅ Automatically swapped brain and tumor based on volume analysis');
      } else {
        console.log('✅ Volume analysis confirms correct brain/tumor assignment');
        console.log(`Brain volume: ${brainVolume.toFixed(2)}, Tumor volume: ${tumorVolume?.toFixed(2)}`);
      }
    }
  }, [rawBrainGeometry, rawTumorGeometry]);

  // Store onZoomChange in a ref so we can use it in the controls setup
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  // Expose zoom handlers to parent component and set up change listener
  useEffect(() => {
    if (cameraRef.current && controlsRef.current) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;

      // Set up change listener for zoom updates
      const handleChange = () => {
        if (onZoomChangeRef.current) {
          const distance = camera.position.distanceTo(controls.target);
          onZoomChangeRef.current(distance);
        }
      };
      
      controls.addEventListener('change', handleChange);

      if (onZoomHandlersReady) {
        const handlers = {
          zoomIn: () => {
            // Move camera closer along current view direction
            const target = controls.target;
            const direction = new THREE.Vector3().subVectors(camera.position, target);
            const currentDistance = direction.length();
            const newDistance = Math.max(MIN_ZOOM_DISTANCE, currentDistance - 20);

            direction.normalize().multiplyScalar(newDistance);
            camera.position.copy(target).add(direction);
            controls.update();
          },
          zoomOut: () => {
            // Move camera farther along current view direction
            const target = controls.target;
            const direction = new THREE.Vector3().subVectors(camera.position, target);
            const currentDistance = direction.length();
            const newDistance = Math.min(MAX_ZOOM_DISTANCE, currentDistance + 20);

            direction.normalize().multiplyScalar(newDistance);
            camera.position.copy(target).add(direction);
            controls.update();
          },
          getCurrentZoom: () => {
            const target = controls.target;
            return camera.position.distanceTo(target);
          },
          setZoomDistance: (distance: number) => {
            // Set camera to specific distance (clamped)
            const target = controls.target;
            const direction = new THREE.Vector3().subVectors(camera.position, target);
            const clampedDistance = Math.max(MIN_ZOOM_DISTANCE, Math.min(MAX_ZOOM_DISTANCE, distance));

            direction.normalize().multiplyScalar(clampedDistance);
            camera.position.copy(target).add(direction);
            controls.update();
          }
        };

        onZoomHandlersReady(handlers);
      }

      return () => {
        controls.removeEventListener('change', handleChange);
      };
    }
  }, [onZoomHandlersReady]);

  return (
    <>
      {/* Camera - view from below (bottom of brain facing user), back at bottom, front at top, 63% zoom */}
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={[0, 0, -216]}
        up={[0, 1, 0]}
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
      {showGrid && (
        <gridHelper
          args={[200, 20, '#3b8ebd', '#1e3a50']}
          position={[0, -100, 0]}
        />
      )}                                                                                                                                                                                                
  
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
          <meshStandardMaterial color="#3b8ebd" wireframe />
        </mesh>
      )}

      {/* Crosshair lines for quad-view */}
      {showCrosshairPlanes && crosshairPosition && (
        <CrosshairLines
          position={crosshairPosition}
          size={volumeDims && voxelSpacing
            ? Math.max(
                volumeDims[0] * voxelSpacing[0],
                volumeDims[1] * voxelSpacing[1],
                volumeDims[2] * voxelSpacing[2]
              ) * 1.2
            : 200
          }
        />
      )}

      {/* Orbit controls */}
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        minDistance={MIN_ZOOM_DISTANCE}
        maxDistance={MAX_ZOOM_DISTANCE}
      />
    </>
  );
}

export default function MeshViewer({
  studyId,
  stlFiles,
  meshState,
  onZoomHandlersReady,
  onZoomChange,
  crosshairPosition,
  showCrosshairPlanes,
  showGrid = true,
  volumeDims,
  voxelSpacing,
}: MeshViewerProps) {
  return (
    <Canvas
      style={{
        width: '100%',
        height: '100%',
        background: 'hsl(222, 30%, 9%)'
      }}
      shadows
    >
      <Scene
        studyId={studyId}
        stlFiles={stlFiles}
        meshState={meshState}
        onZoomHandlersReady={onZoomHandlersReady}
        onZoomChange={onZoomChange}
        crosshairPosition={crosshairPosition}
        showCrosshairPlanes={showCrosshairPlanes}
        showGrid={showGrid}
        volumeDims={volumeDims}
        voxelSpacing={voxelSpacing}
      />
    </Canvas>
  );
}
