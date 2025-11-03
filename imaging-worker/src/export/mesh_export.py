"""
Mesh export functions for STL, OBJ, and PLY formats.

Supports multi-label meshes with different materials/colors.
"""

import logging
from pathlib import Path
from typing import Optional, Dict
import numpy as np
import struct

logger = logging.getLogger(__name__)


def export_stl(
    vertices: np.ndarray,
    faces: np.ndarray,
    output_path: Path,
    normals: Optional[np.ndarray] = None,
    binary: bool = True,
    label: Optional[str] = None,
) -> None:
    """
    Export mesh to STL format (STereoLithography).

    Args:
        vertices: (N, 3) array of vertex positions
        faces: (M, 3) array of triangle indices
        output_path: Path to output .stl file
        normals: Optional (N, 3) array of vertex normals (computed if not provided)
        binary: If True, write binary STL (faster, smaller). Otherwise ASCII.
        label: Optional label name for the solid
    """
    logger.info(f"Exporting STL to {output_path} (binary={binary})...")

    # Compute face normals if not provided
    if normals is None:
        face_normals = _compute_face_normals(vertices, faces)
    else:
        # Average vertex normals to get face normals
        face_normals = np.mean(normals[faces], axis=1)
        # Normalize
        norms = np.linalg.norm(face_normals, axis=1, keepdims=True)
        norms[norms < 1e-8] = 1.0
        face_normals /= norms

    if binary:
        _write_stl_binary(vertices, faces, face_normals, output_path, label)
    else:
        _write_stl_ascii(vertices, faces, face_normals, output_path, label)

    logger.info(f"✓ Exported {len(faces):,} triangles to {output_path}")


def export_obj(
    vertices: np.ndarray,
    faces: np.ndarray,
    output_path: Path,
    normals: Optional[np.ndarray] = None,
    label: Optional[str] = None,
    material_color: Optional[tuple] = None,
) -> None:
    """
    Export mesh to OBJ format (Wavefront OBJ).

    Args:
        vertices: (N, 3) array of vertex positions
        faces: (M, 3) array of triangle indices
        output_path: Path to output .obj file
        normals: Optional (N, 3) array of vertex normals
        label: Optional label name for the object
        material_color: Optional RGB color tuple (0-1) for material
    """
    logger.info(f"Exporting OBJ to {output_path}...")

    with open(output_path, 'w') as f:
        # Header
        f.write(f"# Wavefront OBJ file\n")
        if label:
            f.write(f"# Object: {label}\n")
        f.write(f"# Vertices: {len(vertices)}\n")
        f.write(f"# Faces: {len(faces)}\n\n")

        # Material library (if color provided)
        if material_color is not None:
            mtl_path = output_path.with_suffix('.mtl')
            _write_mtl_file(mtl_path, label or "material", material_color)
            f.write(f"mtllib {mtl_path.name}\n\n")

        # Object name
        obj_name = label or "mesh"
        f.write(f"o {obj_name}\n\n")

        # Vertices
        for v in vertices:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        f.write("\n")

        # Normals
        if normals is not None:
            for n in normals:
                f.write(f"vn {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}\n")
            f.write("\n")

        # Material
        if material_color is not None:
            f.write(f"usemtl {label or 'material'}\n\n")

        # Faces (OBJ uses 1-based indexing)
        if normals is not None:
            for face in faces:
                f.write(f"f {face[0]+1}//{face[0]+1} {face[1]+1}//{face[1]+1} {face[2]+1}//{face[2]+1}\n")
        else:
            for face in faces:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")

    logger.info(f"✓ Exported {len(faces):,} triangles to {output_path}")


def export_ply(
    vertices: np.ndarray,
    faces: np.ndarray,
    output_path: Path,
    normals: Optional[np.ndarray] = None,
    colors: Optional[np.ndarray] = None,
    binary: bool = True,
) -> None:
    """
    Export mesh to PLY format (Polygon File Format).

    Args:
        vertices: (N, 3) array of vertex positions
        faces: (M, 3) array of triangle indices
        output_path: Path to output .ply file
        normals: Optional (N, 3) array of vertex normals
        colors: Optional (N, 3) array of RGB colors (0-255)
        binary: If True, write binary PLY. Otherwise ASCII.
    """
    logger.info(f"Exporting PLY to {output_path} (binary={binary})...")

    if binary:
        _write_ply_binary(vertices, faces, output_path, normals, colors)
    else:
        _write_ply_ascii(vertices, faces, output_path, normals, colors)

    logger.info(f"✓ Exported {len(faces):,} triangles to {output_path}")


# ============================================================================
# Helper Functions
# ============================================================================

def _compute_face_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Compute face normals from vertices and faces."""
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]

    edge1 = v1 - v0
    edge2 = v2 - v0
    normals = np.cross(edge1, edge2)

    # Normalize
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms[norms < 1e-8] = 1.0
    normals /= norms

    return normals


def _write_stl_binary(
    vertices: np.ndarray,
    faces: np.ndarray,
    face_normals: np.ndarray,
    output_path: Path,
    label: Optional[str],
) -> None:
    """Write binary STL file."""
    with open(output_path, 'wb') as f:
        # Header (80 bytes)
        header = (label or "mesh")[:80].ljust(80, '\0').encode('utf-8')
        f.write(header)

        # Number of triangles (4 bytes, unsigned int)
        f.write(struct.pack('<I', len(faces)))

        # Triangles
        for face_idx, face in enumerate(faces):
            # Normal (3 floats)
            normal = face_normals[face_idx]
            f.write(struct.pack('<fff', *normal))

            # Vertices (3 x 3 floats)
            for vertex_idx in face:
                v = vertices[vertex_idx]
                f.write(struct.pack('<fff', *v))

            # Attribute byte count (2 bytes, typically 0)
            f.write(struct.pack('<H', 0))


def _write_stl_ascii(
    vertices: np.ndarray,
    faces: np.ndarray,
    face_normals: np.ndarray,
    output_path: Path,
    label: Optional[str],
) -> None:
    """Write ASCII STL file."""
    with open(output_path, 'w') as f:
        solid_name = label or "mesh"
        f.write(f"solid {solid_name}\n")

        for face_idx, face in enumerate(faces):
            normal = face_normals[face_idx]
            f.write(f"  facet normal {normal[0]:.6e} {normal[1]:.6e} {normal[2]:.6e}\n")
            f.write(f"    outer loop\n")

            for vertex_idx in face:
                v = vertices[vertex_idx]
                f.write(f"      vertex {v[0]:.6e} {v[1]:.6e} {v[2]:.6e}\n")

            f.write(f"    endloop\n")
            f.write(f"  endfacet\n")

        f.write(f"endsolid {solid_name}\n")


def _write_ply_binary(
    vertices: np.ndarray,
    faces: np.ndarray,
    output_path: Path,
    normals: Optional[np.ndarray],
    colors: Optional[np.ndarray],
) -> None:
    """Write binary PLY file."""
    with open(output_path, 'wb') as f:
        # Write ASCII header
        header = _create_ply_header(vertices, faces, normals, colors, binary=True)
        f.write(header.encode('utf-8'))

        # Write vertex data (binary)
        for i, v in enumerate(vertices):
            # Position
            f.write(struct.pack('<fff', *v))

            # Normal
            if normals is not None:
                f.write(struct.pack('<fff', *normals[i]))

            # Color
            if colors is not None:
                f.write(struct.pack('<BBB', *colors[i]))

        # Write face data (binary)
        for face in faces:
            # Number of vertices in face (always 3 for triangles)
            f.write(struct.pack('<B', 3))
            # Vertex indices
            f.write(struct.pack('<III', *face))


def _write_ply_ascii(
    vertices: np.ndarray,
    faces: np.ndarray,
    output_path: Path,
    normals: Optional[np.ndarray],
    colors: Optional[np.ndarray],
) -> None:
    """Write ASCII PLY file."""
    with open(output_path, 'w') as f:
        # Write header
        header = _create_ply_header(vertices, faces, normals, colors, binary=False)
        f.write(header)

        # Write vertex data
        for i, v in enumerate(vertices):
            line = f"{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}"

            if normals is not None:
                n = normals[i]
                line += f" {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}"

            if colors is not None:
                c = colors[i]
                line += f" {int(c[0])} {int(c[1])} {int(c[2])}"

            f.write(line + "\n")

        # Write face data
        for face in faces:
            f.write(f"3 {face[0]} {face[1]} {face[2]}\n")


def _create_ply_header(
    vertices: np.ndarray,
    faces: np.ndarray,
    normals: Optional[np.ndarray],
    colors: Optional[np.ndarray],
    binary: bool,
) -> str:
    """Create PLY file header."""
    lines = [
        "ply",
        f"format {'binary_little_endian' if binary else 'ascii'} 1.0",
        f"element vertex {len(vertices)}",
        "property float x",
        "property float y",
        "property float z",
    ]

    if normals is not None:
        lines.extend([
            "property float nx",
            "property float ny",
            "property float nz",
        ])

    if colors is not None:
        lines.extend([
            "property uchar red",
            "property uchar green",
            "property uchar blue",
        ])

    lines.extend([
        f"element face {len(faces)}",
        "property list uchar int vertex_indices",
        "end_header",
    ])

    return "\n".join(lines) + "\n"


def _write_mtl_file(
    mtl_path: Path,
    material_name: str,
    color: tuple,
) -> None:
    """Write OBJ material file (.mtl)."""
    with open(mtl_path, 'w') as f:
        f.write(f"# Wavefront MTL file\n\n")
        f.write(f"newmtl {material_name}\n")
        f.write(f"Ka {color[0]:.3f} {color[1]:.3f} {color[2]:.3f}\n")  # Ambient
        f.write(f"Kd {color[0]:.3f} {color[1]:.3f} {color[2]:.3f}\n")  # Diffuse
        f.write(f"Ks 0.5 0.5 0.5\n")  # Specular
        f.write(f"Ns 10.0\n")  # Shininess
        f.write(f"d 1.0\n")  # Transparency (opaque)
