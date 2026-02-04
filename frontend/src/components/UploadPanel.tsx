import { useState, useRef } from 'react';
import { uploadNiftiWithLabels } from '../api';

interface UploadPanelProps {
  onUploadComplete: (studyId: string) => void;
  hasStudy: boolean;
}

export default function UploadPanel({ onUploadComplete, hasStudy }: UploadPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [labelsFile, setLabelsFile] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const labelsInputRef = useRef<HTMLInputElement>(null);

  const validateNiftiFile = (file: File): boolean => {
    return file.name.endsWith('.nii.gz') || file.name.endsWith('.nii');
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!validateNiftiFile(file)) {
      setError('Image file must be a NIfTI file (.nii or .nii.gz)');
      return;
    }

    setError('');
    setImageFile(file);
  };

  const handleLabelsSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!validateNiftiFile(file)) {
      setError('Labels file must be a NIfTI file (.nii or .nii.gz)');
      return;
    }

    setError('');
    setLabelsFile(file);
  };

  const handleUpload = async () => {
    if (!imageFile || !labelsFile) {
      setError('Please select both image and labels files');
      return;
    }

    setUploading(true);
    setError('');
    setProgress('Uploading files...');

    try {
      setProgress('Processing brain from image, tumor from labels...');
      const response = await uploadNiftiWithLabels(imageFile, labelsFile);
      setProgress('Generating 3D meshes...');

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

  const FileSelector = ({
    label,
    file,
    inputRef,
    onSelect,
    description,
  }: {
    label: string;
    file: File | null;
    inputRef: React.RefObject<HTMLInputElement>;
    onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    description: string;
  }) => (
    <div style={{
      border: '2px dashed #d1d5db',
      borderRadius: '12px',
      padding: '20px',
      textAlign: 'center',
      marginBottom: '16px',
      background: file ? '#f0fdf4' : '#fafafa',
      borderColor: file ? '#86efac' : '#d1d5db',
      transition: 'all 0.2s',
    }}>
      <input
        ref={inputRef}
        type="file"
        accept=".nii,.nii.gz"
        onChange={onSelect}
        style={{ display: 'none' }}
      />
      <div style={{
        fontSize: '14px',
        fontWeight: '600',
        color: '#374151',
        marginBottom: '8px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '12px',
        color: '#6b7280',
        marginBottom: '12px',
      }}>
        {description}
      </div>
      {file ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}>
          <span style={{ color: '#16a34a', fontSize: '18px' }}>&#10003;</span>
          <span style={{
            color: '#15803d',
            fontSize: '14px',
            fontWeight: '500',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {file.name}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (label.includes('Image')) setImageFile(null);
              else setLabelsFile(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 6px',
            }}
          >
            &times;
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            padding: '8px 16px',
            background: '#f3f4f6',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          Choose File
        </button>
      )}
    </div>
  );

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
        padding: '40px',
        maxWidth: '480px',
        width: '90%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: '700',
          color: '#1f2937',
          marginBottom: '12px',
          textAlign: 'center',
        }}>
          Brain Tumor Viewer
        </h1>

        <p style={{
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.6',
          marginBottom: '24px',
          textAlign: 'center',
        }}>
          Upload your MRI image and ground truth tumor labels to generate accurate 3D brain and tumor meshes.
        </p>

        {error && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {uploading ? (
          <div style={{
            textAlign: 'center',
            padding: '32px',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              border: '4px solid #e5e7eb',
              borderTop: '4px solid #2563eb',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px',
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
            <FileSelector
              label="MRI Image File"
              description="The brain MRI scan (.nii.gz)"
              file={imageFile}
              inputRef={imageInputRef}
              onSelect={handleImageSelect}
            />

            <FileSelector
              label="Tumor Labels File"
              description="Ground truth tumor segmentation (.nii.gz)"
              file={labelsFile}
              inputRef={labelsInputRef}
              onSelect={handleLabelsSelect}
            />

            <button
              onClick={handleUpload}
              disabled={!imageFile || !labelsFile}
              style={{
                width: '100%',
                padding: '14px 24px',
                background: imageFile && labelsFile ? '#2563eb' : '#9ca3af',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: imageFile && labelsFile ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                boxShadow: imageFile && labelsFile
                  ? '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                  : 'none',
                marginTop: '8px',
              }}
              onMouseEnter={(e) => {
                if (imageFile && labelsFile) {
                  e.currentTarget.style.background = '#1d4ed8';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (imageFile && labelsFile) {
                  e.currentTarget.style.background = '#2563eb';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              Generate 3D Model
            </button>

            <p style={{
              fontSize: '12px',
              color: '#9ca3af',
              textAlign: 'center',
              marginTop: '16px',
            }}>
              Brain mesh will be generated from the image file.<br/>
              Tumor mesh will be extracted from the labels file.
            </p>
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
