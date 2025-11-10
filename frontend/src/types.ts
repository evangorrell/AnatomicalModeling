export interface UploadResponse {
  studyId: string;
  message: string;
  fileType: string;
}

export interface Study {
  id: string;
  modality: string;
  seriesDescription: string;
  metadata: {
    source: string;
    filename: string;
    segmentation?: {
      method: string;
      labels: {
        [key: string]: string;
      };
      brain_voxels: number;
      tumor_voxels: number;
      brain_volume_ml: number;
      tumor_volume_ml: number;
      meshes?: {
        meshes: {
          [key: string]: {
            label_value: number;
            vertices: number;
            faces: number;
            voxels: number;
            post_processed: boolean;
            role?: 'brain' | 'tumor' | 'unknown';
            confidence?: number;
          };
        };
      };
    };
  };
  createdAt: string;
}

export interface MeshMetadata {
  meshes: string[];
  metadata: any;
}

export interface MeshState {
  brain: {
    visible: boolean;
    color: string;
    opacity: number;
  };
  tumor: {
    visible: boolean;
    color: string;
    opacity: number;
  };
}
