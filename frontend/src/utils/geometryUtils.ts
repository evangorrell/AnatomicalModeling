import * as THREE from 'three';

// Compute the bounding-box center of a geometry.
export function computeGeometryCenter(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox?.getCenter(center);
  return center;
}

// Clone a geometry and translate it so that center maps to the origin.
// Used to co-center brain + tumor meshes using a shared reference point.
export function centerGeometry(
  geometry: THREE.BufferGeometry,
  center: THREE.Vector3,
): THREE.BufferGeometry {
  const centered = geometry.clone();
  centered.translate(-center.x, -center.y, -center.z);
  return centered;
}
