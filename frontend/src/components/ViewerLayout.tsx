import { useState, useRef } from 'react';
import MeshViewer from './MeshViewer';
import { MeshState } from '../types';
import { downloadAllMeshes } from '../api';

interface ViewerLayoutProps {
  studyId: string;
  onReset: () => void;
}

export default function ViewerLayout({ studyId, onReset }: ViewerLayoutProps) {
  const [meshState, setMeshState] = useState<MeshState>({
    brain: {
      visible: true,
      color: '#b0b0b0', // Grey
      opacity: 0.8,
    },
    tumor: {
      visible: true,
      color: '#ff3333', // Red
      opacity: 1.0,
    },
  });

  const [downloading, setDownloading] = useState(false);

  // Zoom handlers reference
  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
  } | null>(null);
  const [zoomValue, setZoomValue] = useState(200);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadAllMeshes(studyId);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download meshes. Please try again.');
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

  const ColorSwatch = ({ color, onClick }: { color: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '6px',
        background: color,
        border: '2px solid #e5e7eb',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.1)';
        e.currentTarget.style.borderColor = '#2563eb';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.borderColor = '#e5e7eb';
      }}
    />
  );

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Top toolbar */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '32px',
        flexWrap: 'wrap',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        zIndex: 10,
      }}>
        {/* Zoom control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '200px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', minWidth: '60px' }}>
            Zoom
          </label>
          <input
            type="range"
            min="50"
            max="500"
            value={zoomValue}
            onChange={(e) => {
              const targetDistance = Number(e.target.value);
              setZoomValue(targetDistance);

              if (zoomHandlersRef.current) {
                const currentDistance = zoomHandlersRef.current.getCurrentZoom();
                const delta = currentDistance - targetDistance;
                const steps = Math.abs(Math.round(delta / 20));

                // Apply zoom in steps
                for (let i = 0; i < steps; i++) {
                  if (delta > 0) {
                    zoomHandlersRef.current.zoomIn();
                  } else {
                    zoomHandlersRef.current.zoomOut();
                  }
                }
              }
            }}
            style={{
              flex: 1,
              accentColor: '#2563eb',
            }}
          />
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '40px', background: '#e5e7eb' }} />

        {/* Brain controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={meshState.brain.visible}
              onChange={(e) => updateBrainState({ visible: e.target.checked })}
              style={{ accentColor: '#2563eb', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            Brain
          </label>

          <div style={{ display: 'flex', gap: '6px' }}>
            <ColorSwatch color="#b0b0b0" onClick={() => updateBrainState({ color: '#b0b0b0' })} />
            <ColorSwatch color="#e0e0e0" onClick={() => updateBrainState({ color: '#e0e0e0' })} />
            <ColorSwatch color="#909090" onClick={() => updateBrainState({ color: '#909090' })} />
            <ColorSwatch color="#f5deb3" onClick={() => updateBrainState({ color: '#f5deb3' })} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '60px' }}>Opacity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={meshState.brain.opacity}
              onChange={(e) => updateBrainState({ opacity: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#2563eb' }}
            />
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '40px', background: '#e5e7eb' }} />

        {/* Tumor controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={meshState.tumor.visible}
              onChange={(e) => updateTumorState({ visible: e.target.checked })}
              style={{ accentColor: '#2563eb', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            Tumor
          </label>

          <div style={{ display: 'flex', gap: '6px' }}>
            <ColorSwatch color="#ff3333" onClick={() => updateTumorState({ color: '#ff3333' })} />
            <ColorSwatch color="#ff6b6b" onClick={() => updateTumorState({ color: '#ff6b6b' })} />
            <ColorSwatch color="#cc0000" onClick={() => updateTumorState({ color: '#cc0000' })} />
            <ColorSwatch color="#ff9966" onClick={() => updateTumorState({ color: '#ff9966' })} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '60px' }}>Opacity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={meshState.tumor.opacity}
              onChange={(e) => updateTumorState({ opacity: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#2563eb' }}
            />
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* New upload button */}
        <button
          onClick={onReset}
          style={{
            padding: '10px 20px',
            background: 'white',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f9fafb';
            e.currentTarget.style.borderColor = '#9ca3af';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
            e.currentTarget.style.borderColor = '#d1d5db';
          }}
        >
          New Upload
        </button>
      </div>

      {/* 3D Viewer */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MeshViewer
          studyId={studyId}
          stlFiles={{ brain: null, tumor: null }}
          meshState={meshState}
          onZoomHandlersReady={(handlers) => {
            zoomHandlersRef.current = handlers;
            // Initialize zoom value based on initial camera distance
            const currentZoom = handlers.getCurrentZoom();
            setZoomValue(currentZoom);
          }}
        />

        {/* Download button (bottom-right) */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            padding: '14px 24px',
            background: downloading ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: downloading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            transition: 'all 0.2s',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            if (!downloading) {
              e.currentTarget.style.background = '#1d4ed8';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 8px -1px rgba(0, 0, 0, 0.15), 0 3px 6px -1px rgba(0, 0, 0, 0.08)';
            }
          }}
          onMouseLeave={(e) => {
            if (!downloading) {
              e.currentTarget.style.background = '#2563eb';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
            }
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {downloading ? 'Downloading...' : 'Download STLs'}
        </button>
      </div>
    </div>
  );
}
