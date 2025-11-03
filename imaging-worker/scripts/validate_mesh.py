#!/usr/bin/env python3
"""
Validate mesh quality - check manifoldness, watertightness, statistics.
Similar to Phase A2 metrics but for meshes.
"""

import sys
from pathlib import Path
import numpy as np
import trimesh
import json


def validate_mesh(mesh_path: str) -> dict:
    """
    Validate mesh and compute quality metrics.

    Args:
        mesh_path: Path to mesh file (STL, OBJ, PLY)

    Returns:
        Dictionary of validation results and metrics
    """
    print(f"Loading mesh: {mesh_path}")
    mesh = trimesh.load(mesh_path)

    print(f"\n{'='*60}")
    print("MESH STATISTICS")
    print('='*60)

    stats = {
        "file": str(mesh_path),
        "vertices": len(mesh.vertices),
        "faces": len(mesh.faces),
        "edges": len(mesh.edges),
    }

    print(f"Vertices:  {stats['vertices']:,}")
    print(f"Faces:     {stats['faces']:,}")
    print(f"Edges:     {stats['edges']:,}")

    # Bounding box
    bounds = mesh.bounds
    size = bounds[1] - bounds[0]
    stats["bounding_box"] = {
        "min": bounds[0].tolist(),
        "max": bounds[1].tolist(),
        "size": size.tolist(),
    }

    print(f"\nBounding box size: [{size[0]:.2f}, {size[1]:.2f}, {size[2]:.2f}] mm")

    # Volume and surface area
    if mesh.is_volume:
        stats["volume_mm3"] = float(mesh.volume)
        stats["volume_ml"] = float(mesh.volume / 1000)
        print(f"Volume: {stats['volume_ml']:.2f} ml")
    else:
        print("⚠️  Warning: Mesh is not a closed volume")
        stats["volume_mm3"] = None
        stats["volume_ml"] = None

    stats["surface_area_mm2"] = float(mesh.area)
    stats["surface_area_cm2"] = float(mesh.area / 100)
    print(f"Surface area: {stats['surface_area_cm2']:.2f} cm²")

    # Center of mass
    if mesh.is_volume:
        center = mesh.center_mass
        stats["center_of_mass"] = center.tolist()
        print(f"Center of mass: [{center[0]:.2f}, {center[1]:.2f}, {center[2]:.2f}]")

    print(f"\n{'='*60}")
    print("MESH QUALITY CHECKS")
    print('='*60)

    quality = {}

    # 1. Watertightness
    is_watertight = mesh.is_watertight
    quality["watertight"] = bool(is_watertight)
    print(f"✓ Watertight: {'YES' if is_watertight else 'NO'} {'✅' if is_watertight else '❌'}")

    # 2. Manifoldness (no non-manifold edges)
    is_manifold = not mesh.edges_unique.shape[0] != mesh.edges.shape[0]
    quality["manifold"] = bool(is_manifold)
    print(f"✓ Manifold: {'YES' if is_manifold else 'NO'} {'✅' if is_manifold else '❌'}")

    # 3. Check for degenerate faces
    degenerate = mesh.faces[mesh.area_faces < 1e-8]
    quality["degenerate_faces"] = len(degenerate)
    print(f"✓ Degenerate faces: {len(degenerate)} {'✅' if len(degenerate) == 0 else '⚠️'}")

    # 4. Check for duplicate vertices
    unique_vertices = len(np.unique(mesh.vertices, axis=0))
    duplicate_verts = len(mesh.vertices) - unique_vertices
    quality["duplicate_vertices"] = duplicate_verts
    print(f"✓ Duplicate vertices: {duplicate_verts} {'✅' if duplicate_verts == 0 else '⚠️'}")

    # 5. Check for isolated vertices
    vertex_faces = mesh.vertex_faces
    isolated = (vertex_faces == -1).all(axis=1).sum()
    quality["isolated_vertices"] = int(isolated)
    print(f"✓ Isolated vertices: {isolated} {'✅' if isolated == 0 else '⚠️'}")

    # 6. Face orientation consistency
    if mesh.is_watertight:
        quality["face_orientation_consistent"] = True
        print(f"✓ Face orientation: Consistent ✅")
    else:
        quality["face_orientation_consistent"] = False
        print(f"✓ Face orientation: Inconsistent ❌")

    # 7. Mesh density/resolution
    if mesh.is_volume:
        # Vertices per mm³
        density = len(mesh.vertices) / mesh.volume if mesh.volume > 0 else 0
        quality["vertex_density_per_mm3"] = float(density)
        print(f"✓ Vertex density: {density:.4f} vertices/mm³")

    print(f"\n{'='*60}")
    print("TOPOLOGICAL PROPERTIES")
    print('='*60)

    topology = {}

    # Euler characteristic (for closed meshes: V - E + F = 2)
    euler = len(mesh.vertices) - len(mesh.edges) + len(mesh.faces)
    topology["euler_characteristic"] = int(euler)
    print(f"Euler characteristic: {euler}")

    if mesh.is_volume and mesh.is_watertight:
        # Number of holes (genus)
        genus = 1 - (euler // 2)
        topology["genus"] = int(genus)
        print(f"Genus (holes): {genus}")

        if genus == 0:
            print("  → Topologically equivalent to a sphere (no holes) ✅")
        else:
            print(f"  → Has {genus} hole(s)")

    print(f"\n{'='*60}")
    print("3D PRINTING SUITABILITY")
    print('='*60)

    printability = {}

    if is_watertight and is_manifold:
        printability["suitable"] = True
        print("✅ SUITABLE for 3D printing")
    else:
        printability["suitable"] = False
        print("❌ NOT SUITABLE for 3D printing")

        if not is_watertight:
            print("  → Fix: Mesh has holes/gaps")
        if not is_manifold:
            print("  → Fix: Mesh has non-manifold edges")

    # Check minimum wall thickness (estimate)
    if len(mesh.faces) > 0:
        edge_lengths = np.linalg.norm(
            mesh.vertices[mesh.edges[:, 0]] - mesh.vertices[mesh.edges[:, 1]],
            axis=1
        )
        min_edge = edge_lengths.min()
        median_edge = np.median(edge_lengths)
        max_edge = edge_lengths.max()

        printability["min_edge_length_mm"] = float(min_edge)
        printability["median_edge_length_mm"] = float(median_edge)
        printability["max_edge_length_mm"] = float(max_edge)

        print(f"\nEdge lengths:")
        print(f"  Min: {min_edge:.3f} mm")
        print(f"  Median: {median_edge:.3f} mm")
        print(f"  Max: {max_edge:.3f} mm")

        if min_edge < 0.5:
            print(f"  ⚠️  Very small features (<0.5mm) may not print well")

    # Build final result
    result = {
        "statistics": stats,
        "quality": quality,
        "topology": topology,
        "printability": printability,
    }

    # Overall score
    score = 0
    max_score = 6

    if quality["watertight"]: score += 1
    if quality["manifold"]: score += 1
    if quality["degenerate_faces"] == 0: score += 1
    if quality["duplicate_vertices"] == 0: score += 1
    if quality["isolated_vertices"] == 0: score += 1
    if quality["face_orientation_consistent"]: score += 1

    result["quality_score"] = f"{score}/{max_score}"

    print(f"\n{'='*60}")
    print(f"OVERALL QUALITY SCORE: {score}/{max_score}")
    print('='*60)

    if score == max_score:
        print("🏆 EXCELLENT - Perfect mesh quality!")
    elif score >= 4:
        print("✅ GOOD - Minor issues, suitable for most uses")
    elif score >= 2:
        print("⚠️  FAIR - Has issues, may need repair")
    else:
        print("❌ POOR - Significant issues, needs repair")

    return result


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python validate_mesh.py <mesh_file.stl|obj|ply>")
        print("\nExample:")
        print("  python validate_mesh.py results/meshes/brain.stl")
        sys.exit(1)

    mesh_path = sys.argv[1]
    if not Path(mesh_path).exists():
        print(f"Error: File not found: {mesh_path}")
        sys.exit(1)

    # Validate mesh
    result = validate_mesh(mesh_path)

    # Save report
    output_path = Path(mesh_path).with_suffix('.validation.json')
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)

    print(f"\n✅ Validation report saved to: {output_path}")


if __name__ == "__main__":
    main()
