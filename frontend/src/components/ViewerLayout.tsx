import { useState, useRef, useEffect, useCallback } from 'react';
import MeshViewer from './MeshViewer';
import QuadView from './QuadView';
import { MeshState } from '../types';
import { downloadMesh } from '../api';
import { NiftiVolume } from '../hooks/useNiftiVolume';
import { MeasurementMode } from '../measurements/types';

interface ViewerLayoutProps {
  viewerType: '3d-only' | 'quad' | 'quad-with-stl';
  currentStudyId: string | null;
  stlUrls: { brain: string | null; tumor: string | null };
  meshState: MeshState;
  setMeshState: React.Dispatch<React.SetStateAction<MeshState>>;
  niftiVolume: NiftiVolume | null;
  niftiLoading: boolean;
  hasTumorMesh: boolean;
  onReset: () => void;
}

export default function ViewerLayout({
  viewerType,
  currentStudyId,
  stlUrls,
  meshState,
  setMeshState,
  niftiVolume,
  niftiLoading,
  hasTumorMesh,
  onReset,
}: ViewerLayoutProps) {
  const [downloading, setDownloading] = useState(false);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('off');
  const [measurementClearKey, setMeasurementClearKey] = useState(0);
  const [undoKey, setUndoKey] = useState(0);
  const [showCrosshairs, setShowCrosshairs] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [is3dFullscreen, setIs3dFullscreen] = useState(false);

  // Zoom handlers
  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
    setZoomDistance: (distance: number) => void;
  } | null>(null);
  const [zoomPercentage, setZoomPercentage] = useState(50);

  // Zoom step helpers
  const ZOOM_STEPS = [3, 10, 25, 33, 50, 67, 75, 80, 90, 100, 110];
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 110;
  const percentageToDistance = (pct: number) => 500 - (pct / 100) * 450;
  const distanceToPercentage = (dist: number) => Math.round(((500 - dist) / 450) * 100);

  const handleZoomIn = useCallback(() => {
    if (zoomHandlersRef.current) {
      const nextStep = ZOOM_STEPS.find(step => step > zoomPercentage) ?? MAX_ZOOM;
      const clampedStep = Math.min(nextStep, MAX_ZOOM);
      const newDistance = percentageToDistance(clampedStep);
      zoomHandlersRef.current.setZoomDistance(newDistance);
      setZoomPercentage(clampedStep);
    }
  }, [zoomPercentage]);

  const handleZoomOut = useCallback(() => {
    if (zoomHandlersRef.current) {
      const prevStep = [...ZOOM_STEPS].reverse().find(step => step < zoomPercentage) ?? MIN_ZOOM;
      const clampedStep = Math.max(prevStep, MIN_ZOOM);
      const newDistance = percentageToDistance(clampedStep);
      zoomHandlersRef.current.setZoomDistance(newDistance);
      setZoomPercentage(clampedStep);
    }
  }, [zoomPercentage]);

  const handleZoomChange = useCallback((distance: number) => {
    const pct = distanceToPercentage(distance);
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pct));
    setZoomPercentage(clamped);
  }, []);

  // Derived state
  const is3dView = viewerType === '3d-only' || is3dFullscreen;

  // MeshViewer props for 3D view mode
  const meshStudyId = (is3dFullscreen && viewerType === 'quad') ? currentStudyId : null;
  const meshStlFiles = (is3dFullscreen && viewerType === 'quad')
    ? { brain: null as string | null, tumor: null as string | null }
    : stlUrls;

  // Show sliders based on available data
  const showBrainSlider = stlUrls.brain || (is3dFullscreen && viewerType === 'quad');
  const showTumorSlider = stlUrls.tumor || (is3dFullscreen && viewerType === 'quad' && hasTumorMesh);

  // Keyboard listener for Cmd+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (measurementMode === 'distance') {
          e.preventDefault();
          setUndoKey(k => k + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measurementMode]);

  const handleDownload = async () => {
    if (!currentStudyId) return;
    setDownloading(true);
    try {
      await downloadMesh(currentStudyId, 'brain.stl');
      if (hasTumorMesh) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await downloadMesh(currentStudyId, 'tumor.stl');
      }
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download meshes.');
    } finally {
      setDownloading(false);
    }
  };

  const updateBrainState = (updates: Partial<MeshState['brain']>) => {
    setMeshState(prev => ({
      ...prev,
      brain: { ...prev.brain, ...updates },
    }));
  };

  const updateTumorState = (updates: Partial<MeshState['tumor']>) => {
    setMeshState(prev => ({
      ...prev,
      tumor: { ...prev.tumor, ...updates },
    }));
  };

  return (
    <div style={{
      width: '100%',
      height: 'calc(100vh - 100px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minWidth: '800px',
    }}>
      {/* Wrapper for header & viewer to share same width */}
      <div style={{
        height: '100%',
        aspectRatio: '1',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header row */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexShrink: 0,
          gap: 'clamp(8px, 2vw, 16px)',
        }}>
          <h2 style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', fontWeight: '700', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {is3dView ? '3D Model Viewer' : 'Medical Imaging Viewer'}
          </h2>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {currentStudyId && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: downloading ? 'not-allowed' : 'pointer',
                  opacity: downloading ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {downloading ? 'Downloading...' : 'Download STLs'}
              </button>
            )}
            <button
              onClick={onReset}
              style={{
                padding: '6px 16px',
                background: 'hsl(var(--secondary))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                color: 'hsl(var(--foreground))',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ← Back to Upload
            </button>
          </div>
        </div>

        {/* Toolbar for 3D view mode */}
        {is3dView && (
          <div style={{
            background: 'hsl(var(--card))',
            backdropFilter: 'blur(10px)',
            borderRadius: '12px',
            padding: '10px 20px',
            marginBottom: '12px',
            display: 'flex',
            gap: '20px',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
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
              height: '28px',
            }}>
              {/* Crosshairs Toggle */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'hsl(var(--foreground) / 0.85)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
                <input
                  type="checkbox"
                  checked={showCrosshairs}
                  onChange={(e) => setShowCrosshairs(e.target.checked)}
                  style={{
                    width: '13px',
                    height: '13px',
                    accentColor: 'hsl(var(--primary))',
                    cursor: 'pointer',
                  }}
                />
                Crosshairs
              </label>

              <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.12)' }} />

              {/* Grid Toggle */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'hsl(var(--foreground) / 0.85)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  style={{
                    width: '13px',
                    height: '13px',
                    accentColor: 'hsl(var(--primary))',
                    cursor: 'pointer',
                  }}
                />
                Grid
              </label>

              <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.12)' }} />

              {/* Measure Toggle */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'hsl(var(--foreground) / 0.85)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
                <input
                  type="checkbox"
                  checked={measurementMode === 'distance'}
                  onChange={(e) => setMeasurementMode(e.target.checked ? 'distance' : 'off')}
                  style={{
                    width: '13px',
                    height: '13px',
                    accentColor: 'hsl(var(--primary))',
                    cursor: 'pointer',
                  }}
                />
                Measure
              </label>

              <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.12)' }} />

              {/* Clear Button */}
              <button
                onClick={() => setMeasurementClearKey(k => k + 1)}
                style={{
                  padding: '2px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'hsl(var(--muted-foreground))',
                  fontSize: '12px',
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

            {/* Zoom Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: '500' }}>Zoom</span>
              <button
                onClick={handleZoomOut}
                style={{
                  width: '28px',
                  height: '28px',
                  background: 'hsl(var(--secondary))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  color: 'hsl(var(--foreground))',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                −
              </button>
              <span style={{ fontSize: '14px', minWidth: '40px', textAlign: 'center' }}>
                {zoomPercentage}%
              </span>
              <button
                onClick={handleZoomIn}
                style={{
                  width: '28px',
                  height: '28px',
                  background: 'hsl(var(--secondary))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  color: 'hsl(var(--foreground))',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                +
              </button>
            </div>

            {/* Brain Slider */}
            {showBrainSlider && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500' }}>Brain</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={meshState.brain.opacity}
                  onChange={(e) => updateBrainState({ opacity: Number(e.target.value) })}
                  style={{ width: '80px', accentColor: 'hsl(var(--muted-foreground))' }}
                />
              </div>
            )}

            {/* Tumor Slider */}
            {showTumorSlider && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500' }}>Tumor</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={meshState.tumor.opacity}
                  onChange={(e) => updateTumorState({ opacity: Number(e.target.value) })}
                  style={{ width: '80px', accentColor: 'hsl(var(--chart-3))' }}
                />
              </div>
            )}

            {/* Minimize / expand toggle - far right */}
            {is3dFullscreen && (
              <button
                onClick={() => setIs3dFullscreen(false)}
                title="Back to quad view"
                style={{
                  position: 'absolute',
                  right: '12px',
                  width: '24px',
                  height: '24px',
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
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 14 10 14 10 20"/>
                  <polyline points="20 10 14 10 14 4"/>
                  <line x1="14" y1="10" x2="21" y2="3"/>
                  <line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Viewer container */}
        <div style={{
          flex: 1,
          minHeight: 0,
          borderRadius: '12px',
          overflow: 'hidden',
          background: 'hsl(var(--card))',
        }}>
          {is3dView ? (
            <MeshViewer
              studyId={meshStudyId}
              stlFiles={meshStlFiles}
              meshState={meshState}
              showGrid={showGrid}
              showCrosshairPlanes={showCrosshairs}
              crosshairPosition={{ x: 0, y: 0, z: 0 }}
              volumeDims={niftiVolume?.dims}
              voxelSpacing={niftiVolume?.pixDims}
              onZoomHandlersReady={(handlers) => {
                zoomHandlersRef.current = handlers;
                const pct = distanceToPercentage(handlers.getCurrentZoom());
                setZoomPercentage(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pct)));
              }}
              onZoomChange={handleZoomChange}
            />
          ) : niftiVolume ? (
            <QuadView
              volume={niftiVolume}
              studyId={viewerType === 'quad' ? currentStudyId : null}
              stlFiles={viewerType === 'quad-with-stl' ? stlUrls : { brain: null, tumor: null }}
              meshState={meshState}
              onMeshStateChange={(updates) => setMeshState(prev => ({ ...prev, ...updates }))}
              onZoomHandlersReady={(handlers) => {
                zoomHandlersRef.current = handlers;
                const pct = distanceToPercentage(handlers.getCurrentZoom());
                setZoomPercentage(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pct)));
              }}
              measurementMode={measurementMode}
              onMeasurementModeChange={setMeasurementMode}
              measurementClearKey={measurementClearKey}
              onMeasurementClear={() => setMeasurementClearKey(k => k + 1)}
              undoKey={undoKey}
              showCrosshairs={showCrosshairs}
              onShowCrosshairsChange={setShowCrosshairs}
              showGrid={showGrid}
              onShowGridChange={setShowGrid}
              onToggleFullscreen={() => setIs3dFullscreen(true)}
            />
          ) : niftiLoading ? (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'hsl(var(--muted-foreground))',
            }}>
              Loading volume data...
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
