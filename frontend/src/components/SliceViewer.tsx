import { useRef, useEffect, useCallback } from 'react';
import { NiftiVolume, getSlice } from '../hooks/useNiftiVolume';

interface SliceViewerProps {
  volume: NiftiVolume;
  plane: 'axial' | 'coronal' | 'sagittal';
  sliceIndex: number;
  crosshairX: number; // Position in the other two dimensions
  crosshairY: number;
  onSliceChange: (index: number) => void;
  onCrosshairChange: (x: number, y: number) => void;
  color: string; // Border color for the view
  label: string;
}

export default function SliceViewer({
  volume,
  plane,
  sliceIndex,
  crosshairX,
  crosshairY,
  onSliceChange,
  onCrosshairChange,
  color,
  label,
}: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get max slice index for this plane
  const getMaxSlice = useCallback(() => {
    const [dimX, dimY, dimZ] = volume.dims;
    switch (plane) {
      case 'axial': return dimZ - 1;
      case 'coronal': return dimY - 1;
      case 'sagittal': return dimX - 1;
    }
  }, [volume.dims, plane]);

  // Get slice dimensions
  const getSliceDims = useCallback(() => {
    const [dimX, dimY, dimZ] = volume.dims;
    switch (plane) {
      case 'axial': return { width: dimX, height: dimY };
      case 'coronal': return { width: dimX, height: dimZ };
      case 'sagittal': return { width: dimY, height: dimZ };
    }
  }, [volume.dims, plane]);

  // Render slice to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !volume) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { data, width, height } = getSlice(volume, plane, sliceIndex);

    // Set canvas size to match slice
    canvas.width = width;
    canvas.height = height;

    // Create ImageData and draw
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);

    // Draw crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
    ctx.lineWidth = 1;

    // Vertical line (crosshairX)
    const xPos = crosshairX;
    ctx.beginPath();
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, height);
    ctx.stroke();

    // Horizontal line (crosshairY) - note: Y is flipped in display
    const yPos = height - 1 - crosshairY;
    ctx.beginPath();
    ctx.moveTo(0, yPos);
    ctx.lineTo(width, yPos);
    ctx.stroke();

  }, [volume, plane, sliceIndex, crosshairX, crosshairY]);

  // Handle click on canvas to update crosshairs
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    // Y is flipped in display, so we need to flip it back
    const dataY = canvas.height - 1 - y;

    onCrosshairChange(x, dataY);
  }, [onCrosshairChange]);

  // Handle mouse drag on canvas
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return; // Only if left mouse button is held
    handleCanvasClick(e);
  }, [handleCanvasClick]);

  // Handle scroll for slice navigation
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const newIndex = Math.max(0, Math.min(getMaxSlice(), sliceIndex + delta));
    onSliceChange(newIndex);
  }, [sliceIndex, getMaxSlice, onSliceChange]);

  const maxSlice = getMaxSlice();
  const sliceDims = getSliceDims();

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background: '#000',
        borderTop: `3px solid ${color}`,
        position: 'relative',
      }}
    >
      {/* Header bar */}
      <div style={{
        background: color,
        padding: '4px 8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        fontWeight: '600',
      }}>
        <span>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="range"
            min="0"
            max={maxSlice}
            value={sliceIndex}
            onChange={(e) => onSliceChange(parseInt(e.target.value))}
            style={{ width: '100px', accentColor: '#fff' }}
          />
          <span style={{ minWidth: '70px', textAlign: 'right' }}>
            {sliceIndex} / {maxSlice}
          </span>
        </div>
      </div>

      {/* Canvas container - zoomed in */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: '0',
      }}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onWheel={handleWheel}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: 'scale(2.2)',
            cursor: 'crosshair',
            imageRendering: 'pixelated',
          }}
        />
      </div>

      {/* Dimension info */}
      <div style={{
        position: 'absolute',
        bottom: '4px',
        left: '8px',
        fontSize: '10px',
        color: 'rgba(255, 255, 255, 0.5)',
      }}>
        {sliceDims.width} x {sliceDims.height}
      </div>
    </div>
  );
}
