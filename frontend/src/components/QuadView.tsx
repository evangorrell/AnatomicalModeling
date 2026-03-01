import { useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { NiftiVolume } from '../hooks/useNiftiVolume';
import { useMeasurements } from '../hooks/useMeasurements';
import SliceViewer, { VIEWER_HEADER_HEIGHT } from './SliceViewer';
import MeshViewer from './MeshViewer';
import { MeshState } from '../types';
import { MeasurementMode } from '../measurements/types';

// Divider style
const DIVIDER = '2px solid white';

// Helper component to wrap each quadrant with inner borders
interface QuadCellProps {
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  children: ReactNode;
}

function QuadCell({ position, children }: QuadCellProps) {
  const borderStyles: React.CSSProperties = {
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  };

  // Add inner borders
  if (position === 'topLeft') {
    borderStyles.borderRight = DIVIDER;
    borderStyles.borderBottom = DIVIDER;
  } else if (position === 'topRight') {
    borderStyles.borderBottom = DIVIDER;
  } else if (position === 'bottomLeft') {
    borderStyles.borderRight = DIVIDER;
    borderStyles.borderBottomLeftRadius = '8px';
  } else if (position === 'bottomRight') {
    borderStyles.borderBottomRightRadius = '8px';
  }

  return <div style={borderStyles}>{children}</div>;
}

interface CrosshairPosition {
  x: number;
  y: number;
  z: number;
}

interface QuadViewProps {
  volume: NiftiVolume;
  studyId: string | null;
  stlFiles: { brain: string | null; tumor: string | null };
  meshState: MeshState;
  onMeshStateChange: (updates: Partial<MeshState>) => void;
  onZoomHandlersReady?: (handlers: { zoomIn: () => void; zoomOut: () => void; getCurrentZoom: () => number; setZoomDistance: (distance: number) => void }) => void;
  measurementMode?: MeasurementMode;
  onMeasurementModeChange?: (mode: MeasurementMode) => void;
  measurementClearKey?: number;
  onMeasurementClear?: () => void;
  undoKey?: number;
  showCrosshairs?: boolean;
  onShowCrosshairsChange?: (show: boolean) => void;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  onToggleFullscreen?: () => void;
}

export default function QuadView({
  volume,
  studyId,
  stlFiles,
  meshState,
  onMeshStateChange,
  onZoomHandlersReady,
  measurementMode = 'off',
  onMeasurementModeChange,
  measurementClearKey = 0,
  onMeasurementClear,
  undoKey = 0,
  showCrosshairs = true,
  onShowCrosshairsChange,
  showGrid,
  onShowGridChange,
  onToggleFullscreen,
}: QuadViewProps) {
  const [dims] = useState(() => volume.dims);

  const [crosshair, setCrosshair] = useState<CrosshairPosition>(() => ({
    x: Math.floor(volume.dims[0] / 2),
    y: Math.floor(volume.dims[1] / 2),
    z: Math.floor(volume.dims[2] / 2),
  }));

  const measurements = useMeasurements({
    measurementMode,
    pixDims: volume.pixDims,
    clearKey: measurementClearKey,
    undoKey,
  });

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

  const normalizedCrosshair = {
    x: (crosshair.x / dims[0]) * 2 - 1,
    y: (crosshair.y / dims[1]) * 2 - 1,
    z: (crosshair.z / dims[2]) * 2 - 1,
  };

  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
    setZoomDistance: (distance: number) => void;
  } | null>(null);
  const [zoomPercentage, setZoomPercentage] = useState(50);

  // Zoom steps
  const ZOOM_STEPS = [3, 10, 25, 33, 50, 67, 75, 80, 90, 100, 110];
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 110;

  // Convert percentage to camera distance
  const percentageToDistance = (pct: number) => 500 - (pct / 100) * 450;
  // Convert distance to percentage
  const distanceToPercentage = (dist: number) => Math.round(((500 - dist) / 450) * 100);

  const handleZoomIn = useCallback(() => {
    if (zoomHandlersRef.current) {
      // Find next zoom step up
      const currentPct = zoomPercentage;
      const nextStep = ZOOM_STEPS.find(step => step > currentPct) ?? MAX_ZOOM;
      const clampedStep = Math.min(nextStep, MAX_ZOOM);
      const newDistance = percentageToDistance(clampedStep);
      zoomHandlersRef.current.setZoomDistance(newDistance);
      setZoomPercentage(clampedStep);
    }
  }, [zoomPercentage]);

  const handleZoomOut = useCallback(() => {
    if (zoomHandlersRef.current) {
      // Find next zoom step down
      const currentPct = zoomPercentage;
      const prevStep = [...ZOOM_STEPS].reverse().find(step => step < currentPct) ?? MIN_ZOOM;
      const clampedStep = Math.max(prevStep, MIN_ZOOM);
      const newDistance = percentageToDistance(clampedStep);
      zoomHandlersRef.current.setZoomDistance(newDistance);
      setZoomPercentage(clampedStep);
    }
  }, [zoomPercentage]);

  // Clamp zoom percentage when it changes from scroll
  const handleZoomChange = useCallback((distance: number) => {
    const pct = distanceToPercentage(distance);
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pct));
    setZoomPercentage(clamped);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      background: 'hsl(var(--background))',
      gap: '8px',
    }}>
      {/* Global Toolbar Strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '28px',
        minHeight: '28px',
        padding: '0 8px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '8px',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* Controls Pill Group */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '0 10px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '6px',
          height: '20px',
        }}>
          {/* Crosshairs Toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: 'hsl(var(--foreground) / 0.85)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>
            <input
              type="checkbox"
              checked={showCrosshairs}
              onChange={(e) => onShowCrosshairsChange?.(e.target.checked)}
              style={{
                width: '12px',
                height: '12px',
                accentColor: 'hsl(var(--primary))',
                cursor: 'pointer',
              }}
            />
            Crosshairs
          </label>

          <div style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* Grid Toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: 'hsl(var(--foreground) / 0.85)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => onShowGridChange(e.target.checked)}
              style={{
                width: '12px',
                height: '12px',
                accentColor: 'hsl(var(--primary))',
                cursor: 'pointer',
              }}
            />
            Grid
          </label>

          <div style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* Measure Toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: 'hsl(var(--foreground) / 0.85)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>
            <input
              type="checkbox"
              checked={measurementMode === 'distance'}
              onChange={(e) => onMeasurementModeChange?.(e.target.checked ? 'distance' : 'off')}
              style={{
                width: '12px',
                height: '12px',
                accentColor: 'hsl(var(--primary))',
                cursor: 'pointer',
              }}
            />
            Measure
          </label>

          <div style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* Clear Button */}
          <button
            onClick={() => onMeasurementClear?.()}
            style={{
              padding: '2px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: 'hsl(var(--muted-foreground))',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Clear
          </button>
        </div>

        {/* Fullscreen toggle */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            title="Expand 3D view"
            style={{
              position: 'absolute',
              right: '8px',
              width: '20px',
              height: '20px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '4px',
              color: 'hsl(var(--foreground) / 0.7)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        )}
      </div>

      {/* Quad Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 0,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        borderRadius: '8px',
      }}>
      {/* Top Left: Axial */}
      <QuadCell position="topLeft">
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
        measurementMode={measurementMode}
        measurements={measurements.state.measurementsByPanel.axial}
        draftPoints={measurements.state.draftByPanel.axial}
        onMeasurementClick={(p) => measurements.handleClick('axial', p)}
        onMeasurementPointDrag={(id, key, pt) => measurements.handlePointDrag('axial', id, key, pt)}
        onMeasurementCancel={() => measurements.handleCancel('axial')}
        showCrosshairs={showCrosshairs}
        />
      </QuadCell>

      {/* Top Right: 3D View */}
      <QuadCell position="topRight">
        <div style={{
          background: 'hsl(var(--card))',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          borderTop: '3px solid hsl(var(--primary))',
        }}>
          <div style={{
            height: `${VIEWER_HEADER_HEIGHT}px`,
            minHeight: `${VIEWER_HEADER_HEIGHT}px`,
            background: 'hsl(var(--primary))',
            padding: '0 6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            color: 'hsl(var(--primary-foreground))',
            whiteSpace: 'nowrap',
            boxSizing: 'border-box',
          }}>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontSize: '11px' }}>3D View</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flexShrink: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>Zoom</span>
              <button
                onClick={handleZoomOut}
                style={{
                  width: '18px',
                  height: '18px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '3px',
                  color: 'hsl(var(--primary-foreground))',
                  fontSize: '12px',
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
                  width: '18px',
                  height: '18px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '3px',
                  color: 'hsl(var(--primary-foreground))',
                  fontSize: '12px',
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flexShrink: 1 }}>
              <span style={{ fontSize: '11px', color: 'hsl(var(--primary-foreground) / 0.8)', whiteSpace: 'nowrap' }}>Brain</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={meshState.brain.opacity}
                onChange={(e) => onMeshStateChange({
                  brain: { ...meshState.brain, opacity: Number(e.target.value) }
                })}
                style={{ width: '60px', minWidth: '30px', accentColor: '#b0b0b0', height: '4px', flexShrink: 1 }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flexShrink: 1 }}>
              <span style={{ fontSize: '11px', color: 'hsl(340 55% 52%)', whiteSpace: 'nowrap' }}>Tumor</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={meshState.tumor.opacity}
                onChange={(e) => onMeshStateChange({
                  tumor: { ...meshState.tumor, opacity: Number(e.target.value) }
                })}
                style={{ width: '60px', minWidth: '30px', accentColor: 'hsl(340 55% 52%)', height: '4px', flexShrink: 1 }}
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
              const pct = distanceToPercentage(currentZoom);
              setZoomPercentage(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pct)));
              if (onZoomHandlersReady) onZoomHandlersReady(handlers);
            }}
            onZoomChange={handleZoomChange}
            crosshairPosition={normalizedCrosshair}
            showCrosshairPlanes={showCrosshairs}
            showGrid={showGrid}
            volumeDims={dims}
            voxelSpacing={volume.pixDims}
          />
        </div>
        </div>
      </QuadCell>

      {/* Bottom Left: Coronal */}
      <QuadCell position="bottomLeft">
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
          measurementMode={measurementMode}
          measurements={measurements.state.measurementsByPanel.coronal}
          draftPoints={measurements.state.draftByPanel.coronal}
          onMeasurementClick={(p) => measurements.handleClick('coronal', p)}
          onMeasurementPointDrag={(id, key, pt) => measurements.handlePointDrag('coronal', id, key, pt)}
          onMeasurementCancel={() => measurements.handleCancel('coronal')}
          showCrosshairs={showCrosshairs}
        />
      </QuadCell>

      {/* Bottom Right: Sagittal */}
      <QuadCell position="bottomRight">
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
          measurementMode={measurementMode}
          measurements={measurements.state.measurementsByPanel.sagittal}
          draftPoints={measurements.state.draftByPanel.sagittal}
          onMeasurementClick={(p) => measurements.handleClick('sagittal', p)}
          onMeasurementPointDrag={(id, key, pt) => measurements.handlePointDrag('sagittal', id, key, pt)}
          onMeasurementCancel={() => measurements.handleCancel('sagittal')}
          showCrosshairs={showCrosshairs}
        />
      </QuadCell>
      </div>
    </div>
  );
}
