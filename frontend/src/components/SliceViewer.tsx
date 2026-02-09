import { useRef, useEffect, useCallback, useState } from 'react';
import { NiftiVolume, getSlice } from '../hooks/useNiftiVolume';
import MeasurementOverlay from './MeasurementOverlay';
import { Point2D, Measurement, MeasurementMode, PlaneType } from '../measurements/types';

// Constant for viewer header height (px)
export const VIEWER_HEADER_HEIGHT = 28;

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
  onMeasurementCancel?: () => void;
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
  onMeasurementCancel,
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
  // Sync ref mirrors dragging state
  const draggingRef = useRef<typeof dragging>(null);

  const [hoveringPoint, setHoveringPoint] = useState(false);

  // Track if mouse was pressed
  const isMouseDownHereRef = useRef(false);
  // Track if we're actively drawing a new measurement
  const isMeasuringRef = useRef(false);
  // Start point for in-progress drag measurement (so preview works)
  const measureStartRef = useRef<Point2D | null>(null);

  // Global mouseup listener to reset state when mouse is released anywhere
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isMouseDownHereRef.current = false;
      draggingRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

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
  }, [volume, plane, sliceIndex]);

  // Draw crosshairs on overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const crosshairCanvas = crosshairCanvasRef.current;
    const pane = canvasContainerRef.current;
    if (!canvas || !crosshairCanvas || !pane) return;

    const ctx = crosshairCanvas.getContext('2d');
    if (!ctx) return;

    // Clear crosshairs if disabled
    if (!showCrosshairs) {
      const paneRect = pane.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      crosshairCanvas.width = paneRect.width * dpr;
      crosshairCanvas.height = paneRect.height * dpr;
      ctx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
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

      // Draw crosshairs 
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)'; // Reduced opacity
      ctx.lineWidth = 0.8;
      ctx.lineCap = 'butt';

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(xAligned, 0);
      ctx.lineTo(xAligned, paneRect.height);
      ctx.stroke();

      // Horizontal line
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
    const threshold = 8;
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
    // Mark mouse was pressed
    isMouseDownHereRef.current = true;

    const imagePoint = screenToImage(e.clientX, e.clientY);
    if (!imagePoint) return;

    if (measurementMode === 'distance') {
      // Check if clicking near an existing measurement point to drag it
      const nearbyPoint = findNearbyPoint(imagePoint);
      if (nearbyPoint) {
        draggingRef.current = nearbyPoint;
        setDragging(nearbyPoint);
        e.preventDefault();
        return;
      }

      // Start a new measurement - first point on mousedown
      if (onMeasurementClick) {
        measureStartRef.current = imagePoint;
        isMeasuringRef.current = true;
        onMeasurementClick(imagePoint);
        setMousePosition(imagePoint); // Initialize preview position
        e.preventDefault();
        return;
      }
    }

    // Only update crosshair position if crosshairs are enabled
    if (!showCrosshairs) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataY = canvas.height - 1 - imagePoint.y;
    onCrosshairChange(imagePoint.x, dataY);
  }, [measurementMode, onMeasurementClick, onCrosshairChange, screenToImage, findNearbyPoint, showCrosshairs]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imagePoint = screenToImage(e.clientX, e.clientY);

    // Dragging an existing measurement point
    const activeDrag = draggingRef.current;
    if (activeDrag && imagePoint && onMeasurementPointDrag) {
      onMeasurementPointDrag(activeDrag.measurementId, activeDrag.pointKey, imagePoint);
      return;
    }

    // Track mouse position for measurement preview
    if (measurementMode === 'distance' && isMeasuringRef.current && measureStartRef.current) {
      setMousePosition(imagePoint);
    } else if (!isMeasuringRef.current) {
      setMousePosition(null);
    }

    // Show grab cursor when hovering near a draggable measurement point
    if (measurementMode === 'distance' && imagePoint && !isMeasuringRef.current) {
      const nearby = findNearbyPoint(imagePoint);
      setHoveringPoint(nearby !== null);
    } else if (!isMeasuringRef.current) {
      setHoveringPoint(false);
    }

    // Only handle crosshair dragging if mouse was pressed on this canvas
    // Also only allow if crosshairs are enabled
    if (e.buttons === 1 && measurementMode === 'off' && isMouseDownHereRef.current && showCrosshairs) {
      const canvas = canvasRef.current;
      if (!canvas || !imagePoint) return;
      const dataY = canvas.height - 1 - imagePoint.y;
      onCrosshairChange(imagePoint.x, dataY);
    }
  }, [measurementMode, screenToImage, onMeasurementPointDrag, onCrosshairChange, showCrosshairs, findNearbyPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isMouseDownHereRef.current = false;
    draggingRef.current = null;
    setDragging(null);

    // Complete measurement on mouse release
    if (isMeasuringRef.current && measurementMode === 'distance' && onMeasurementClick) {
      const imagePoint = screenToImage(e.clientX, e.clientY);
      if (imagePoint) {
        onMeasurementClick(imagePoint);
      }
      isMeasuringRef.current = false;
      measureStartRef.current = null;
      setMousePosition(null);
    }
  }, [measurementMode, onMeasurementClick, screenToImage]);

  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
    setHoveringPoint(false);
    draggingRef.current = null;
    setDragging(null);
    // Cancel measurement if user leaves canvas while measuring
    if (isMeasuringRef.current) {
      isMeasuringRef.current = false;
      measureStartRef.current = null;
      onMeasurementCancel?.();
    }
  }, [onMeasurementCancel]);

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
        height: `${VIEWER_HEADER_HEIGHT}px`,
        minHeight: `${VIEWER_HEADER_HEIGHT}px`,
        background: color,
        padding: '0 8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      }}>
        <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px', minWidth: 0, flex: 1 }}>
          <input
            type="range"
            min="0"
            max={maxSlice}
            value={sliceIndex}
            onChange={(e) => onSliceChange(parseInt(e.target.value))}
            style={{ flex: 1, minWidth: '50px', accentColor: '#fff' }}
          />
          <span style={{ minWidth: '60px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: '11px', flexShrink: 0 }}>
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
              cursor: dragging ? 'grabbing' : hoveringPoint ? 'grab' : (measurementMode !== 'off' ? 'crosshair' : (showCrosshairs ? 'crosshair' : 'default')),
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

        {/* Crosshair overlay */}
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
