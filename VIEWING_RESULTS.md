# How to View and Compare Your Segmentation Results

## Quick Start

### 1. Download Your Results

```bash
./download_and_view.sh
```

This will download:
- `results/original.nii.gz` - Your original uploaded image
- `results/volume.nii.gz` - The processed volume
- `results/mask.nii.gz` - **Your segmentation result**

### 2. View in 3D Slicer

**Install 3D Slicer** (if you haven't already):
- Download from: https://download.slicer.org/
- Free and works on Mac/Windows/Linux

**Load Your Files:**

1. Open 3D Slicer
2. Go to: **File → Add Data** (or drag and drop files)
3. Select both files:
   - `results/volume.nii.gz` (your original MRI scan)
   - `results/mask.nii.gz` (your segmentation)
4. Click "Show Options" and check "Show Options" for the mask
5. Change the mask's "Label Map" setting to ON

**Visualize in 3D:**

1. Go to the **Segment Editor** module (dropdown at top)
2. Click "Add" to create a segment
3. Import your mask: **Import/Export → Import from labelmap → mask.nii.gz**
4. Click "Show 3D" button to see the 3D rendering
5. Use the slice viewers to see overlays on each plane (axial, sagittal, coronal)

**Adjust Visualization:**

- In the **Volumes** module, you can adjust window/level for the MRI
- In **Segment Editor**, you can change the segment color and opacity
- Use the 3D view controls to rotate, zoom, and pan

### 3. Compare with Ground Truth

If you have the ground truth segmentation from BraTS (usually called `*_seg.nii.gz`):

```bash
python3 compare_segmentation.py results/mask.nii.gz path/to/BRATS_001_seg.nii.gz
```

This will compute and display:
- **Dice Coefficient** (0-1, higher is better, >0.9 is excellent)
- **Jaccard Index** (IoU)
- **Hausdorff Distance** (mm, lower is better)
- **Volume Similarity**
- **Sensitivity & Specificity**

Results are saved to `comparison_metrics.json`.

### 4. Compare Side-by-Side in 3D Slicer

To compare your segmentation with ground truth:

1. Load all three files:
   - `results/volume.nii.gz` (original image)
   - `results/mask.nii.gz` (your segmentation)
   - `BRATS_001_seg.nii.gz` (ground truth)

2. In **Segment Editor**:
   - Import your mask as "My Segmentation" (red)
   - Import ground truth as "Ground Truth" (green)
   - Use different colors to see overlap

3. The overlap shows:
   - **Red only**: False positives (you segmented, but not in GT)
   - **Green only**: False negatives (missed by your algorithm)
   - **Yellow (red+green)**: True positives (correct segmentation)

## API Endpoints

You can also use the API directly:

```bash
# Get all studies
curl http://localhost:3000/studies

# Get specific study details
curl http://localhost:3000/studies/9683d2ce-c25c-47b9-bfe9-a8c2947e2de1

# Get all artifact URLs (signed S3 URLs)
curl http://localhost:3000/studies/9683d2ce-c25c-47b9-bfe9-a8c2947e2de1/artifacts

# Direct downloads (these redirect to S3)
curl -L http://localhost:3000/studies/9683d2ce-c25c-47b9-bfe9-a8c2947e2de1/download/mask -o mask.nii.gz
```

## Understanding Your Segmentation Results

From your metadata:
```json
{
  "method": "classical",
  "otsu_threshold": 408.27,
  "foreground_voxels": 1,409,339,
  "foreground_fraction": 15.8%,
  "volume_ml": 1409.3 ml
}
```

**This means:**
- Algorithm used: Otsu thresholding + morphology
- Intensity threshold: 408.27
- Segmented region: ~1.4 liters (15.8% of total volume)
- For brain tumor: This seems quite large - might be segmenting the whole brain rather than just tumor

**Expected for brain tumor:**
- Typical glioblastoma: 20-60 ml
- Large tumors: 60-150 ml
- Your result (1409 ml) suggests it's likely segmenting more than just the tumor

**Improvement ideas:**
1. Use a different channel (T1-contrast or FLAIR might be better for tumor)
2. Add region of interest (ROI) preprocessing
3. Use the deep learning path (U-Net) - coming in Phase B2
4. Adjust morphological parameters
5. Add intensity-based constraints

## Next Steps

1. **Download and view** your current results
2. **Compare with ground truth** to see actual performance
3. **Iterate on parameters** in the segmentation algorithm
4. **Try different MRI channels** (your data has 4 channels: T1, T1c, T2, FLAIR)
5. **Implement U-Net** for better automatic segmentation (Phase B2)

## Troubleshooting

**Can't download files?**
- Make sure the server is running: `cd orchestration && npm run start:dev`
- Check MinIO is running: `docker ps` should show minio container

**3D Slicer not showing overlay?**
- Make sure mask is set as "Label Map"
- Adjust opacity in Volumes module
- Try switching slice viewer backgrounds

**Ground truth has different size?**
- The comparison script will automatically resample
- Make sure you're using the correct corresponding ground truth file

**Want to try different segmentation parameters?**
- Check `imaging-worker/src/seg/classical.py`
- Parameters: closing_radius, opening_radius, fill_holes
- Can modify the CLI in `imaging-worker/src/cli.py`
