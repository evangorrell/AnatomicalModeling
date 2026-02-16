"""CLI entry point for imaging worker."""

import argparse
import logging
import sys
from pathlib import Path
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

from src.prep.resample import VolumeResampler
from src.seg.classical import ClassicalSegmenter
from src.seg.metrics import SegmentationMetrics
from src.export.mesh_export import export_stl, export_obj, export_ply
from src.mesh.repair import repair_mesh_advanced
import SimpleITK as sitk
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Shared helpers
def _extract_3d_volume(image: sitk.Image) -> sitk.Image:
    """Extract a single 3D volume from a 4D image (multi-channel MRI)."""
    if image.GetDimension() != 4:
        return image

    num_channels = image.GetSize()[3]
    channel_idx = min(1, num_channels - 1)  # Prefer T1c (channel 1), fallback to 0
    logger.info(f"4D volume with {num_channels} channels, extracting channel {channel_idx}")

    extractor = sitk.ExtractImageFilter()
    size = list(image.GetSize())
    size[3] = 0  # Collapse 4th dimension
    extractor.SetSize(size)
    extractor.SetIndex([0, 0, 0, channel_idx])

    extracted = extractor.Execute(image)
    logger.info(f"Extracted 3D volume: size={extracted.GetSize()}, spacing={extracted.GetSpacing()}")
    return extracted


def _segment_brain_otsu(image_arr: np.ndarray) -> np.ndarray:
    """Segment brain from image using Otsu threshold + morphology.

    Returns a boolean brain mask with the largest connected component.
    This is the shared logic used by both the --use-labels path in the CLI
    and the ClassicalSegmenter.
    """
    from skimage import filters, morphology
    from scipy import ndimage

    non_zero = image_arr[image_arr > 0]
    if len(non_zero) == 0:
        logger.warning("No non-zero voxels in image")
        return np.zeros_like(image_arr, dtype=bool)

    brain_threshold = filters.threshold_otsu(non_zero)
    brain_mask = image_arr > brain_threshold
    logger.info(f"Brain Otsu threshold: {brain_threshold:.2f}, initial voxels: {brain_mask.sum():,}")

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
        brain_mask = labeled == largest_label

    logger.info(f"Final brain voxels: {brain_mask.sum():,}")
    return brain_mask.astype(bool)


# Commands
def cmd_resample(args) -> int:
    """Resample volume to isotropic spacing."""
    logger.info(f"Resampling volume: {args.input}")

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        image = sitk.ReadImage(str(input_path))
        logger.info(f"Loaded volume: size={image.GetSize()}, spacing={image.GetSpacing()}")

        target_spacing = None
        if args.spacing:
            target_spacing = (args.spacing,) * 3

        resampler = VolumeResampler(
            target_spacing=target_spacing,
            interpolation=args.interpolation,
        )

        resampled, metadata = resampler.resample_to_isotropic(image, output_dir)

        logger.info(f"Resampling complete")
        logger.info(f"  Output: {output_dir / 'volume_isotropic.nii.gz'}")
        logger.info(f"  New size: {resampled.GetSize()}")
        logger.info(f"  New spacing: {resampled.GetSpacing()}")
        logger.info(f"  Scale factors: {metadata['scale_factors']}")

        return 0
    except Exception as e:
        logger.error(f"Resampling failed: {e}", exc_info=True)
        return 1


def _segment_with_labels(args, image: sitk.Image) -> tuple:
    """Segment using provided ground truth label file + Otsu brain."""
    print("PROGRESS: 30 - Using provided label file for tumor...", flush=True)
    logger.info(f"Using label file: {args.use_labels}")

    label_img = sitk.ReadImage(args.use_labels)
    label_img = _extract_3d_volume(label_img)
    label_arr = sitk.GetArrayFromImage(label_img)

    # Parse tumor labels
    tumor_labels = [int(x.strip()) for x in args.tumor_labels.split(',')]
    logger.info(f"Tumor labels: {tumor_labels}")

    tumor_mask = np.isin(label_arr, tumor_labels)
    logger.info(f"Tumor voxels from ground truth: {tumor_mask.sum():,}")

    # Brain from image using Otsu
    print("PROGRESS: 40 - Segmenting brain from image...", flush=True)
    image_arr = sitk.GetArrayFromImage(image)
    brain_mask = _segment_brain_otsu(image_arr)

    # Create multi-class mask
    multi_class = np.zeros_like(image_arr, dtype=np.uint8)
    multi_class[brain_mask & ~tumor_mask] = 1  # Brain tissue
    multi_class[tumor_mask] = 2  # Tumor

    mask = sitk.GetImageFromArray(multi_class)
    mask.CopyInformation(image)

    # Compute volumes
    spacing = image.GetSpacing()
    voxel_volume_mm3 = np.prod(spacing)
    brain_voxels = int((multi_class == 1).sum())
    tumor_voxels = int((multi_class == 2).sum())

    metadata = {
        "method": "ground_truth_labels",
        "label_file": str(args.use_labels),
        "tumor_labels": tumor_labels,
        "labels": {"0": "background", "1": "brain", "2": "tumor"},
        "brain_voxels": brain_voxels,
        "tumor_voxels": tumor_voxels,
        "brain_volume_ml": float(brain_voxels * voxel_volume_mm3 / 1000),
        "tumor_volume_ml": float(tumor_voxels * voxel_volume_mm3 / 1000),
    }

    logger.info(f"Created mask with GT tumor + Otsu brain")
    logger.info(f"  Brain voxels: {brain_voxels:,}")
    logger.info(f"  Tumor voxels: {tumor_voxels:,}")

    return mask, metadata


def _segment_classical(args, image: sitk.Image) -> tuple:
    """Segment using classical methods (Otsu thresholding + morphology)."""
    segmenter = ClassicalSegmenter(
        closing_radius=args.closing_radius,
        opening_radius=args.opening_radius,
        fill_holes=not args.no_fill_holes,
        largest_component_only=not args.keep_all_components,
        tumor_threshold_std=args.tumor_threshold_std,
    )

    print("PROGRESS: 30 - Running Otsu thresholding...", flush=True)
    return segmenter.segment(image, Path(args.output))


def cmd_segment(args) -> int:
    """Segment a NIfTI volume using classical methods."""
    logger.info(f"Segmenting volume: {args.input}")

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        print("PROGRESS: 0 - Loading volume...", flush=True)

        image = sitk.ReadImage(str(input_path))
        logger.info(f"Loaded volume: size={image.GetSize()}, spacing={image.GetSpacing()}")

        print("PROGRESS: 10 - Volume loaded, starting segmentation...", flush=True)

        image = _extract_3d_volume(image)
        if image.GetDimension() == 3:
            print("PROGRESS: 15 - 3D volume ready", flush=True)

        print("PROGRESS: 20 - Running segmentation algorithm...", flush=True)

        # Dispatch to label-based or classical segmentation
        if args.use_labels:
            mask, metadata = _segment_with_labels(args, image)
            # Save mask (label path doesn't go through ClassicalSegmenter which saves internally)
            output_dir.mkdir(parents=True, exist_ok=True)
            sitk.WriteImage(mask, str(output_dir / "mask.nii.gz"))
            # Save metadata
            with open(output_dir / "segmentation_metadata.json", "w") as f:
                json.dump(metadata, f, indent=2)
        else:
            mask, metadata = _segment_classical(args, image)

        print("PROGRESS: 90 - Segmentation complete, saving results...", flush=True)

        logger.info(f"Segmentation complete")
        logger.info(f"  Method: {metadata['method']}")

        if 'brain_voxels' in metadata:
            logger.info(f"  Brain voxels: {metadata['brain_voxels']:,}")
            logger.info(f"  Tumor voxels: {metadata['tumor_voxels']:,}")
            logger.info(f"  Brain volume: {metadata['brain_volume_ml']:.2f} ml")
            logger.info(f"  Tumor volume: {metadata['tumor_volume_ml']:.2f} ml")
        else:
            logger.info(f"  Foreground voxels: {metadata['foreground_voxels']:,}")
            logger.info(f"  Volume: {metadata['volume_ml']:.2f} ml")

        # Compare with ground truth if provided
        if args.ground_truth:
            logger.info(f"\nComparing with ground truth: {args.ground_truth}")
            gt = sitk.ReadImage(args.ground_truth)
            metrics = SegmentationMetrics.compute_all_metrics(mask, gt)

            logger.info(f"Metrics computed:")
            logger.info(f"  Dice coefficient: {metrics['dice']:.4f}")
            logger.info(f"  Jaccard index: {metrics['jaccard']:.4f}")
            logger.info(f"  Hausdorff-95: {metrics['hausdorff_95']:.2f} mm")
            logger.info(f"  Volume similarity: {metrics['volume_similarity']:.4f}")

            metrics_path = output_dir / "metrics.json"
            with open(metrics_path, "w") as f:
                json.dump(metrics, f, indent=2)
            logger.info(f"  Saved metrics to {metrics_path}")

        print("PROGRESS: 100 - Segmentation pipeline complete", flush=True)
        return 0

    except Exception as e:
        logger.error(f"Segmentation failed: {e}", exc_info=True)
        return 1


# Label configuration
LABEL_NAMES = {1: "brain", 2: "tumor"}
LABEL_COLORS = {
    1: (0.7, 0.7, 0.7),  # Grey for brain
    2: (1.0, 0.2, 0.2),  # Red for tumor
}


def _process_single_label(label, label_name, label_color, mask_array, spacing, origin, direction, step_size, args, output_dir) -> dict | None:
    """Process a single label: marching cubes + postprocess + export. Thread-safe."""
    from src.surf.marching_cubes import MarchingCubes, Mesh

    mc = MarchingCubes(step_size=step_size)

    logger.info(f"Processing label {label}: {label_name}")

    binary_mask = (mask_array == label).astype(np.float32)
    logger.info(f"Label {label} voxels: {binary_mask.sum():,}")

    mesh = mc.extract_surface(
        binary_mask, level=0.5,
        spacing=spacing, origin=origin, direction=direction,
        compute_normals=True,
    )

    if mesh.n_vertices == 0:
        logger.warning(f"No mesh generated for label {label}")
        return None

    logger.info(f"[{label_name}] Raw MC: {mesh.n_vertices:,} vertices, {mesh.n_faces:,} faces")

    # Negate Y-axis: LPS (+y=posterior) -> display convention (+y=anterior)
    # so the 3D view matches radiological axial orientation
    mesh.vertices[:, 1] = -mesh.vertices[:, 1]
    if mesh.normals is not None:
        mesh.normals[:, 1] = -mesh.normals[:, 1]
    mesh.faces = mesh.faces[:, ::-1]
    logger.info(f"[{label_name}] Applied Y-flip for display convention")

    # Post-process
    if not args.no_postprocess:
        logger.info(f"[{label_name}] Post-processing mesh...")
        target_faces = int(len(mesh.faces) * (1 - args.decimation_target)) if args.decimate else None
        vertices, faces, normals = repair_mesh_advanced(
            mesh.vertices, mesh.faces, mesh.normals,
            target_faces=target_faces,
        )
        mesh = Mesh(vertices=vertices, faces=faces, normals=normals)
        logger.info(f"[{label_name}] Post-processed: {mesh.n_vertices:,} vertices, {mesh.n_faces:,} faces")

    # Export
    formats = args.formats.split(',')
    for fmt in formats:
        fmt = fmt.strip().lower()
        if fmt == 'stl':
            export_stl(mesh.vertices, mesh.faces, output_dir / f"{label_name}.stl",
                       normals=mesh.normals, binary=not args.ascii, label=label_name)
        elif fmt == 'obj':
            export_obj(mesh.vertices, mesh.faces, output_dir / f"{label_name}.obj",
                       normals=mesh.normals, label=label_name, material_color=label_color)
        elif fmt == 'ply':
            color_255 = (np.array(label_color) * 255).astype(np.uint8)
            colors = np.tile(color_255, (mesh.n_vertices, 1))
            export_ply(mesh.vertices, mesh.faces, output_dir / f"{label_name}.ply",
                       normals=mesh.normals, colors=colors, binary=not args.ascii)

    logger.info(f"[{label_name}] Export complete")

    mesh_role = "brain" if label_name == "brain" else "tumor" if label_name == "tumor" else "unknown"
    return {
        "label_name": label_name,
        "label_value": int(label),
        "vertices": mesh.n_vertices,
        "faces": mesh.n_faces,
        "voxels": int(binary_mask.sum()),
        "post_processed": not args.no_postprocess,
        "role": mesh_role,
        "confidence": 1.0,
    }


def cmd_mesh(args) -> int:
    """Generate mesh from segmentation mask using Marching Cubes."""
    logger.info(f"Generating mesh from segmentation: {args.input}")

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        print("PROGRESS: 0 - Loading segmentation mask...", flush=True)

        mask_img = sitk.ReadImage(str(input_path))
        spacing = mask_img.GetSpacing()
        origin = mask_img.GetOrigin()
        direction = mask_img.GetDirection()

        logger.info(f"Mask size: {mask_img.GetSize()}, spacing: {spacing}")
        logger.info(f"Mask origin: {origin}, direction: {direction}")

        # Debug mode
        debug_stats = {}
        if args.debug:
            from src.debug.diagnostics import (
                compute_image_diagnostics,
                save_debug_stats,
                print_diagnostics,
            )
            logger.info("DEBUG MODE - Computing diagnostics")

            debug_dir = output_dir / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)

            mask_diag = compute_image_diagnostics(mask_img, name="segmentation_mask")
            debug_stats["mask"] = mask_diag
            logger.info("\nMask diagnostics:")
            print_diagnostics(mask_diag, indent=1)

        print("PROGRESS: 10 - Analyzing segmentation...", flush=True)

        output_dir.mkdir(parents=True, exist_ok=True)

        mask_array = sitk.GetArrayFromImage(mask_img)
        labels = np.unique(mask_array)
        labels = labels[labels > 0]

        logger.info(f"Found {len(labels)} non-background labels: {labels}")
        print(f"PROGRESS: 15 - Found {len(labels)} structures to mesh", flush=True)

        step_size = args.step_size
        meshes_metadata = {}

        # Process labels in parallel
        print(f"PROGRESS: 20 - Processing {len(labels)} structures in parallel...", flush=True)
        logger.info(f"\nParallel processing: {len(labels)} labels")

        with ThreadPoolExecutor(max_workers=len(labels)) as executor:
            futures = {}
            for label in labels:
                label_name = LABEL_NAMES.get(label, f"label_{label}")
                label_color = LABEL_COLORS.get(label, (0.5, 0.5, 0.5))
                future = executor.submit(
                    _process_single_label,
                    label, label_name, label_color,
                    mask_array, spacing, origin, direction,
                    step_size, args, output_dir,
                )
                futures[future] = label_name

            for future in as_completed(futures):
                label_name = futures[future]
                try:
                    result = future.result()
                    if result:
                        meshes_metadata[result["label_name"]] = {
                            k: v for k, v in result.items() if k != "label_name"
                        }
                        print(f"PROGRESS: 60 - {label_name} mesh complete", flush=True)
                except Exception as e:
                    logger.error(f"[{label_name}] Failed: {e}", exc_info=True)

        print(f"PROGRESS: 85 - All meshes generated", flush=True)
        print("PROGRESS: 90 - Saving metadata...", flush=True)

        # Save metadata
        formats = args.formats.split(',')
        metadata = {
            "input_file": str(input_path),
            "step_size": args.step_size,
            "formats": formats,
            "meshes": meshes_metadata,
            "coordinate_info": {
                "convention": "LPS (Left-Posterior-Superior)",
                "spacing_xyz_mm": list(spacing),
                "origin_xyz_mm": list(origin),
                "direction_matrix": list(direction),
            },
        }

        metadata_path = output_dir / "mesh_metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        # Debug: save stats
        if args.debug:
            debug_stats["coordinate_convention"] = {
                "physical_space": "LPS (Left-Posterior-Superior)",
                "sitk_index_order": "(x, y, z)",
                "numpy_array_order": "(z, y, x)",
                "mesh_vertex_order": "(x, y, z) in physical LPS coordinates",
            }
            debug_stats["image_metadata"] = {
                "size_xyz": list(mask_img.GetSize()),
                "spacing_xyz_mm": list(spacing),
                "origin_xyz_mm": list(origin),
                "direction_matrix": list(direction),
            }
            save_debug_stats(debug_stats, output_dir / "debug" / "stats.json")

        print("PROGRESS: 100 - Mesh generation complete!", flush=True)

        logger.info(f"Generated {len(meshes_metadata)} meshes -> {output_dir}")
        return 0

    except Exception as e:
        logger.error(f"Mesh generation failed: {e}", exc_info=True)
        return 1


# CLI argument parser
def main() -> int:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Imaging Worker CLI - NIfTI to 3D Mesh Pipeline"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Resample command
    resample_parser = subparsers.add_parser("resample", help="Resample volume to isotropic")
    resample_parser.add_argument("input", help="Path to NIfTI file")
    resample_parser.add_argument("output", help="Output directory")
    resample_parser.add_argument(
        "--spacing", type=float,
        help="Target isotropic spacing (mm). Default: use minimum of current spacing",
    )
    resample_parser.add_argument(
        "--interpolation", choices=["linear", "bspline", "nearest"], default="linear",
        help="Interpolation method",
    )

    # Segment command
    segment_parser = subparsers.add_parser("segment", help="Segment a NIfTI volume")
    segment_parser.add_argument("input", help="Path to NIfTI file (.nii.gz)")
    segment_parser.add_argument("output", help="Output directory")
    segment_parser.add_argument("--closing-radius", type=int, default=5)
    segment_parser.add_argument("--opening-radius", type=int, default=3)
    segment_parser.add_argument("--no-fill-holes", action="store_true")
    segment_parser.add_argument("--keep-all-components", action="store_true")
    segment_parser.add_argument("--ground-truth", help="Ground truth mask for metrics")
    segment_parser.add_argument(
        "--tumor-threshold-std", type=float, default=1.0,
        help="Tumor threshold: voxels > (mean + X*std). Default: 1.0",
    )
    segment_parser.add_argument(
        "--use-labels",
        help="Path to ground truth label file (.nii.gz) instead of classical segmentation",
    )
    segment_parser.add_argument(
        "--tumor-labels", default="1,2,3,4",
        help="Comma-separated label values for tumor (with --use-labels). Default: 1,2,3,4",
    )

    # Mesh command
    mesh_parser = subparsers.add_parser("mesh", help="Generate 3D mesh from segmentation mask")
    mesh_parser.add_argument("input", help="Path to segmentation mask (.nii.gz)")
    mesh_parser.add_argument("output", help="Output directory")
    mesh_parser.add_argument("--formats", default="stl,obj", help="Export formats (stl,obj,ply)")
    mesh_parser.add_argument("--step-size", type=int, default=1, help="Marching cubes step size")
    mesh_parser.add_argument("--ascii", action="store_true", help="ASCII format instead of binary")
    mesh_parser.add_argument("--no-postprocess", action="store_true", help="Skip post-processing")
    mesh_parser.add_argument("--no-fill-holes", action="store_true", help="Skip hole filling")
    mesh_parser.add_argument("--no-smooth", action="store_true", help="Skip smoothing")
    mesh_parser.add_argument("--decimate", action="store_true", help="Enable decimation")
    mesh_parser.add_argument(
        "--decimation-target", type=float, default=0.5,
        help="Decimation reduction (0.0-1.0). Default: 0.5",
    )
    mesh_parser.add_argument("--debug", action="store_true", help="Enable debug diagnostics")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 0

    commands = {
        "resample": cmd_resample,
        "segment": cmd_segment,
        "mesh": cmd_mesh,
    }
    handler = commands.get(args.command)
    if handler:
        return handler(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
