#!/bin/bash
# Final codebase cleanup - Remove old/redundant files
# Keep: early_phase_meshes (comparison), final_test (production), core code

echo "🧹 Starting final codebase cleanup..."
echo "================================================"

# Safety check
if [ ! -f "CLAUDE.md" ]; then
    echo "❌ Error: Must run from project root!"
    exit 1
fi

echo ""
echo "📁 REMOVING: Old intermediate results..."

# Remove old result files (keep early_phase_meshes and final_test)
rm -f results/mask.nii.gz
rm -f results/volume.nii.gz
rm -f results/original.nii.gz
rm -f results/brain_only.nii.gz
rm -f results/brain_with_tumor.nii.gz
rm -f results/tumor_only.nii.gz
rm -f results/label_visualization.png
rm -f results/.DS_Store

# Remove old mesh directories (redundant)
rm -rf results/meshes  # Old 3/6 quality meshes
rm -rf results/meshes_a4  # Intermediate test
rm -rf test_meshes  # Duplicate old meshes
rm -rf downloaded_meshes  # API download cache

echo "  ✓ Removed old result files"

echo ""
echo "📄 REMOVING: Redundant/temporary scripts..."

# Remove temporary conversion scripts
rm -f convert_to_ascii.py

# Remove old cleanup scripts (this will be the new one)
rm -f cleanup.sh

# Keep these useful scripts:
# - compare_segmentation.py (useful tool)
# - visualize_labels.py (useful tool)
# - download_meshes.sh (API helper)
# - view_mesh.html (browser viewer)
# - download_and_view.sh (quick viewer)

echo "  ✓ Removed temporary scripts"

echo ""
echo "📚 CONSOLIDATING: Documentation..."

# Remove redundant old documentation
rm -f CLEANUP_PLAN.md  # Old, no longer relevant
rm -f PROJECT_STRUCTURE.md  # Will be replaced with updated version

# Keep these docs:
# - CLAUDE.md (main instructions)
# - README.md (project overview)
# - PHASE_A3_COMPLETE.md (Phase A3 guide)
# - PHASE_A4_SUMMARY.md (Phase A4 analysis)
# - SEGMENTATION_IMPROVEMENTS_SUCCESS.md (final results)
# - VIEWING_RESULTS.md (how to view meshes)

echo "  ✓ Consolidated documentation"

echo ""
echo "🗑️  REMOVING: System files..."

# Remove all .DS_Store files
find . -name ".DS_Store" -type f -delete

echo "  ✓ Removed .DS_Store files"

echo ""
echo "📊 CURRENT STATE:"
echo "================================================"

echo ""
echo "📁 Results directory:"
du -sh results/early_phase_meshes 2>/dev/null && echo "  ✓ early_phase_meshes/ (kept for comparison)"
du -sh results/final_test 2>/dev/null && echo "  ✓ final_test/ (production-ready 5/6 quality)"
du -sh results/improved_seg 2>/dev/null && echo "  ✓ improved_seg/ (improved segmentation mask)"

echo ""
echo "📄 Root scripts:"
ls -1 *.sh *.py *.html 2>/dev/null | while read file; do
    echo "  ✓ $file"
done

echo ""
echo "📚 Documentation:"
ls -1 *.md 2>/dev/null | while read file; do
    echo "  ✓ $file"
done

echo ""
echo "================================================"
echo "✅ Cleanup complete!"
echo ""
echo "📦 KEPT:"
echo "  - results/early_phase_meshes/ (old 3/6 quality for comparison)"
echo "  - results/final_test/ (new 5/6 quality meshes)"
echo "  - results/improved_seg/ (improved segmentation)"
echo "  - Useful scripts (compare_segmentation.py, visualize_labels.py, etc.)"
echo "  - Core documentation (CLAUDE.md, README.md, phase guides)"
echo ""
echo "🗑️  REMOVED:"
echo "  - Old intermediate results (mask.nii.gz, volume.nii.gz, etc.)"
echo "  - Old mesh directories (results/meshes, results/meshes_a4)"
echo "  - Duplicate mesh folders (test_meshes/)"
echo "  - Temporary scripts (convert_to_ascii.py, cleanup.sh)"
echo "  - Redundant docs (CLEANUP_PLAN.md, old PROJECT_STRUCTURE.md)"
echo "  - All .DS_Store files"
echo ""
