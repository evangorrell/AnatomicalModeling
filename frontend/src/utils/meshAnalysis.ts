import * as THREE from 'three';

/**
 * Analyze filename to detect if it's a tumor or healthy tissue
 */
export function analyzeFilename(filename: string): 'tumor' | 'healthy' | 'unknown' {
  const lower = filename.toLowerCase();

  // Tumor indicators (more specific patterns first)
  const tumorKeywords = [
    'tumor', 'tumour', 'lesion', 'mass', 'neoplasm',
    'glioma', 'glioblastoma', 'astrocytoma', 'meningioma',
    'cancer', 'carcinoma', 'sarcoma', 'adenoma',
    'metastasis', 'metastatic', 'malignant',
    'abnormal', 'pathology', 'disease'
  ];

  // Healthy tissue indicators
  const healthyKeywords = [
    'brain', 'cerebr', 'cortex', 'hemisphere',
    'liver', 'hepat',
    'kidney', 'renal',
    'lung', 'pulmonary',
    'heart', 'cardiac',
    'organ', 'tissue',
    'normal', 'healthy', 'skull'
  ];

  // Check if filename contains BOTH tumor and healthy keywords
  let hasTumorKeyword = false;
  let hasHealthyKeyword = false;

  for (const keyword of tumorKeywords) {
    if (lower.includes(keyword)) {
      hasTumorKeyword = true;
      break;
    }
  }

  for (const keyword of healthyKeywords) {
    if (lower.includes(keyword)) {
      hasHealthyKeyword = true;
      break;
    }
  }

  // If both types of keywords are present, it's ambiguous
  if (hasTumorKeyword && hasHealthyKeyword) {
    return 'unknown';
  }

  // Check tumor keywords
  if (hasTumorKeyword) {
    return 'tumor';
  }

  // Check healthy tissue keywords
  if (hasHealthyKeyword) {
    return 'healthy';
  }

  return 'unknown';
}

/**
 * Calculate the volume of a mesh using the signed volume of tetrahedra method
 * https://en.wikipedia.org/wiki/Polyhedron#Volume
 */
export function calculateMeshVolume(geometry: THREE.BufferGeometry): number {
  const positions = geometry.attributes.position;
  const indices = geometry.index;

  if (!positions || !indices) {
    console.warn('Geometry missing position or index data');
    return 0;
  }

  let volume = 0;

  // Iterate through each triangle
  for (let i = 0; i < indices.count; i += 3) {
    const i0 = indices.getX(i);
    const i1 = indices.getX(i + 1);
    const i2 = indices.getX(i + 2);

    // Get triangle vertices
    const v0 = new THREE.Vector3(
      positions.getX(i0),
      positions.getY(i0),
      positions.getZ(i0)
    );
    const v1 = new THREE.Vector3(
      positions.getX(i1),
      positions.getY(i1),
      positions.getZ(i1)
    );
    const v2 = new THREE.Vector3(
      positions.getX(i2),
      positions.getY(i2),
      positions.getZ(i2)
    );

    // Calculate signed volume of tetrahedron formed by origin and triangle
    // V = (1/6) * |a · (b × c)|
    const cross = new THREE.Vector3().crossVectors(v1, v2);
    const signedVolume = v0.dot(cross) / 6.0;

    volume += signedVolume;
  }

  return Math.abs(volume);
}

export type MeshRole = 'brain' | 'tumor' | 'unknown';

export interface ClassifiedMesh {
  file: File;
  role: MeshRole;
  confidence: number;
}

/**
 * Classify a single STL file by filename
 * Returns: { role, confidence }
 */
function classifySingleFile(file: File): { role: MeshRole; confidence: number } {
  const analysis = analyzeFilename(file.name);

  if (analysis === 'tumor') {
    return { role: 'tumor', confidence: 0.9 };
  } else if (analysis === 'healthy') {
    return { role: 'brain', confidence: 0.9 };
  } else {
    return { role: 'unknown', confidence: 0.0 };
  }
}

/**
 * Detect which file is tumor vs healthy tissue
 * Returns: { brain: File | null, tumor: File | null, unknown: File | null }
 */
export async function detectBrainAndTumor(
  files: File[]
): Promise<{ brain: File | null; tumor: File | null; unknown: File | null }> {
  if (files.length === 0) {
    throw new Error('No files provided');
  }

  if (files.length === 1) {
    // Single file - classify by filename, don't assume it's brain
    const classification = classifySingleFile(files[0]);

    if (classification.role === 'brain') {
      return { brain: files[0], tumor: null, unknown: null };
    } else if (classification.role === 'tumor') {
      return { brain: null, tumor: files[0], unknown: null };
    } else {
      // Ambiguous - let user decide
      return { brain: null, tumor: null, unknown: files[0] };
    }
  }

  // Try filename analysis first
  const file1Analysis = analyzeFilename(files[0].name);
  const file2Analysis = analyzeFilename(files[1].name);

  console.log('Filename analysis:', {
    file1: files[0].name,
    result1: file1Analysis,
    file2: files[1].name,
    result2: file2Analysis,
  });

  // If filename analysis is conclusive, use it
  if (file1Analysis === 'tumor' && file2Analysis === 'healthy') {
    return { brain: files[1], tumor: files[0], unknown: null };
  }
  if (file1Analysis === 'healthy' && file2Analysis === 'tumor') {
    return { brain: files[0], tumor: files[1], unknown: null };
  }

  // If one is unknown but the other is clear
  if (file1Analysis === 'tumor' && file2Analysis === 'unknown') {
    return { brain: files[1], tumor: files[0], unknown: null };
  }
  if (file2Analysis === 'tumor' && file1Analysis === 'unknown') {
    return { brain: files[0], tumor: files[1], unknown: null };
  }
  if (file1Analysis === 'healthy' && file2Analysis === 'unknown') {
    return { brain: files[0], tumor: files[1], unknown: null };
  }
  if (file2Analysis === 'healthy' && file1Analysis === 'unknown') {
    return { brain: files[1], tumor: files[0], unknown: null };
  }

  // Filename analysis inconclusive - fall back to file size as proxy
  // (We'll calculate actual volume after loading, but use size for initial assignment)
  console.log('Filename analysis inconclusive, falling back to file size');
  const sortedBySize = [...files].sort((a, b) => b.size - a.size);

  return {
    brain: sortedBySize[0],
    tumor: sortedBySize[1] || null,
    unknown: null,
  };
}

/**
 * Verify brain/tumor assignment using volume analysis
 * Call this after STL files are loaded into geometries
 * Returns true if assignment seems correct, false if it should be swapped
 */
export function verifyAssignmentByVolume(
  brainGeometry: THREE.BufferGeometry,
  tumorGeometry: THREE.BufferGeometry | null
): { shouldSwap: boolean; brainVolume: number; tumorVolume: number | null } {
  if (!tumorGeometry) {
    return { shouldSwap: false, brainVolume: calculateMeshVolume(brainGeometry), tumorVolume: null };
  }

  const brainVolume = calculateMeshVolume(brainGeometry);
  const tumorVolume = calculateMeshVolume(tumorGeometry);

  console.log('Volume analysis:', { brainVolume, tumorVolume, ratio: brainVolume / tumorVolume });

  // Healthy tissue should be significantly larger than tumor
  // Typical ratio is 10:1 to 100:1, but we'll use 3:1 as threshold to be safe
  const shouldSwap = tumorVolume > brainVolume || (tumorVolume / brainVolume) > 0.33;

  return { shouldSwap, brainVolume, tumorVolume };
}
