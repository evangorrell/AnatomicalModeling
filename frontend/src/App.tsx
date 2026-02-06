import { useState, useEffect, useRef } from 'react';
import { uploadNiftiWithLabels, downloadMesh } from './api';
import MeshViewer from './components/MeshViewer';
import QuadView from './components/QuadView';
import CircularProgress from './components/CircularProgress';
import { MeshState } from './types';
import { io, Socket } from 'socket.io-client';
import { useMeshes } from './hooks/useMeshes';
import { useNiftiVolume } from './hooks/useNiftiVolume';
import { detectBrainAndTumor } from './utils/meshAnalysis';
import { MeasurementMode } from './measurements/types';

// Uploaded files tracking
interface UploadedFiles {
  nifti: File[];  // Up to 2 NIfTI files
  stl: File[];    // Up to 2 STL files
}

export default function App() {
  const [currentStudyId, setCurrentStudyId] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<'upload' | 'viewer'>('upload');
  const [viewerType, setViewerType] = useState<'3d-only' | 'quad' | 'quad-with-stl'>('quad');

  // Unified file upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFiles>({
    nifti: [],
    stl: [],
  });

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // STL URLs for viewer (created from uploaded files)
  const [stlUrls, setStlUrls] = useState<{ brain: string | null; tumor: string | null }>({
    brain: null,
    tumor: null,
  });

  const [niftiFileForViewer, setNiftiFileForViewer] = useState<File | null>(null);

  // Load mesh data to check if tumor exists (only for generated meshes)
  const { tumor } = useMeshes(currentStudyId);

  // Load NIfTI volume for quad-view
  const { volume: niftiVolume, loading: niftiLoading } = useNiftiVolume(niftiFileForViewer);

  const [meshState, setMeshState] = useState<MeshState>({
    brain: {
      visible: true,
      color: '#b0b0b0',
      opacity: 0.5,
    },
    tumor: {
      visible: true,
      color: '#ff6b4a',
      opacity: 1.0,
    },
  });

  // Measurement mode state
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('off');
  const [measurementClearKey, setMeasurementClearKey] = useState(0);
  const [undoKey, setUndoKey] = useState(0);

  // Keyboard listener for Cmd+Z undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        // Only handle undo when in viewer mode with measurement mode active
        if (viewerMode === 'viewer' && measurementMode === 'distance') {
          e.preventDefault();
          setUndoKey(k => k + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerMode, measurementMode]);

  // Zoom handlers reference (set by MeshViewer)
  const zoomHandlersRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    getCurrentZoom: () => number;
  } | null>(null);
  const [zoomPercentage, setZoomPercentage] = useState(50);

  // WebSocket reference
  const socketRef = useRef<Socket | null>(null);

  // Contact form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Adjust opacity based on what meshes are present
  useEffect(() => {
    const hasBrain = stlUrls.brain || (viewerType === 'quad' && currentStudyId);
    const hasTumor = stlUrls.tumor || tumor.geometry;

    if (hasBrain && hasTumor) {
      setMeshState(prev => ({
        ...prev,
        brain: { ...prev.brain, opacity: 0.5 },
        tumor: { ...prev.tumor, opacity: 1.0 },
      }));
    } else if (hasBrain && !hasTumor) {
      setMeshState(prev => ({
        ...prev,
        brain: { ...prev.brain, opacity: 1.0 },
      }));
    } else if (!hasBrain && hasTumor) {
      setMeshState(prev => ({
        ...prev,
        tumor: { ...prev.tumor, opacity: 1.0 },
      }));
    }
  }, [stlUrls.brain, stlUrls.tumor, tumor.geometry, viewerType, currentStudyId]);

  // Determine what can be done with current uploads
  const hasNifti = uploadedFiles.nifti.length === 2;
  const hasStl = uploadedFiles.stl.length > 0;
  const canGenerateMesh = hasNifti && !hasStl; // 2 NIfTI only
  const canViewStlOnly = hasStl && !hasNifti;   // STL only
  const canViewHybrid = hasNifti && hasStl;     // Both NIfTI and STL

  const handleFileSelect = async (files: FileList | File) => {
    const fileArray = files instanceof FileList ? Array.from(files) : [files];

    // Separate files by type
    const newNiftiFiles: File[] = [];
    const newStlFiles: File[] = [];
    const invalidFiles: File[] = [];

    for (const file of fileArray) {
      if (file.name.endsWith('.nii.gz') || file.name.endsWith('.nii')) {
        newNiftiFiles.push(file);
      } else if (file.name.endsWith('.stl')) {
        newStlFiles.push(file);
      } else {
        invalidFiles.push(file);
      }
    }

    if (invalidFiles.length > 0) {
      setError(`Invalid file type: ${invalidFiles.map(f => f.name).join(', ')}. Please select .nii.gz or .stl files.`);
      return;
    }

    // Check limits
    const totalNifti = uploadedFiles.nifti.length + newNiftiFiles.length;
    const totalStl = uploadedFiles.stl.length + newStlFiles.length;

    if (totalNifti > 2) {
      setError('Maximum 2 NIfTI files allowed.');
      return;
    }
    if (totalStl > 2) {
      setError('Maximum 2 STL files allowed.');
      return;
    }

    setUploadedFiles(prev => ({
      nifti: [...prev.nifti, ...newNiftiFiles],
      stl: [...prev.stl, ...newStlFiles],
    }));
    setError('');
  };

  const removeFile = (type: 'nifti' | 'stl', index: number) => {
    setUploadedFiles(prev => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));
  };

  const handleGenerateMesh = async () => {
    if (uploadedFiles.nifti.length !== 2) return;

    setProcessing(true);
    setError('');
    setProgress(0);
    setProgressMessage('Uploading files...');

    // Sort by size: larger = image, smaller = labels
    const sorted = [...uploadedFiles.nifti].sort((a, b) => b.size - a.size);
    const imageFile = sorted[0];
    const labelsFile = sorted[1];

    try {
      const response = await uploadNiftiWithLabels(imageFile, labelsFile);
      const studyId = response.studyId;

      console.log(`Upload complete. Study ID: ${studyId}. Connecting to WebSocket...`);

      const backendUrl = (import.meta as any).env?.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:3000';
      const socket = io(`${backendUrl}/progress`, {
        transports: ['websocket', 'polling'],
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('WebSocket connected');
        socket.emit('subscribe', studyId);
      });

      socket.on('progress', (data: { percentage: number; message: string; stage: string }) => {
        setProgress(data.percentage);
        setProgressMessage(data.message);
      });

      socket.on('complete', () => {
        setProgress(100);
        setProgressMessage('Complete!');

        setTimeout(() => {
          setCurrentStudyId(studyId);
          setNiftiFileForViewer(imageFile);
          setViewerType('quad');
          setProcessing(false);
          setProgress(0);
          setProgressMessage('');
          setViewerMode('viewer');
          socket.disconnect();
        }, 1000);
      });

      socket.on('error', (data: { message: string }) => {
        setError(data.message || 'Processing failed.');
        setProcessing(false);
        setProgress(0);
        setProgressMessage('');
        socket.disconnect();
      });

      socket.on('connect_error', () => {
        setError('Connection error. Please refresh and try again.');
        setProcessing(false);
        setProgress(0);
        setProgressMessage('');
      });

    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Upload failed.');
      setProcessing(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const handleViewStlOnly = async () => {
    if (uploadedFiles.stl.length === 0) return;

    // Detect brain/tumor from STL files
    const { brain: brainFile, tumor: tumorFile } = await detectBrainAndTumor(uploadedFiles.stl);

    setStlUrls({
      brain: brainFile ? URL.createObjectURL(brainFile) : null,
      tumor: tumorFile ? URL.createObjectURL(tumorFile) : null,
    });

    setViewerType('3d-only');
    setViewerMode('viewer');
  };

  const handleViewHybrid = async () => {
    if (uploadedFiles.nifti.length !== 2 || uploadedFiles.stl.length === 0) return;

    // Sort NIfTI by size for viewer
    const sorted = [...uploadedFiles.nifti].sort((a, b) => b.size - a.size);
    const imageFile = sorted[0];

    // Detect brain/tumor from STL files
    const { brain: brainFile, tumor: tumorFile } = await detectBrainAndTumor(uploadedFiles.stl);

    setNiftiFileForViewer(imageFile);
    setStlUrls({
      brain: brainFile ? URL.createObjectURL(brainFile) : null,
      tumor: tumorFile ? URL.createObjectURL(tumorFile) : null,
    });

    setViewerType('quad-with-stl');
    setViewerMode('viewer');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDownload = async () => {
    if (!currentStudyId) return;
    setDownloading(true);
    try {
      await downloadMesh(currentStudyId, 'brain.stl');
      if (tumor.geometry) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await downloadMesh(currentStudyId, 'tumor.stl');
      }
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download meshes.');
    } finally {
      setDownloading(false);
    }
  };

  const updateBrainState = (updates: Partial<MeshState['brain']>) => {
    setMeshState(prev => ({
      ...prev,
      brain: { ...prev.brain, ...updates },
    }));
  };

  const updateTumorState = (updates: Partial<MeshState['tumor']>) => {
    setMeshState(prev => ({
      ...prev,
      tumor: { ...prev.tumor, ...updates },
    }));
  };

  const handleContactChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Contact form submitted:', formData);
    alert('Message sent! (Demo - not actually sent)');
    setFormData({ name: '', email: '', message: '' });
  };

  const resetViewer = () => {
    setViewerMode('upload');
    setCurrentStudyId(null);
    setNiftiFileForViewer(null);

    // Clean up STL object URLs
    if (stlUrls.brain) URL.revokeObjectURL(stlUrls.brain);
    if (stlUrls.tumor) URL.revokeObjectURL(stlUrls.tumor);
    setStlUrls({ brain: null, tumor: null });

    // Keep uploaded files - user can remove them manually with X button
    setError('');
    setProgress(0);
    setProgressMessage('');
  };

  // Get total file count
  const totalFiles = uploadedFiles.nifti.length + uploadedFiles.stl.length;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0B1B3D 0%, #1e3a5f 50%, #4a6fa5 100%)',
      color: 'white',
    }}>
      {/* Navigation */}
      <nav style={{
        padding: '24px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: '700',
          letterSpacing: '2px',
          margin: 0,
        }}>
          ANATOMICAL MODELING
        </h1>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="#main" style={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', fontSize: '15px' }}>
            Upload
          </a>
          <a href="#contact" style={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', fontSize: '15px' }}>
            Contact
          </a>
        </div>
      </nav>

      {/* Main Section */}
      <section id="main" style={{
        minHeight: viewerMode === 'viewer' ? 'auto' : '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: viewerMode === 'viewer' ? 'flex-start' : 'center',
        alignItems: viewerMode === 'viewer' ? 'stretch' : 'center',
        padding: viewerMode === 'viewer' ? '16px 24px' : '80px 48px',
        maxWidth: viewerMode === 'viewer' ? '100%' : '1400px',
        margin: '0 auto',
      }}>
        {viewerMode === 'upload' ? (
          <>
            {/* Hero Content */}
            <div style={{ marginBottom: '60px', textAlign: 'center', maxWidth: '800px' }}>
              <div style={{
                color: '#ff6b4a',
                fontSize: '14px',
                fontWeight: '600',
                letterSpacing: '2px',
                marginBottom: '24px',
              }}>
                MRI TO 3D MESH PIPELINE
              </div>
              <h2 style={{
                fontSize: '64px',
                fontWeight: '700',
                margin: '0 0 24px 0',
                lineHeight: '1.1',
              }}>
                Precision in<br />Practice.
              </h2>
              <p style={{
                fontSize: '18px',
                lineHeight: '1.6',
                opacity: 0.9,
              }}>
                Upload NIfTI files (.nii.gz) for automatic segmentation and mesh generation,
                or STL files (.stl) to view existing meshes. You can also combine both for
                slice visualization with custom 3D models.
              </p>
            </div>

            {/* Upload Box */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(10px)',
              borderRadius: '16px',
              padding: '40px',
              width: '100%',
              maxWidth: '800px',
            }}>
              {processing ? (
                <div style={{
                  minHeight: '350px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '32px',
                }}>
                  <CircularProgress progress={progress} size={140} strokeWidth={10} />
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '500', color: '#ff6b4a', marginBottom: '8px' }}>
                      {progressMessage}
                    </p>
                    <p style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.6)' }}>
                      This may take a few minutes...
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {error && (
                    <div style={{
                      background: 'rgba(255, 107, 74, 0.2)',
                      border: '1px solid #ff6b4a',
                      color: '#ff6b4a',
                      padding: '16px 24px',
                      borderRadius: '8px',
                      marginBottom: '24px',
                      fontSize: '15px',
                    }}>
                      {error}
                    </div>
                  )}

                  {/* File Listings */}
                  {totalFiles > 0 && (
                    <div style={{ marginBottom: '24px' }}>
                      {/* NIfTI files */}
                      {uploadedFiles.nifti.map((file, i) => (
                        <div key={`nifti-${i}`} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'rgba(74, 222, 128, 0.15)',
                          border: '1px solid rgba(74, 222, 128, 0.4)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          marginBottom: '8px',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '10px', color: '#4ade80', fontWeight: '600', letterSpacing: '0.5px' }}>
                              NIFTI
                            </div>
                            <div style={{
                              fontSize: '14px',
                              color: 'rgba(255, 255, 255, 0.9)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {file.name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile('nifti', i)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.1)',
                              border: 'none',
                              color: 'rgba(255, 255, 255, 0.6)',
                              fontSize: '16px',
                              cursor: 'pointer',
                              padding: '4px 10px',
                              borderRadius: '6px',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {/* STL files */}
                      {uploadedFiles.stl.map((file, i) => (
                        <div key={`stl-${i}`} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'rgba(59, 130, 246, 0.15)',
                          border: '1px solid rgba(59, 130, 246, 0.4)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          marginBottom: '8px',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '10px', color: '#3b82f6', fontWeight: '600', letterSpacing: '0.5px' }}>
                              STL MESH
                            </div>
                            <div style={{
                              fontSize: '14px',
                              color: 'rgba(255, 255, 255, 0.9)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {file.name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                              {(file.size / 1024).toFixed(0)} KB
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile('stl', i)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.1)',
                              border: 'none',
                              color: 'rgba(255, 255, 255, 0.6)',
                              fontSize: '16px',
                              cursor: 'pointer',
                              padding: '4px 10px',
                              borderRadius: '6px',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {/* Info text */}
                      {hasNifti && !hasStl && (
                        <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center', marginTop: '8px' }}>
                          Larger file → MRI image, smaller file → tumor labels (auto-detected)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Drop Zone */}
                  <div
                    onDrop={handleDrop}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onClick={() => document.getElementById('file-input')?.click()}
                    style={{
                      minHeight: totalFiles > 0 ? '120px' : '200px',
                      border: `2px dashed ${dragActive ? '#ff6b4a' : 'rgba(255, 255, 255, 0.3)'}`,
                      borderRadius: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      background: dragActive ? 'rgba(255, 107, 74, 0.1)' : 'transparent',
                      marginBottom: '24px',
                    }}
                  >
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p style={{ fontSize: '16px', fontWeight: '500', margin: '16px 0 8px 0' }}>
                      Drop .nii.gz or .stl files here
                    </p>
                    <p style={{ fontSize: '13px', opacity: 0.6 }}>
                      or click to browse
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    {canGenerateMesh && (
                      <button
                        onClick={handleGenerateMesh}
                        style={{
                          padding: '14px 32px',
                          background: '#ff6b4a',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Generate 3D Mesh
                      </button>
                    )}
                    {canViewStlOnly && (
                      <button
                        onClick={handleViewStlOnly}
                        style={{
                          padding: '14px 32px',
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        View 3D Mesh
                      </button>
                    )}
                    {canViewHybrid && (
                      <button
                        onClick={handleViewHybrid}
                        style={{
                          padding: '14px 32px',
                          background: 'linear-gradient(135deg, #4ade80, #3b82f6)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        View with Slices
                      </button>
                    )}
                  </div>

                  <input
                    id="file-input"
                    type="file"
                    accept=".nii,.gz,.stl,application/gzip"
                    multiple
                    onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                    style={{ display: 'none' }}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          // Viewer Mode - Page container (column)
          <div style={{
            width: '100%',
            height: 'calc(100vh - 100px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {/* Wrapper for header + viewer to share same width */}
            <div style={{
              height: '100%',
              aspectRatio: '1',
              maxWidth: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}>
              {/* Header row */}
              <div style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                flexShrink: 0,
              }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', margin: 0 }}>
                  {viewerType === '3d-only' ? '3D Model Viewer' : 'Medical Imaging Viewer'}
                </h2>

                {/* Measurement controls - only show for quad view modes */}
                {viewerType !== '3d-only' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '4px',
                  }}>
                    <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', padding: '0 8px' }}>
                      Measure:
                    </span>
                    {(['off', 'distance'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setMeasurementMode(mode)}
                        style={{
                          padding: '6px 12px',
                          background: measurementMode === mode ? '#ff6b4a' : 'transparent',
                          border: 'none',
                          borderRadius: '6px',
                          color: measurementMode === mode ? 'white' : 'rgba(255, 255, 255, 0.7)',
                          fontSize: '12px',
                          fontWeight: measurementMode === mode ? '600' : '400',
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                    <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)', margin: '0 4px' }} />
                    <button
                      onClick={() => setMeasurementClearKey(k => k + 1)}
                      style={{
                        padding: '6px 12px',
                        background: 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '6px',
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px' }}>
                  {currentStudyId && (
                    <button
                      onClick={handleDownload}
                      disabled={downloading}
                      style={{
                        background: '#ff6b4a',
                        color: 'white',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        opacity: downloading ? 0.6 : 1,
                      }}
                    >
                      {downloading ? 'Downloading...' : 'Download STLs'}
                    </button>
                  )}
                  <button
                    onClick={resetViewer}
                    style={{
                      padding: '12px 24px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                    }}
                  >
                    ← Back to Upload
                  </button>
                </div>
              </div>

            {/* Controls for 3D-only mode */}
            {viewerType === '3d-only' && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                display: 'flex',
                gap: '24px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>Zoom</span>
                  <button
                    onClick={() => {
                      if (zoomHandlersRef.current) {
                        zoomHandlersRef.current.zoomOut();
                        const currentZoom = zoomHandlersRef.current.getCurrentZoom();
                        setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
                      }
                    }}
                    style={{
                      width: '32px',
                      height: '32px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '18px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <span style={{ fontSize: '14px', minWidth: '45px', textAlign: 'center' }}>
                    {zoomPercentage}%
                  </span>
                  <button
                    onClick={() => {
                      if (zoomHandlersRef.current) {
                        zoomHandlersRef.current.zoomIn();
                        const currentZoom = zoomHandlersRef.current.getCurrentZoom();
                        setZoomPercentage(Math.round(((500 - currentZoom) / 450) * 100));
                      }
                    }}
                    style={{
                      width: '32px',
                      height: '32px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '18px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>

                {stlUrls.brain && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>Brain</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={meshState.brain.opacity}
                      onChange={(e) => updateBrainState({ opacity: Number(e.target.value) })}
                      style={{ width: '100px', accentColor: '#b0b0b0' }}
                    />
                  </div>
                )}

                {stlUrls.tumor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>Tumor</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={meshState.tumor.opacity}
                      onChange={(e) => updateTumorState({ opacity: Number(e.target.value) })}
                      style={{ width: '100px', accentColor: '#ff6b4a' }}
                    />
                  </div>
                )}
              </div>
            )}

              {/* Quad-viewer container */}
              <div style={{
                flex: 1,
                minHeight: 0,
                borderRadius: '12px',
                overflow: 'hidden',
                background: 'rgba(0, 0, 0, 0.2)',
              }}>
              {viewerType === '3d-only' ? (
                <MeshViewer
                  studyId={null}
                  stlFiles={stlUrls}
                  meshState={meshState}
                  onZoomHandlersReady={(handlers) => {
                    zoomHandlersRef.current = handlers;
                    setZoomPercentage(Math.round(((500 - handlers.getCurrentZoom()) / 450) * 100));
                  }}
                />
              ) : niftiVolume ? (
                <QuadView
                  volume={niftiVolume}
                  studyId={viewerType === 'quad' ? currentStudyId : null}
                  stlFiles={viewerType === 'quad-with-stl' ? stlUrls : { brain: null, tumor: null }}
                  meshState={meshState}
                  onMeshStateChange={(updates) => setMeshState(prev => ({ ...prev, ...updates }))}
                  onZoomHandlersReady={(handlers) => {
                    zoomHandlersRef.current = handlers;
                    setZoomPercentage(Math.round(((500 - handlers.getCurrentZoom()) / 450) * 100));
                  }}
                  measurementMode={measurementMode}
                  measurementClearKey={measurementClearKey}
                  undoKey={undoKey}
                />
              ) : niftiLoading ? (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}>
                  Loading volume data...
                </div>
              ) : null}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Contact Section */}
      <section id="contact" style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        padding: '80px 48px',
      }}>
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          width: '100%',
        }}>
          <h2 style={{
            fontSize: '48px',
            fontWeight: '700',
            marginBottom: '16px',
            textAlign: 'center',
          }}>
            Get in Contact
          </h2>
          <p style={{
            fontSize: '16px',
            opacity: 0.8,
            textAlign: 'center',
            marginBottom: '48px',
          }}>
            Have questions? Reach out to our team.
          </p>

          <form onSubmit={handleContactSubmit} style={{
            background: 'rgba(26, 49, 86, 0.6)',
            backdropFilter: 'blur(10px)',
            borderRadius: '16px',
            padding: '40px',
          }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Name
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleContactChange}
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: '#0F2447',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  fontSize: '15px',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleContactChange}
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: '#0F2447',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  fontSize: '15px',
                }}
              />
            </div>

            <div style={{ marginBottom: '32px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Message
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleContactChange}
                required
                rows={5}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: '#0F2447',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  fontSize: '15px',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ textAlign: 'center' }}>
              <button
                type="submit"
                style={{
                  padding: '16px 40px',
                  borderRadius: '999px',
                  fontSize: '16px',
                  fontWeight: '600',
                  background: '#ff6b4a',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
                Send Message
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
