export interface UploadResponse {
  studyId: string;
  message: string;
  fileType: string;
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

export interface UploadedFiles {
  nifti: File[];
  stl: File[];
}
