#!/bin/bash
# Quick script to download meshes from API

if [ -z "$1" ]; then
  echo "Usage: ./download_meshes.sh <studyId>"
  echo "Example: ./download_meshes.sh abc-123-xyz"
  exit 1
fi

STUDY_ID=$1
OUTPUT_DIR="downloaded_meshes"

echo "Downloading meshes for study: $STUDY_ID"
echo "Output directory: $OUTPUT_DIR"

mkdir -p $OUTPUT_DIR

echo "Downloading brain.stl..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/brain.stl" -o "$OUTPUT_DIR/brain.stl"

echo "Downloading tumor.stl..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/tumor.stl" -o "$OUTPUT_DIR/tumor.stl"

echo "Downloading brain.obj..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/brain.obj" -o "$OUTPUT_DIR/brain.obj"

echo "Downloading brain.mtl..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/brain.mtl" -o "$OUTPUT_DIR/brain.mtl"

echo "Downloading tumor.obj..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/tumor.obj" -o "$OUTPUT_DIR/tumor.obj"

echo "Downloading tumor.mtl..."
curl -L "http://localhost:3000/studies/$STUDY_ID/download/mesh/tumor.mtl" -o "$OUTPUT_DIR/tumor.mtl"

echo ""
echo "✓ Download complete!"
echo "Files saved to: $OUTPUT_DIR/"
ls -lh $OUTPUT_DIR/

echo ""
echo "To open in Meshmixer:"
echo "  open -a 'Autodesk Meshmixer' $OUTPUT_DIR/brain.stl"
echo "  open -a 'Autodesk Meshmixer' $OUTPUT_DIR/tumor.stl"
