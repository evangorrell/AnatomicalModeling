# AnatomicalModeling

Medical imaging pipeline that converts NIfTI brain scans into interactive 3D meshes.

Processes MRI brain scans (NIfTI format) or pre-made STL files and generates 3D mesh visualizations with brain and tumor structures. Built with Python for image processing, TypeScript for orchestration, and React for interactive visualization.

---

## Features

### Pipeline
- Upload NIfTI image (`.nii.gz`) + ground-truth tumor labels
- Classical segmentation: Otsu thresholding + morphological operations
- Custom Marching Cubes implementation for mesh generation
- Mesh post-processing via PyMeshLab (smoothing, repair, decimation)
- Multi-format export: STL, OBJ, PLY

### Direct STL Viewing
- Drag-and-drop STL upload for immediate visualization
- Automatic brain/tumor classification via filename and volume analysis
- Manual role correction for ambiguous files

### Real-Time Processing
- WebSocket progress updates during mesh generation (0-100%)
- Stage tracking: Upload, Segmentation, Mesh Generation, Finalization
- BullMQ job queue for async processing

### Interactive 3D Viewer
- Rotate, pan, zoom with mouse/touch controls
- Quad-view mode: axial, sagittal, coronal slices + 3D view
- Crosshair synchronization across views
- Separate opacity and visibility controls per structure
- Measurement tools and grid overlay

---

## Architecture

```
Frontend (React + Three.js)       :5173
        |
        | HTTP / WebSocket
        v
Orchestration API (NestJS + BullMQ)  :3000
        |
        | Job Queue
        v
Imaging Worker (Python CLI)
        |
   +----+----+
   v         v
 Redis    MinIO (S3)
           PostgreSQL
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Docker and Docker Compose

### 1. Start Infrastructure

```bash
cd infra
docker compose up -d
```

Service endpoints:
- PostgreSQL: `localhost:5432` (postgres / postgres / dicom_pipeline)
- Redis: `localhost:6379`
- MinIO API: `localhost:9000`
- MinIO Console: `localhost:9001` (minioadmin / minioadmin)

### 2. Set Up Imaging Worker

```bash
cd imaging-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 3. Set Up Orchestration API

```bash
cd orchestration
npm install
cp .env.example .env
npm run start:dev
```

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Access

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api

---

## Usage

### Web Interface

**NIfTI upload:**
1. Open http://localhost:5173
2. Upload an MRI image (`.nii.gz`) and tumor label file (`.nii.gz`)
3. Watch real-time progress as the pipeline runs
4. Interact with the 3D viewer when complete
5. Download generated STL/OBJ meshes

**STL upload:**
1. Drag and drop 1-2 STL files
2. System auto-classifies as brain/tumor via filename and volume
3. View immediately with adjustable opacity and visibility

### API

```bash
# Upload NIfTI image + labels
curl -X POST http://localhost:3000/studies/upload \
  -F "image=@BRATS_001.nii.gz" \
  -F "labels=@BRATS_001_seg.nii.gz"

# Check study status
curl http://localhost:3000/studies/{studyId}

# List available meshes
curl http://localhost:3000/studies/{studyId}/meshes

# Download a mesh
curl -L http://localhost:3000/studies/{studyId}/download/mesh/brain.stl -o brain.stl
```

Full API reference: [imaging-worker/docs/api.md](imaging-worker/docs/api.md)

### Imaging Worker CLI

The Python worker can also be used standalone:

```bash
cd imaging-worker
source .venv/bin/activate

# Resample to isotropic spacing
python -m src.cli resample volume.nii.gz output/ --spacing 1.0

# Segment (Otsu + morphology, or with ground-truth labels)
python -m src.cli segment image.nii.gz output/
python -m src.cli segment image.nii.gz output/ --use-labels labels.nii.gz

# Generate meshes from segmentation mask
python -m src.cli mesh mask.nii.gz output/ --formats stl,obj
```

Run `python -m src.cli <command> --help` for full option details.

---

## Project Structure

```
AnatomicalModeling/
├── frontend/                    # React + Vite + Three.js
│   └── src/
│       ├── components/          # MeshViewer, QuadView, SliceViewer, etc.
│       ├── hooks/               # Custom React hooks
│       ├── utils/               # Mesh analysis and classification
│       ├── api.ts               # API client
│       └── types.ts             # TypeScript types
│
├── orchestration/               # NestJS API server
│   └── src/
│       ├── studies/             # Upload, processing, download endpoints
│       │   ├── studies.controller.ts
│       │   ├── studies.service.ts
│       │   ├── studies.processor.ts   # BullMQ job processor
│       │   └── study.entity.ts
│       ├── events/              # WebSocket progress gateway
│       ├── jobs/                # Job entity
│       └── models/              # Model entity
│
├── imaging-worker/              # Python image processing
│   ├── src/
│   │   ├── prep/                # Volume resampling
│   │   ├── seg/                 # Segmentation (Otsu, level-set, metrics)
│   │   ├── surf/                # Custom Marching Cubes
│   │   ├── mesh/                # Post-processing + PyMeshLab repair
│   │   ├── export/              # STL, OBJ, PLY export
│   │   ├── debug/               # Coordinate diagnostics
│   │   └── cli.py               # CLI entry point
│   ├── tests/                   # pytest suite
│   ├── scripts/                 # Standalone utilities (validate_mesh.py)
│   └── docs/                    # API reference, getting started
│
└── infra/                       # Docker Compose
    └── docker-compose.yml       # PostgreSQL 16, Redis 7, MinIO
```

---

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Three.js, React Three Fiber, Socket.io-client

**Backend:** NestJS, TypeORM, BullMQ, Socket.io, AWS SDK (S3/MinIO)

**Imaging:** Python 3.10+, SimpleITK, NumPy, SciPy, scikit-image, PyMeshLab, trimesh

**Infrastructure:** PostgreSQL 16, Redis 7, MinIO, Docker Compose

---

## Development

### Tests

```bash
# Python worker
cd imaging-worker && source .venv/bin/activate
pytest
pytest --cov=src tests/

# Backend API
cd orchestration
npm test

# Frontend
cd frontend
npm run build
```

### Building for Production

```bash
# Frontend
cd frontend && npm run build     # Output in dist/

# Backend
cd orchestration && npm run build  # Output in dist/
```

---

## Security

- Files stored with UUID-based keys in S3
- Presigned URLs with expiration for downloads
- CORS configured for frontend access
- No authentication in demo mode
- Research visualization only - not a medical device

---

## License

ISC
