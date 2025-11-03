# API Reference

REST API for DICOM to 3D mesh pipeline.

## Base URL

```
http://localhost:3000
```

## Authentication

🚧 Not yet implemented (Phase B1).

---

## Studies

### Upload DICOM Study

Upload a ZIP file containing DICOM series.

**Endpoint**: `POST /studies/upload`

**Request**:
- Content-Type: `multipart/form-data`
- Body: `file` (ZIP file)

**Example**:
```bash
curl -X POST http://localhost:3000/studies/upload \
  -F "file=@kidney-scan.zip"
```

**Response** (200 OK):
```json
{
  "studyId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "DICOM study uploaded and processed successfully"
}
```

**Processing**:
1. ZIP uploaded to S3: `studies/{studyId}/original.zip`
2. DICOM ingestion (de-identify, sort slices)
3. Isotropic resampling
4. Artifacts uploaded:
   - `studies/{studyId}/volume.nii.gz`
   - `studies/{studyId}/volume_isotropic.nii.gz`
5. Metadata extracted and stored

### Get Study

Retrieve study details.

**Endpoint**: `GET /studies/:id`

**Response** (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "seriesInstanceUID": "1.2.840.113619.2.55.3...",
  "sliceCount": 120,
  "modality": "MR",
  "seriesDescription": "T2 AXIAL",
  "metadata": {
    "size": [256, 256, 120],
    "spacing": [1.0, 1.0, 3.0],
    "origin": [0, 0, 0],
    "direction": [1, 0, 0, 0, 1, 0, 0, 0, 1],
    "slice_normal": [0, 0, 1],
    "manufacturer": "SIEMENS",
    "field_strength": 3.0
  },
  "s3Key": "studies/.../original.zip",
  "volumeS3Key": "studies/.../volume.nii.gz",
  "createdAt": "2025-11-01T12:00:00Z",
  "updatedAt": "2025-11-01T12:00:00Z",
  "jobs": []
}
```

### List Studies

List all uploaded studies.

**Endpoint**: `GET /studies`

**Response** (200 OK):
```json
[
  {
    "id": "...",
    "seriesDescription": "T2 AXIAL",
    "sliceCount": 120,
    "modality": "MR",
    "createdAt": "2025-11-01T12:00:00Z"
  }
]
```

---

## Jobs

🚧 Coming in Phase A5.

Planned endpoints:
- `POST /studies/:studyId/reconstruct` - Start reconstruction job
- `GET /jobs/:jobId` - Get job status and progress
- `GET /jobs/:jobId/logs` - Stream job logs

---

## Models

🚧 Coming in Phase A5.

Planned endpoints:
- `GET /models/:modelId` - Get model metadata
- `GET /models/:modelId/preview` - Get preview artifacts
- `GET /models/:modelId/mesh?format=stl` - Download mesh

---

## Interactive Documentation

Full interactive API documentation available at:

**http://localhost:3000/api**

Includes:
- All endpoints with examples
- Request/response schemas
- Try-it-out functionality
- Model definitions

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "File must be a ZIP archive",
  "error": "Bad Request"
}
```

**Common Status Codes**:
- `400` - Bad Request (invalid input)
- `404` - Not Found
- `500` - Internal Server Error
