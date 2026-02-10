import { useState, useEffect, useRef } from 'react';
import { uploadNiftiWithLabels } from './api';
import { MeshState, UploadedFiles } from './types';
import { io, Socket } from 'socket.io-client';
import { useMeshes } from './hooks/useMeshes';
import { useNiftiVolume } from './hooks/useNiftiVolume';
import { detectBrainAndTumor } from './utils/meshAnalysis';
import UploadPanel from './components/UploadPanel';
import ViewerLayout from './components/ViewerLayout';
import ContactForm from './components/ContactForm';

export default function App() {
  const [currentStudyId, setCurrentStudyId] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<'upload' | 'viewer'>('upload');
  const [viewerType, setViewerType] = useState<'3d-only' | 'quad' | 'quad-with-stl'>('quad');

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFiles>({
    nifti: [],
    stl: [],
  });

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');

  const [stlUrls, setStlUrls] = useState<{ brain: string | null; tumor: string | null }>({
    brain: null,
    tumor: null,
  });

  const [niftiFileForViewer, setNiftiFileForViewer] = useState<File | null>(null);

  // Load mesh data to check if tumor exists
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

  // WebSocket reference
  const socketRef = useRef<Socket | null>(null);

  const resetProgress = () => {
    setProcessing(false);
    setProgress(0);
    setProgressMessage('');
  };

  // Sort NIfTI files by size descending — larger = MRI image, smaller = labels
  const getSortedNifti = () => [...uploadedFiles.nifti].sort((a, b) => b.size - a.size);

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

  const handleFileSelect = (files: FileList | File) => {
    const fileArray = files instanceof FileList ? Array.from(files) : [files];

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

    const totalNifti = uploadedFiles.nifti.length + newNiftiFiles.length;
    const totalStl = uploadedFiles.stl.length + newStlFiles.length;

    if (totalNifti > 2) {
      setError('Maximum 2 NIfTI files allowed.'); // image and label
      return;
    }
    if (totalStl > 2) {
      setError('Maximum 2 STL files allowed.'); // brain and tumor
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

    const sorted = getSortedNifti();
    const imageFile = sorted[0];
    const labelsFile = sorted[1];

    try {
      const response = await uploadNiftiWithLabels(imageFile, labelsFile);
      const studyId = response.studyId;

      console.log(`Upload complete. Study ID: ${studyId}. Connecting to WebSocket...`);

      const backendUrl = 'http://localhost:3000';
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
          resetProgress();
          setViewerMode('viewer');
          socket.disconnect();
        }, 1000);
      });

      socket.on('error', (data: { message: string }) => {
        setError(data.message || 'Processing failed.');
        resetProgress();
        socket.disconnect();
      });

      socket.on('connect_error', () => {
        setError('Connection error. Please refresh and try again.');
        resetProgress();
      });

    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e.response?.data?.message || e.message || 'Upload failed.');
      resetProgress();
    }
  };

  const handleViewStlOnly = async () => {
    if (uploadedFiles.stl.length === 0) return;

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

    const imageFile = getSortedNifti()[0];

    const { brain: brainFile, tumor: tumorFile } = await detectBrainAndTumor(uploadedFiles.stl);

    setNiftiFileForViewer(imageFile);
    setStlUrls({
      brain: brainFile ? URL.createObjectURL(brainFile) : null,
      tumor: tumorFile ? URL.createObjectURL(tumorFile) : null,
    });

    setViewerType('quad-with-stl');
    setViewerMode('viewer');
  };

  const resetViewer = () => {
    setViewerMode('upload');
    setCurrentStudyId(null);
    setNiftiFileForViewer(null);

    // Clean up STL object URLs
    if (stlUrls.brain) URL.revokeObjectURL(stlUrls.brain);
    if (stlUrls.tumor) URL.revokeObjectURL(stlUrls.tumor);
    setStlUrls({ brain: null, tumor: null });

    setError('');
    resetProgress();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
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
          <a
            href="#main"
            onClick={(e) => {
              e.preventDefault();
              resetViewer();
              document.getElementById('main')?.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{ color: 'hsl(var(--secondary-foreground))', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
          >
            Upload
          </a>
          <a href="#contact" style={{ color: 'hsl(var(--secondary-foreground))', textDecoration: 'none', fontSize: '15px' }}>
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
          <UploadPanel
            uploadedFiles={uploadedFiles}
            processing={processing}
            progress={progress}
            progressMessage={progressMessage}
            error={error}
            onFileSelect={handleFileSelect}
            onRemoveFile={removeFile}
            onGenerateMesh={handleGenerateMesh}
            onViewStlOnly={handleViewStlOnly}
            onViewHybrid={handleViewHybrid}
          />
        ) : (
          <ViewerLayout
            viewerType={viewerType}
            currentStudyId={currentStudyId}
            stlUrls={stlUrls}
            meshState={meshState}
            setMeshState={setMeshState}
            niftiVolume={niftiVolume}
            niftiLoading={niftiLoading}
            hasTumorMesh={!!tumor.geometry}
            onReset={resetViewer}
          />
        )}
      </section>

      {/* Contact Section */}
      <ContactForm />
    </div>
  );
}
