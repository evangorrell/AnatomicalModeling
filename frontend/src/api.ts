import axios from 'axios';
import { UploadResponse, Study, MeshMetadata } from './types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000, // 10 minutes for mesh generation
});

export const uploadNifti = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<UploadResponse>('/studies/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const uploadNiftiWithLabels = async (imageFile: File, labelsFile: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('labels', labelsFile);

  const response = await api.post<UploadResponse>('/studies/upload-with-labels', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getStudy = async (studyId: string): Promise<Study> => {
  const response = await api.get<Study>(`/studies/${studyId}`);
  return response.data;
};

export const listStudies = async (): Promise<Study[]> => {
  const response = await api.get<Study[]>('/studies');
  return response.data;
};

export const listMeshes = async (studyId: string): Promise<MeshMetadata> => {
  const response = await api.get<MeshMetadata>(`/studies/${studyId}/meshes`);
  return response.data;
};

export const getMeshUrl = (studyId: string, filename: string): string => {
  return `${API_BASE_URL}/studies/${studyId}/download/mesh/${filename}`;
};

export const downloadMesh = async (studyId: string, filename: string): Promise<void> => {
  const url = getMeshUrl(studyId, filename);

  // Fetch the blob
  const response = await fetch(url);
  const blob = await response.blob();

  // Create a temporary link and trigger download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up
  URL.revokeObjectURL(link.href);
};

export const downloadAllMeshes = async (studyId: string): Promise<void> => {
  const meshes = ['brain.stl', 'tumor.stl'];

  for (const mesh of meshes) {
    await downloadMesh(studyId, mesh);
    // Small delay to avoid browser download blocking
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
