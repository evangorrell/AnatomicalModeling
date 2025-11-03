"""Tests for DICOM ingestion module."""

import pytest
import tempfile
from pathlib import Path
import numpy as np
import SimpleITK as sitk
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
import zipfile

from src.io.dicom_ingest import DICOMIngestor


@pytest.fixture
def temp_dir():
    """Create temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def synthetic_dicom_series(temp_dir):
    """Create synthetic DICOM series for testing."""
    num_slices = 10
    size = (64, 64)
    spacing = (1.5, 1.5, 3.0)  # Non-isotropic

    dicom_files = []
    series_uid = pydicom.uid.generate_uid()

    for i in range(num_slices):
        # Create synthetic image data
        image_data = np.random.randint(0, 4096, size, dtype=np.uint16)

        # Create DICOM dataset
        file_meta = FileMetaDataset()
        file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian

        ds = FileDataset(
            None, {}, file_meta=file_meta, preamble=b"\0" * 128
        )

        # Set required DICOM tags
        ds.PatientName = "Test^Patient"
        ds.PatientID = "TEST001"
        ds.SeriesInstanceUID = series_uid
        ds.SOPInstanceUID = pydicom.uid.generate_uid()
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.4"  # MR Image Storage
        ds.Modality = "MR"
        ds.SeriesDescription = "Test Series"
        ds.InstanceNumber = i + 1

        # Image dimensions
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows = size[0]
        ds.Columns = size[1]
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0

        # Spacing
        ds.PixelSpacing = [spacing[0], spacing[1]]
        ds.SliceThickness = spacing[2]

        # Position and orientation
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]  # Axial
        ds.ImagePositionPatient = [0, 0, i * spacing[2]]  # Move along Z

        # Image data
        ds.PixelData = image_data.tobytes()

        # Save
        filepath = temp_dir / f"slice_{i:03d}.dcm"
        ds.save_as(filepath)
        dicom_files.append(filepath)

    return dicom_files, series_uid, spacing


def test_find_dicom_files(temp_dir, synthetic_dicom_series):
    """Test finding DICOM files in directory."""
    dicom_files, _, _ = synthetic_dicom_series

    ingestor = DICOMIngestor()
    found_files = ingestor._find_dicom_files(temp_dir)

    assert len(found_files) == len(dicom_files)
    assert all(f in found_files for f in dicom_files)


def test_group_by_series(temp_dir, synthetic_dicom_series):
    """Test grouping DICOM files by series."""
    dicom_files, series_uid, _ = synthetic_dicom_series

    ingestor = DICOMIngestor(deidentify=False)
    series_groups = ingestor._group_by_series(dicom_files)

    assert len(series_groups) == 1
    assert series_uid in series_groups
    assert len(series_groups[series_uid]) == len(dicom_files)


def test_sort_slices(temp_dir, synthetic_dicom_series):
    """Test sorting slices by position."""
    dicom_files, _, spacing = synthetic_dicom_series

    # Shuffle files
    import random
    shuffled = dicom_files.copy()
    random.shuffle(shuffled)

    ingestor = DICOMIngestor(deidentify=False)
    sorted_files = ingestor._sort_slices(shuffled)

    # Verify order by checking positions
    positions = []
    for f in sorted_files:
        ds = pydicom.dcmread(f, stop_before_pixels=True)
        positions.append(ds.ImagePositionPatient[2])

    # Should be monotonically increasing
    assert positions == sorted(positions)
    assert len(positions) == len(dicom_files)


def test_spacing_calculation(temp_dir, synthetic_dicom_series):
    """Test that spacing is correctly extracted."""
    dicom_files, _, expected_spacing = synthetic_dicom_series

    ingestor = DICOMIngestor(deidentify=False)
    sorted_files = ingestor._sort_slices(dicom_files)
    image = ingestor._load_as_sitk_image(sorted_files)

    spacing = np.array(image.GetSpacing())
    expected = np.array(expected_spacing)

    # Check spacing (within floating point tolerance)
    np.testing.assert_allclose(spacing, expected, rtol=1e-5)


def test_process_zip(temp_dir, synthetic_dicom_series):
    """Test full ZIP processing pipeline."""
    dicom_files, _, spacing = synthetic_dicom_series

    # Create ZIP file
    zip_path = temp_dir / "test_series.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for f in dicom_files:
            zf.write(f, f.name)

    # Process ZIP
    output_dir = temp_dir / "output"
    ingestor = DICOMIngestor(deidentify=False)
    image, metadata, nifti_path = ingestor.process_zip(zip_path, output_dir)

    # Verify outputs
    assert nifti_path.exists()
    assert (output_dir / "metadata.json").exists()

    # Check image properties
    assert image.GetSize()[2] == len(dicom_files)
    assert image.GetDimension() == 3

    # Check metadata
    assert metadata["slice_count"] == len(dicom_files)
    assert len(metadata["spacing"]) == 3
    assert len(metadata["size"]) == 3
    assert "series_uid" in metadata


def test_deidentification(temp_dir, synthetic_dicom_series):
    """Test that de-identification removes sensitive tags."""
    dicom_files, _, _ = synthetic_dicom_series

    ingestor = DICOMIngestor(deidentify=True)
    deidentified = ingestor._deidentify_files(dicom_files)

    # Check that sensitive tags are removed
    for f in deidentified:
        ds = pydicom.dcmread(f)
        assert ds.PatientName == "ANONYMOUS"
        assert ds.PatientID == "ANON"
        assert not hasattr(ds, "PatientBirthDate")


def test_transform_consistency(temp_dir, synthetic_dicom_series):
    """Test that transform matrix is preserved correctly."""
    dicom_files, _, _ = synthetic_dicom_series

    ingestor = DICOMIngestor(deidentify=False)
    sorted_files = ingestor._sort_slices(dicom_files)
    image = ingestor._load_as_sitk_image(sorted_files)

    # Check that direction matrix is identity (axial orientation)
    direction = np.array(image.GetDirection()).reshape(3, 3)
    expected = np.eye(3)
    np.testing.assert_allclose(direction, expected, atol=1e-3)


def test_image_count(temp_dir, synthetic_dicom_series):
    """Test that all images are loaded."""
    dicom_files, _, _ = synthetic_dicom_series
    expected_count = len(dicom_files)

    ingestor = DICOMIngestor(deidentify=False)
    sorted_files = ingestor._sort_slices(dicom_files)
    image = ingestor._load_as_sitk_image(sorted_files)

    assert image.GetSize()[2] == expected_count
