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
        # Load volume
        image = sitk.ReadImage(str(input_path))
        logger.info(f"Loaded volume: size={image.GetSize()}, spacing={image.GetSpacing()}")

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

        # Segment
        segmenter = ClassicalSegmenter(
            closing_radius=args.closing_radius,
            opening_radius=args.opening_radius,
            fill_holes=not args.no_fill_holes,
            largest_component_only=not args.keep_all_components,
        )

        if args.method == "levelset":
            mask, metadata = segmenter.segment_with_levelset(
                image, iterations=args.levelset_iterations, output_dir=output_dir
            )
        else:
            mask, metadata = segmenter.segment(image, output_dir)

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
        # Load segmentation mask
        logger.info("Loading segmentation mask...")
        mask_img = sitk.ReadImage(str(input_path))
        spacing = mask_img.GetSpacing()

        logger.info(f"Mask size: {mask_img.GetSize()}")
        logger.info(f"Mask spacing: {spacing}")

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)

        # Get unique labels
        mask_array = sitk.GetArrayFromImage(mask_img)
        labels = np.unique(mask_array)
        labels = labels[labels > 0]  # Skip background (0)

        logger.info(f"Found {len(labels)} non-background labels: {labels}")

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
        for label in labels:
            label_name = label_names.get(label, f"label_{label}")
            label_color = label_colors.get(label, (0.5, 0.5, 0.5))

            logger.info(f"\n{'='*60}")
            logger.info(f"Processing label {label}: {label_name}")
            logger.info('='*60)

            # Create binary mask for this label
            binary_mask = (mask_array == label).astype(np.float32)
            logger.info(f"Label {label} voxels: {binary_mask.sum():,}")

            # Extract surface
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

            # Store metadata
            meshes_metadata[label_name] = {
                "label_value": int(label),
                "vertices": mesh.n_vertices,
                "faces": mesh.n_faces,
                "voxels": int(binary_mask.sum()),
                "post_processed": not args.no_postprocess,
            }

            # Export in requested formats
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

        # Save metadata
        metadata_path = output_dir / "mesh_metadata.json"
        metadata = {
            "input_file": str(input_path),
            "step_size": args.step_size,
            "formats": formats,
            "meshes": meshes_metadata,
        }

        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

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
