"""
Mesh post-processing for 3D print-ready output.

Phase A4: Automated mesh repair and optimization pipeline.
- Hole filling (close gaps from ventricles/cavities)
- Laplacian/Taubin smoothing (reduce jaggedness)
- Manifold repair (fix non-manifold geometry)
- Decimation (reduce triangle count while preserving shape)

Goal: Transform raw Marching Cubes output (3/6 quality)
      into 3D print-ready meshes (6/6 quality).
"""

import logging
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import trimesh
import pyvista as pv

logger = logging.getLogger(__name__)


class MeshPostProcessor:
    """
    Automated mesh post-processing pipeline.

    Transforms raw Marching Cubes meshes into watertight,
    manifold, 3D print-ready geometry.
    """

    def __init__(
        self,
        fill_holes: bool = True,
        smooth: bool = True,
        repair_manifold: bool = False,  # DISABLED by default for medical meshes
        decimate: bool = False,
        target_reduction: float = 0.5,
    ):
        """
        Initialize post-processor.

        Args:
            fill_holes: Close gaps and holes in mesh
            smooth: Apply Laplacian/Taubin smoothing
            repair_manifold: Fix non-manifold geometry (disabled for medical meshes)
            decimate: Reduce triangle count
            target_reduction: Decimation target (0.5 = 50% reduction)
        """
        self.fill_holes = fill_holes
        self.smooth = smooth
        self.repair_manifold = repair_manifold
        self.decimate = decimate
        self.target_reduction = target_reduction

    def process(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        normals: Optional[np.ndarray] = None,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Run full post-processing pipeline.

        Args:
            vertices: (N, 3) array of vertex positions
            faces: (M, 3) array of triangle indices
            normals: Optional (N, 3) array of vertex normals

        Returns:
            (vertices, faces, normals) - processed mesh
        """
        logger.info("Starting mesh post-processing pipeline...")
        logger.info(f"  Input: {len(vertices):,} vertices, {len(faces):,} faces")

        # Step 1: Fill holes
        if self.fill_holes:
            vertices, faces, normals = self._fill_holes(vertices, faces, normals)

        # Step 2: Repair manifold geometry
        if self.repair_manifold:
            vertices, faces, normals = self._repair_manifold(vertices, faces, normals)

        # Step 3: Smooth surface
        if self.smooth:
            vertices, faces, normals = self._smooth_mesh(vertices, faces, normals)

        # Step 4: Decimate (optional)
        if self.decimate:
            vertices, faces, normals = self._decimate_mesh(vertices, faces, normals)

        logger.info(f"  Output: {len(vertices):,} vertices, {len(faces):,} faces")
        logger.info("✓ Post-processing complete!")

        return vertices, faces, normals

    def _fill_holes(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        normals: Optional[np.ndarray],
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """Fill holes using trimesh."""
        logger.info("Filling holes...")

        try:
            # Convert to trimesh
            mesh = trimesh.Trimesh(vertices=vertices, faces=faces)

            # Fill holes (iterative approach)
            # fillHoles() closes boundaries by adding faces
            mesh.fill_holes()

            logger.info(f"  Watertight before: {mesh.is_watertight}")

            # If still not watertight, try more aggressive repair
            if not mesh.is_watertight:
                # Fix normals (ensures consistent face orientation)
                mesh.fix_normals()

                # Remove degenerate faces
                mesh.remove_degenerate_faces()

                # Remove duplicate/unreferenced vertices
                mesh.remove_unreferenced_vertices()
                mesh.merge_vertices()

                # Try filling holes again
                mesh.fill_holes()

            logger.info(f"  Watertight after: {mesh.is_watertight}")
            logger.info(f"  Holes filled: {len(mesh.faces) - len(faces)} new faces added")

            # Recompute normals after hole filling
            normals = mesh.vertex_normals.copy()

            return mesh.vertices.copy(), mesh.faces.copy(), normals

        except Exception as e:
            logger.warning(f"  Hole filling failed: {e}")
            logger.warning("  Continuing with original mesh...")
            return vertices, faces, normals

    def _repair_manifold(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        normals: Optional[np.ndarray],
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """Repair non-manifold geometry."""
        logger.info("Repairing manifold geometry...")

        try:
            mesh = trimesh.Trimesh(vertices=vertices, faces=faces)

            # Check manifold status
            is_manifold = mesh.is_watertight and mesh.is_winding_consistent
            logger.info(f"  Manifold before: {is_manifold}")

            # Split mesh into separate connected components
            # This helps identify and fix problematic geometry
            components = mesh.split(only_watertight=False)

            if len(components) > 1:
                logger.info(f"  Found {len(components)} connected components")

                # For medical imaging meshes, DON'T discard large components!
                # Brain anatomy often has many legitimate parts (ventricles, etc.)
                # Instead, keep all "significant" components (>1% of vertices)
                total_vertices = sum(len(c.vertices) for c in components)
                threshold = total_vertices * 0.01  # 1% threshold

                # Keep all components above threshold
                significant_components = [c for c in components if len(c.vertices) >= threshold]

                logger.info(f"  Kept {len(significant_components)} significant components (>{threshold:.0f} vertices)")
                logger.info(f"  Discarded {len(components) - len(significant_components)} tiny artifacts")

                # Merge significant components back together
                # This preserves the complete anatomy while removing noise
                vertices_list = []
                faces_list = []
                vertex_offset = 0

                for comp in significant_components:
                    vertices_list.append(comp.vertices)
                    faces_list.append(comp.faces + vertex_offset)
                    vertex_offset += len(comp.vertices)

                if len(vertices_list) > 0:
                    mesh = trimesh.Trimesh(
                        vertices=np.vstack(vertices_list),
                        faces=np.vstack(faces_list),
                    )
                    logger.info(f"  Merged mesh: {len(mesh.vertices):,} vertices total")
                else:
                    logger.warning("  No significant components found! Using original mesh")
                    # Fall back to original mesh
                    mesh = trimesh.Trimesh(vertices=vertices, faces=faces)

            # Fix winding order (ensure consistent face orientation)
            mesh.fix_normals()

            # Final cleanup
            mesh.remove_degenerate_faces()
            mesh.remove_duplicate_faces()
            mesh.remove_unreferenced_vertices()

            is_manifold = mesh.is_watertight and mesh.is_winding_consistent
            logger.info(f"  Manifold after: {is_manifold}")

            # Recompute normals
            normals = mesh.vertex_normals.copy()

            return mesh.vertices.copy(), mesh.faces.copy(), normals

        except Exception as e:
            logger.warning(f"  Manifold repair failed: {e}")
            logger.warning("  Continuing with original mesh...")
            return vertices, faces, normals

    def _smooth_mesh(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        normals: Optional[np.ndarray],
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """Smooth mesh using Taubin smoothing (better than Laplacian)."""
        logger.info("Smoothing mesh (Taubin filter)...")

        try:
            # Convert to PyVista mesh
            # PyVista uses VTK under the hood (industry standard)
            mesh_pv = pv.PolyData(vertices, np.hstack([np.full((len(faces), 1), 3), faces]))

            # Taubin smoothing: better than Laplacian, preserves volume
            # - Alternates between shrinking and expanding
            # - Prevents mesh from collapsing
            # - Preserves sharp features better
            smoothed = mesh_pv.smooth_taubin(
                n_iter=20,           # Number of iterations
                pass_band=0.1,       # Smoothing strength (0.0-2.0)
                boundary_smoothing=True,
                feature_smoothing=False,  # Preserve sharp edges
            )

            # Extract vertices and faces
            vertices_smooth = np.array(smoothed.points)
            faces_smooth = smoothed.faces.reshape(-1, 4)[:, 1:4]

            # Recompute normals after smoothing
            mesh = trimesh.Trimesh(vertices=vertices_smooth, faces=faces_smooth)
            normals = mesh.vertex_normals.copy()

            logger.info("  ✓ Smoothing complete (jagged edges reduced)")

            return vertices_smooth, faces_smooth, normals

        except Exception as e:
            logger.warning(f"  Smoothing failed: {e}")
            logger.warning("  Continuing with original mesh...")
            return vertices, faces, normals

    def _decimate_mesh(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        normals: Optional[np.ndarray],
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """Reduce triangle count using quadric error decimation."""
        logger.info(f"Decimating mesh (target: {self.target_reduction*100:.0f}% reduction)...")

        try:
            mesh_pv = pv.PolyData(vertices, np.hstack([np.full((len(faces), 1), 3), faces]))

            original_faces = len(faces)
            target_faces = int(original_faces * (1 - self.target_reduction))

            # Quadric error decimation (high quality)
            # - Preserves shape better than simple decimation
            # - Uses quadric error metrics to minimize surface deviation
            decimated = mesh_pv.decimate(
                target_reduction=self.target_reduction,
                volume_preservation=True,
                boundary_vertex_deletion=False,  # Keep boundaries intact
            )

            vertices_dec = np.array(decimated.points)
            faces_dec = decimated.faces.reshape(-1, 4)[:, 1:4]

            # Recompute normals
            mesh = trimesh.Trimesh(vertices=vertices_dec, faces=faces_dec)
            normals = mesh.vertex_normals.copy()

            logger.info(f"  {original_faces:,} → {len(faces_dec):,} faces "
                       f"({(1 - len(faces_dec)/original_faces)*100:.1f}% reduction)")

            return vertices_dec, faces_dec, normals

        except Exception as e:
            logger.warning(f"  Decimation failed: {e}")
            logger.warning("  Continuing with original mesh...")
            return vertices, faces, normals


def postprocess_mesh(
    vertices: np.ndarray,
    faces: np.ndarray,
    normals: Optional[np.ndarray] = None,
    fill_holes: bool = True,
    smooth: bool = True,
    repair_manifold: bool = True,
    decimate: bool = False,
    target_reduction: float = 0.5,
    use_advanced_repair: bool = True,  # NEW: Use PyMeshLab for guaranteed watertight
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Convenience function for mesh post-processing.

    Args:
        vertices: (N, 3) vertex positions
        faces: (M, 3) triangle indices
        normals: Optional (N, 3) vertex normals
        fill_holes: Close gaps in mesh
        smooth: Apply Taubin smoothing
        repair_manifold: Fix non-manifold geometry
        decimate: Reduce triangle count
        target_reduction: Decimation strength (0.5 = 50% reduction)
        use_advanced_repair: Use PyMeshLab for professional repair (recommended)

    Returns:
        (vertices, faces, normals) - processed mesh
    """
    # Option 1: Advanced repair using PyMeshLab (recommended for 3D printing)
    if use_advanced_repair:
        logger.info("Using ADVANCED REPAIR mode (PyMeshLab)...")
        from .repair import repair_mesh_advanced

        target_faces = int(len(faces) * (1 - target_reduction)) if decimate else None

        return repair_mesh_advanced(
            vertices,
            faces,
            normals,
            target_faces=target_faces,
        )

    # Option 2: Basic repair using trimesh/pyvista
    else:
        logger.info("Using BASIC REPAIR mode (trimesh/pyvista)...")
        processor = MeshPostProcessor(
            fill_holes=fill_holes,
            smooth=smooth,
            repair_manifold=repair_manifold,
            decimate=decimate,
            target_reduction=target_reduction,
        )

        return processor.process(vertices, faces, normals)
