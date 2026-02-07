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
  showCrosshairs?: boolean;
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
  showCrosshairs = true,
}: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const [mousePosition, setMousePosition] = useState<Point2D | null>(null);
  const [dragging, setDragging] = useState<{
    measurementId: string;
    pointKey: 'A' | 'B';
  } | null>(null);

  const getMaxSlice = useCallback(() => {
    const [dimX, dimY, dimZ] = volume.dims;
    switch (plane) {
      case 'axial': return dimZ - 1;
      case 'coronal': return dimY - 1;
      case 'sagittal': return dimX - 1;
    }
  }, [volume.dims, plane]);

  const getSliceDims = useCallback(() => {
    const [dimX, dimY, dimZ] = volume.dims;
    switch (plane) {
      case 'axial': return { width: dimX, height: dimY };
      case 'coronal': return { width: dimX, height: dimZ };
      case 'sagittal': return { width: dimY, height: dimZ };
    }
  }, [volume.dims, plane]);

  // Render slice to canvas (image only, no crosshairs)
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
  }, [volume, plane, sliceIndex]);

  // Draw crosshairs on overlay canvas - spans full pane
  useEffect(() => {
    const canvas = canvasRef.current;
    const crosshairCanvas = crosshairCanvasRef.current;
    const pane = canvasContainerRef.current;
    if (!canvas || !crosshairCanvas || !pane) return;

    // Clear crosshairs if disabled
    if (!showCrosshairs) {
      const ctx = crosshairCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
      }
      return;
    }

    const drawCrosshairs = () => {
      const paneRect = pane.getBoundingClientRect();
      const imgRect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Size overlay to fill the entire pane
      crosshairCanvas.width = paneRect.width * dpr;
      crosshairCanvas.height = paneRect.height * dpr;
      crosshairCanvas.style.width = `${paneRect.width}px`;
      crosshairCanvas.style.height = `${paneRect.height}px`;

      const ctx = crosshairCanvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, paneRect.width, paneRect.height);

      // Calculate crosshair position in pane coordinates
      const imgOffsetX = imgRect.left - paneRect.left;
      const imgOffsetY = imgRect.top - paneRect.top;

      // Scale from image pixels to displayed CSS pixels
      const scaleX = imgRect.width / canvas.width;
      const scaleY = imgRect.height / canvas.height;

      // Crosshair position in pane CSS coordinates
      const xCss = imgOffsetX + (crosshairX + 0.5) * scaleX;
      const yImg = canvas.height - 1 - crosshairY + 0.5;
      const yCss = imgOffsetY + yImg * scaleY;

      // Half-pixel alignment for crisp lines
      const xAligned = Math.round(xCss) + 0.5;
      const yAligned = Math.round(yCss) + 0.5;

      // Draw crosshairs - bright yellow
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';

      // Vertical line - full pane height
      ctx.beginPath();
      ctx.moveTo(xAligned, 0);
      ctx.lineTo(xAligned, paneRect.height);
      ctx.stroke();

      // Horizontal line - full pane width
      ctx.beginPath();
      ctx.moveTo(0, yAligned);
      ctx.lineTo(paneRect.width, yAligned);
      ctx.stroke();
    };

    drawCrosshairs();

    const resizeObserver = new ResizeObserver(() => {
      drawCrosshairs();
    });
    resizeObserver.observe(pane);

    return () => {
      resizeObserver.disconnect();
    };
  }, [crosshairX, crosshairY, volume, plane, sliceIndex, showCrosshairs]);

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

  const findNearbyPoint = useCallback((imagePoint: Point2D): { measurementId: string; pointKey: 'A' | 'B' } | null => {
    const threshold = 5;
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

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imagePoint = screenToImage(e.clientX, e.clientY);
    if (!imagePoint) return;

    if (measurementMode === 'distance') {
      const nearbyPoint = findNearbyPoint(imagePoint);
      if (nearbyPoint) {
        setDragging(nearbyPoint);
        e.preventDefault();
        return;
      }
    }

    if (measurementMode !== 'off' && onMeasurementClick) {
      onMeasurementClick(imagePoint);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataY = canvas.height - 1 - imagePoint.y;
    onCrosshairChange(imagePoint.x, dataY);
  }, [measurementMode, onMeasurementClick, onCrosshairChange, screenToImage, findNearbyPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imagePoint = screenToImage(e.clientX, e.clientY);

    if (measurementMode === 'distance' && draftPoints.length > 0) {
      setMousePosition(imagePoint);
    } else {
      setMousePosition(null);
    }

    if (dragging && imagePoint && onMeasurementPointDrag) {
      onMeasurementPointDrag(dragging.measurementId, dragging.pointKey, imagePoint);
      return;
    }

    if (e.buttons === 1 && measurementMode === 'off') {
      const canvas = canvasRef.current;
      if (!canvas || !imagePoint) return;
      const dataY = canvas.height - 1 - imagePoint.y;
      onCrosshairChange(imagePoint.x, dataY);
    }
  }, [measurementMode, draftPoints.length, screenToImage, dragging, onMeasurementPointDrag, onCrosshairChange]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
    setDragging(null);
  }, []);

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
        background: 'hsl(var(--background))',
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

      {/* Canvas container (the pane) */}
      <div
        ref={canvasContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          overflow: 'hidden',
          padding: '0',
          position: 'relative',
        }}
      >
        {/* Image wrapper with transform zoom */}
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: dragging ? 'grabbing' : (measurementMode !== 'off' ? 'crosshair' : 'crosshair'),
              imageRendering: 'pixelated',
              background: '#000',
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

        {/* Crosshair overlay - fills entire pane, on top of image */}
        <canvas
          ref={crosshairCanvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      </div>
    </div>
  );
}
