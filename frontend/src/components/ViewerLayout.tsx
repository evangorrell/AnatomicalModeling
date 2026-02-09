import { useState, useRef, useEffect } from 'react';
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

  // Zoom handlers
  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
  } | null>(null);
  const [zoomPercentage, setZoomPercentage] = useState(50);

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
            {viewerType === '3d-only' ? '3D Model Viewer' : 'Medical Imaging Viewer'}
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

        {/* Controls for 3D-only mode */}
        {viewerType === '3d-only' && (
          <div style={{
            background: 'hsl(var(--card))',
            backdropFilter: 'blur(10px)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            display: 'flex',
            gap: '24px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', fontWeight: '500' }}>Zoom</span>
              <button
                onClick={() => {
                  if (zoomHandlersRef.current) {
                    zoomHandlersRef.current.zoomOut();
                    const currentZoom = zoomHandlersRef.current.getCurrentZoom();
                    setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
                  }
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'hsl(var(--secondary))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  color: 'hsl(var(--foreground))',
                  fontSize: '18px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                −
              </button>
              <span style={{ fontSize: '14px', minWidth: '45px', textAlign: 'center' }}>
                {zoomPercentage}%
              </span>
              <button
                onClick={() => {
                  if (zoomHandlersRef.current) {
                    zoomHandlersRef.current.zoomIn();
                    const currentZoom = zoomHandlersRef.current.getCurrentZoom();
                    setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
                  }
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'hsl(var(--secondary))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  color: 'hsl(var(--foreground))',
                  fontSize: '18px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>

            {stlUrls.brain && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500' }}>Brain</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={meshState.brain.opacity}
                  onChange={(e) => updateBrainState({ opacity: Number(e.target.value) })}
                  style={{ width: '100px', accentColor: 'hsl(var(--muted-foreground))' }}
                />
              </div>
            )}

            {stlUrls.tumor && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500' }}>Tumor</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={meshState.tumor.opacity}
                  onChange={(e) => updateTumorState({ opacity: Number(e.target.value) })}
                  style={{ width: '100px', accentColor: 'hsl(var(--chart-3))' }}
                />
              </div>
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
          {viewerType === '3d-only' ? (
            <MeshViewer
              studyId={null}
              stlFiles={stlUrls}
              meshState={meshState}
              onZoomHandlersReady={(handlers) => {
                zoomHandlersRef.current = handlers;
                setZoomPercentage(Math.round(((500 - handlers.getCurrentZoom()) / 450) * 100));
              }}
              onZoomChange={(distance) => {
                setZoomPercentage(Math.round(((500 - distance) / 450) * 100));
              }}
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
                setZoomPercentage(Math.round(((500 - handlers.getCurrentZoom()) / 450) * 100));
              }}
              measurementMode={measurementMode}
              onMeasurementModeChange={setMeasurementMode}
              measurementClearKey={measurementClearKey}
              onMeasurementClear={() => setMeasurementClearKey(k => k + 1)}
              undoKey={undoKey}
              showCrosshairs={showCrosshairs}
              onShowCrosshairsChange={setShowCrosshairs}
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
