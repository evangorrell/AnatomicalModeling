# Testing Phase A2: Classical Segmentation

Now that you have **Phase A2** complete, you can test segmentation with your brain tumor dataset!

## What You Have

From the Medical Segmentation Decathlon dataset:
- `imagesTr/*.nii.gz` - Training images (brain MRI scans)
- `imagesTs/*.nii.gz` - Test images
- `labelsTr/*.nii.gz` - **Ground truth segmentations** (expert-labeled tumor masks)

## Option 1: Test via CLI (Fastest)

### Segment a Single Image

```bash
cd imaging-worker
source .venv/bin/activate

# Segment an image WITHOUT ground truth
python -m src.cli segment \
  /path/to/dataset/imagesTr/brain_001.nii.gz \
  ./output/brain_001/

# Segment WITH ground truth comparison
python -m src.cli segment \
  /path/to/dataset/imagesTr/brain_001.nii.gz \
  ./output/brain_001/ \
  --ground-truth /path/to/dataset/labelsTr/brain_001.nii.gz
```

### Expected Output

```
Segmenting volume: /path/to/dataset/imagesTr/brain_001.nii.gz
Loaded volume: size=(240, 240, 155), spacing=(1.0, 1.0, 1.0)
Starting classical segmentation...
Step 1: Otsu thresholding...
Otsu threshold: 152.34
Step 2: Morphological closing (radius=2)...
Step 3: Filling holes...
Step 4: Morphological opening (radius=2)...
Step 5: Extracting largest connected component...
✓ Segmentation complete
  Method: classical
  Foreground voxels: 1,234,567
  Volume: 1234.57 ml

Comparing with ground truth...
✓ Metrics computed:
  Dice coefficient: 0.8234
  Jaccard index: 0.7012
  Hausdorff-95: 4.23 mm
  Volume similarity: 0.9456
```

### Output Files

```
output/brain_001/
├── mask.nii.gz                    # Binary segmentation
├── segmentation_metadata.json     # Segmentation parameters
└── metrics.json                   # Dice, Hausdorff, etc. (if ground truth provided)
```

## Option 2: Test via API

### Upload NIfTI File

```bash
# Start API if not running
cd orchestration
npm run start:dev

# Upload a brain scan
curl -X POST http://localhost:3000/studies/upload \
  -F "file=@/path/to/dataset/imagesTr/brain_001.nii.gz"
```

### Response

```json
{
  "studyId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "NIfTI volume uploaded and segmented successfully",
  "fileType": "nifti"
}
```

### View Results

```bash
# Get study details (including segmentation metadata)
curl http://localhost:3000/studies/{studyId}
```

### Download Segmentation Mask

Go to MinIO console:
1. Open http://localhost:9001
2. Login: `minioadmin` / `minioadmin`
3. Browse: `dicom-artifacts/studies/{studyId}/mask.nii.gz`
4. Download the mask

## Advanced Options

### Use Level-Set Refinement

```bash
# More accurate but slower
python -m src.cli segment \
  /path/to/dataset/imagesTr/brain_001.nii.gz \
  ./output/brain_001_levelset/ \
  --method levelset \
  --levelset-iterations 200
```

### Customize Morphology

```bash
# Larger closing to fill bigger gaps
python -m src.cli segment \
  /path/to/dataset/imagesTr/brain_001.nii.gz \
  ./output/brain_001_custom/ \
  --closing-radius 5 \
  --opening-radius 3
```

### Keep All Components

```bash
# Don't extract only largest component
python -m src.cli segment \
  /path/to/dataset/imagesTr/brain_001.nii.gz \
  ./output/brain_001_all/ \
  --keep-all-components
```

## Batch Processing Multiple Scans

```bash
# Process all training images
cd imaging-worker
source .venv/bin/activate

for image in /path/to/dataset/imagesTr/*.nii.gz; do
  basename=$(basename "$image" .nii.gz)
  label="/path/to/dataset/labelsTr/${basename}.nii.gz"

  echo "Processing $basename..."
  python -m src.cli segment \
    "$image" \
    "./output/$basename/" \
    --ground-truth "$label"
done

# Collect all metrics
echo "Scan,Dice,Jaccard,Hausdorff95,VolumeSimilarity" > results.csv
for dir in output/*/; do
  if [ -f "${dir}metrics.json" ]; then
    python -c "
import json
import sys
with open('${dir}metrics.json') as f:
    m = json.load(f)
    name = '${dir}'.split('/')[-2]
    print(f\"{name},{m['dice']},{m['jaccard']},{m['hausdorff_95']},{m['volume_similarity']}\")
" >> results.csv
  fi
done

cat results.csv
```

## Understanding the Metrics

- **Dice Coefficient** (0-1, higher better): Overlap between prediction and ground truth
  - >0.9: Excellent
  - 0.7-0.9: Good
  - <0.7: Needs improvement

- **Jaccard Index** (0-1, higher better): Intersection over union
  - Always lower than Dice
  - More conservative metric

- **Hausdorff Distance** (mm, lower better): Maximum surface distance error
  - <5mm: Very good
  - 5-10mm: Acceptable
  - >10mm: Check for issues

- **Volume Similarity** (0-1, higher better): How close the volumes match
  - >0.95: Excellent volume match
  - 0.85-0.95: Good

## Visualizing Results

### Option 1: Use ITK-SNAP (Free Software)

```bash
# Download from: http://www.itksnap.org/
# Open the image and mask as overlay
```

### Option 2: Use Python

```python
import nibabel as nib
import matplotlib.pyplot as plt

# Load image and mask
image = nib.load('/path/to/imagesTr/brain_001.nii.gz')
mask = nib.load('./output/brain_001/mask.nii.gz')

# Plot middle slice
slice_idx = image.shape[2] // 2
plt.figure(figsize=(12, 5))

plt.subplot(1, 2, 1)
plt.imshow(image.get_fdata()[:, :, slice_idx], cmap='gray')
plt.title('Original Image')

plt.subplot(1, 2, 2)
plt.imshow(image.get_fdata()[:, :, slice_idx], cmap='gray')
plt.imshow(mask.get_fdata()[:, :, slice_idx], cmap='Reds', alpha=0.5)
plt.title('Image + Segmentation Overlay')

plt.show()
```

## Troubleshooting

### Segmentation is all background or all foreground

Try adjusting morphology parameters:
```bash
python -m src.cli segment ... --closing-radius 0 --opening-radius 0
```

### Multiple disconnected components

The algorithm keeps the largest by default. To see all:
```bash
python -m src.cli segment ... --keep-all-components
```

### Low Dice score

- Brain tumor segmentation is challenging
- Classical methods struggle with diffuse tumors
- Phase B2 (U-Net) will improve results significantly

## Next Steps

After testing segmentation:
- **Phase A3**: Implement custom Marching Cubes for surface extraction
- **Phase A4**: Add mesh smoothing and STL/OBJ export
- **Phase A5**: Build web viewer with 3D visualization

Ready to proceed? Just say: **"Implement Custom Marching Cubes + normals and benchmark vs VTK"**
