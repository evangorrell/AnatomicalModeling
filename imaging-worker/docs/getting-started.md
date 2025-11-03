# Getting Started

Quick start guide for the DICOM to 3D Pipeline.

## Prerequisites

- **Python**: 3.10+ (for imaging worker)
- **Node.js**: 18+ (for orchestration API)
- **Docker**: For infrastructure (Postgres, Redis, MinIO)

## Setup Steps

### 1. Clone and Navigate

```bash
cd AnatomicalModeling
```

### 2. Start Infrastructure

```bash
cd infra
docker-compose up -d
cd ..
```

Verify services are healthy:
```bash
docker-compose ps
```

### 3. Set Up Imaging Worker

```bash
cd imaging-worker

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"

# Run tests to verify setup
pytest

cd ..
```

### 4. Set Up Orchestration API

```bash
cd orchestration

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env if needed

# Start API in development mode
npm run start:dev
```

The API will be available at:
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api

## Quick Test (Phase A1)

### Option 1: Direct Worker CLI

```bash
cd imaging-worker
source .venv/bin/activate

# Process a DICOM ZIP file
python -m src.cli pipeline /path/to/dicom.zip ./output/
```

### Option 2: Via API

```bash
# Upload DICOM ZIP
curl -X POST http://localhost:3000/studies/upload \
  -F "file=@/path/to/dicom.zip"

# Get study details
curl http://localhost:3000/studies/{studyId}
```

## What's Working (Phase A1)

✅ **Imaging Worker**:
- DICOM ZIP ingestion
- De-identification
- Slice sorting by position
- Isotropic resampling
- Metadata extraction
- Comprehensive tests

✅ **Orchestration API**:
- Study upload endpoint
- S3/MinIO storage
- Database persistence
- Swagger documentation

✅ **Infrastructure**:
- PostgreSQL database
- Redis for job queues
- MinIO for object storage

## Next Steps

See CLAUDE.md for the full development roadmap. Next phases include:
- **Phase A2**: Classical segmentation (Otsu + morphology + level-set)
- **Phase A3**: Custom Marching Cubes implementation
- **Phase A4**: Mesh post-processing and export
- **Phase A5**: Job orchestration, WebSockets, preview viewer

## Troubleshooting

### Python Dependencies Fail
Ensure you have system dependencies for medical imaging libraries:
- On Ubuntu: `apt-get install python3-dev build-essential`
- On macOS: `brew install python@3.10`

### Database Connection Issues
Check that Docker services are running:
```bash
cd infra
docker-compose ps
```

Restart if needed:
```bash
docker-compose restart postgres
```

### Worker Not Found
Update `.env` in orchestration to point to correct Python path:
```
WORKER_PYTHON_PATH=/path/to/venv/bin/python
WORKER_SCRIPT_PATH=../imaging-worker/src/cli.py
```
