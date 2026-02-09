// Measurement types for 2D slice panels

export interface Point2D {
  x: number; // Image pixel X coordinate
  y: number; // Image pixel Y coordinate
}

export type MeasurementMode = 'off' | 'distance';

export type PlaneType = 'axial' | 'coronal' | 'sagittal';

export interface DistanceMeasurement {
  kind: 'distance';
  id: string;
  A: Point2D;
  B: Point2D;
  mm: number;
  createdAt: number;
}

export type Measurement = DistanceMeasurement;

export interface MeasurementState {
  measurementsByPanel: {
    axial: Measurement[];
    coronal: Measurement[];
    sagittal: Measurement[];
  };
  draftByPanel: {
    axial: Point2D[];
    coronal: Point2D[];
    sagittal: Point2D[];
  };
}

export const initialMeasurementState: MeasurementState = {
  measurementsByPanel: {
    axial: [],
    coronal: [],
    sagittal: [],
  },
  draftByPanel: {
    axial: [],
    coronal: [],
    sagittal: [],
  },
};
