import { useState, useCallback, useEffect, useRef } from 'react';
import { NiftiVolume } from '../hooks/useNiftiVolume';
import SliceViewer from './SliceViewer';
import MeshViewer from './MeshViewer';
import { MeshState } from '../types';

interface CrosshairPosition {
  x: number; // Sagittal position (left-right)
  y: number; // Coronal position (front-back)
  z: number; // Axial position (top-bottom)
}

interface QuadViewProps {
  volume: NiftiVolume;
  studyId: string | null;
  stlFiles: { brain: string | null; tumor: string | null };
  meshState: MeshState;
  onMeshStateChange: (updates: Partial<MeshState>) => void;
  onZoomHandlersReady?: (handlers: { zoomIn: () => void; zoomOut: () => void; getCurrentZoom: () => number }) => void;
}

export default function QuadView({
  volume,
  studyId,
  stlFiles,
  meshState,
  onMeshStateChange,
  onZoomHandlersReady,
}: QuadViewProps) {
  const [dims] = useState(() => volume.dims);

  // Crosshair position (in voxel coordinates)
  const [crosshair, setCrosshair] = useState<CrosshairPosition>(() => ({
    x: Math.floor(volume.dims[0] / 2),
    y: Math.floor(volume.dims[1] / 2),
    z: Math.floor(volume.dims[2] / 2),
  }));

  // Update crosshair when volume changes
  useEffect(() => {
    setCrosshair({
      x: Math.floor(volume.dims[0] / 2),
      y: Math.floor(volume.dims[1] / 2),
      z: Math.floor(volume.dims[2] / 2),
    });
  }, [volume]);

  // Handlers for each slice viewer
  const handleAxialSliceChange = useCallback((z: number) => {
    setCrosshair(prev => ({ ...prev, z }));
  }, []);

  const handleAxialCrosshairChange = useCallback((x: number, y: number) => {
    setCrosshair(prev => ({ ...prev, x, y }));
  }, []);

  const handleCoronalSliceChange = useCallback((y: number) => {
    setCrosshair(prev => ({ ...prev, y }));
  }, []);

  const handleCoronalCrosshairChange = useCallback((x: number, z: number) => {
    setCrosshair(prev => ({ ...prev, x, z }));
  }, []);

  const handleSagittalSliceChange = useCallback((x: number) => {
    setCrosshair(prev => ({ ...prev, x }));
  }, []);

  const handleSagittalCrosshairChange = useCallback((y: number, z: number) => {
    setCrosshair(prev => ({ ...prev, y, z }));
  }, []);

  // Convert crosshair to normalized coordinates for 3D view (-1 to 1)
  const normalizedCrosshair = {
    x: (crosshair.x / dims[0]) * 2 - 1,
    y: (crosshair.y / dims[1]) * 2 - 1,
    z: (crosshair.z / dims[2]) * 2 - 1,
  };

  // Zoom handlers
  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
  } | null>(null);
  const [zoomPercentage, setZoomPercentage] = useState(50);

  const handleZoomIn = useCallback(() => {
    if (zoomHandlersRef.current) {
      zoomHandlersRef.current.zoomIn();
      const currentZoom = zoomHandlersRef.current.getCurrentZoom();
      setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (zoomHandlersRef.current) {
      zoomHandlersRef.current.zoomOut();
      const currentZoom = zoomHandlersRef.current.getCurrentZoom();
      setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
    }
  }, []);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: '4px',
      height: '100%',
      overflow: 'hidden',
      background: '#1a1a1a',
    }}>
      {/* Top Left: Axial (Red) */}
      <SliceViewer
        volume={volume}
        plane="axial"
        sliceIndex={crosshair.z}
        crosshairX={crosshair.x}
        crosshairY={crosshair.y}
        onSliceChange={handleAxialSliceChange}
        onCrosshairChange={handleAxialCrosshairChange}
        color="#e74c3c"
        label="Axial"
      />

      {/* Top Right: 3D View (Blue) */}
      <div style={{
        background: '#000',
        borderTop: '3px solid #3498db',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          background: '#3498db',
          padding: '4px 12px',
          fontSize: '12px',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <span>3D View</span>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Zoom */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={handleZoomOut}
                style={{
                  width: '20px',
                  height: '20px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                −
              </button>
              <span style={{ fontSize: '11px', minWidth: '32px', textAlign: 'center' }}>
                {zoomPercentage}%
              </span>
              <button
                onClick={handleZoomIn}
                style={{
                  width: '20px',
                  height: '20px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                +
              </button>
            </div>

            {/* Brain opacity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Brain</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={meshState.brain.opacity}
                onChange={(e) => onMeshStateChange({
                  brain: { ...meshState.brain, opacity: Number(e.target.value) }
                })}
                style={{ width: '60px', accentColor: '#b0b0b0', height: '4px' }}
              />
            </div>

            {/* Tumor opacity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#ff6b4a' }}>Tumor</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={meshState.tumor.opacity}
                onChange={(e) => onMeshStateChange({
                  tumor: { ...meshState.tumor, opacity: Number(e.target.value) }
                })}
                style={{ width: '60px', accentColor: '#ff6b4a', height: '4px' }}
              />
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <MeshViewer
            studyId={studyId}
            stlFiles={stlFiles}
            meshState={meshState}
            onZoomHandlersReady={(handlers) => {
              zoomHandlersRef.current = handlers;
              const currentZoom = handlers.getCurrentZoom();
              setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
              if (onZoomHandlersReady) onZoomHandlersReady(handlers);
            }}
            crosshairPosition={normalizedCrosshair}
            showCrosshairPlanes={true}
            volumeDims={dims}
            voxelSpacing={volume.pixDims}
          />
        </div>
      </div>

      {/* Bottom Left: Coronal (Green) */}
      <SliceViewer
        volume={volume}
        plane="coronal"
        sliceIndex={crosshair.y}
        crosshairX={crosshair.x}
        crosshairY={crosshair.z}
        onSliceChange={handleCoronalSliceChange}
        onCrosshairChange={handleCoronalCrosshairChange}
        color="#2ecc71"
        label="Coronal"
      />

      {/* Bottom Right: Sagittal (Yellow) */}
      <SliceViewer
        volume={volume}
        plane="sagittal"
        sliceIndex={crosshair.x}
        crosshairX={crosshair.y}
        crosshairY={crosshair.z}
        onSliceChange={handleSagittalSliceChange}
        onCrosshairChange={handleSagittalCrosshairChange}
        color="#f1c40f"
        label="Sagittal"
      />
    </div>
  );
}
