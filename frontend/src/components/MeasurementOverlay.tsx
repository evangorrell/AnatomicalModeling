import React from 'react';
import { Point2D, Measurement, PlaneType } from '../measurements/types';
import { calculateDistanceMm } from '../measurements/math';

interface MeasurementOverlayProps {
  plane: PlaneType;
  measurements: Measurement[];
  draftPoints: Point2D[];
  mousePosition: Point2D | null;
  spacing: [number, number, number];
  imageToScreen: (p: Point2D) => Point2D;
  canvasWidth: number;
  canvasHeight: number;
}

const STROKE_COLOR = 'rgba(255, 255, 255, 0.8)';
const PREVIEW_COLOR = 'rgba(180, 180, 180, 0.6)';
const STROKE_WIDTH = 1;
const POINT_RADIUS = 2;
const FONT_SIZE = 6;

export default function MeasurementOverlay({
  plane,
  measurements,
  draftPoints,
  mousePosition,
  spacing,
  imageToScreen,
  canvasWidth,
  canvasHeight,
}: MeasurementOverlayProps) {
  // Render a simple line between two points
  const renderLine = (A: Point2D, B: Point2D, key: string, isPreview: boolean = false) => {
    const screenA = imageToScreen(A);
    const screenB = imageToScreen(B);

    return (
      <line
        key={key}
        x1={screenA.x}
        y1={screenA.y}
        x2={screenB.x}
        y2={screenB.y}
        stroke={isPreview ? PREVIEW_COLOR : STROKE_COLOR}
        strokeWidth={STROKE_WIDTH}
      />
    );
  };

  // Render a small point
  const renderPoint = (p: Point2D, key: string, isPreview: boolean = false) => {
    const screenP = imageToScreen(p);
    return (
      <circle
        key={key}
        cx={screenP.x}
        cy={screenP.y}
        r={POINT_RADIUS}
        fill={isPreview ? PREVIEW_COLOR : STROKE_COLOR}
      />
    );
  };

  // Render distance label
  const renderDistanceLabel = (A: Point2D, B: Point2D, mm: number, key: string, isPreview: boolean = false) => {
    const screenA = imageToScreen(A);
    const screenB = imageToScreen(B);
    const midX = (screenA.x + screenB.x) / 2;
    const midY = (screenA.y + screenB.y) / 2;

    return (
      <text
        key={key}
        x={midX}
        y={midY}
        fill={isPreview ? PREVIEW_COLOR : '#fff'}
        fontSize={FONT_SIZE}
        fontWeight="500"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ textShadow: isPreview ? 'none' : '1px 1px 1px black, -1px -1px 1px black' }}
      >
        {mm.toFixed(1)} mm
      </text>
    );
  };

  // Render finalized distance measurement
  const renderDistanceMeasurement = (m: Measurement) => {
    if (m.kind !== 'distance') return null;

    return (
      <g key={m.id}>
        {renderLine(m.A, m.B, `line-${m.id}`)}
        {renderPoint(m.A, `pointA-${m.id}`)}
        {renderPoint(m.B, `pointB-${m.id}`)}
        {renderDistanceLabel(m.A, m.B, m.mm, `label-${m.id}`)}
      </g>
    );
  };

  // Render draft points and preview line
  const renderDraft = () => {
    if (draftPoints.length === 0) return null;

    const elements: React.ReactNode[] = [];

    // Render draft point
    elements.push(renderPoint(draftPoints[0], 'draft-point-0'));

    // If we have a mouse position, render preview line and distance
    if (mousePosition) {
      elements.push(renderLine(draftPoints[0], mousePosition, 'preview-line', true));
      elements.push(renderPoint(mousePosition, 'preview-point', true));

      // Calculate and show preview distance
      const previewMm = calculateDistanceMm(draftPoints[0], mousePosition, plane, spacing);
      elements.push(renderDistanceLabel(draftPoints[0], mousePosition, previewMm, 'preview-label', true));
    }

    return <g key="draft">{elements}</g>;
  };

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Render finalized measurements */}
      {measurements.map((m) => renderDistanceMeasurement(m))}
      {/* Render draft and preview */}
      {renderDraft()}
    </svg>
  );
}
