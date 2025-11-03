"""Resampling module for isotropic volume generation."""

import logging
from typing import Tuple, Optional, Dict
from pathlib import Path
import json

import numpy as np
import SimpleITK as sitk

logger = logging.getLogger(__name__)


class VolumeResampler:
    """Handles resampling of medical images to isotropic spacing."""

    def __init__(
        self,
        target_spacing: Optional[Tuple[float, float, float]] = None,
        interpolation: str = "linear",
    ):
        """Initialize volume resampler.

        Args:
            target_spacing: Target isotropic spacing in mm. If None, uses min of current spacing.
            interpolation: Interpolation method ('linear', 'bspline', 'nearest').
        """
        self.target_spacing = target_spacing
        self.interpolation = interpolation
        self._interpolator_map = {
            "linear": sitk.sitkLinear,
            "bspline": sitk.sitkBSpline,
            "nearest": sitk.sitkNearestNeighbor,
        }

    def resample_to_isotropic(
        self, image: sitk.Image, output_dir: Optional[Path] = None
    ) -> Tuple[sitk.Image, Dict]:
        """Resample image to isotropic spacing.

        Args:
            image: Input SimpleITK image.
            output_dir: Optional directory to save resampled volume.

        Returns:
            Tuple of (resampled image, transform metadata).
        """
        original_spacing = np.array(image.GetSpacing())
        original_size = np.array(image.GetSize())

        logger.info(f"Original spacing: {original_spacing}")
        logger.info(f"Original size: {original_size}")

        # Determine target isotropic spacing
        if self.target_spacing is None:
            target_spacing = np.min(original_spacing)
            logger.info(f"Auto-selected isotropic spacing: {target_spacing} mm")
        else:
            target_spacing = self.target_spacing[0]  # Should be same for all dims
            logger.info(f"Using specified isotropic spacing: {target_spacing} mm")

        target_spacing_vec = np.array([target_spacing] * 3)

        # Calculate new size to maintain physical extent
        scale_factors = original_spacing / target_spacing_vec
        new_size = (original_size * scale_factors).astype(int)

        logger.info(f"Target spacing: {target_spacing_vec}")
        logger.info(f"Target size: {new_size}")
        logger.info(f"Scale factors: {scale_factors}")

        # Set up resampler
        resampler = sitk.ResampleImageFilter()
        resampler.SetOutputSpacing(target_spacing_vec.tolist())
        resampler.SetSize(new_size.tolist())
        resampler.SetOutputDirection(image.GetDirection())
        resampler.SetOutputOrigin(image.GetOrigin())
        resampler.SetTransform(sitk.Transform())
        resampler.SetDefaultPixelValue(image.GetPixelIDValue())

        # Set interpolator
        interpolator = self._interpolator_map.get(
            self.interpolation, sitk.sitkLinear
        )
        resampler.SetInterpolator(interpolator)

        logger.info(f"Resampling with {self.interpolation} interpolation...")
        resampled = resampler.Execute(image)

        # Verify output
        logger.info(f"Resampled size: {resampled.GetSize()}")
        logger.info(f"Resampled spacing: {resampled.GetSpacing()}")

        # Generate transform metadata
        metadata = {
            "original_spacing": original_spacing.tolist(),
            "original_size": original_size.tolist(),
            "target_spacing": target_spacing_vec.tolist(),
            "target_size": new_size.tolist(),
            "scale_factors": scale_factors.tolist(),
            "interpolation": self.interpolation,
            "origin": list(image.GetOrigin()),
            "direction": list(image.GetDirection()),
            "physical_size_mm": (original_spacing * original_size).tolist(),
        }

        # Save if output directory provided
        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)

            nifti_path = output_dir / "volume_isotropic.nii.gz"
            sitk.WriteImage(resampled, str(nifti_path))
            logger.info(f"Saved resampled volume to {nifti_path}")

            metadata_path = output_dir / "resample_metadata.json"
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
            logger.info(f"Saved resample metadata to {metadata_path}")

        return resampled, metadata

    def resample_with_reference(
        self, image: sitk.Image, reference: sitk.Image
    ) -> sitk.Image:
        """Resample image to match reference image geometry.

        Useful for resampling masks to match volume spacing.

        Args:
            image: Image to resample.
            reference: Reference image with target geometry.

        Returns:
            Resampled image matching reference geometry.
        """
        resampler = sitk.ResampleImageFilter()
        resampler.SetReferenceImage(reference)
        resampler.SetInterpolator(sitk.sitkNearestNeighbor)  # For masks
        resampler.SetDefaultPixelValue(0)
        resampler.SetTransform(sitk.Transform())

        resampled = resampler.Execute(image)
        logger.info(
            f"Resampled to reference: size={resampled.GetSize()}, "
            f"spacing={resampled.GetSpacing()}"
        )

        return resampled

    def verify_isotropic(self, image: sitk.Image, tolerance: float = 1e-3) -> bool:
        """Verify that an image has isotropic spacing within tolerance.

        Args:
            image: Image to check.
            tolerance: Tolerance for spacing difference (mm).

        Returns:
            True if spacing is isotropic within tolerance.
        """
        spacing = np.array(image.GetSpacing())
        min_spacing = np.min(spacing)
        max_spacing = np.max(spacing)
        diff = max_spacing - min_spacing

        is_isotropic = diff <= tolerance

        logger.info(
            f"Spacing check: {spacing}, "
            f"diff={diff:.6f}, isotropic={is_isotropic} (tol={tolerance})"
        )

        return is_isotropic

    def calculate_optimal_spacing(
        self, image: sitk.Image, max_size_voxels: int = 512
    ) -> float:
        """Calculate optimal isotropic spacing to limit volume size.

        Args:
            image: Input image.
            max_size_voxels: Maximum size along any dimension.

        Returns:
            Optimal spacing in mm.
        """
        spacing = np.array(image.GetSpacing())
        size = np.array(image.GetSize())

        # Physical extent
        extent = spacing * size

        # Required spacing to meet size constraint
        required_spacing = extent / max_size_voxels

        # Use maximum to ensure no dimension exceeds limit
        optimal_spacing = np.max(required_spacing)

        logger.info(
            f"Optimal spacing for max size {max_size_voxels}: "
            f"{optimal_spacing:.3f} mm"
        )

        return float(optimal_spacing)
