#!/usr/bin/env python3
"""
Visualize multi-label segmentation and export separate files for each label.
"""

import sys
import numpy as np
import SimpleITK as sitk
import matplotlib.pyplot as plt
from pathlib import Path


def visualize_multilabel_mask(mask_path: str, output_dir: str = "results"):
    """Load and visualize a multi-label segmentation mask."""

    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)

    print(f"Loading mask: {mask_path}")
    mask_img = sitk.ReadImage(mask_path)
    mask = sitk.GetArrayFromImage(mask_img)

    print(f"Mask shape: {mask.shape}")
    print(f"Mask dtype: {mask.dtype}")

    # Count labels
    unique_labels = np.unique(mask)
    print(f"\nUnique labels: {unique_labels}")

    label_names = {
        0: "Background",
        1: "Brain",
        2: "Tumor"
    }

    print("\n" + "="*60)
    print("LABEL DISTRIBUTION")
    print("="*60)
    for label in unique_labels:
        count = (mask == label).sum()
        percentage = count / mask.size * 100
        name = label_names.get(label, f"Unknown_{label}")
        print(f"Label {label} ({name:12s}): {count:10,} voxels ({percentage:5.2f}%)")

    # Find middle slices
    mid_axial = mask.shape[0] // 2
    mid_coronal = mask.shape[1] // 2
    mid_sagittal = mask.shape[2] // 2

    # Create visualization
    fig, axes = plt.subplots(2, 3, figsize=(15, 10))

    # Row 1: Show all labels together with color
    axes[0, 0].imshow(mask[mid_axial, :, :], cmap='nipy_spectral', vmin=0, vmax=2)
    axes[0, 0].set_title(f'Axial (slice {mid_axial})\nAll Labels')
    axes[0, 0].axis('off')

    axes[0, 1].imshow(mask[:, mid_coronal, :], cmap='nipy_spectral', vmin=0, vmax=2)
    axes[0, 1].set_title(f'Coronal (slice {mid_coronal})\nAll Labels')
    axes[0, 1].axis('off')

    axes[0, 2].imshow(mask[:, :, mid_sagittal], cmap='nipy_spectral', vmin=0, vmax=2)
    axes[0, 2].set_title(f'Sagittal (slice {mid_sagittal})\nAll Labels')
    axes[0, 2].axis('off')

    # Row 2: Show tumor only (highlighted)
    tumor_mask = mask == 2

    # Create RGB overlay: brain=grey, tumor=red
    axial_overlay = np.zeros((mask.shape[1], mask.shape[2], 3))
    brain_axial = mask[mid_axial, :, :] == 1
    tumor_axial = mask[mid_axial, :, :] == 2
    axial_overlay[brain_axial] = [0.5, 0.5, 0.5]  # Grey for brain
    axial_overlay[tumor_axial] = [1.0, 0, 0]  # Red for tumor

    axes[1, 0].imshow(axial_overlay)
    axes[1, 0].set_title(f'Axial\nTumor (red) in Brain (grey)')
    axes[1, 0].axis('off')

    coronal_overlay = np.zeros((mask.shape[0], mask.shape[2], 3))
    brain_coronal = mask[:, mid_coronal, :] == 1
    tumor_coronal = mask[:, mid_coronal, :] == 2
    coronal_overlay[brain_coronal] = [0.5, 0.5, 0.5]
    coronal_overlay[tumor_coronal] = [1.0, 0, 0]

    axes[1, 1].imshow(coronal_overlay)
    axes[1, 1].set_title(f'Coronal\nTumor (red) in Brain (grey)')
    axes[1, 1].axis('off')

    sagittal_overlay = np.zeros((mask.shape[0], mask.shape[1], 3))
    brain_sagittal = mask[:, :, mid_sagittal] == 1
    tumor_sagittal = mask[:, :, mid_sagittal] == 2
    sagittal_overlay[brain_sagittal] = [0.5, 0.5, 0.5]
    sagittal_overlay[tumor_sagittal] = [1.0, 0, 0]

    axes[1, 2].imshow(sagittal_overlay)
    axes[1, 2].set_title(f'Sagittal\nTumor (red) in Brain (grey)')
    axes[1, 2].axis('off')

    plt.tight_layout()
    viz_path = output_dir / "label_visualization.png"
    plt.savefig(viz_path, dpi=150, bbox_inches='tight')
    print(f"\n✅ Visualization saved to: {viz_path}")

    # Export separate NIfTI files for each label
    print("\n" + "="*60)
    print("EXPORTING SEPARATE LABEL FILES")
    print("="*60)

    # Brain only (label 1)
    brain_only = (mask == 1).astype(np.uint8)
    brain_img = sitk.GetImageFromArray(brain_only)
    brain_img.CopyInformation(mask_img)
    brain_path = output_dir / "brain_only.nii.gz"
    sitk.WriteImage(brain_img, str(brain_path))
    print(f"✓ Brain mask saved to: {brain_path}")

    # Tumor only (label 2)
    tumor_only = (mask == 2).astype(np.uint8)
    tumor_img = sitk.GetImageFromArray(tumor_only)
    tumor_img.CopyInformation(mask_img)
    tumor_path = output_dir / "tumor_only.nii.gz"
    sitk.WriteImage(tumor_img, str(tumor_path))
    print(f"✓ Tumor mask saved to: {tumor_path}")

    # Combined binary (brain + tumor as single object)
    combined = (mask > 0).astype(np.uint8)
    combined_img = sitk.GetImageFromArray(combined)
    combined_img.CopyInformation(mask_img)
    combined_path = output_dir / "brain_with_tumor.nii.gz"
    sitk.WriteImage(combined_img, str(combined_path))
    print(f"✓ Combined mask saved to: {combined_path}")

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print("Now you can load these in 3D Slicer:")
    print(f"  • {brain_path} - Brain tissue only")
    print(f"  • {tumor_path} - Tumor only (tiny!)")
    print(f"  • {combined_path} - Everything together")
    print("\nOr use the multi-label mask with Segment Editor:")
    print(f"  1. Load {mask_path}")
    print("  2. Segment Editor → Import/Export → Import from labelmap")
    print("  3. This will create 2 segments (brain + tumor)")
    print("="*60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python visualize_labels.py <mask.nii.gz>")
        print("\nExample:")
        print("  python visualize_labels.py results/mask.nii.gz")
        sys.exit(1)

    mask_path = sys.argv[1]
    if not Path(mask_path).exists():
        print(f"Error: File not found: {mask_path}")
        sys.exit(1)

    visualize_multilabel_mask(mask_path)
