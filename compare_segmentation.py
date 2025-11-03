#!/usr/bin/env python3
"""
Compare segmentation results with ground truth.
Computes Dice coefficient, Hausdorff distance, and other metrics.
"""

import sys
from pathlib import Path
import numpy as np
import SimpleITK as sitk
import json


def compute_dice(pred: np.ndarray, gt: np.ndarray) -> float:
    """Compute Dice similarity coefficient."""
    intersection = np.logical_and(pred, gt).sum()
    if pred.sum() + gt.sum() == 0:
        return 1.0 if pred.sum() == 0 and gt.sum() == 0 else 0.0
    return 2.0 * intersection / (pred.sum() + gt.sum())


def compute_jaccard(pred: np.ndarray, gt: np.ndarray) -> float:
    """Compute Jaccard index (IoU)."""
    intersection = np.logical_and(pred, gt).sum()
    union = np.logical_or(pred, gt).sum()
    if union == 0:
        return 1.0 if intersection == 0 else 0.0
    return intersection / union


def compute_hausdorff(pred_img: sitk.Image, gt_img: sitk.Image) -> dict:
    """Compute Hausdorff distances."""
    hausdorff_filter = sitk.HausdorffDistanceImageFilter()
    hausdorff_filter.Execute(pred_img, gt_img)

    return {
        'hausdorff': hausdorff_filter.GetHausdorffDistance(),
        'average_hausdorff': hausdorff_filter.GetAverageHausdorffDistance(),
    }


def compute_volume_similarity(pred: np.ndarray, gt: np.ndarray) -> float:
    """Compute volume similarity."""
    pred_vol = pred.sum()
    gt_vol = gt.sum()
    if pred_vol + gt_vol == 0:
        return 1.0
    return 1.0 - abs(pred_vol - gt_vol) / (pred_vol + gt_vol)


def compare_segmentations(pred_path: str, gt_path: str) -> dict:
    """
    Compare predicted segmentation with ground truth.

    Args:
        pred_path: Path to predicted segmentation mask
        gt_path: Path to ground truth mask

    Returns:
        Dictionary of metrics
    """
    print(f"Loading predicted mask: {pred_path}")
    pred_img = sitk.ReadImage(pred_path)
    pred = sitk.GetArrayFromImage(pred_img) > 0

    print(f"Loading ground truth mask: {gt_path}")
    gt_img = sitk.ReadImage(gt_path)
    gt = sitk.GetArrayFromImage(gt_img) > 0

    print(f"\nPredicted shape: {pred.shape}, sum: {pred.sum():,}")
    print(f"Ground truth shape: {gt.shape}, sum: {gt.sum():,}")

    if pred.shape != gt.shape:
        print("⚠️  Warning: Shapes don't match! Attempting to resample...")
        # Resample prediction to match ground truth
        resampler = sitk.ResampleImageFilter()
        resampler.SetReferenceImage(gt_img)
        resampler.SetInterpolator(sitk.sitkNearestNeighbor)
        pred_img = resampler.Execute(pred_img)
        pred = sitk.GetArrayFromImage(pred_img) > 0
        print(f"Resampled prediction shape: {pred.shape}")

    print("\n📊 Computing metrics...")

    # Compute metrics
    metrics = {
        'dice': compute_dice(pred, gt),
        'jaccard': compute_jaccard(pred, gt),
        'volume_similarity': compute_volume_similarity(pred, gt),
        'sensitivity': float(np.logical_and(pred, gt).sum() / gt.sum() if gt.sum() > 0 else 0),
        'specificity': float(np.logical_and(~pred, ~gt).sum() / (~gt).sum() if (~gt).sum() > 0 else 0),
        'pred_volume_voxels': int(pred.sum()),
        'gt_volume_voxels': int(gt.sum()),
    }

    # Compute Hausdorff if both masks are non-empty
    if pred.sum() > 0 and gt.sum() > 0:
        hausdorff_metrics = compute_hausdorff(
            sitk.Cast(pred_img, sitk.sitkUInt8),
            sitk.Cast(gt_img, sitk.sitkUInt8)
        )
        metrics.update(hausdorff_metrics)
    else:
        metrics['hausdorff'] = float('inf')
        metrics['average_hausdorff'] = float('inf')

    return metrics


def main():
    """Main entry point."""
    if len(sys.argv) < 3:
        print("Usage: python compare_segmentation.py <predicted_mask.nii.gz> <ground_truth_mask.nii.gz>")
        print("\nExample:")
        print("  python compare_segmentation.py results/mask.nii.gz path/to/ground_truth.nii.gz")
        sys.exit(1)

    pred_path = sys.argv[1]
    gt_path = sys.argv[2]

    if not Path(pred_path).exists():
        print(f"❌ Error: Predicted mask not found: {pred_path}")
        sys.exit(1)

    if not Path(gt_path).exists():
        print(f"❌ Error: Ground truth mask not found: {gt_path}")
        sys.exit(1)

    # Compare
    metrics = compare_segmentations(pred_path, gt_path)

    # Display results
    print("\n" + "="*60)
    print("📊 SEGMENTATION COMPARISON RESULTS")
    print("="*60)
    print(f"Dice Coefficient:        {metrics['dice']:.4f}")
    print(f"Jaccard Index (IoU):     {metrics['jaccard']:.4f}")
    print(f"Volume Similarity:       {metrics['volume_similarity']:.4f}")
    print(f"Sensitivity (Recall):    {metrics['sensitivity']:.4f}")
    print(f"Specificity:             {metrics['specificity']:.4f}")

    if metrics.get('hausdorff') != float('inf'):
        print(f"Hausdorff Distance:      {metrics['hausdorff']:.2f} mm")
        print(f"Average Hausdorff:       {metrics['average_hausdorff']:.2f} mm")

    print(f"\nPredicted Volume:        {metrics['pred_volume_voxels']:,} voxels")
    print(f"Ground Truth Volume:     {metrics['gt_volume_voxels']:,} voxels")
    print("="*60)

    # Save metrics
    output_path = Path("comparison_metrics.json")
    with open(output_path, "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\n✅ Metrics saved to: {output_path}")

    # Interpretation
    print("\n💡 Interpretation:")
    if metrics['dice'] >= 0.9:
        print("   Excellent segmentation! (Dice ≥ 0.9)")
    elif metrics['dice'] >= 0.7:
        print("   Good segmentation (0.7 ≤ Dice < 0.9)")
    elif metrics['dice'] >= 0.5:
        print("   Moderate segmentation (0.5 ≤ Dice < 0.7)")
    else:
        print("   Poor segmentation (Dice < 0.5)")


if __name__ == "__main__":
    main()
