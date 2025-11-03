"""DICOM ingestion module: read, de-identify, group, and sort DICOM series."""

import logging
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import zipfile
import tempfile
import shutil
import json

import numpy as np
import pydicom
from pydicom.dataset import Dataset
import SimpleITK as sitk

logger = logging.getLogger(__name__)


class DICOMIngestor:
    """Handles DICOM file ingestion, de-identification, grouping, and sorting."""

    # Tags to remove/anonymize for de-identification
    DEIDENTIFY_TAGS = [
        "PatientName",
        "PatientID",
        "PatientBirthDate",
        "PatientSex",
        "PatientAge",
        "InstitutionName",
        "InstitutionAddress",
        "ReferringPhysicianName",
        "PerformingPhysicianName",
        "OperatorsName",
        "StudyDate",
        "StudyTime",
        "SeriesDate",
        "SeriesTime",
        "AcquisitionDate",
        "AcquisitionTime",
    ]

    def __init__(self, deidentify: bool = True):
        """Initialize DICOM ingestor.

        Args:
            deidentify: Whether to de-identify DICOM files.
        """
        self.deidentify = deidentify

    def process_zip(
        self, zip_path: Path, output_dir: Path
    ) -> Tuple[sitk.Image, Dict, Path]:
        """Process a ZIP file containing DICOM series.

        Args:
            zip_path: Path to ZIP file containing DICOM files.
            output_dir: Directory to write output files.

        Returns:
            Tuple of (SimpleITK image, metadata dict, NIfTI path).
        """
        output_dir.mkdir(parents=True, exist_ok=True)

        # Extract ZIP to temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            logger.info(f"Extracting ZIP to {temp_path}")
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_path)

            # Find all DICOM files
            dicom_files = self._find_dicom_files(temp_path)
            logger.info(f"Found {len(dicom_files)} DICOM files")

            if not dicom_files:
                raise ValueError("No DICOM files found in ZIP")

            # Group by series
            series_groups = self._group_by_series(dicom_files)
            logger.info(f"Found {len(series_groups)} series")

            if len(series_groups) == 0:
                raise ValueError("No valid series found")

            # Use the series with the most slices
            series_uid, series_files = max(series_groups.items(), key=lambda x: len(x[1]))
            logger.info(f"Using series {series_uid} with {len(series_files)} slices")

            # Sort slices by position
            sorted_files = self._sort_slices(series_files)

            # Load as SimpleITK image
            image = self._load_as_sitk_image(sorted_files)

            # Generate metadata
            metadata = self._generate_metadata(sorted_files[0], image, len(sorted_files))

            # Save as NIfTI
            nifti_path = output_dir / "volume.nii.gz"
            sitk.WriteImage(image, str(nifti_path))
            logger.info(f"Saved volume to {nifti_path}")

            # Save metadata
            metadata_path = output_dir / "metadata.json"
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
            logger.info(f"Saved metadata to {metadata_path}")

            return image, metadata, nifti_path

    def _find_dicom_files(self, directory: Path) -> List[Path]:
        """Recursively find all DICOM files in directory."""
        dicom_files = []
        for path in directory.rglob("*"):
            if path.is_file() and self._is_dicom_file(path):
                dicom_files.append(path)
        return dicom_files

    def _is_dicom_file(self, path: Path) -> bool:
        """Check if file is a valid DICOM file."""
        try:
            pydicom.dcmread(path, stop_before_pixels=True)
            return True
        except Exception:
            return False

    def _group_by_series(self, dicom_files: List[Path]) -> Dict[str, List[Path]]:
        """Group DICOM files by SeriesInstanceUID."""
        series_groups = {}
        for path in dicom_files:
            try:
                ds = pydicom.dcmread(path, stop_before_pixels=True)
                series_uid = ds.SeriesInstanceUID
                if series_uid not in series_groups:
                    series_groups[series_uid] = []
                series_groups[series_uid].append(path)
            except Exception as e:
                logger.warning(f"Failed to read {path}: {e}")
        return series_groups

    def _sort_slices(self, dicom_files: List[Path]) -> List[Path]:
        """Sort DICOM slices by ImagePositionPatient along the slice normal.

        Uses ImageOrientationPatient to compute the slice normal direction,
        then projects ImagePositionPatient onto this normal to determine slice order.
        """
        # Read first file to get orientation
        ds0 = pydicom.dcmread(dicom_files[0], stop_before_pixels=True)

        if not hasattr(ds0, "ImageOrientationPatient"):
            logger.warning("No ImageOrientationPatient found, sorting by InstanceNumber")
            return self._sort_by_instance_number(dicom_files)

        # Compute slice normal from ImageOrientationPatient
        orientation = np.array(ds0.ImageOrientationPatient, dtype=float)
        row_cosine = orientation[:3]
        col_cosine = orientation[3:]
        slice_normal = np.cross(row_cosine, col_cosine)
        slice_normal = slice_normal / np.linalg.norm(slice_normal)

        # Compute position along normal for each slice
        positions = []
        for path in dicom_files:
            try:
                ds = pydicom.dcmread(path, stop_before_pixels=True)
                if hasattr(ds, "ImagePositionPatient"):
                    pos = np.array(ds.ImagePositionPatient, dtype=float)
                    position_along_normal = np.dot(pos, slice_normal)
                    positions.append((position_along_normal, path))
                else:
                    # Fallback to instance number
                    instance = getattr(ds, "InstanceNumber", 0)
                    positions.append((instance, path))
            except Exception as e:
                logger.warning(f"Failed to read position from {path}: {e}")
                positions.append((0, path))

        # Sort by position
        positions.sort(key=lambda x: x[0])
        sorted_files = [path for _, path in positions]

        logger.info(
            f"Sorted {len(sorted_files)} slices along normal direction "
            f"(range: {positions[0][0]:.2f} to {positions[-1][0]:.2f})"
        )

        return sorted_files

    def _sort_by_instance_number(self, dicom_files: List[Path]) -> List[Path]:
        """Fallback: sort by InstanceNumber."""
        files_with_numbers = []
        for path in dicom_files:
            try:
                ds = pydicom.dcmread(path, stop_before_pixels=True)
                instance = getattr(ds, "InstanceNumber", 0)
                files_with_numbers.append((instance, path))
            except Exception as e:
                logger.warning(f"Failed to read {path}: {e}")
                files_with_numbers.append((0, path))

        files_with_numbers.sort(key=lambda x: x[0])
        return [path for _, path in files_with_numbers]

    def _load_as_sitk_image(self, sorted_files: List[Path]) -> sitk.Image:
        """Load sorted DICOM files as a SimpleITK 3D image."""
        # De-identify if requested
        if self.deidentify:
            sorted_files = self._deidentify_files(sorted_files)

        # Use SimpleITK's ImageSeriesReader for proper metadata handling
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames([str(f) for f in sorted_files])
        reader.MetaDataDictionaryArrayUpdateOn()
        reader.LoadPrivateTagsOn()

        image = reader.Execute()
        logger.info(
            f"Loaded 3D volume: size={image.GetSize()}, "
            f"spacing={image.GetSpacing()}, origin={image.GetOrigin()}"
        )

        return image

    def _deidentify_files(self, dicom_files: List[Path]) -> List[Path]:
        """De-identify DICOM files by removing sensitive tags.

        Creates temporary de-identified copies.
        """
        temp_dir = Path(tempfile.mkdtemp())
        deidentified_files = []

        for i, path in enumerate(dicom_files):
            try:
                ds = pydicom.dcmread(path)

                # Remove sensitive tags
                for tag in self.DEIDENTIFY_TAGS:
                    if hasattr(ds, tag):
                        delattr(ds, tag)

                # Anonymize IDs
                ds.PatientID = "ANON"
                ds.PatientName = "ANONYMOUS"

                # Save to temp file
                temp_file = temp_dir / f"slice_{i:04d}.dcm"
                ds.save_as(temp_file)
                deidentified_files.append(temp_file)
            except Exception as e:
                logger.warning(f"Failed to de-identify {path}: {e}")
                deidentified_files.append(path)

        logger.info(f"De-identified {len(deidentified_files)} files")
        return deidentified_files

    def _generate_metadata(
        self, sample_file: Path, image: sitk.Image, slice_count: int
    ) -> Dict:
        """Generate metadata from DICOM and SimpleITK image."""
        ds = pydicom.dcmread(sample_file, stop_before_pixels=True)

        metadata = {
            "slice_count": slice_count,
            "size": list(image.GetSize()),
            "spacing": list(image.GetSpacing()),
            "origin": list(image.GetOrigin()),
            "direction": list(image.GetDirection()),
            "modality": getattr(ds, "Modality", "UNKNOWN"),
            "series_description": getattr(ds, "SeriesDescription", ""),
            "series_uid": getattr(ds, "SeriesInstanceUID", ""),
            "manufacturer": getattr(ds, "Manufacturer", ""),
            "field_strength": getattr(ds, "MagneticFieldStrength", None),
        }

        # Add orientation info if available
        if hasattr(ds, "ImageOrientationPatient"):
            orientation = np.array(ds.ImageOrientationPatient, dtype=float)
            row_cosine = orientation[:3]
            col_cosine = orientation[3:]
            slice_normal = np.cross(row_cosine, col_cosine)
            metadata["image_orientation_patient"] = orientation.tolist()
            metadata["slice_normal"] = slice_normal.tolist()

        return metadata
