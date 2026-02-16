"""Segmentation evaluation metrics."""

import logging
from typing import Dict

import numpy as np
import SimpleITK as sitk
from scipy import ndimage

logger = logging.getLogger(__name__)


class SegmentationMetrics:
    """Calculate segmentation quality metrics."""

    @staticmethod
    def dice_coefficient(pred: sitk.Image, gt: sitk.Image) -> float:
        """Calculate Dice similarity coefficient.

        Dice = 2 * |A ∩ B| / (|A| + |B|)

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.

        Returns:
            Dice coefficient (0-1, higher is better).
        """
        pred_array = sitk.GetArrayFromImage(pred).astype(bool)
        gt_array = sitk.GetArrayFromImage(gt).astype(bool)

        intersection = np.logical_and(pred_array, gt_array).sum()
        pred_sum = pred_array.sum()
        gt_sum = gt_array.sum()

        if pred_sum + gt_sum == 0:
            return 1.0  # Both empty

        dice = 2.0 * intersection / (pred_sum + gt_sum)
        return float(dice)

    @staticmethod
    def jaccard_index(pred: sitk.Image, gt: sitk.Image) -> float:
        """Calculate Jaccard index (IoU).

        Jaccard = |A ∩ B| / |A ∪ B|

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.

        Returns:
            Jaccard index (0-1, higher is better).
        """
        pred_array = sitk.GetArrayFromImage(pred).astype(bool)
        gt_array = sitk.GetArrayFromImage(gt).astype(bool)

        intersection = np.logical_and(pred_array, gt_array).sum()
        union = np.logical_or(pred_array, gt_array).sum()

        if union == 0:
            return 1.0  # Both empty

        jaccard = intersection / union
        return float(jaccard)

    @staticmethod
    def hausdorff_distance(
        pred: sitk.Image, gt: sitk.Image, percentile: float = 95.0
    ) -> float:
        """Calculate Hausdorff distance (95th percentile).

        Measures maximum surface distance between masks.

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.
            percentile: Percentile for robust Hausdorff (default 95).

        Returns:
            Hausdorff distance in mm.
        """
        # Use SimpleITK's Hausdorff distance filter
        hausdorff_filter = sitk.HausdorffDistanceImageFilter()
        hausdorff_filter.Execute(pred, gt)

        if percentile == 100.0:
            # Maximum Hausdorff distance
            return hausdorff_filter.GetHausdorffDistance()
        else:
            # For percentile-based, compute manually
            return SegmentationMetrics._percentile_hausdorff(pred, gt, percentile)

    @staticmethod
    def _percentile_hausdorff(
        pred: sitk.Image, gt: sitk.Image, percentile: float
    ) -> float:
        """Calculate percentile-based Hausdorff distance.

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.
            percentile: Percentile.

        Returns:
            Percentile Hausdorff distance in mm.
        """
        spacing = pred.GetSpacing()

        # Get surface points
        pred_surface = SegmentationMetrics._get_surface_points(pred)
        gt_surface = SegmentationMetrics._get_surface_points(gt)

        if len(pred_surface) == 0 or len(gt_surface) == 0:
            return 0.0

        # Scale by spacing
        pred_surface = pred_surface * np.array(spacing[::-1])  # Reverse for ZYX order
        gt_surface = gt_surface * np.array(spacing[::-1])

        # Compute distances from pred to gt
        distances_pred_to_gt = []
        for point in pred_surface:
            dist = np.min(np.linalg.norm(gt_surface - point, axis=1))
            distances_pred_to_gt.append(dist)

        # Compute distances from gt to pred
        distances_gt_to_pred = []
        for point in gt_surface:
            dist = np.min(np.linalg.norm(pred_surface - point, axis=1))
            distances_gt_to_pred.append(dist)

        # Combine both directions
        all_distances = distances_pred_to_gt + distances_gt_to_pred

        # Return percentile
        return float(np.percentile(all_distances, percentile))

    @staticmethod
    def _get_surface_points(mask: sitk.Image) -> np.ndarray:
        """Extract surface points from binary mask.

        Args:
            mask: Binary mask.

        Returns:
            Array of surface point coordinates (N, 3).
        """
        mask_array = sitk.GetArrayFromImage(mask).astype(bool)

        # Erode to find boundary
        eroded = ndimage.binary_erosion(mask_array)
        surface = np.logical_xor(mask_array, eroded)

        # Get coordinates
        points = np.argwhere(surface)
        return points

    @staticmethod
    def volume_similarity(pred: sitk.Image, gt: sitk.Image) -> float:
        """Calculate volume similarity.

        VS = 1 - |V_pred - V_gt| / (V_pred + V_gt)

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.

        Returns:
            Volume similarity (0-1, higher is better).
        """
        pred_array = sitk.GetArrayFromImage(pred).astype(bool)
        gt_array = sitk.GetArrayFromImage(gt).astype(bool)

        v_pred = pred_array.sum()
        v_gt = gt_array.sum()

        if v_pred + v_gt == 0:
            return 1.0

        vs = 1.0 - abs(v_pred - v_gt) / (v_pred + v_gt)
        return float(vs)

    @staticmethod
    def compute_all_metrics(
        pred: sitk.Image, gt: sitk.Image, percentile: float = 95.0
    ) -> Dict[str, float]:
        """Compute all segmentation metrics.

        Args:
            pred: Predicted binary mask.
            gt: Ground truth binary mask.
            percentile: Percentile for Hausdorff distance.

        Returns:
            Dictionary of metrics.
        """
        logger.info("Computing segmentation metrics...")

        metrics = {
            "dice": SegmentationMetrics.dice_coefficient(pred, gt),
            "jaccard": SegmentationMetrics.jaccard_index(pred, gt),
            "hausdorff_95": SegmentationMetrics.hausdorff_distance(pred, gt, percentile),
            "volume_similarity": SegmentationMetrics.volume_similarity(pred, gt),
        }

        logger.info(f"Metrics: Dice={metrics['dice']:.4f}, "
                   f"Hausdorff-95={metrics['hausdorff_95']:.2f}mm")

        return metrics
