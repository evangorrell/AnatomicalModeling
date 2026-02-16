"""Classical segmentation module using Otsu thresholding and morphological operations.

NOTE: The primary pipeline now uses ground truth tumor labels (--labels flag).
This module serves as a fallback when ground truth labels are not available.
"""

import logging
from typing import Tuple, Dict, Optional
from pathlib import Path
import json

import numpy as np
import SimpleITK as sitk
from skimage import filters, morphology
from scipy import ndimage

logger = logging.getLogger(__name__)

# Minimum tumor component size in voxels (removes noise-sized detections)
MIN_TUMOR_COMPONENT_VOXELS = 100


class ClassicalSegmenter:
    """Classical segmentation using Otsu threshold + morphological operations."""

    def __init__(
        self,
        closing_radius: int = 5,  # Increased from 2 - fills larger gaps
        opening_radius: int = 3,  # Increased from 2 - removes more noise
        fill_holes: bool = True,
        largest_component_only: bool = True,
        gaussian_sigma: float = 1.0,  # Smooth before thresholding
        min_object_size: int = 1000,  # Remove tiny disconnected pieces
        tumor_threshold_std: float = 1.0,  # Tumor threshold: mean + X*std (default 1.0 for better sensitivity)
    ):
        """Initialize classical segmenter.

        Args:
            closing_radius: Radius for morphological closing (fills small gaps).
            opening_radius: Radius for morphological opening (removes small objects).
            fill_holes: Whether to fill holes in the mask.
            largest_component_only: Keep only the largest connected component.
            gaussian_sigma: Gaussian smoothing sigma (0 = disabled). Reduces noise.
            min_object_size: Minimum object size in voxels (removes small artifacts).
            tumor_threshold_std: Tumor threshold multiplier. Tumor = voxels > (mean + X*std).
                                 Lower values = more sensitive (captures more of tumor).
                                 Default: 1.0 (was 2.0, which was too aggressive).
        """
        self.closing_radius = closing_radius
        self.opening_radius = opening_radius
        self.fill_holes = fill_holes
        self.largest_component_only = largest_component_only
        self.gaussian_sigma = gaussian_sigma
        self.min_object_size = min_object_size
        self.tumor_threshold_std = tumor_threshold_std

    def segment(
        self, image: sitk.Image, output_dir: Optional[Path] = None
    ) -> Tuple[sitk.Image, Dict]:
        """Segment image using classical methods - multi-class version.
        Creates a multi-label segmentation for surgical planning:
        - Label 0: Background (air/void)
        - Label 1: Brain tissue (normal)
        - Label 2: Tumor (abnormal high-intensity region)

        Pipeline:
        1. Segment whole brain (Otsu threshold)
        2. Segment tumor (mean + 2*std threshold)
        3. Combine into multi-class mask

        Args:
            image: Input SimpleITK image.
            output_dir: Optional directory to save mask and metadata.

        Returns:
            Tuple of (multi-class mask image, metadata dict).
        """
        logger.info("Starting classical multi-class segmentation...")
        logger.info("Goal: Label 0=Background, 1=Brain, 2=Tumor")

        # Convert to numpy for processing
        array = sitk.GetArrayFromImage(image)

        # Improvement: Gaussian smoothing before thresholding
        # This reduces noise and creates smoother boundaries -> fewer fragments
        if self.gaussian_sigma > 0:
            logger.info(f"Applying Gaussian smoothing (sigma={self.gaussian_sigma})...")
            array = ndimage.gaussian_filter(array, sigma=self.gaussian_sigma)
            logger.info("  Smoothing complete (reduces noise and fragmentation)")

        non_zero = array[array > 0]

        logger.info(f"Image stats (non-zero): min={non_zero.min()}, max={non_zero.max()}, mean={non_zero.mean():.2f}, std={non_zero.std():.2f}")

        # STEP 1: Segment whole brain (Otsu)
        logger.info("\n--- Segmenting brain (Otsu) ---")
        brain_threshold = filters.threshold_otsu(non_zero)
        brain_mask = array > brain_threshold
        logger.info(f"Brain Otsu threshold: {brain_threshold:.2f}")
        logger.info(f"Initial brain voxels: {brain_mask.sum():,}")

        # Morphological operations on brain mask
        if self.closing_radius > 0:
            logger.info(f"Morphological closing (radius={self.closing_radius})...")
            footprint = morphology.ball(self.closing_radius)
            brain_mask = morphology.binary_closing(brain_mask, footprint=footprint)
            logger.info(f"After closing: {brain_mask.sum():,} voxels")

        if self.fill_holes:
            logger.info("Filling holes in brain mask...")
            # Fill holes slice by slice in all 3 orientations to catch all ventricles
            # Fill in axial direction (z-axis)
            for i in range(brain_mask.shape[0]):
                brain_mask[i, :, :] = ndimage.binary_fill_holes(brain_mask[i, :, :])
            # Fill in coronal direction (y-axis)
            for i in range(brain_mask.shape[1]):
                brain_mask[:, i, :] = ndimage.binary_fill_holes(brain_mask[:, i, :])
            # Fill in sagittal direction (x-axis)
            for i in range(brain_mask.shape[2]):
                brain_mask[:, :, i] = ndimage.binary_fill_holes(brain_mask[:, :, i])
            logger.info(f"After filling holes (all orientations): {brain_mask.sum():,} voxels")

        if self.opening_radius > 0:
            logger.info(f"Morphological opening (radius={self.opening_radius})...")
            footprint = morphology.ball(self.opening_radius)
            brain_mask = morphology.binary_opening(brain_mask, footprint=footprint)
            logger.info(f"After opening: {brain_mask.sum():,} voxels")

        # Improvement: Remove small disconnected objects (noise/artifacts)
        if self.min_object_size > 0:
            logger.info(f"Removing small objects (< {self.min_object_size} voxels)...")
            brain_mask_bool = brain_mask.astype(bool)
            brain_mask = morphology.remove_small_objects(brain_mask_bool, min_size=self.min_object_size)
            logger.info(f"After removing small objects: {brain_mask.sum():,} voxels")

        if self.largest_component_only:
            logger.info("Extracting largest connected component (brain)...")
            brain_mask = self._extract_largest_component(brain_mask)
            logger.info(f"Brain mask (largest component): {brain_mask.sum():,} voxels")

        # Segment tumor (mean + X*std)
        logger.info(f"\n--- Segmenting tumor (mean + {self.tumor_threshold_std}*std) ---")
        tumor_threshold = non_zero.mean() + self.tumor_threshold_std * non_zero.std()
        tumor_mask = array > tumor_threshold
        logger.info(f"Tumor threshold (mean + {self.tumor_threshold_std}*std): {tumor_threshold:.2f}")
        logger.info(f"Initial tumor voxels: {tumor_mask.sum():,}")

        # Tumor must be within brain
        tumor_mask = np.logical_and(tumor_mask, brain_mask)
        logger.info(f"Tumor within brain: {tumor_mask.sum():,} voxels")

        # Clean up tumor mask (smaller operations)
        if tumor_mask.sum() > 0:
            logger.info("Cleaning tumor mask...")
            # Small morphological operations for tumor
            tumor_footprint = morphology.ball(1)
            tumor_mask = morphology.binary_closing(tumor_mask, footprint=tumor_footprint)
            tumor_mask = morphology.binary_opening(tumor_mask, footprint=tumor_footprint)

            # Keep only reasonably-sized components (remove tiny noise)
            # Keep only reasonably-sized tumor components (remove tiny noise)
            labeled_tumor, num_tumor_components = ndimage.label(tumor_mask)

            if num_tumor_components > 0:
                component_sizes = np.bincount(labeled_tumor.ravel())
                component_sizes[0] = 0  # ignore background label

                keep_labels = np.where(component_sizes >= MIN_TUMOR_COMPONENT_VOXELS)[0]

                if keep_labels.size > 0:
                    tumor_mask = np.isin(labeled_tumor, keep_labels)
                    logger.info(
                        f"Kept {keep_labels.size} tumor components >= {MIN_TUMOR_COMPONENT_VOXELS} voxels "
                        f"(largest={component_sizes[keep_labels].max():,} voxels)"
                    )
                else:
                    tumor_mask = np.zeros_like(tumor_mask, dtype=bool)
                    logger.warning(f"All tumor components were < {MIN_TUMOR_COMPONENT_VOXELS} voxels; tumor mask cleared.")
            else:
                tumor_mask = np.zeros_like(tumor_mask, dtype=bool)
                logger.warning("No tumor components detected after labeling!")

        else:
            logger.warning("No voxels above tumor threshold!")

        # STEP 3: Create multi-class mask
        logger.info("\n--- Creating multi-class mask ---")
        multi_class_mask = np.zeros_like(array, dtype=np.uint8)

        # Label 1: Brain tissue (excluding tumor)
        brain_only = np.logical_and(brain_mask, ~tumor_mask)
        multi_class_mask[brain_only] = 1

        # Label 2: Tumor
        multi_class_mask[tumor_mask] = 2

        logger.info(f"Label 0 (Background): {(multi_class_mask == 0).sum():,} voxels")
        logger.info(f"Label 1 (Brain):      {(multi_class_mask == 1).sum():,} voxels")
        logger.info(f"Label 2 (Tumor):      {(multi_class_mask == 2).sum():,} voxels")

        # Convert to SimpleITK image
        mask_image = sitk.GetImageFromArray(multi_class_mask)
        mask_image.CopyInformation(image)

        # Metadata
        spacing = image.GetSpacing()
        voxel_volume_mm3 = np.prod(spacing)

        brain_volume_mm3 = (multi_class_mask == 1).sum() * voxel_volume_mm3
        tumor_volume_mm3 = (multi_class_mask == 2).sum() * voxel_volume_mm3
        total_volume_mm3 = brain_volume_mm3 + tumor_volume_mm3

        metadata = {
            "method": "classical_multiclass",
            "labels": {
                "0": "background",
                "1": "brain",
                "2": "tumor"
            },
            "brain_threshold": float(brain_threshold),
            "tumor_threshold": float(tumor_threshold),
            "closing_radius": self.closing_radius,
            "opening_radius": self.opening_radius,
            "fill_holes": self.fill_holes,
            "largest_component_only": self.largest_component_only,
            "brain_voxels": int((multi_class_mask == 1).sum()),
            "tumor_voxels": int((multi_class_mask == 2).sum()),
            "total_voxels": int(multi_class_mask.size),
            "brain_volume_mm3": float(brain_volume_mm3),
            "brain_volume_ml": float(brain_volume_mm3 / 1000),
            "tumor_volume_mm3": float(tumor_volume_mm3),
            "tumor_volume_ml": float(tumor_volume_mm3 / 1000),
            "total_volume_ml": float(total_volume_mm3 / 1000),
            "tumor_to_brain_ratio": float(tumor_volume_mm3 / brain_volume_mm3) if brain_volume_mm3 > 0 else 0.0,
        }

        # Save if output directory provided
        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)

            mask_path = output_dir / "mask.nii.gz"
            sitk.WriteImage(mask_image, str(mask_path))
            logger.info(f"\n  Saved multi-class mask to {mask_path}")

            metadata_path = output_dir / "segmentation_metadata.json"
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
            logger.info(f"  Saved metadata to {metadata_path}")

        logger.info("\n" + "="*60)
        logger.info("Multi-class segmentation complete!")
        logger.info("="*60)
        logger.info(f"Brain volume:  {metadata['brain_volume_ml']:.1f} ml")
        logger.info(f"Tumor volume:  {metadata['tumor_volume_ml']:.1f} ml")
        logger.info(f"Tumor/Brain:   {metadata['tumor_to_brain_ratio']*100:.1f}%")
        logger.info("="*60)

        return mask_image, metadata

    def _extract_largest_component(self, binary_mask: np.ndarray) -> np.ndarray:
        """Extract the largest connected component from binary mask.

        Args:
            binary_mask: Binary numpy array.

        Returns:
            Binary mask with only largest component.
        """
        # Label connected components
        labeled, num_components = ndimage.label(binary_mask)

        if num_components == 0:
            logger.warning("No connected components found!")
            return binary_mask

        if num_components == 1:
            logger.info("Only one component found")
            return binary_mask

        # Find largest component
        component_sizes = np.bincount(labeled.ravel())
        # Ignore background (label 0)
        component_sizes[0] = 0
        largest_label = component_sizes.argmax()

        logger.info(
            f"Found {num_components} components, "
            f"largest has {component_sizes[largest_label]:,} voxels"
        )

        # Keep only largest
        return labeled == largest_label
