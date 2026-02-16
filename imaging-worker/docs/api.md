# API Reference

REST API for the NIfTI-to-3D-mesh pipeline.

## Base URL

```
http://localhost:3000
```

## Authentication

Not yet implemented.

---

## Studies

### Upload NIfTI Image + Labels

Upload an MRI image and ground-truth tumor label file. Both must be NIfTI format (`.nii.gz` or `.nii`). The pipeline segments the brain from the image using Otsu thresholding, extracts the tumor from the labels, and generates 3D meshes (STL/OBJ) for both structures.

**Endpoint**: `POST /studies/upload`

**Request**:
- Content-Type: `multipart/form-data`
- Fields:
  - `image` (required): MRI image file (`.nii.gz`)
  - `labels` (required): Ground-truth tumor label file (`.nii.gz`)

The API automatically determines which file is the image vs labels.

**Example**:
```bash
curl -X POST http://localhost:3000/studies/upload \
  -F "image=@BRATS_001.nii.gz" \
  -F "labels=@BRATS_001_seg.nii.gz"
```

**Response** (201 Created):
```json
{
  "studyId": "550e8400-e29b-41d4-a716-446655440000",
  "jobId": "1",
  "message": "Image and labels uploaded. Brain will be segmented from image, tumor from labels.",
  "fileType": "nifti_with_labels",
  "status": "processing"
}
```

**Processing pipeline** (runs async via BullMQ):
1. Files uploaded to S3: `studies/{studyId}/original.nii.gz` and `studies/{studyId}/labels.nii.gz`
2. Segmentation: brain via Otsu threshold, tumor from labels
3. Mesh generation: custom Marching Cubes for each structure
4. Mesh post-processing: repair, smoothing via PyMeshLab
5. Export: STL + OBJ files uploaded to `studies/{studyId}/meshes/`
6. Progress streamed via WebSocket

### Get Study

Retrieve study details.

**Endpoint**: `GET /studies/:id`

**Response** (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "seriesInstanceUID": null,
  "sliceCount": null,
  "modality": null,
  "seriesDescription": null,
  "metadata": { ... },
  "s3Key": "studies/.../original.nii.gz",
  "volumeS3Key": "studies/.../volume.nii.gz",
  "createdAt": "2025-11-01T12:00:00Z",
  "updatedAt": "2025-11-01T12:00:00Z",
  "jobs": []
}
```

### List Studies

List all uploaded studies, ordered by creation date (newest first).

**Endpoint**: `GET /studies`

**Response** (200 OK):
```json
[
  {
    "id": "...",
    "metadata": { ... },
    "createdAt": "2025-11-01T12:00:00Z"
  }
]
```

---

## Artifacts

### Get Artifact URLs

Get signed S3 URLs for all study artifacts.

**Endpoint**: `GET /studies/:id/artifacts`

**Response** (200 OK):
```json
{
  "studyId": "...",
  "artifacts": {
    "original": "https://...",
    "volume": "https://...",
    "mask": "https://...",
    "volume_isotropic": "https://..."
  },
  "metadata": { ... }
}
```

### Download Original Image

**Endpoint**: `GET /studies/:id/download/original`

**Query params**: `info=true` returns JSON with download URL instead of streaming the file.

### Download Processed Volume

**Endpoint**: `GET /studies/:id/download/volume`

**Query params**: `info=true` returns JSON with download URL.

### Download Segmentation Mask

**Endpoint**: `GET /studies/:id/download/mask`

**Query params**: `info=true` returns JSON with download URL.

---

## Meshes

### List Meshes

List all generated 3D mesh files for a study.

**Endpoint**: `GET /studies/:id/meshes`

**Response** (200 OK):
```json
{
  "meshes": ["brain.stl", "brain.obj", "brain.mtl", "tumor.stl", "tumor.obj", "tumor.mtl"],
  "metadata": { ... }
}
```

### Download Mesh File

Download a specific mesh file (STL, OBJ, MTL).

**Endpoint**: `GET /studies/:id/download/mesh/:filename`

**Query params**: `info=true` returns JSON with download URL instead of streaming the file.

**Example**:
```bash
# Stream file directly
curl -L http://localhost:3000/studies/{studyId}/download/mesh/brain.stl -o brain.stl

# Get download URL
curl http://localhost:3000/studies/{studyId}/download/mesh/brain.stl?info=true
```

---

## WebSocket Events

Connect via Socket.IO on namespace `/progress`.

### Subscribe to Progress

```javascript
socket.emit('subscribe', studyId);
```

### Progress Events (server to client)

```javascript
socket.on('progress', (data) => {
  // data: { studyId, percentage, stage, message, timestamp }
  // stage: 'upload' | 'segmentation' | 'mesh_generation' | 'finalizing'
});
```

### Complete Event

```javascript
socket.on('complete', (data) => {
  // data: { studyId, status, meshes: string[] }
});
```

### Error Event

```javascript
socket.on('error', (data) => {
  // data: { message, details? }
});
```

---

## Interactive Documentation

Full interactive API documentation available at:

**http://localhost:3000/api**

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "Both image and labels files are required",
  "error": "Bad Request"
}
```

**Common Status Codes**:
- `400` - Bad Request (invalid input, missing files)
- `404` - Not Found
- `500` - Internal Server Error
