import { useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { NiftiVolume } from '../hooks/useNiftiVolume';
import SliceViewer, { VIEWER_HEADER_HEIGHT } from './SliceViewer';
import MeshViewer from './MeshViewer';
import { MeshState } from '../types';
import {
  Point2D,
  Measurement,
  MeasurementMode,
  PlaneType,
  MeasurementState,
  initialMeasurementState,
} from '../measurements/types';
import {
  calculateDistanceMm,
  generateMeasurementId,
} from '../measurements/math';

// Divider style for the "+" center divider
const DIVIDER = '2px solid white';

// Helper component to wrap each quadrant with conditional inner borders
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

  // Add inner borders based on position to create "+" divider
  if (position === 'topLeft') {
    borderStyles.borderRight = DIVIDER;
    borderStyles.borderBottom = DIVIDER;
  } else if (position === 'topRight') {
    borderStyles.borderBottom = DIVIDER;
  } else if (position === 'bottomLeft') {
    borderStyles.borderRight = DIVIDER;
  }
  // bottomRight has no borders

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
  onZoomHandlersReady?: (handlers: { zoomIn: () => void; zoomOut: () => void; getCurrentZoom: () => number }) => void;
  measurementMode?: MeasurementMode;
  onMeasurementModeChange?: (mode: MeasurementMode) => void;
  measurementClearKey?: number;
  onMeasurementClear?: () => void;
  undoKey?: number;
  showCrosshairs?: boolean;
  onShowCrosshairsChange?: (show: boolean) => void;
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
}: QuadViewProps) {
  const [dims] = useState(() => volume.dims);

  const [crosshair, setCrosshair] = useState<CrosshairPosition>(() => ({
    x: Math.floor(volume.dims[0] / 2),
    y: Math.floor(volume.dims[1] / 2),
    z: Math.floor(volume.dims[2] / 2),
  }));

  const [measurementState, setMeasurementState] = useState<MeasurementState>(initialMeasurementState);
  const [showGrid, setShowGrid] = useState(true);

  // Track which panel was last modified for undo
  const lastModifiedPanelRef = useRef<PlaneType | null>(null);

  useEffect(() => {
    setCrosshair({
      x: Math.floor(volume.dims[0] / 2),
      y: Math.floor(volume.dims[1] / 2),
      z: Math.floor(volume.dims[2] / 2),
    });
  }, [volume]);

  // Clear measurements when clear key changes
  useEffect(() => {
    if (measurementClearKey > 0) {
      setMeasurementState(initialMeasurementState);
      lastModifiedPanelRef.current = null;
    }
  }, [measurementClearKey]);

  // Undo last measurement when undo key changes
  useEffect(() => {
    if (undoKey > 0) {
      setMeasurementState(prev => {
        // First, check if there are any draft points to clear
        for (const panel of ['axial', 'coronal', 'sagittal'] as PlaneType[]) {
          if (prev.draftByPanel[panel].length > 0) {
            return {
              ...prev,
              draftByPanel: {
                ...prev.draftByPanel,
                [panel]: [],
              },
            };
          }
        }

        // Otherwise, remove the most recent measurement (by createdAt)
        let latestPanel: PlaneType | null = null;
        let latestTime = 0;

        for (const panel of ['axial', 'coronal', 'sagittal'] as PlaneType[]) {
          const measurements = prev.measurementsByPanel[panel];
          if (measurements.length > 0) {
            const lastMeasurement = measurements[measurements.length - 1];
            if (lastMeasurement.createdAt > latestTime) {
              latestTime = lastMeasurement.createdAt;
              latestPanel = panel;
            }
          }
        }

        if (latestPanel) {
          return {
            ...prev,
            measurementsByPanel: {
              ...prev.measurementsByPanel,
              [latestPanel]: prev.measurementsByPanel[latestPanel].slice(0, -1),
            },
          };
        }

        return prev;
      });
    }
  }, [undoKey]);

  // Handle measurement click for a specific panel
  const handleMeasurementClick = useCallback((panel: PlaneType, point: Point2D) => {
    if (measurementMode === 'off') return;

    lastModifiedPanelRef.current = panel;

    setMeasurementState(prev => {
      const currentDraft = [...prev.draftByPanel[panel], point];

      if (currentDraft.length < 2) {
        return {
          ...prev,
          draftByPanel: {
            ...prev.draftByPanel,
            [panel]: currentDraft,
          },
        };
      }

      const [A, B] = currentDraft;
      const mm = calculateDistanceMm(A, B, panel, volume.pixDims);
      const newMeasurement: Measurement = {
        kind: 'distance',
        id: generateMeasurementId(),
        A,
        B,
        mm,
        createdAt: Date.now(),
      };

      return {
        ...prev,
        measurementsByPanel: {
          ...prev.measurementsByPanel,
          [panel]: [...prev.measurementsByPanel[panel], newMeasurement],
        },
        draftByPanel: {
          ...prev.draftByPanel,
          [panel]: [],
        },
      };
    });
  }, [measurementMode, volume.pixDims]);

  // Handle dragging a measurement point
  const handleMeasurementPointDrag = useCallback((panel: PlaneType, measurementId: string, pointKey: 'A' | 'B', newPoint: Point2D) => {
    setMeasurementState(prev => {
      const measurements = prev.measurementsByPanel[panel];
      const idx = measurements.findIndex(m => m.id === measurementId);
      if (idx === -1) return prev;

      const measurement = measurements[idx];
      const updatedA = pointKey === 'A' ? newPoint : measurement.A;
      const updatedB = pointKey === 'B' ? newPoint : measurement.B;
      const mm = calculateDistanceMm(updatedA, updatedB, panel, volume.pixDims);

      const updatedMeasurement: Measurement = {
        ...measurement,
        A: updatedA,
        B: updatedB,
        mm,
      };

      const newMeasurements = [...measurements];
      newMeasurements[idx] = updatedMeasurement;

      return {
        ...prev,
        measurementsByPanel: {
          ...prev.measurementsByPanel,
          [panel]: newMeasurements,
        },
      };
    });
  }, [volume.pixDims]);

  // Handle cancelling a measurement (e.g., mouse leaves canvas during drag)
  const handleMeasurementCancel = useCallback((panel: PlaneType) => {
    setMeasurementState(prev => ({
      ...prev,
      draftByPanel: {
        ...prev.draftByPanel,
        [panel]: [],
      },
    }));
  }, []);

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

  // Chrome-like zoom steps (3% to 110%)
  const ZOOM_STEPS = [3, 10, 25, 33, 50, 67, 75, 80, 90, 100, 110];
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 110;

  // Convert percentage to camera distance: distance = 500 - (percentage / 100) * 450
  const percentageToDistance = (pct: number) => 500 - (pct / 100) * 450;
  // Convert distance to percentage: percentage = ((500 - distance) / 450) * 100
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
      }}>
        {/* Controls pill group */}
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
              onChange={(e) => setShowGrid(e.target.checked)}
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
      {/* Top Left: Axial (Red) */}
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
        measurements={measurementState.measurementsByPanel.axial}
        draftPoints={measurementState.draftByPanel.axial}
        onMeasurementClick={(p) => handleMeasurementClick('axial', p)}
        onMeasurementPointDrag={(id, key, pt) => handleMeasurementPointDrag('axial', id, key, pt)}
        onMeasurementCancel={() => handleMeasurementCancel('axial')}
        showCrosshairs={showCrosshairs}
        />
      </QuadCell>

      {/* Top Right: 3D View (Blue) */}
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

      {/* Bottom Left: Coronal (Green) */}
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
          measurements={measurementState.measurementsByPanel.coronal}
          draftPoints={measurementState.draftByPanel.coronal}
          onMeasurementClick={(p) => handleMeasurementClick('coronal', p)}
          onMeasurementPointDrag={(id, key, pt) => handleMeasurementPointDrag('coronal', id, key, pt)}
          onMeasurementCancel={() => handleMeasurementCancel('coronal')}
          showCrosshairs={showCrosshairs}
        />
      </QuadCell>

      {/* Bottom Right: Sagittal (Yellow) */}
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
          measurements={measurementState.measurementsByPanel.sagittal}
          draftPoints={measurementState.draftByPanel.sagittal}
          onMeasurementClick={(p) => handleMeasurementClick('sagittal', p)}
          onMeasurementPointDrag={(id, key, pt) => handleMeasurementPointDrag('sagittal', id, key, pt)}
          onMeasurementCancel={() => handleMeasurementCancel('sagittal')}
          showCrosshairs={showCrosshairs}
        />
      </QuadCell>
      </div>
    </div>
  );
}
