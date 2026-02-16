"""
Diagnostic utilities for coordinate system verification.

This module provides tools to validate the correctness of coordinate
transforms throughout the imaging pipeline, helping identify orientation
and positioning bugs.

COORDINATE CONVENTIONS USED:
- SimpleITK: LPS (Left-Posterior-Superior) coordinate system
  - X increases towards patient's left
  - Y increases towards patient's posterior
  - Z increases towards patient's superior
  - Spacing/Origin/Size all use (x, y, z) order

- NumPy arrays from GetArrayFromImage: (z, y, x) order
  - This is the reverse of SimpleITK indexing

- Mesh vertices: LPS physical coordinates (same as SimpleITK)
"""

import logging
import json
from pathlib import Path
from typing import Dict, Optional, Tuple, Any
import numpy as np
import SimpleITK as sitk

logger = logging.getLogger(__name__)


def compute_image_diagnostics(
    image: sitk.Image,
    name: str = "image",
    mask_label: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Compute comprehensive diagnostics for a SimpleITK image.

    Args:
        image: SimpleITK image to analyze
        name: Descriptive name for logging
        mask_label: If provided, compute stats for this label value only

    Returns:
        Dictionary with diagnostic information
    """
    array = sitk.GetArrayFromImage(image)
    spacing = image.GetSpacing()
    origin = image.GetOrigin()
    direction = image.GetDirection()
    size = image.GetSize()

    # Basic image info
    diagnostics = {
        "name": name,
        "size_xyz": list(size),
        "spacing_xyz_mm": list(spacing),
        "origin_xyz_mm": list(origin),
        "direction_matrix": list(direction),
        "numpy_shape_zyx": list(array.shape),
        "dtype": str(array.dtype),
        "voxel_volume_mm3": float(np.prod(spacing)),
    }

    # For masks, compute label statistics
    if mask_label is not None:
        mask_binary = (array == mask_label)
        if mask_binary.sum() > 0:
            diagnostics.update(_compute_mask_stats(
                mask_binary, spacing, origin, direction, name=f"{name}_label{mask_label}"
            ))
    elif np.issubdtype(array.dtype, np.integer):
        # For integer arrays, assume it's a label image
        unique_labels = np.unique(array)
        diagnostics["unique_labels"] = unique_labels.tolist()
        diagnostics["label_counts"] = {
            int(label): int((array == label).sum()) for label in unique_labels
        }
    else:
        # For float arrays, compute value statistics
        diagnostics["min_value"] = float(array.min())
        diagnostics["max_value"] = float(array.max())
        diagnostics["mean_value"] = float(array.mean())
        diagnostics["std_value"] = float(array.std())

    return diagnostics


def _compute_mask_stats(
    mask_binary: np.ndarray,
    spacing: Tuple[float, float, float],
    origin: Tuple[float, float, float],
    direction: Tuple[float, ...],
    name: str = "mask",
) -> Dict[str, Any]:
    """Compute statistics for a binary mask."""
    stats = {}

    # Voxel count and volume
    voxel_count = int(mask_binary.sum())
    voxel_volume = np.prod(spacing)
    stats["voxel_count"] = voxel_count
    stats["volume_mm3"] = float(voxel_count * voxel_volume)
    stats["volume_ml"] = float(voxel_count * voxel_volume / 1000)

    if voxel_count == 0:
        return stats

    # Find voxel-space bounding box (z, y, x order)
    coords = np.where(mask_binary)  # Returns (z_indices, y_indices, x_indices)
    z_min, z_max = coords[0].min(), coords[0].max()
    y_min, y_max = coords[1].min(), coords[1].max()
    x_min, x_max = coords[2].min(), coords[2].max()

    stats["bbox_voxel_zyx"] = {
        "min": [int(z_min), int(y_min), int(x_min)],
        "max": [int(z_max), int(y_max), int(x_max)],
        "size": [int(z_max - z_min + 1), int(y_max - y_min + 1), int(x_max - x_min + 1)],
    }

    # Compute voxel-space centroid (z, y, x order)
    centroid_voxel_z = coords[0].mean()
    centroid_voxel_y = coords[1].mean()
    centroid_voxel_x = coords[2].mean()
    stats["centroid_voxel_zyx"] = [
        float(centroid_voxel_z),
        float(centroid_voxel_y),
        float(centroid_voxel_x),
    ]

    # Convert centroid to physical coordinates (x, y, z order)
    centroid_xyz_voxel = np.array([centroid_voxel_x, centroid_voxel_y, centroid_voxel_z])
    centroid_physical = voxel_to_physical(centroid_xyz_voxel, spacing, origin, direction)
    stats["centroid_physical_xyz_mm"] = centroid_physical.tolist()

    # Physical bounding box
    bbox_min_xyz = np.array([x_min, y_min, z_min])
    bbox_max_xyz = np.array([x_max + 1, y_max + 1, z_max + 1])  # +1 to include last voxel
    bbox_min_phys = voxel_to_physical(bbox_min_xyz, spacing, origin, direction)
    bbox_max_phys = voxel_to_physical(bbox_max_xyz, spacing, origin, direction)

    stats["bbox_physical_xyz_mm"] = {
        "min": bbox_min_phys.tolist(),
        "max": bbox_max_phys.tolist(),
        "size": (bbox_max_phys - bbox_min_phys).tolist(),
    }

    # Laterality check: is centroid left (positive x in LPS) or right (negative x)?
    stats["laterality_lps"] = "left" if centroid_physical[0] > 0 else "right"

    return stats


def voxel_to_physical(
    voxel_xyz: np.ndarray,
    spacing: Tuple[float, float, float],
    origin: Tuple[float, float, float],
    direction: Tuple[float, ...],
) -> np.ndarray:
    """
    Convert voxel indices to physical coordinates.

    This implements the same transform as SimpleITK's
    TransformContinuousIndexToPhysicalPoint.

    Args:
        voxel_xyz: Voxel indices in (x, y, z) order
        spacing: Voxel spacing in (x, y, z) order
        origin: Physical origin in (x, y, z) order
        direction: Direction cosines (9 floats, row-major 3x3)

    Returns:
        Physical coordinates in (x, y, z) order (LPS)
    """
    spacing_arr = np.array(spacing, dtype=np.float64)
    origin_arr = np.array(origin, dtype=np.float64)
    direction_matrix = np.array(direction, dtype=np.float64).reshape(3, 3)

    # physical = origin + direction @ (voxel * spacing)
    scaled = voxel_xyz * spacing_arr
    physical = origin_arr + direction_matrix @ scaled

    return physical


def physical_to_voxel(
    physical_xyz: np.ndarray,
    spacing: Tuple[float, float, float],
    origin: Tuple[float, float, float],
    direction: Tuple[float, ...],
) -> np.ndarray:
    """
    Convert physical coordinates to voxel indices.

    Inverse of voxel_to_physical.

    Args:
        physical_xyz: Physical coordinates in (x, y, z) order (LPS)
        spacing: Voxel spacing in (x, y, z) order
        origin: Physical origin in (x, y, z) order
        direction: Direction cosines (9 floats, row-major 3x3)

    Returns:
        Voxel indices in (x, y, z) order
    """
    spacing_arr = np.array(spacing, dtype=np.float64)
    origin_arr = np.array(origin, dtype=np.float64)
    direction_matrix = np.array(direction, dtype=np.float64).reshape(3, 3)

    # Inverse: voxel = (direction^-1 @ (physical - origin)) / spacing
    direction_inv = np.linalg.inv(direction_matrix)
    shifted = physical_xyz - origin_arr
    scaled = direction_inv @ shifted
    voxel = scaled / spacing_arr

    return voxel


def compute_mesh_diagnostics(
    vertices: np.ndarray,
    faces: np.ndarray,
    name: str = "mesh",
) -> Dict[str, Any]:
    """
    Compute diagnostics for a mesh.

    Args:
        vertices: (N, 3) array of vertex positions in physical coordinates
        faces: (M, 3) array of triangle indices
        name: Descriptive name

    Returns:
        Dictionary with diagnostic information
    """
    if len(vertices) == 0:
        return {"name": name, "n_vertices": 0, "n_faces": 0}

    # Basic mesh info
    diagnostics = {
        "name": name,
        "n_vertices": len(vertices),
        "n_faces": len(faces),
    }

    # Bounding box
    bbox_min = vertices.min(axis=0)
    bbox_max = vertices.max(axis=0)
    diagnostics["bbox_physical_xyz_mm"] = {
        "min": bbox_min.tolist(),
        "max": bbox_max.tolist(),
        "size": (bbox_max - bbox_min).tolist(),
    }

    # Centroid
    centroid = vertices.mean(axis=0)
    diagnostics["centroid_physical_xyz_mm"] = centroid.tolist()

    # Laterality
    diagnostics["laterality_lps"] = "left" if centroid[0] > 0 else "right"

    return diagnostics


def verify_mask_mesh_consistency(
    mask_stats: Dict[str, Any],
    mesh_stats: Dict[str, Any],
    tolerance_mm: float = 5.0,
) -> Dict[str, Any]:
    """
    Verify that mesh matches the mask it was generated from.

    Args:
        mask_stats: Diagnostics from compute_image_diagnostics with mask_label
        mesh_stats: Diagnostics from compute_mesh_diagnostics
        tolerance_mm: Maximum allowed centroid difference in mm

    Returns:
        Dictionary with consistency check results
    """
    results = {"checks": {}, "passed": True, "errors": []}

    # Check 1: Centroid consistency
    if "centroid_physical_xyz_mm" in mask_stats and "centroid_physical_xyz_mm" in mesh_stats:
        mask_centroid = np.array(mask_stats["centroid_physical_xyz_mm"])
        mesh_centroid = np.array(mesh_stats["centroid_physical_xyz_mm"])
        centroid_diff = np.linalg.norm(mask_centroid - mesh_centroid)

        results["checks"]["centroid_difference_mm"] = float(centroid_diff)
        results["checks"]["centroid_within_tolerance"] = centroid_diff <= tolerance_mm

        if centroid_diff > tolerance_mm:
            results["passed"] = False
            results["errors"].append(
                f"Centroid mismatch: mask={mask_centroid.tolist()}, "
                f"mesh={mesh_centroid.tolist()}, diff={centroid_diff:.2f}mm"
            )

    # Check 2: Bounding box overlap
    if "bbox_physical_xyz_mm" in mask_stats and "bbox_physical_xyz_mm" in mesh_stats:
        mask_bbox = mask_stats["bbox_physical_xyz_mm"]
        mesh_bbox = mesh_stats["bbox_physical_xyz_mm"]

        # Compute overlap
        overlap_min = np.maximum(mask_bbox["min"], mesh_bbox["min"])
        overlap_max = np.minimum(mask_bbox["max"], mesh_bbox["max"])
        has_overlap = np.all(overlap_max > overlap_min)

        results["checks"]["bbox_has_overlap"] = has_overlap

        if not has_overlap:
            results["passed"] = False
            results["errors"].append(
                f"No bounding box overlap: mask={mask_bbox}, mesh={mesh_bbox}"
            )

    # Check 3: Laterality consistency
    if "laterality_lps" in mask_stats and "laterality_lps" in mesh_stats:
        mask_lat = mask_stats["laterality_lps"]
        mesh_lat = mesh_stats["laterality_lps"]

        results["checks"]["laterality_match"] = mask_lat == mesh_lat
        results["checks"]["mask_laterality"] = mask_lat
        results["checks"]["mesh_laterality"] = mesh_lat

        if mask_lat != mesh_lat:
            results["passed"] = False
            results["errors"].append(
                f"Laterality mismatch: mask={mask_lat}, mesh={mesh_lat}"
            )

    return results


def save_debug_stats(
    stats: Dict[str, Any],
    output_path: Path,
) -> None:
    """Save diagnostic statistics to JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(stats, f, indent=2)

    logger.info(f"Saved debug stats: {output_path}")


def print_diagnostics(diagnostics: Dict[str, Any], indent: int = 0) -> None:
    """Pretty-print diagnostics to logger."""
    prefix = "  " * indent
    for key, value in diagnostics.items():
        if isinstance(value, dict):
            logger.info(f"{prefix}{key}:")
            print_diagnostics(value, indent + 1)
        elif isinstance(value, list) and len(value) > 0 and isinstance(value[0], (int, float)):
            # Format numeric lists nicely
            formatted = ", ".join(f"{v:.2f}" if isinstance(v, float) else str(v) for v in value)
            logger.info(f"{prefix}{key}: [{formatted}]")
        else:
            logger.info(f"{prefix}{key}: {value}")
