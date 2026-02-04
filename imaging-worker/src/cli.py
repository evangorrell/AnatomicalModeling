"""CLI entry point for imaging worker."""

import argparse
import logging
import sys
from pathlib import Path
import json

from src.prep.resample import VolumeResampler
from src.seg.classical import ClassicalSegmenter
from src.seg.metrics import SegmentationMetrics
from src.surf.marching_cubes import MarchingCubes
from src.export.mesh_export import export_stl, export_obj, export_ply
from src.mesh.postprocess import postprocess_mesh
import SimpleITK as sitk
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def cmd_resample(args):
    """Resample volume to isotropic spacing."""
    logger.info(f"Resampling volume: {args.input}")

    import SimpleITK as sitk

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        # Load volume
        image = sitk.ReadImage(str(input_path))
        logger.info(f"Loaded volume: size={image.GetSize()}, spacing={image.GetSpacing()}")

        # Resample
        target_spacing = None
        if args.spacing:
            target_spacing = (args.spacing,) * 3

        resampler = VolumeResampler(
            target_spacing=target_spacing,
            interpolation=args.interpolation,
        )

        resampled, metadata = resampler.resample_to_isotropic(image, output_dir)

        logger.info(f"✓ Resampling complete")
        logger.info(f"  Output: {output_dir / 'volume_isotropic.nii.gz'}")
        logger.info(f"  New size: {resampled.GetSize()}")
        logger.info(f"  New spacing: {resampled.GetSpacing()}")
        logger.info(f"  Scale factors: {metadata['scale_factors']}")

        return 0
    except Exception as e:
        logger.error(f"Resampling failed: {e}", exc_info=True)
        return 1


def cmd_segment(args):
    """Segment a NIfTI volume using classical methods."""
    logger.info(f"Segmenting volume: {args.input}")

    import SimpleITK as sitk

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        # Progress: 0% - Starting
        print("PROGRESS: 0 - Loading volume...", flush=True)

        # Load volume
        image = sitk.ReadImage(str(input_path))
        logger.info(f"Loaded volume: size={image.GetSize()}, spacing={image.GetSpacing()}")

        # Progress: 10%
        print("PROGRESS: 10 - Volume loaded, starting segmentation...", flush=True)

        # Handle 4D volumes (multi-channel) - extract a single 3D volume
        if image.GetDimension() == 4:
            # For multi-channel MRI (e.g., BraTS with T1, T1c, T2, FLAIR)
            # Extract channel 1 (T1c) or channel 0 if only one channel exists
            num_channels = image.GetSize()[3]
            channel_idx = min(1, num_channels - 1)  # Prefer channel 1 (T1c), fallback to 0
            logger.info(f"4D volume detected with {num_channels} channels, extracting channel {channel_idx}")

            # Extract single channel using SimpleITK's slicing
            extractor = sitk.ExtractImageFilter()
            size = list(image.GetSize())
            size[3] = 0  # Collapse 4th dimension
            extractor.SetSize(size)

            index = [0, 0, 0, channel_idx]
            extractor.SetIndex(index)

            image = extractor.Execute(image)
            logger.info(f"Extracted 3D volume: size={image.GetSize()}, spacing={image.GetSpacing()}")
            print("PROGRESS: 15 - 3D volume extracted", flush=True)

        # Progress: 20%
        print("PROGRESS: 20 - Running segmentation algorithm...", flush=True)

        # Check if using ground truth labels
        if args.use_labels:
            print("PROGRESS: 30 - Using provided label file for tumor...", flush=True)
            logger.info(f"Using label file: {args.use_labels}")

            # Load label file
            label_img = sitk.ReadImage(args.use_labels)
            label_arr = sitk.GetArrayFromImage(label_img)

            # Parse tumor labels
            tumor_labels = [int(x.strip()) for x in args.tumor_labels.split(',')]
            logger.info(f"Tumor labels: {tumor_labels}")

            # Get tumor mask from ground truth
            tumor_mask = np.isin(label_arr, tumor_labels)
            logger.info(f"Tumor voxels from ground truth: {tumor_mask.sum():,}")

            # Get brain mask from image using Otsu (not from label file)
            print("PROGRESS: 40 - Segmenting brain from image...", flush=True)
            from skimage import filters
            image_arr = sitk.GetArrayFromImage(image)
            non_zero = image_arr[image_arr > 0]
            brain_threshold = filters.threshold_otsu(non_zero)
            brain_mask = image_arr > brain_threshold

            # Apply morphological closing to fill holes in brain
            from skimage import morphology
            footprint = morphology.ball(3)
            brain_mask = morphology.binary_closing(brain_mask, footprint=footprint)

            # Fill holes in brain
            from scipy import ndimage
            for i in range(brain_mask.shape[0]):
                brain_mask[i, :, :] = ndimage.binary_fill_holes(brain_mask[i, :, :])

            # Keep largest connected component
            labeled, num_components = ndimage.label(brain_mask)
            if num_components > 1:
                component_sizes = np.bincount(labeled.ravel())
                component_sizes[0] = 0
                largest_label = component_sizes.argmax()
                brain_mask = labeled == largest_label

            logger.info(f"Brain voxels from image: {brain_mask.sum():,}")

            # Create multi-class mask: brain (excluding tumor) = 1, tumor = 2
            multi_class = np.zeros_like(label_arr, dtype=np.uint8)
            multi_class[brain_mask & ~tumor_mask] = 1  # Brain tissue
            multi_class[tumor_mask] = 2  # Tumor (from ground truth)

            # Create SimpleITK image
            mask = sitk.GetImageFromArray(multi_class)
            mask.CopyInformation(label_img)

            # Save mask
            output_dir.mkdir(parents=True, exist_ok=True)
            mask_path = output_dir / "mask.nii.gz"
            sitk.WriteImage(mask, str(mask_path))

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

            # Save metadata
            metadata_path = output_dir / "segmentation_metadata.json"
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)

            logger.info(f"Created mask with GT tumor + Otsu brain")
            logger.info(f"  Brain voxels: {brain_voxels:,}")
            logger.info(f"  Tumor voxels: {tumor_voxels:,}")
        else:
            # Segment using classical methods
            segmenter = ClassicalSegmenter(
                closing_radius=args.closing_radius,
                opening_radius=args.opening_radius,
                fill_holes=not args.no_fill_holes,
                largest_component_only=not args.keep_all_components,
                tumor_threshold_std=args.tumor_threshold_std,
            )

            if args.method == "levelset":
                print("PROGRESS: 30 - Running level-set segmentation...", flush=True)
                mask, metadata = segmenter.segment_with_levelset(
                    image, iterations=args.levelset_iterations, output_dir=output_dir
                )
            else:
                print("PROGRESS: 30 - Running Otsu thresholding...", flush=True)
                mask, metadata = segmenter.segment(image, output_dir)

        # Progress: 90%
        print("PROGRESS: 90 - Segmentation complete, saving results...", flush=True)

        logger.info(f"✓ Segmentation complete")
        logger.info(f"  Method: {metadata['method']}")

        # Handle both old binary and new multi-class metadata formats
        if 'brain_voxels' in metadata:
            # Multi-class segmentation
            logger.info(f"  Brain voxels: {metadata['brain_voxels']:,}")
            logger.info(f"  Tumor voxels: {metadata['tumor_voxels']:,}")
            logger.info(f"  Brain volume: {metadata['brain_volume_ml']:.2f} ml")
            logger.info(f"  Tumor volume: {metadata['tumor_volume_ml']:.2f} ml")
        else:
            # Binary segmentation (backward compatibility)
            logger.info(f"  Foreground voxels: {metadata['foreground_voxels']:,}")
            logger.info(f"  Volume: {metadata['volume_ml']:.2f} ml")

        # Compare with ground truth if provided
        if args.ground_truth:
            logger.info(f"\nComparing with ground truth: {args.ground_truth}")
            gt = sitk.ReadImage(args.ground_truth)
            metrics = SegmentationMetrics.compute_all_metrics(mask, gt)

            logger.info(f"✓ Metrics computed:")
            logger.info(f"  Dice coefficient: {metrics['dice']:.4f}")
            logger.info(f"  Jaccard index: {metrics['jaccard']:.4f}")
            logger.info(f"  Hausdorff-95: {metrics['hausdorff_95']:.2f} mm")
            logger.info(f"  Volume similarity: {metrics['volume_similarity']:.4f}")

            # Save metrics
            metrics_path = output_dir / "metrics.json"
            with open(metrics_path, "w") as f:
                json.dump(metrics, f, indent=2)
            logger.info(f"  Saved metrics to {metrics_path}")

        # Progress: 100%
        print("PROGRESS: 100 - Segmentation pipeline complete", flush=True)

        return 0
    except Exception as e:
        logger.error(f"Segmentation failed: {e}", exc_info=True)
        return 1


def cmd_mesh(args):
    """Generate mesh from segmentation mask using Marching Cubes (Phase A3)."""
    logger.info(f"Generating mesh from segmentation: {args.input}")

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return 1

    try:
        # Progress: 0%
        print("PROGRESS: 0 - Loading segmentation mask...", flush=True)

        # Load segmentation mask
        logger.info("Loading segmentation mask...")
        mask_img = sitk.ReadImage(str(input_path))
        spacing = mask_img.GetSpacing()
        origin = mask_img.GetOrigin()
        direction = mask_img.GetDirection()

        logger.info(f"Mask size: {mask_img.GetSize()}")
        logger.info(f"Mask spacing: {spacing}")
        logger.info(f"Mask origin: {origin}")
        logger.info(f"Mask direction: {direction}")

        # Debug mode: comprehensive diagnostics
        debug_stats = {}
        if args.debug:
            from src.debug.diagnostics import (
                compute_image_diagnostics,
                compute_mesh_diagnostics,
                verify_mask_mesh_consistency,
                save_debug_overlays,
                save_debug_stats,
                print_diagnostics,
            )
            logger.info("\n" + "="*60)
            logger.info("DEBUG MODE ENABLED - Computing comprehensive diagnostics")
            logger.info("="*60)

            debug_dir = output_dir / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)

            # Compute mask diagnostics
            mask_diag = compute_image_diagnostics(mask_img, name="segmentation_mask")
            debug_stats["mask"] = mask_diag
            logger.info("\nMask diagnostics:")
            print_diagnostics(mask_diag, indent=1)

        # Progress: 10%
        print("PROGRESS: 10 - Analyzing segmentation...", flush=True)

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)

        # Get unique labels
        mask_array = sitk.GetArrayFromImage(mask_img)
        labels = np.unique(mask_array)
        labels = labels[labels > 0]  # Skip background (0)

        logger.info(f"Found {len(labels)} non-background labels: {labels}")

        # Progress: 15%
        print(f"PROGRESS: 15 - Found {len(labels)} structures to mesh", flush=True)

        # Label names for multi-class
        label_names = {
            1: "brain",
            2: "tumor",
        }

        # Label colors for visualization
        label_colors = {
            1: (0.7, 0.7, 0.7),  # Grey for brain
            2: (1.0, 0.2, 0.2),  # Red for tumor
        }

        # Initialize Marching Cubes
        mc = MarchingCubes(step_size=args.step_size)

        meshes_metadata = {}

        # Generate mesh for each label
        for idx, label in enumerate(labels):
            label_name = label_names.get(label, f"label_{label}")
            label_color = label_colors.get(label, (0.5, 0.5, 0.5))

            # Progress per label: 20% + (70% / num_labels) * idx
            base_progress = 20 + int((70 / len(labels)) * idx)
            print(f"PROGRESS: {base_progress} - Processing {label_name}...", flush=True)

            logger.info(f"\n{'='*60}")
            logger.info(f"Processing label {label}: {label_name}")
            logger.info('='*60)

            # Create binary mask for this label
            binary_mask = (mask_array == label).astype(np.float32)
            logger.info(f"Label {label} voxels: {binary_mask.sum():,}")

            # Extract surface
            print(f"PROGRESS: {base_progress + 5} - Running Marching Cubes for {label_name}...", flush=True)
            mesh = mc.extract_surface(
                binary_mask,
                level=0.5,
                spacing=spacing,
                compute_normals=True,
            )

            if mesh.n_vertices == 0:
                logger.warning(f"No mesh generated for label {label}")
                continue

            logger.info(f"Raw Marching Cubes output: {mesh.n_vertices:,} vertices, {mesh.n_faces:,} faces")

            # Phase A4: Post-process mesh (if enabled)
            if not args.no_postprocess:
                print(f"PROGRESS: {base_progress + 10} - Post-processing {label_name} mesh...", flush=True)
                logger.info(f"\nPhase A4: Post-processing mesh...")
                vertices, faces, normals = postprocess_mesh(
                    mesh.vertices,
                    mesh.faces,
                    mesh.normals,
                    fill_holes=not args.no_fill_holes,
                    smooth=not args.no_smooth,
                    repair_manifold=False,  # Disabled for medical meshes (too aggressive)
                    decimate=args.decimate,
                    target_reduction=args.decimation_target,
                )

                # Create new mesh with post-processed data
                from src.surf.marching_cubes import Mesh
                mesh = Mesh(vertices=vertices, faces=faces, normals=normals)

                logger.info(f"Post-processed output: {mesh.n_vertices:,} vertices, {mesh.n_faces:,} faces")

            # Store metadata with explicit role (NIfTI pipeline knows roles with certainty)
            mesh_role = "brain" if label_name == "brain" else "tumor" if label_name == "tumor" else "unknown"
            meshes_metadata[label_name] = {
                "label_value": int(label),
                "vertices": mesh.n_vertices,
                "faces": mesh.n_faces,
                "voxels": int(binary_mask.sum()),
                "post_processed": not args.no_postprocess,
                "role": mesh_role,
                "confidence": 1.0,  # NIfTI pipeline has 100% confidence
            }

            # Debug mode: verify mesh coordinates
            if args.debug:
                logger.info(f"\n--- DEBUG: {label_name} mesh diagnostics ---")

                # Compute mask stats for this label
                label_mask_stats = compute_image_diagnostics(
                    mask_img, name=f"mask_{label_name}", mask_label=int(label)
                )
                debug_stats[f"mask_{label_name}"] = label_mask_stats
                logger.info(f"\nMask stats for {label_name}:")
                print_diagnostics(label_mask_stats, indent=1)

                # Compute mesh stats
                mesh_stats = compute_mesh_diagnostics(
                    mesh.vertices, mesh.faces, name=f"mesh_{label_name}"
                )
                debug_stats[f"mesh_{label_name}"] = mesh_stats
                logger.info(f"\nMesh stats for {label_name}:")
                print_diagnostics(mesh_stats, indent=1)

                # Verify consistency
                consistency = verify_mask_mesh_consistency(
                    label_mask_stats, mesh_stats, tolerance_mm=10.0
                )
                debug_stats[f"consistency_{label_name}"] = consistency
                logger.info(f"\nConsistency check for {label_name}:")
                print_diagnostics(consistency, indent=1)

                if not consistency["passed"]:
                    logger.warning(f"⚠️  CONSISTENCY CHECK FAILED for {label_name}!")
                    for error in consistency["errors"]:
                        logger.warning(f"   {error}")
                else:
                    logger.info(f"✓ Consistency check PASSED for {label_name}")

                # Generate overlay images (need original image for this)
                # For now, use the mask as both image and mask
                save_debug_overlays(
                    mask_img, mask_img,
                    debug_dir / "overlays",
                    label=int(label),
                    name=label_name,
                )

            # Export in requested formats
            print(f"PROGRESS: {base_progress + 15} - Exporting {label_name} files...", flush=True)
            formats = args.formats.split(',')

            for fmt in formats:
                fmt = fmt.strip().lower()

                if fmt == 'stl':
                    stl_path = output_dir / f"{label_name}.stl"
                    export_stl(
                        mesh.vertices,
                        mesh.faces,
                        stl_path,
                        normals=mesh.normals,
                        binary=not args.ascii,
                        label=label_name,
                    )

                elif fmt == 'obj':
                    obj_path = output_dir / f"{label_name}.obj"
                    export_obj(
                        mesh.vertices,
                        mesh.faces,
                        obj_path,
                        normals=mesh.normals,
                        label=label_name,
                        material_color=label_color,
                    )

                elif fmt == 'ply':
                    ply_path = output_dir / f"{label_name}.ply"
                    # Convert color to 0-255 range for PLY
                    color_255 = (np.array(label_color) * 255).astype(np.uint8)
                    colors = np.tile(color_255, (mesh.n_vertices, 1))
                    export_ply(
                        mesh.vertices,
                        mesh.faces,
                        ply_path,
                        normals=mesh.normals,
                        colors=colors,
                        binary=not args.ascii,
                    )

                else:
                    logger.warning(f"Unknown format: {fmt}")

        # Progress: 90%
        print("PROGRESS: 90 - Saving metadata...", flush=True)

        # Save metadata
        metadata_path = output_dir / "mesh_metadata.json"
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

        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        # Debug mode: save comprehensive stats
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

        # Progress: 100%
        print("PROGRESS: 100 - Mesh generation complete!", flush=True)

        logger.info(f"\n{'='*60}")
        logger.info("MESH GENERATION COMPLETE!")
        logger.info('='*60)
        logger.info(f"Generated {len(meshes_metadata)} meshes")
        logger.info(f"Output directory: {output_dir}")
        logger.info(f"Metadata saved to: {metadata_path}")
        logger.info('='*60)

        return 0

    except Exception as e:
        logger.error(f"Mesh generation failed: {e}", exc_info=True)
        return 1


def main():
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
        "--spacing",
        type=float,
        help="Target isotropic spacing (mm). Default: use minimum of current spacing",
    )
    resample_parser.add_argument(
        "--interpolation",
        choices=["linear", "bspline", "nearest"],
        default="linear",
        help="Interpolation method",
    )

    # Segment command (Phase A2)
    segment_parser = subparsers.add_parser(
        "segment",
        help="Segment a NIfTI volume using classical methods",
    )
    segment_parser.add_argument("input", help="Path to NIfTI file (.nii.gz)")
    segment_parser.add_argument("output", help="Output directory")
    segment_parser.add_argument(
        "--method",
        choices=["otsu", "levelset"],
        default="otsu",
        help="Segmentation method (default: otsu)",
    )
    segment_parser.add_argument(
        "--closing-radius",
        type=int,
        default=5,
        help="Morphological closing radius (default: 5, increased for better connectivity)",
    )
    segment_parser.add_argument(
        "--opening-radius",
        type=int,
        default=3,
        help="Morphological opening radius (default: 3, increased for better noise removal)",
    )
    segment_parser.add_argument(
        "--no-fill-holes",
        action="store_true",
        help="Don't fill holes in mask",
    )
    segment_parser.add_argument(
        "--keep-all-components",
        action="store_true",
        help="Keep all components (don't extract largest only)",
    )
    segment_parser.add_argument(
        "--levelset-iterations",
        type=int,
        default=100,
        help="Number of level-set iterations (default: 100)",
    )
    segment_parser.add_argument(
        "--ground-truth",
        help="Path to ground truth mask for metric computation",
    )
    segment_parser.add_argument(
        "--tumor-threshold-std",
        type=float,
        default=1.0,
        help="Tumor threshold: voxels > (mean + X*std). Lower = more sensitive. Default: 1.0",
    )
    segment_parser.add_argument(
        "--use-labels",
        help="Path to ground truth label file (.nii.gz) to use instead of classical segmentation",
    )
    segment_parser.add_argument(
        "--tumor-labels",
        default="1,2,3,4",
        help="Comma-separated label values to treat as tumor (for --use-labels). Default: 1,2,3,4",
    )
    segment_parser.add_argument(
        "--brain-labels",
        default="all",
        help="Label values for brain: 'all' (non-zero) or comma-separated values. Default: all",
    )

    # Mesh command (Phase A3 + A4)
    mesh_parser = subparsers.add_parser(
        "mesh",
        help="Generate 3D mesh from segmentation mask using Marching Cubes (Phase A3) with post-processing (Phase A4)",
    )
    mesh_parser.add_argument("input", help="Path to segmentation mask (.nii.gz)")
    mesh_parser.add_argument("output", help="Output directory for mesh files")
    mesh_parser.add_argument(
        "--formats",
        default="stl,obj",
        help="Comma-separated list of formats to export (stl,obj,ply). Default: stl,obj",
    )
    mesh_parser.add_argument(
        "--step-size",
        type=int,
        default=1,
        help="Marching cubes step size (larger = coarser mesh, faster). Default: 1",
    )
    mesh_parser.add_argument(
        "--ascii",
        action="store_true",
        help="Export ASCII format instead of binary (larger files)",
    )

    # Phase A4: Post-processing options
    mesh_parser.add_argument(
        "--no-postprocess",
        action="store_true",
        help="Skip all post-processing (NOT RECOMMENDED for 3D printing)",
    )
    mesh_parser.add_argument(
        "--no-fill-holes",
        action="store_true",
        help="Skip hole filling (keeps gaps in mesh)",
    )
    mesh_parser.add_argument(
        "--no-smooth",
        action="store_true",
        help="Skip smoothing (keeps jagged edges)",
    )
    mesh_parser.add_argument(
        "--no-repair",
        action="store_true",
        help="Skip manifold repair (may have non-manifold geometry)",
    )
    mesh_parser.add_argument(
        "--decimate",
        action="store_true",
        help="Enable decimation (reduce triangle count)",
    )
    mesh_parser.add_argument(
        "--decimation-target",
        type=float,
        default=0.5,
        help="Decimation reduction target (0.0-1.0). Default: 0.5 (50%% reduction)",
    )
    mesh_parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode: output coordinate diagnostics, overlays, and validation stats",
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 0

    # Dispatch to command handler
    if args.command == "resample":
        return cmd_resample(args)
    elif args.command == "segment":
        return cmd_segment(args)
    elif args.command == "mesh":
        return cmd_mesh(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
