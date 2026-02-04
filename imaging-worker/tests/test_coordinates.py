"""
Tests for coordinate system correctness in the imaging pipeline.

These tests verify that:
1. Voxel-to-physical coordinate transforms are correct
2. Mesh vertices match mask positions in physical space
3. No unintended flips or rotations occur
4. Synthetic phantoms produce geometrically correct meshes
"""

import pytest
import numpy as np
import SimpleITK as sitk
import tempfile
from pathlib import Path

from src.surf.marching_cubes import MarchingCubes, Mesh
from src.debug.diagnostics import (
    voxel_to_physical,
    physical_to_voxel,
    compute_image_diagnostics,
    compute_mesh_diagnostics,
    verify_mask_mesh_consistency,
)


class TestVoxelToPhysicalTransform:
    """Test coordinate transform functions."""

    def test_identity_transform(self):
        """With identity direction and zero origin, physical = voxel * spacing."""
        voxel = np.array([10.0, 20.0, 30.0])
        spacing = (1.0, 1.0, 1.0)
        origin = (0.0, 0.0, 0.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        physical = voxel_to_physical(voxel, spacing, origin, direction)
        np.testing.assert_array_almost_equal(physical, voxel)

    def test_spacing_scaling(self):
        """Spacing should scale voxel coordinates."""
        voxel = np.array([10.0, 20.0, 30.0])
        spacing = (2.0, 3.0, 4.0)
        origin = (0.0, 0.0, 0.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        physical = voxel_to_physical(voxel, spacing, origin, direction)
        expected = np.array([20.0, 60.0, 120.0])
        np.testing.assert_array_almost_equal(physical, expected)

    def test_origin_offset(self):
        """Origin should offset physical coordinates."""
        voxel = np.array([0.0, 0.0, 0.0])
        spacing = (1.0, 1.0, 1.0)
        origin = (100.0, 200.0, 300.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        physical = voxel_to_physical(voxel, spacing, origin, direction)
        expected = np.array([100.0, 200.0, 300.0])
        np.testing.assert_array_almost_equal(physical, expected)

    def test_roundtrip_transform(self):
        """physical_to_voxel should be inverse of voxel_to_physical."""
        voxel_original = np.array([15.5, 25.5, 35.5])
        spacing = (0.5, 0.75, 1.0)
        origin = (-50.0, -100.0, -150.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        physical = voxel_to_physical(voxel_original, spacing, origin, direction)
        voxel_recovered = physical_to_voxel(physical, spacing, origin, direction)
        np.testing.assert_array_almost_equal(voxel_recovered, voxel_original)

    def test_rotated_direction(self):
        """Direction matrix should rotate coordinates correctly."""
        voxel = np.array([1.0, 0.0, 0.0])
        spacing = (1.0, 1.0, 1.0)
        origin = (0.0, 0.0, 0.0)
        # 90-degree rotation around z-axis: x -> y, y -> -x
        direction = (0, -1, 0, 1, 0, 0, 0, 0, 1)

        physical = voxel_to_physical(voxel, spacing, origin, direction)
        expected = np.array([0.0, 1.0, 0.0])
        np.testing.assert_array_almost_equal(physical, expected, decimal=5)


class TestMarchingCubesCoordinates:
    """Test that Marching Cubes produces correct physical coordinates."""

    def test_sphere_centroid_identity(self):
        """Sphere mesh centroid should match sphere center in physical space."""
        # Create a 3D array with a sphere
        size = 50
        center_voxel = np.array([25, 25, 25])  # x, y, z in voxel indices
        radius_voxels = 10

        # Create volume (z, y, x order for numpy)
        volume = np.zeros((size, size, size), dtype=np.float32)
        for z in range(size):
            for y in range(size):
                for x in range(size):
                    dist = np.sqrt((x - center_voxel[0])**2 +
                                 (y - center_voxel[1])**2 +
                                 (z - center_voxel[2])**2)
                    if dist <= radius_voxels:
                        volume[z, y, x] = 1.0

        # Use identity transform
        spacing = (1.0, 1.0, 1.0)
        origin = (0.0, 0.0, 0.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        # Extract mesh
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(volume, level=0.5, spacing=spacing,
                                  origin=origin, direction=direction)

        # Mesh centroid should be at center (25, 25, 25)
        mesh_centroid = mesh.vertices.mean(axis=0)
        expected_centroid = center_voxel.astype(float)

        np.testing.assert_array_almost_equal(mesh_centroid, expected_centroid, decimal=1)

    def test_sphere_centroid_with_offset(self):
        """Sphere center with origin offset should be correctly positioned."""
        # Create volume with sphere at center
        size = 40
        center_voxel = np.array([20, 20, 20])
        radius_voxels = 8

        volume = np.zeros((size, size, size), dtype=np.float32)
        for z in range(size):
            for y in range(size):
                for x in range(size):
                    dist = np.sqrt((x - center_voxel[0])**2 +
                                 (y - center_voxel[1])**2 +
                                 (z - center_voxel[2])**2)
                    if dist <= radius_voxels:
                        volume[z, y, x] = 1.0

        # Use non-trivial transform
        spacing = (2.0, 2.0, 2.0)
        origin = (100.0, 200.0, 300.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        # Expected physical centroid
        expected_physical = np.array([
            origin[0] + center_voxel[0] * spacing[0],
            origin[1] + center_voxel[1] * spacing[1],
            origin[2] + center_voxel[2] * spacing[2],
        ])

        # Extract mesh
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(volume, level=0.5, spacing=spacing,
                                  origin=origin, direction=direction)

        mesh_centroid = mesh.vertices.mean(axis=0)
        np.testing.assert_array_almost_equal(mesh_centroid, expected_physical, decimal=1)

    def test_off_center_object_laterality(self):
        """Object on one side should remain on that side in physical space."""
        # Create volume with object on the RIGHT side (negative x in LPS)
        size = 60
        center_voxel = np.array([10, 30, 30])  # x=10, near the "right" at lower x
        radius_voxels = 5

        volume = np.zeros((size, size, size), dtype=np.float32)
        for z in range(size):
            for y in range(size):
                for x in range(size):
                    dist = np.sqrt((x - center_voxel[0])**2 +
                                 (y - center_voxel[1])**2 +
                                 (z - center_voxel[2])**2)
                    if dist <= radius_voxels:
                        volume[z, y, x] = 1.0

        # Transform: center of volume (30, 30, 30) maps to origin
        # So x=10 should be at x = -20 in physical space (LEFT of center in LPS)
        spacing = (1.0, 1.0, 1.0)
        origin = (-30.0, -30.0, -30.0)  # Centers the volume
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(volume, level=0.5, spacing=spacing,
                                  origin=origin, direction=direction)

        mesh_centroid = mesh.vertices.mean(axis=0)

        # x=10 in voxel -> x = -30 + 10*1 = -20 in physical
        # This is LEFT of center (negative x), which in LPS is actually RIGHT hemisphere
        # (LPS: positive x is patient's LEFT)
        assert mesh_centroid[0] < 0, f"Expected negative x (right of center), got {mesh_centroid[0]}"

    def test_anisotropic_spacing(self):
        """Different spacing in each dimension should scale mesh correctly."""
        size = 30
        center = np.array([15, 15, 15])
        radius = 5

        volume = np.zeros((size, size, size), dtype=np.float32)
        for z in range(size):
            for y in range(size):
                for x in range(size):
                    dist = np.sqrt((x - center[0])**2 + (y - center[1])**2 + (z - center[2])**2)
                    if dist <= radius:
                        volume[z, y, x] = 1.0

        # Anisotropic spacing
        spacing = (1.0, 2.0, 3.0)  # x, y, z
        origin = (0.0, 0.0, 0.0)
        direction = (1, 0, 0, 0, 1, 0, 0, 0, 1)

        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(volume, level=0.5, spacing=spacing,
                                  origin=origin, direction=direction)

        # Bounding box should reflect anisotropic scaling
        bbox_min = mesh.vertices.min(axis=0)
        bbox_max = mesh.vertices.max(axis=0)
        bbox_size = bbox_max - bbox_min

        # Expected: sphere with radius 5 voxels, scaled by spacing
        # diameter ~10 voxels, so size = [10*1, 10*2, 10*3] = [10, 20, 30]
        # However, marching cubes surface is slightly outside the voxel boundaries
        # so we expect approximately these values with up to ~20% tolerance
        expected_size = np.array([10.0, 20.0, 30.0])

        # The ratio of size in each dimension should match spacing ratios
        # bbox_size[1] / bbox_size[0] should be ~2 (spacing ratio 2/1)
        # bbox_size[2] / bbox_size[0] should be ~3 (spacing ratio 3/1)
        ratio_yx = bbox_size[1] / bbox_size[0]
        ratio_zx = bbox_size[2] / bbox_size[0]

        # Allow some tolerance due to discrete voxel boundaries
        assert 1.5 < ratio_yx < 2.5, f"Expected ratio ~2, got {ratio_yx}"
        assert 2.5 < ratio_zx < 3.5, f"Expected ratio ~3, got {ratio_zx}"


class TestMaskMeshConsistency:
    """Test that mesh matches the mask it was generated from."""

    def test_centroid_consistency(self):
        """Mesh centroid should be close to mask centroid in physical space."""
        # Create a simple mask with SimpleITK
        size = [50, 50, 50]
        spacing = [1.5, 1.5, 1.5]
        origin = [-37.5, -37.5, -37.5]  # Centers the volume at physical origin
        direction = [1, 0, 0, 0, 1, 0, 0, 0, 1]

        # Create SimpleITK image
        mask = sitk.Image(size, sitk.sitkUInt8)
        mask.SetSpacing(spacing)
        mask.SetOrigin(origin)
        mask.SetDirection(direction)

        # Add a sphere off-center
        center_idx = [15, 25, 25]  # x, y, z in SimpleITK index order
        radius = 8

        for x in range(size[0]):
            for y in range(size[1]):
                for z in range(size[2]):
                    dist = np.sqrt((x - center_idx[0])**2 +
                                 (y - center_idx[1])**2 +
                                 (z - center_idx[2])**2)
                    if dist <= radius:
                        mask.SetPixel([x, y, z], 1)

        # Compute mask diagnostics
        mask_stats = compute_image_diagnostics(mask, name="test_mask", mask_label=1)

        # Generate mesh
        array = sitk.GetArrayFromImage(mask)
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(
            array.astype(np.float32),
            level=0.5,
            spacing=tuple(spacing),
            origin=tuple(origin),
            direction=tuple(direction),
        )

        # Compute mesh diagnostics
        mesh_stats = compute_mesh_diagnostics(mesh.vertices, mesh.faces, name="test_mesh")

        # Verify consistency
        result = verify_mask_mesh_consistency(mask_stats, mesh_stats, tolerance_mm=5.0)

        assert result["passed"], f"Consistency check failed: {result['errors']}"

    def test_bounding_box_overlap(self):
        """Mesh bounding box should overlap with mask bounding box."""
        # Create mask with a cube
        size = [40, 40, 40]
        spacing = [1.0, 1.0, 1.0]
        origin = [0.0, 0.0, 0.0]
        direction = [1, 0, 0, 0, 1, 0, 0, 0, 1]

        mask = sitk.Image(size, sitk.sitkUInt8)
        mask.SetSpacing(spacing)
        mask.SetOrigin(origin)
        mask.SetDirection(direction)

        # Add a cube
        for x in range(10, 30):
            for y in range(10, 30):
                for z in range(10, 30):
                    mask.SetPixel([x, y, z], 1)

        mask_stats = compute_image_diagnostics(mask, name="test_mask", mask_label=1)

        array = sitk.GetArrayFromImage(mask)
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(
            array.astype(np.float32),
            level=0.5,
            spacing=tuple(spacing),
            origin=tuple(origin),
            direction=tuple(direction),
        )

        mesh_stats = compute_mesh_diagnostics(mesh.vertices, mesh.faces, name="test_mesh")

        result = verify_mask_mesh_consistency(mask_stats, mesh_stats, tolerance_mm=5.0)

        assert result["checks"]["bbox_has_overlap"], "Bounding boxes should overlap"


class TestNoUnintendedFlips:
    """Test that laterality and orientation are preserved."""

    def test_x_axis_direction(self):
        """Object at high x-index should have positive x physical coordinate."""
        size = [50, 30, 30]
        spacing = [1.0, 1.0, 1.0]
        origin = [0.0, 0.0, 0.0]
        direction = [1, 0, 0, 0, 1, 0, 0, 0, 1]

        mask = sitk.Image(size, sitk.sitkUInt8)
        mask.SetSpacing(spacing)
        mask.SetOrigin(origin)
        mask.SetDirection(direction)

        # Place sphere at high x
        for x in range(35, 45):
            for y in range(10, 20):
                for z in range(10, 20):
                    mask.SetPixel([x, y, z], 1)

        array = sitk.GetArrayFromImage(mask)
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(
            array.astype(np.float32),
            level=0.5,
            spacing=tuple(spacing),
            origin=tuple(origin),
            direction=tuple(direction),
        )

        centroid = mesh.vertices.mean(axis=0)

        # High x-index (35-45) should give high x physical coordinate
        assert centroid[0] > 30, f"Expected high x, got {centroid[0]}"

    def test_z_axis_direction(self):
        """Object at high z-index should have positive z physical coordinate."""
        size = [30, 30, 50]
        spacing = [1.0, 1.0, 1.0]
        origin = [0.0, 0.0, 0.0]
        direction = [1, 0, 0, 0, 1, 0, 0, 0, 1]

        mask = sitk.Image(size, sitk.sitkUInt8)
        mask.SetSpacing(spacing)
        mask.SetOrigin(origin)
        mask.SetDirection(direction)

        # Place sphere at high z
        for x in range(10, 20):
            for y in range(10, 20):
                for z in range(35, 45):
                    mask.SetPixel([x, y, z], 1)

        array = sitk.GetArrayFromImage(mask)
        mc = MarchingCubes(step_size=1)
        mesh = mc.extract_surface(
            array.astype(np.float32),
            level=0.5,
            spacing=tuple(spacing),
            origin=tuple(origin),
            direction=tuple(direction),
        )

        centroid = mesh.vertices.mean(axis=0)

        # High z-index (35-45) should give high z physical coordinate
        assert centroid[2] > 30, f"Expected high z, got {centroid[2]}"
