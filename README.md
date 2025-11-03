# AnatomicalModeling

MRI DICOM → 3D Mesh Pipeline

Convert single-organ MR DICOM series into interactive 3D models and export watertight STL/OBJ/PLY meshes.

## 🎯 Project Status

**Phase A1: COMPLETE** ✅
- DICOM ZIP ingestion with de-identification
- Isotropic volume resampling
- Metadata extraction and tracking
- REST API with Swagger docs
- S3/MinIO storage integration
- Comprehensive test suite

## 🚀 Quick Start

See [docs/getting-started.md](docs/getting-started.md) for detailed setup instructions.

```bash
# 1. Start infrastructure
cd infra && docker-compose up -d

# 2. Set up Python worker
cd ../imaging-worker
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. Set up TypeScript API
cd ../orchestration
npm install
cp .env.example .env
npm run start:dev

# 4. Access API docs
open http://localhost:3000/api
```

## 📁 Project Structure

```
AnatomicalModeling/
├── imaging-worker/     # Python worker for DICOM processing
│   ├── src/
│   │   ├── io/         # DICOM ingestion
│   │   ├── prep/       # Volume preprocessing
│   │   ├── seg/        # Segmentation (Phase A2)
│   │   ├── surf/       # Surface extraction (Phase A3)
│   │   ├── mesh/       # Mesh post-processing (Phase A4)
│   │   └── export/     # Mesh export (Phase A4)
│   └── tests/
│
├── orchestration/      # NestJS API
│   └── src/
│       ├── studies/    # Study upload & management
│       ├── jobs/       # Job orchestration (Phase A5)
│       └── models/     # Model artifacts (Phase A5)
│
├── infra/              # Docker infrastructure
│   └── docker-compose.yml
│
├── docs/               # Documentation
│   ├── getting-started.md
│   ├── api.md
│   └── phase-a1-complete.md
│
└── CLAUDE.md           # Full project playbook
```

## 🛠 Tech Stack

- **Imaging Worker**: Python (pydicom, SimpleITK, scikit-image, trimesh, pyvista)
- **Orchestration API**: TypeScript (NestJS, TypeORM, BullMQ)
- **Infrastructure**: Docker (Postgres, Redis, MinIO)
- **Future Viewer**: React + VTK.js + Three.js

## 📖 Documentation

- **[Getting Started](docs/getting-started.md)** - Setup and installation
- **[API Reference](docs/api.md)** - REST API documentation
- **[Phase A1 Complete](docs/phase-a1-complete.md)** - Current progress
- **[CLAUDE.md](CLAUDE.md)** - Complete project roadmap and playbook

## 🧪 Development

### Imaging Worker

```bash
cd imaging-worker
source .venv/bin/activate

# Run tests
pytest

# Process DICOM
python -m src.cli pipeline input.zip output/
```

### Orchestration API

```bash
cd orchestration

# Development mode
npm run start:dev

# Build for production
npm run build

# Run tests
npm test
```

## 🎯 Roadmap

- ✅ **Phase A1**: Ingest & Isotropic Volume
- ⏳ **Phase A2**: Classical Segmentation (Otsu + morphology + level-set)
- ⏳ **Phase A3**: Custom Marching Cubes + benchmarks
- ⏳ **Phase A4**: Mesh post-processing & STL/OBJ/PLY export
- ⏳ **Phase A5**: Job orchestration + WebSocket progress + preview viewer
- ⏳ **Phase B1**: Auth, observability, CI/CD
- ⏳ **Phase B2**: Deep learning path (U-Net)
- ⏳ **Phase C1**: CAD export (NURBS fitting, STEP/IGES)

## 📝 License

ISC

## 🤝 Contributing

This is a research/demo project. See CLAUDE.md for the complete development plan.
