"""Tests for volume resampling module."""

import pytest
import numpy as np
import SimpleITK as sitk
from pathlib import Path
import tempfile

from src.prep.resample import VolumeResampler


@pytest.fixture
def temp_dir():
    """Create temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def non_isotropic_volume():
    """Create a synthetic non-isotropic 3D volume."""
    size = (64, 64, 32)
    spacing = (1.0, 1.0, 3.0)  # Non-isotropic: 1x1x3 mm

    # Create phantom with known geometry
    image = sitk.GetImageFromArray(np.random.rand(*size[::-1]).astype(np.float32))
    image.SetSpacing(spacing)
    image.SetOrigin((0, 0, 0))
    image.SetDirection(np.eye(3).flatten().tolist())

    return image


@pytest.fixture
def isotropic_volume():
    """Create a synthetic isotropic 3D volume."""
    size = (64, 64, 64)
    spacing = (1.0, 1.0, 1.0)

    image = sitk.GetImageFromArray(np.random.rand(*size[::-1]).astype(np.float32))
    image.SetSpacing(spacing)
    image.SetOrigin((0, 0, 0))
    image.SetDirection(np.eye(3).flatten().tolist())

    return image


def test_resample_to_isotropic_auto(non_isotropic_volume):
    """Test automatic isotropic resampling."""
    resampler = VolumeResampler()
    resampled, metadata = resampler.resample_to_isotropic(non_isotropic_volume)

    # Check that spacing is now isotropic
    spacing = np.array(resampled.GetSpacing())
    assert np.allclose(spacing[0], spacing[1], rtol=1e-5)
    assert np.allclose(spacing[1], spacing[2], rtol=1e-5)

    # Should use minimum original spacing (1.0 mm)
    assert np.allclose(spacing[0], 1.0, rtol=1e-5)

    # Check metadata
    assert "original_spacing" in metadata
    assert "target_spacing" in metadata
    assert metadata["interpolation"] == "linear"


def test_resample_to_isotropic_specified(non_isotropic_volume):
    """Test resampling with specified target spacing."""
    target = (0.5, 0.5, 0.5)
    resampler = VolumeResampler(target_spacing=target)
    resampled, metadata = resampler.resample_to_isotropic(non_isotropic_volume)

    # Check that spacing matches target
    spacing = np.array(resampled.GetSpacing())
    assert np.allclose(spacing, 0.5, rtol=1e-5)

    # Size should increase proportionally
    original_size = np.array(non_isotropic_volume.GetSize())
    new_size = np.array(resampled.GetSize())
    original_spacing = np.array(non_isotropic_volume.GetSpacing())

    expected_size = (original_size * original_spacing / 0.5).astype(int)
    np.testing.assert_array_almost_equal(new_size, expected_size, decimal=0)


def test_physical_size_preserved(non_isotropic_volume):
    """Test that physical extent is preserved after resampling."""
    resampler = VolumeResampler()
    resampled, _ = resampler.resample_to_isotropic(non_isotropic_volume)

    # Calculate physical extents
    original_spacing = np.array(non_isotropic_volume.GetSpacing())
    original_size = np.array(non_isotropic_volume.GetSize())
    original_extent = original_spacing * original_size

    new_spacing = np.array(resampled.GetSpacing())
    new_size = np.array(resampled.GetSize())
    new_extent = new_spacing * new_size

    # Extents should match within tolerance
    np.testing.assert_allclose(original_extent, new_extent, rtol=1e-2)


def test_interpolation_methods(non_isotropic_volume):
    """Test different interpolation methods."""
    methods = ["linear", "bspline", "nearest"]

    for method in methods:
        resampler = VolumeResampler(interpolation=method)
        resampled, metadata = resampler.resample_to_isotropic(non_isotropic_volume)

        assert resampled is not None
        assert metadata["interpolation"] == method


def test_verify_isotropic(isotropic_volume, non_isotropic_volume):
    """Test isotropic verification."""
    resampler = VolumeResampler()

    # Isotropic volume should pass
    assert resampler.verify_isotropic(isotropic_volume)

    # Non-isotropic should fail
    assert not resampler.verify_isotropic(non_isotropic_volume)


def test_verify_isotropic_tolerance(non_isotropic_volume):
    """Test isotropic verification with tolerance."""
    resampler = VolumeResampler()

    # With large tolerance, should pass
    assert resampler.verify_isotropic(non_isotropic_volume, tolerance=10.0)

    # With small tolerance, should fail
    assert not resampler.verify_isotropic(non_isotropic_volume, tolerance=1e-6)


def test_resample_with_reference(non_isotropic_volume, isotropic_volume):
    """Test resampling to match reference geometry."""
    resampler = VolumeResampler()
    resampled = resampler.resample_with_reference(
        non_isotropic_volume, isotropic_volume
    )

    # Should match reference geometry
    assert resampled.GetSize() == isotropic_volume.GetSize()
    assert resampled.GetSpacing() == isotropic_volume.GetSpacing()
    assert resampled.GetOrigin() == isotropic_volume.GetOrigin()


def test_calculate_optimal_spacing(non_isotropic_volume):
    """Test optimal spacing calculation."""
    resampler = VolumeResampler()

    # Calculate optimal spacing for max dimension of 128
    optimal_spacing = resampler.calculate_optimal_spacing(
        non_isotropic_volume, max_size_voxels=128
    )

    # Resample with this spacing
    resampler_opt = VolumeResampler(target_spacing=(optimal_spacing,) * 3)
    resampled, _ = resampler_opt.resample_to_isotropic(non_isotropic_volume)

    # Check that max dimension is at or below limit
    assert max(resampled.GetSize()) <= 128


def test_save_output(non_isotropic_volume, temp_dir):
    """Test saving resampled volume and metadata."""
    resampler = VolumeResampler()
    resampled, metadata = resampler.resample_to_isotropic(
        non_isotropic_volume, output_dir=temp_dir
    )

    # Check files exist
    assert (temp_dir / "volume_isotropic.nii.gz").exists()
    assert (temp_dir / "resample_metadata.json").exists()

    # Load and verify
    loaded = sitk.ReadImage(str(temp_dir / "volume_isotropic.nii.gz"))
    assert loaded.GetSize() == resampled.GetSize()
    assert loaded.GetSpacing() == resampled.GetSpacing()


def test_origin_preservation(non_isotropic_volume):
    """Test that origin is preserved during resampling."""
    # Set non-zero origin
    non_isotropic_volume.SetOrigin((10.0, 20.0, 30.0))

    resampler = VolumeResampler()
    resampled, metadata = resampler.resample_to_isotropic(non_isotropic_volume)

    # Origin should be preserved
    assert resampled.GetOrigin() == non_isotropic_volume.GetOrigin()
    assert metadata["origin"] == list(non_isotropic_volume.GetOrigin())


def test_direction_preservation(non_isotropic_volume):
    """Test that direction matrix is preserved during resampling."""
    # Set custom direction (e.g., oblique)
    direction = [0.866, 0.5, 0, -0.5, 0.866, 0, 0, 0, 1]  # 30° rotation in XY
    non_isotropic_volume.SetDirection(direction)

    resampler = VolumeResampler()
    resampled, metadata = resampler.resample_to_isotropic(non_isotropic_volume)

    # Direction should be preserved
    assert resampled.GetDirection() == non_isotropic_volume.GetDirection()
    assert metadata["direction"] == list(non_isotropic_volume.GetDirection())
