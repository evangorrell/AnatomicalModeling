// Measurement math utilities

import { Point2D, PlaneType } from './types';

/**
 * Get the pixel spacing for a given plane orientation
 * spacing is [sx, sy, sz] in mm per voxel
 */
export function getSpacingForPlane(
  plane: PlaneType,
  spacing: [number, number, number]
): [number, number] {
  const [sx, sy, sz] = spacing;
  switch (plane) {
    case 'axial':
      return [sx, sy]; // X-Y plane
    case 'coronal':
      return [sx, sz]; // X-Z plane
    case 'sagittal':
      return [sy, sz]; // Y-Z plane
  }
}

/**
 * Calculate distance in mm between two points in image pixel coordinates
 */
export function calculateDistanceMm(
  A: Point2D,
  B: Point2D,
  plane: PlaneType,
  spacing: [number, number, number]
): number {
  const [spacingX, spacingY] = getSpacingForPlane(plane, spacing);
  const dx = (B.x - A.x) * spacingX;
  const dy = (B.y - A.y) * spacingY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate unique ID for measurements
 */
export function generateMeasurementId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
