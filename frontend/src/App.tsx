import { useState, useEffect } from 'react';
import { uploadNifti, downloadAllMeshes, getMeshUrl } from './api';
import MeshViewer from './components/MeshViewer';
import CircularProgress from './components/CircularProgress';
import { MeshState } from './types';

export default function App() {
  const [currentStudyId, setCurrentStudyId] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<'upload' | 'viewer'>('upload');
  const [uploadType, setUploadType] = useState<'nifti' | 'stl'>('nifti');
  const [uploadedNiftiFile, setUploadedNiftiFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [stlFile, setStlFile] = useState<string | null>(null);

  const [meshState, setMeshState] = useState<MeshState>({
    brain: {
      visible: true,
      color: '#b0b0b0',
      opacity: 0.8,
    },
    tumor: {
      visible: true,
      color: '#ff6b4a',
      opacity: 1.0,
    },
  });

  const [cameraDistance, setCameraDistance] = useState(200);

  // Contact form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  // Smooth progress simulation
  useEffect(() => {
    if (!processing) return;

    let currentProgress = progress;
    const interval = setInterval(() => {
      // Increment progress smoothly
      if (currentProgress < 15) {
        // Upload phase: 0-15% (faster)
        currentProgress += 0.5;
      } else if (currentProgress < 60) {
        // Segmentation phase: 15-60% (slower)
        currentProgress += 0.2;
      } else if (currentProgress < 95) {
        // Mesh generation phase: 60-95% (medium)
        currentProgress += 0.3;
      } else if (currentProgress < 100) {
        // Final phase: 95-100% (slow)
        currentProgress += 0.1;
      }

      setProgress(currentProgress);

      // Update messages based on progress
      if (currentProgress < 15) {
        setProgressMessage('Uploading file...');
      } else if (currentProgress < 60) {
        setProgressMessage('Running segmentation...');
      } else if (currentProgress < 95) {
        setProgressMessage('Generating 3D meshes...');
      } else {
        setProgressMessage('Finalizing...');
      }
    }, 100); // Update every 100ms for smooth animation

    return () => clearInterval(interval);
  }, [processing, progress]);

  const handleFileSelect = async (file: File) => {
    if (uploadType === 'nifti') {
      if (!file.name.endsWith('.nii.gz') && !file.name.endsWith('.nii')) {
        setError('Please select a valid NIfTI file (.nii or .nii.gz)');
        return;
      }

      // Just store the file, don't process yet
      setUploadedNiftiFile(file);
      setError('');

    } else {
      // STL file - direct viewing
      if (!file.name.endsWith('.stl')) {
        setError('Please select a valid STL file (.stl)');
        return;
      }

      const url = URL.createObjectURL(file);
      setStlFile(url);
      setViewerMode('viewer');
    }
  };

  const handleGenerateMesh = async () => {
    if (!uploadedNiftiFile) return;

    setProcessing(true);
    setError('');
    setProgress(0);
    setProgressMessage('Starting...');

    try {
      // Start the actual upload
      const response = await uploadNifti(uploadedNiftiFile);

      // The progress will continue updating via the useEffect
      // Wait for progress to reach 100
      const checkComplete = setInterval(() => {
        if (progress >= 99.5) {
          clearInterval(checkComplete);
          setProgress(100);
          setProgressMessage('Complete!');

          setTimeout(() => {
            setCurrentStudyId(response.studyId);
            setProcessing(false);
            setProgress(0);
            setProgressMessage('');
            setViewerMode('viewer');
          }, 800);
        }
      }, 100);

    } catch (err: any) {
      console.error('Processing failed:', err);
      setError(err.response?.data?.message || err.message || 'Processing failed. Please try again.');
      setProcessing(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
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
      await downloadAllMeshes(currentStudyId);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download meshes. Please try again.');
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
    setStlFile(null);
    setUploadedNiftiFile(null);
    setError('');
    setProgress(0);
    setProgressMessage('');
  };

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

      {/* Main Section - Hero + Upload/Viewer */}
      <section id="main" style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '80px 48px',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        {viewerMode === 'upload' ? (
          <>
            {/* Hero Content - Centered */}
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
                marginBottom: '0',
              }}>
                Transform MRI scans into precise 3D anatomical models. Upload NIfTI files for automatic segmentation and mesh generation, or view existing STL meshes directly.
              </p>
            </div>

            {/* Upload Box with Two Options */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(10px)',
              borderRadius: '16px',
              padding: '40px',
              width: '100%',
              maxWidth: '800px',
            }}>
              {/* Upload Type Selector */}
              <div style={{
                display: 'flex',
                gap: '16px',
                marginBottom: '32px',
              }}>
                <button
                  onClick={() => {
                    setUploadType('nifti');
                    setUploadedNiftiFile(null);
                    setError('');
                  }}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: uploadType === 'nifti' ? '#ff6b4a' : 'rgba(255, 255, 255, 0.1)',
                    border: uploadType === 'nifti' ? 'none' : '2px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: 'white',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                  }}
                >
                  Upload NIfTI File
                </button>
                <button
                  onClick={() => {
                    setUploadType('stl');
                    setUploadedNiftiFile(null);
                    setError('');
                  }}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: uploadType === 'stl' ? '#ff6b4a' : 'rgba(255, 255, 255, 0.1)',
                    border: uploadType === 'stl' ? 'none' : '2px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: 'white',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                  }}
                >
                  Upload STL File
                </button>
              </div>

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

              {/* Drop Zone or Processing State */}
              {processing ? (
                // Circular Progress Bar
                <div style={{
                  minHeight: '280px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                  gap: '32px',
                }}>
                  <CircularProgress progress={progress} size={140} strokeWidth={10} />

                  <div style={{ textAlign: 'center' }}>
                    <p style={{
                      fontSize: '18px',
                      fontWeight: '500',
                      color: '#ff6b4a',
                      marginBottom: '8px',
                    }}>
                      {progressMessage}
                    </p>
                    <p style={{
                      fontSize: '14px',
                      color: 'rgba(255, 255, 255, 0.6)',
                    }}>
                      This may take a few minutes...
                    </p>
                  </div>
                </div>
              ) : uploadedNiftiFile && uploadType === 'nifti' ? (
                // Show "Generate Mesh" button after NIfTI upload
                <div style={{
                  minHeight: '280px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                }}>
                  <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" style={{ marginBottom: '24px' }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>

                  <p style={{
                    fontSize: '20px',
                    fontWeight: '500',
                    marginBottom: '8px',
                  }}>
                    File uploaded successfully!
                  </p>
                  <p style={{
                    fontSize: '15px',
                    opacity: 0.6,
                    marginBottom: '32px',
                  }}>
                    {uploadedNiftiFile.name}
                  </p>

                  <button
                    onClick={handleGenerateMesh}
                    style={{
                      padding: '16px 48px',
                      background: '#ff6b4a',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '18px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#ff5535'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#ff6b4a'}
                  >
                    Generate Mesh
                  </button>

                  <button
                    onClick={() => setUploadedNiftiFile(null)}
                    style={{
                      marginTop: '16px',
                      padding: '8px 24px',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.6)',
                      border: 'none',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    Choose different file
                  </button>
                </div>
              ) : (
                // Drop Zone
                <div
                  onDrop={handleDrop}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onClick={() => document.getElementById('file-input')?.click()}
                  style={{
                    minHeight: '280px',
                    border: `2px dashed ${dragActive ? '#ff6b4a' : 'rgba(255, 255, 255, 0.3)'}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    background: dragActive ? 'rgba(255, 107, 74, 0.1)' : 'transparent',
                  }}
                >
                  <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p style={{
                    fontSize: '20px',
                    fontWeight: '500',
                    margin: '24px 0 8px 0',
                  }}>
                    {uploadType === 'nifti'
                      ? 'Drop your .nii.gz file here'
                      : 'Drop your .stl file here'
                    }
                  </p>
                  <p style={{
                    fontSize: '15px',
                    opacity: 0.6,
                  }}>
                    or click to browse
                  </p>
                </div>
              )}

              <input
                id="file-input"
                type="file"
                accept={uploadType === 'nifti' ? '.gz,.nii' : '.stl'}
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
          </>
        ) : (
          // Viewer Mode - Replaces upload box
          <div style={{ width: '100%' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px',
            }}>
              <h2 style={{
                fontSize: '36px',
                fontWeight: '700',
                margin: 0,
              }}>
                3D Model Viewer
              </h2>
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

            {/* Controls */}
            {uploadType === 'nifti' && currentStudyId && (
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '180px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', minWidth: '50px' }}>Zoom</span>
                  <input
                    type="range"
                    min="80"
                    max="400"
                    value={cameraDistance}
                    onChange={(e) => setCameraDistance(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#ff6b4a' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={meshState.brain.visible}
                      onChange={(e) => updateBrainState({ visible: e.target.checked })}
                      style={{ accentColor: '#ff6b4a', width: '18px', height: '18px' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>Brain</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={meshState.brain.opacity}
                    onChange={(e) => updateBrainState({ opacity: Number(e.target.value) })}
                    style={{ width: '100px', accentColor: '#ff6b4a' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={meshState.tumor.visible}
                      onChange={(e) => updateTumorState({ visible: e.target.checked })}
                      style={{ accentColor: '#ff6b4a', width: '18px', height: '18px' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>Tumor</span>
                  </label>
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

                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  style={{
                    background: '#ff6b4a',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    opacity: downloading ? 0.6 : 1,
                  }}
                >
                  {downloading ? 'Downloading...' : 'Download STLs'}
                </button>
              </div>
            )}

            {/* 3D Viewer */}
            <div style={{
              height: '700px',
              borderRadius: '12px',
              overflow: 'hidden',
              background: 'rgba(0, 0, 0, 0.2)',
            }}>
              <MeshViewer
                studyId={uploadType === 'nifti' ? currentStudyId : null}
                stlFile={stlFile}
                meshState={meshState}
                cameraDistance={cameraDistance}
              />
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
            Have questions? Reach out to our team of experts.
          </p>

          <form onSubmit={handleContactSubmit} style={{
            background: 'rgba(26, 49, 86, 0.6)',
            backdropFilter: 'blur(10px)',
            borderRadius: '16px',
            padding: '40px',
          }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)' }}>
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
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)' }}>
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
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: '32px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)' }}>
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
                  outline: 'none',
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
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#ff5535'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#ff6b4a'}
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
