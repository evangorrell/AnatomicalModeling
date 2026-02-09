import { useState } from 'react';
import CircularProgress from './CircularProgress';
import { UploadedFiles } from '../types';

interface UploadPanelProps {
  uploadedFiles: UploadedFiles;
  processing: boolean;
  progress: number;
  progressMessage: string;
  error: string;
  onFileSelect: (files: FileList | File) => void;
  onRemoveFile: (type: 'nifti' | 'stl', index: number) => void;
  onGenerateMesh: () => void;
  onViewStlOnly: () => void;
  onViewHybrid: () => void;
}

export default function UploadPanel({
  uploadedFiles,
  processing,
  progress,
  progressMessage,
  error,
  onFileSelect,
  onRemoveFile,
  onGenerateMesh,
  onViewStlOnly,
  onViewHybrid,
}: UploadPanelProps) {
  const [dragActive, setDragActive] = useState(false);

  const hasNifti = uploadedFiles.nifti.length === 2;
  const hasStl = uploadedFiles.stl.length > 0;
  const canGenerateMesh = hasNifti && !hasStl;
  const canViewStlOnly = hasStl && !hasNifti;
  const canViewHybrid = hasNifti && hasStl;
  const totalFiles = uploadedFiles.nifti.length + uploadedFiles.stl.length;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      onFileSelect(files);
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

  return (
    <>
      {/* Hero Content */}
      <div style={{ marginBottom: '60px', textAlign: 'center', maxWidth: '800px' }}>
        <div style={{
          color: 'hsl(var(--primary))',
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
        background: 'hsl(var(--card))',
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
              <p style={{ fontSize: '18px', fontWeight: '500', color: 'hsl(var(--primary))', marginBottom: '8px' }}>
                {progressMessage}
              </p>
              <p style={{ fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>
                This may take a few minutes...
              </p>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div style={{
                background: 'hsl(var(--destructive) / 0.2)',
                border: '1px solid hsl(var(--destructive))',
                color: 'hsl(var(--destructive))',
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
                    background: 'hsl(var(--secondary))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    padding: '12px 16px',
                    marginBottom: '8px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: 'hsl(var(--chart-2))', fontWeight: '600', letterSpacing: '0.5px' }}>
                        NIFTI
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: 'hsl(var(--foreground))',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveFile('nifti', i)}
                      style={{
                        background: 'hsl(var(--muted))',
                        border: 'none',
                        color: 'hsl(var(--muted-foreground))',
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
                    background: 'hsl(var(--secondary))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    padding: '12px 16px',
                    marginBottom: '8px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: 'hsl(var(--primary))', fontWeight: '600', letterSpacing: '0.5px' }}>
                        STL MESH
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: 'hsl(var(--foreground))',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                        {(file.size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveFile('stl', i)}
                      style={{
                        background: 'hsl(var(--muted))',
                        border: 'none',
                        color: 'hsl(var(--muted-foreground))',
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
                  <div style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))', textAlign: 'center', marginTop: '8px' }}>
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
                border: `2px dashed ${dragActive ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s',
                background: dragActive ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                marginBottom: '24px',
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p style={{ fontSize: '16px', fontWeight: '500', margin: '16px 0 8px 0' }}>
                Drop .nii.gz or .stl files here
              </p>
              <p style={{ fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>
                or click to browse
              </p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {canGenerateMesh && (
                <button
                  onClick={onGenerateMesh}
                  style={{
                    padding: '14px 32px',
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
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
                  onClick={onViewStlOnly}
                  style={{
                    padding: '14px 32px',
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
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
                  onClick={onViewHybrid}
                  style={{
                    padding: '14px 32px',
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
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
              onChange={(e) => e.target.files && onFileSelect(e.target.files)}
              style={{ display: 'none' }}
            />
          </>
        )}
      </div>
    </>
  );
}
