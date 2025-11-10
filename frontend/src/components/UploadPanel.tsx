import { useState, useRef } from 'react';
import { uploadNifti } from '../api';

interface UploadPanelProps {
  onUploadComplete: (studyId: string) => void;
  hasStudy: boolean;
}

export default function UploadPanel({ onUploadComplete, hasStudy }: UploadPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0]; // For now, handle single file

    // Validate file type
    if (!file.name.endsWith('.nii.gz') && !file.name.endsWith('.nii')) {
      setError('Please select a valid NIfTI file (.nii or .nii.gz)');
      return;
    }

    setUploading(true);
    setError('');
    setProgress('Uploading NIfTI file...');

    try {
      const response = await uploadNifti(file);
      setProgress('Segmentation complete! Generating 3D meshes...');

      // Wait a moment for meshes to be available
      setTimeout(() => {
        setProgress('Success! Loading viewer...');
        onUploadComplete(response.studyId);
      }, 1000);

    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err.response?.data?.message || err.message || 'Upload failed. Please try again.');
      setUploading(false);
      setProgress('');
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: hasStudy ? 'rgba(245, 247, 251, 0.95)' : '#f5f7fb',
      backdropFilter: hasStudy ? 'blur(8px)' : 'none',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '48px',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '700',
          color: '#1f2937',
          marginBottom: '16px',
          textAlign: 'center',
        }}>
          MRI to 3D Mesh Viewer
        </h1>

        <p style={{
          fontSize: '15px',
          color: '#6b7280',
          lineHeight: '1.6',
          marginBottom: '32px',
          textAlign: 'center',
        }}>
          Upload one or more .nii.gz volumes. We'll run segmentation and generate brain and tumor meshes you can explore in 3D.
        </p>

        {error && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '14px',
          }}>
            {error}
          </div>
        )}

        {uploading ? (
          <div style={{
            textAlign: 'center',
            padding: '24px',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #e5e7eb',
              borderTop: '4px solid #2563eb',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }} />
            <p style={{
              color: '#2563eb',
              fontSize: '15px',
              fontWeight: '500',
            }}>
              {progress}
            </p>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".nii,.nii.gz"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              multiple={false}
            />
            <button
              onClick={handleButtonClick}
              style={{
                width: '100%',
                padding: '16px 24px',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#1d4ed8';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 8px -1px rgba(37, 99, 235, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#2563eb';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(37, 99, 235, 0.2)';
              }}
            >
              Upload NIfTI (.nii.gz)
            </button>
          </>
        )}

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
