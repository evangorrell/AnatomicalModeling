"""
Simplified pipeline for brain + tumor mesh generation.

This module provides a clean approach:
1. Brain: Segmented from image using Otsu threshold
2. Tumor: Extracted directly from ground truth label file
3. Both meshes use identical coordinate transforms
"""

import logging
import json
from pathlib import Path
from typing import Tuple, Optional, List
import numpy as np
import SimpleITK as sitk
from skimage import filters, morphology
from scipy import ndimage

from src.surf.marching_cubes import MarchingCubes, Mesh
from src.export.mesh_export import export_stl, export_obj

logger = logging.getLogger(__name__)


def generate_brain_tumor_meshes(
    image_path: str,
    label_path: str,
    output_dir: str,
    tumor_labels: List[int] = [1, 2, 3, 4],
    step_size: int = 1,
    formats: List[str] = ["stl", "obj"],
) -> dict:
    """
    Generate brain and tumor meshes from image and ground truth labels.

    Args:
        image_path: Path to NIfTI image file (.nii.gz)
        label_path: Path to ground truth label file (.nii.gz)
        output_dir: Directory to save output meshes
        tumor_labels: Label values in label_path that represent tumor
        step_size: Marching cubes step size (1=fine, 2=coarse but faster)
        formats: Output formats (stl, obj, ply)

    Returns:
        Dictionary with metadata about generated meshes
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("BRAIN + TUMOR MESH GENERATION")
    logger.info("=" * 60)

    # Load label file (this defines our coordinate system)
    logger.info(f"Loading label file: {label_path}")
    label_img = sitk.ReadImage(label_path)
    label_arr = sitk.GetArrayFromImage(label_img)

    # Get coordinate system from label file
    spacing = label_img.GetSpacing()
    origin = label_img.GetOrigin()
    direction = label_img.GetDirection()

    logger.info(f"  Size: {label_img.GetSize()}")
    logger.info(f"  Spacing: {spacing}")
    logger.info(f"  Origin: {origin}")
    logger.info(f"  Direction: {direction}")

    # Load image file
    logger.info(f"\nLoading image file: {image_path}")
    image = sitk.ReadImage(image_path)

    # Handle 4D images (multi-channel MRI)
    if image.GetDimension() == 4:
        num_channels = image.GetSize()[3]
        channel_idx = min(1, num_channels - 1)  # Use T1c (channel 1) if available
        logger.info(f"  4D image with {num_channels} channels, extracting channel {channel_idx}")

        extractor = sitk.ExtractImageFilter()
        size = list(image.GetSize())
        size[3] = 0
        extractor.SetSize(size)
        extractor.SetIndex([0, 0, 0, channel_idx])
        image = extractor.Execute(image)

    image_arr = sitk.GetArrayFromImage(image)
    logger.info(f"  Image shape: {image_arr.shape}")

    # =========================================
    # STEP 1: Extract TUMOR from ground truth
    # =========================================
    logger.info(f"\n--- STEP 1: Extracting tumor from labels {tumor_labels} ---")
    tumor_mask = np.isin(label_arr, tumor_labels).astype(np.float32)
    tumor_voxels = int(tumor_mask.sum())
    logger.info(f"  Tumor voxels: {tumor_voxels:,}")

    if tumor_voxels == 0:
        logger.warning("  No tumor voxels found!")

    # =========================================
    # STEP 2: Segment BRAIN from image
    # =========================================
    logger.info("\n--- STEP 2: Segmenting brain from image ---")

    # Otsu threshold for brain
    non_zero = image_arr[image_arr > 0]
    if len(non_zero) > 0:
        brain_threshold = filters.threshold_otsu(non_zero)
        brain_mask = image_arr > brain_threshold
        logger.info(f"  Otsu threshold: {brain_threshold:.2f}")
        logger.info(f"  Initial brain voxels: {brain_mask.sum():,}")

        # Morphological closing to fill gaps
        footprint = morphology.ball(3)
        brain_mask = morphology.binary_closing(brain_mask, footprint=footprint)

        # Fill holes slice by slice
        for i in range(brain_mask.shape[0]):
            brain_mask[i, :, :] = ndimage.binary_fill_holes(brain_mask[i, :, :])

        # Keep largest connected component
        labeled, num_components = ndimage.label(brain_mask)
        if num_components > 1:
            component_sizes = np.bincount(labeled.ravel())
            component_sizes[0] = 0
            largest_label = component_sizes.argmax()
            brain_mask = (labeled == largest_label)

        brain_mask = brain_mask.astype(np.float32)
        brain_voxels = int(brain_mask.sum())
        logger.info(f"  Final brain voxels: {brain_voxels:,}")
    else:
        logger.warning("  No non-zero voxels in image!")
        brain_mask = np.zeros_like(image_arr, dtype=np.float32)
        brain_voxels = 0

    # =========================================
    # STEP 3: Generate meshes with SAME transforms
    # =========================================
    logger.info("\n--- STEP 3: Generating meshes ---")
    mc = MarchingCubes(step_size=step_size)

    metadata = {
        "image_file": str(image_path),
        "label_file": str(label_path),
        "tumor_labels": tumor_labels,
        "spacing": list(spacing),
        "origin": list(origin),
        "direction": list(direction),
        "step_size": step_size,
        "meshes": {}
    }

    # Generate BRAIN mesh
    if brain_voxels > 0:
        logger.info("\n  Generating brain mesh...")
        brain_mesh = mc.extract_surface(
            brain_mask,
            level=0.5,
            spacing=spacing,
            origin=origin,
            direction=direction,
            compute_normals=True,
        )
        logger.info(f"    Vertices: {brain_mesh.n_vertices:,}")
        logger.info(f"    Faces: {brain_mesh.n_faces:,}")

        # Export brain mesh
        for fmt in formats:
            if fmt == "stl":
                export_stl(brain_mesh.vertices, brain_mesh.faces,
                          output_dir / "brain.stl", normals=brain_mesh.normals)
            elif fmt == "obj":
                export_obj(brain_mesh.vertices, brain_mesh.faces,
                          output_dir / "brain.obj", normals=brain_mesh.normals,
                          material_color=(0.7, 0.7, 0.7))

        metadata["meshes"]["brain"] = {
            "vertices": brain_mesh.n_vertices,
            "faces": brain_mesh.n_faces,
            "voxels": brain_voxels,
            "centroid": brain_mesh.vertices.mean(axis=0).tolist(),
        }

    # Generate TUMOR mesh
    if tumor_voxels > 0:
        logger.info("\n  Generating tumor mesh...")
        tumor_mesh = mc.extract_surface(
            tumor_mask,
            level=0.5,
            spacing=spacing,
            origin=origin,
            direction=direction,
            compute_normals=True,
        )
        logger.info(f"    Vertices: {tumor_mesh.n_vertices:,}")
        logger.info(f"    Faces: {tumor_mesh.n_faces:,}")

        # Export tumor mesh
        for fmt in formats:
            if fmt == "stl":
                export_stl(tumor_mesh.vertices, tumor_mesh.faces,
                          output_dir / "tumor.stl", normals=tumor_mesh.normals)
            elif fmt == "obj":
                export_obj(tumor_mesh.vertices, tumor_mesh.faces,
                          output_dir / "tumor.obj", normals=tumor_mesh.normals,
                          material_color=(1.0, 0.2, 0.2))

        tumor_centroid = tumor_mesh.vertices.mean(axis=0)
        metadata["meshes"]["tumor"] = {
            "vertices": tumor_mesh.n_vertices,
            "faces": tumor_mesh.n_faces,
            "voxels": tumor_voxels,
            "centroid": tumor_centroid.tolist(),
            "laterality": "LEFT" if tumor_centroid[0] > 0 else "RIGHT",
        }

    # Save metadata
    metadata_path = output_dir / "mesh_metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info("\n" + "=" * 60)
    logger.info("MESH GENERATION COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Output directory: {output_dir}")

    return metadata


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if len(sys.argv) < 4:
        print("Usage: python -m src.pipeline <image.nii.gz> <labels.nii.gz> <output_dir>")
        print("  Optional: --tumor-labels 1,2,3,4  --step-size 2")
        sys.exit(1)

    image_path = sys.argv[1]
    label_path = sys.argv[2]
    output_dir = sys.argv[3]

    # Parse optional arguments
    tumor_labels = [1, 2, 3, 4]
    step_size = 1

    for i, arg in enumerate(sys.argv):
        if arg == "--tumor-labels" and i + 1 < len(sys.argv):
            tumor_labels = [int(x) for x in sys.argv[i + 1].split(",")]
        if arg == "--step-size" and i + 1 < len(sys.argv):
            step_size = int(sys.argv[i + 1])

    generate_brain_tumor_meshes(
        image_path, label_path, output_dir,
        tumor_labels=tumor_labels,
        step_size=step_size,
    )
