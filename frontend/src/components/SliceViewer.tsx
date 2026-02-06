import { useRef, useEffect, useCallback, useState } from 'react';
import { NiftiVolume, getSlice } from '../hooks/useNiftiVolume';
import MeasurementOverlay from './MeasurementOverlay';
import { Point2D, Measurement, MeasurementMode, PlaneType } from '../measurements/types';

interface SliceViewerProps {
  volume: NiftiVolume;
  plane: PlaneType;
  sliceIndex: number;
  crosshairX: number;
  crosshairY: number;
  onSliceChange: (index: number) => void;
  onCrosshairChange: (x: number, y: number) => void;
  color: string;
  label: string;
  measurementMode?: MeasurementMode;
  measurements?: Measurement[];
  draftPoints?: Point2D[];
  onMeasurementClick?: (point: Point2D) => void;
  onMeasurementPointDrag?: (measurementId: string, pointKey: 'A' | 'B', newPoint: Point2D) => void;
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
  measurementMode = 'off',
  measurements = [],
  draftPoints = [],
  onMeasurementClick,
  onMeasurementPointDrag,
}: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Mouse position for preview line (in image coordinates)
  const [mousePosition, setMousePosition] = useState<Point2D | null>(null);

  // Dragging state
  const [dragging, setDragging] = useState<{
    measurementId: string;
    pointKey: 'A' | 'B';
  } | null>(null);

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

    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);

    // Bright + thin (do NOT multiply by DPR unless you also DPR-scale the canvas)
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.lineWidth = 1;         // or 0.75 if you want even thinner
    ctx.lineCap = 'butt';

    const xPos = Math.round(crosshairX) + 0.5;
    const yPos = Math.round(height - 1 - crosshairY) + 0.5;

    ctx.beginPath();
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, yPos);
    ctx.lineTo(width, yPos);
    ctx.stroke();

  }, [volume, plane, sliceIndex, crosshairX, crosshairY]);

  // Convert screen coordinates to image pixel coordinates
  const screenToImage = useCallback((clientX: number, clientY: number): Point2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);

    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) {
      return null;
    }

    return { x, y };
  }, []);

  // Check if a point is near a measurement endpoint
  const findNearbyPoint = useCallback((imagePoint: Point2D): { measurementId: string; pointKey: 'A' | 'B' } | null => {
    const threshold = 5; // pixels
    for (const m of measurements) {
      const distA = Math.sqrt((imagePoint.x - m.A.x) ** 2 + (imagePoint.y - m.A.y) ** 2);
      if (distA <= threshold) {
        return { measurementId: m.id, pointKey: 'A' };
      }
      const distB = Math.sqrt((imagePoint.x - m.B.x) ** 2 + (imagePoint.y - m.B.y) ** 2);
      if (distB <= threshold) {
        return { measurementId: m.id, pointKey: 'B' };
      }
    }
    return null;
  }, [measurements]);

  // Handle mouse down - start dragging or add measurement point
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imagePoint = screenToImage(e.clientX, e.clientY);
    if (!imagePoint) return;

    // Check if clicking on an existing measurement point
    if (measurementMode === 'distance') {
      const nearbyPoint = findNearbyPoint(imagePoint);
      if (nearbyPoint) {
        setDragging(nearbyPoint);
        e.preventDefault();
        return;
      }
    }

    // If measurement mode is active, handle measurement click
    if (measurementMode !== 'off' && onMeasurementClick) {
      onMeasurementClick(imagePoint);
      return;
    }

    // Otherwise, update crosshairs
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataY = canvas.height - 1 - imagePoint.y;
    onCrosshairChange(imagePoint.x, dataY);
  }, [measurementMode, onMeasurementClick, onCrosshairChange, screenToImage, findNearbyPoint]);

  // Handle mouse move - update preview or drag point
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imagePoint = screenToImage(e.clientX, e.clientY);

    // Update mouse position for preview line
    if (measurementMode === 'distance' && draftPoints.length > 0) {
      setMousePosition(imagePoint);
    } else {
      setMousePosition(null);
    }

    // Handle dragging
    if (dragging && imagePoint && onMeasurementPointDrag) {
      onMeasurementPointDrag(dragging.measurementId, dragging.pointKey, imagePoint);
      return;
    }

    // Handle crosshair dragging (only when not in measurement mode)
    if (e.buttons === 1 && measurementMode === 'off') {
      const canvas = canvasRef.current;
      if (!canvas || !imagePoint) return;
      const dataY = canvas.height - 1 - imagePoint.y;
      onCrosshairChange(imagePoint.x, dataY);
    }
  }, [measurementMode, draftPoints.length, screenToImage, dragging, onMeasurementPointDrag, onCrosshairChange]);

  // Handle mouse up - stop dragging
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Handle mouse leave - clear preview
  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
    setDragging(null);
  }, []);

  // Image to screen coordinate transform for overlay
  const imageToScreen = useCallback((p: Point2D): Point2D => {
    return p;
  }, []);

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

      {/* Canvas container */}
      <div
        ref={canvasContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '0',
          position: 'relative',
        }}
      >
        <div style={{ position: 'relative', transform: 'scale(2.0)' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              cursor: dragging ? 'grabbing' : (measurementMode !== 'off' ? 'crosshair' : 'crosshair'),
              imageRendering: 'pixelated',
            }}
          />
          {/* Measurement overlay */}
          <MeasurementOverlay
            plane={plane}
            measurements={measurements}
            draftPoints={draftPoints}
            mousePosition={mousePosition}
            spacing={volume.pixDims}
            imageToScreen={imageToScreen}
            canvasWidth={sliceDims.width}
            canvasHeight={sliceDims.height}
          />
        </div>
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
