#!/bin/bash
# Download and view segmentation results

API_URL="http://localhost:3000"
OUTPUT_DIR="./results"

# Automatically get the latest study ID
echo "🔍 Fetching latest study..."
STUDY_ID=$(curl -s "$API_URL/studies" | jq -r 'sort_by(.createdAt) | .[-1].id')

if [ -z "$STUDY_ID" ] || [ "$STUDY_ID" = "null" ]; then
    echo "❌ Error: No studies found. Please upload a file first."
    exit 1
fi

echo "📋 Latest study ID: $STUDY_ID"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "📥 Downloading artifacts for study: $STUDY_ID"

# Download original file
echo "Downloading original volume..."
curl -L "$API_URL/studies/$STUDY_ID/download/original" -o "$OUTPUT_DIR/original.nii.gz"

# Download volume (processed - same as original for NIfTI uploads)
echo "Downloading processed volume..."
curl -L "$API_URL/studies/$STUDY_ID/download/volume" -o "$OUTPUT_DIR/volume.nii.gz"

# Download segmentation mask
echo "Downloading segmentation mask..."
curl -L "$API_URL/studies/$STUDY_ID/download/mask" -o "$OUTPUT_DIR/mask.nii.gz"

echo ""
echo "✅ Downloads complete! Files saved to: $OUTPUT_DIR"
echo ""
echo "📊 To view in 3D Slicer:"
echo "1. Open 3D Slicer"
echo "2. File -> Add Data"
echo "3. Load both files:"
echo "   - $OUTPUT_DIR/volume.nii.gz (the original image)"
echo "   - $OUTPUT_DIR/mask.nii.gz (the segmentation)"
echo "4. In the 'Volumes' module, you can overlay the mask on the volume"
echo "5. Use the 'Segment Editor' module to visualize in 3D"
echo ""
echo "🔍 To compare with ground truth:"
echo "   Run: python3 compare_segmentation.py"
