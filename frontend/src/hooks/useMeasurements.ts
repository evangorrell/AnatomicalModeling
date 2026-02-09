import { useState, useCallback, useEffect, useRef } from 'react';
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

interface UseMeasurementsOptions {
  measurementMode: MeasurementMode;
  pixDims: [number, number, number];
  clearKey: number;
  undoKey: number;
}

export function useMeasurements({ measurementMode, pixDims, clearKey, undoKey }: UseMeasurementsOptions) {
  const [state, setState] = useState<MeasurementState>(initialMeasurementState);
  const lastModifiedPanelRef = useRef<PlaneType | null>(null);

  // Clear all measurements
  useEffect(() => {
    if (clearKey > 0) {
      setState(initialMeasurementState);
      lastModifiedPanelRef.current = null;
    }
  }, [clearKey]);

  // Undo last measurement or draft
  useEffect(() => {
    if (undoKey > 0) {
      setState(prev => {
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

  // Place a point (first click = draft, second click = finalize)
  const handleClick = useCallback((panel: PlaneType, point: Point2D) => {
    if (measurementMode === 'off') return;

    lastModifiedPanelRef.current = panel;

    setState(prev => {
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
      const mm = calculateDistanceMm(A, B, panel, pixDims);
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
  }, [measurementMode, pixDims]);

  // Drag an existing measurement endpoint to a new position
  const handlePointDrag = useCallback((panel: PlaneType, measurementId: string, pointKey: 'A' | 'B', newPoint: Point2D) => {
    setState(prev => {
      const measurements = prev.measurementsByPanel[panel];
      const idx = measurements.findIndex(m => m.id === measurementId);
      if (idx === -1) return prev;

      const measurement = measurements[idx];
      const updatedA = pointKey === 'A' ? newPoint : measurement.A;
      const updatedB = pointKey === 'B' ? newPoint : measurement.B;
      const mm = calculateDistanceMm(updatedA, updatedB, panel, pixDims);

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
  }, [pixDims]);

  // Cancel an in-progress measurement (e.g., mouse left the canvas)
  const handleCancel = useCallback((panel: PlaneType) => {
    setState(prev => ({
      ...prev,
      draftByPanel: {
        ...prev.draftByPanel,
        [panel]: [],
      },
    }));
  }, []);

  return {
    state,
    handleClick,
    handlePointDrag,
    handleCancel,
  };
}
