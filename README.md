# AnatomicalModeling

> **Medical imaging pipeline for converting NIfTI brain scans into interactive 3D meshes**

A full-stack application that processes MRI brain scans (NIfTI format) or STL files and generates high-quality 3D mesh visualizations. Built with Python for image processing, TypeScript for orchestration, and React for interactive visualization.

---

## ✨ Features

### Core Pipeline
- **NIfTI Processing**: Upload `.nii` or `.nii.gz` brain scan files
- **Automatic Segmentation**: Classical segmentation using Otsu thresholding + morphological operations + level-set refinement
- **Custom Marching Cubes**: From-scratch implementation for mesh generation
- **Mesh Post-Processing**: Laplacian smoothing, decimation, hole filling, and manifold repair
- **Multi-Format Export**: Download meshes as STL, OBJ, or PLY

### Direct STL Viewing
- **Drag & Drop Upload**: Upload existing STL files for immediate visualization
- **Intelligent Classification**: Automatic brain/tumor detection via filename analysis
- **Volume-Based Verification**: Secondary validation using mesh volume calculations
- **User-Correctable**: Manual role selection for ambiguous files

### Real-Time Experience
- **WebSocket Progress**: Live updates during mesh generation (0-100%)
- **Stage Tracking**: Upload → Segmentation → Mesh Generation → Finalization
- **Interactive 3D Viewer**: Rotate, pan, zoom with mouse/touch controls
- **Dual-Mesh Display**: Separate controls for brain and tumor visualization
- **Customizable Rendering**: Toggle visibility, adjust opacity, change colors

---

## 🏗 Architecture

```
┌─────────────────┐
│  React Frontend │ (Three.js + React Three Fiber)
│   Port 5173     │
└────────┬────────┘
         │ HTTP/WebSocket
         ▼
┌─────────────────┐
│  NestJS API     │ (TypeScript + BullMQ)
│   Port 3000     │
└────────┬────────┘
         │ Job Queue
         ▼
┌─────────────────┐
│ Python Worker   │ (Image Processing + Marching Cubes)
│  Background     │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│Redis   │ │MinIO (S3)│
└────────┘ └──────────┘
```

### Components

1. **Frontend (`frontend/`)** - React + Vite + Three.js
   - Interactive 3D mesh viewer with OrbitControls
   - Drag-and-drop file upload (NIfTI or STL)
   - Real-time progress tracking via WebSocket
   - Mesh classification and role selection UI

2. **Orchestration API (`orchestration/`)** - NestJS + TypeORM
   - RESTful API for file upload and study management
   - BullMQ job queue for async processing
   - WebSocket gateway for progress events
   - S3/MinIO integration for artifact storage

3. **Imaging Worker (`imaging-worker/`)** - Python
   - Classical segmentation pipeline (Otsu + morphology + level-set)
   - Custom Marching Cubes implementation
   - Mesh post-processing (smoothing, decimation, hole filling)
   - Multi-format export (STL, OBJ, PLY)

4. **Infrastructure (`infra/`)** - Docker Compose
   - PostgreSQL for metadata storage
   - Redis for job queue
   - MinIO for S3-compatible object storage

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Python** 3.10+ with pip
- **Docker** and Docker Compose

### 1. Clone and Setup Infrastructure

```bash
git clone <repository-url>
cd AnatomicalModeling

# Start infrastructure services
cd infra
docker-compose up -d
cd ..
```

### 2. Setup Python Imaging Worker

```bash
cd imaging-worker

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"

cd ..
```

### 3. Setup NestJS Orchestration API

```bash
cd orchestration

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env if needed (defaults should work with docker-compose)

# Start in development mode
npm run start:dev

cd ..
```

### 4. Setup React Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment (optional)
cp .env.example .env
# Edit .env if backend is not on localhost:3000

# Start development server
npm run dev
```

### 5. Access the Application

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **API Docs**: http://localhost:3000/api (Swagger)
- **MinIO Console**: http://localhost:9001 (minioadmin / minioadmin)

---

## 📖 Usage

### Uploading NIfTI Files

1. Navigate to http://localhost:5173
2. Click **"Upload NIfTI"** tab
3. Drag and drop a `.nii.gz` brain scan file
4. Click **"Generate Mesh"**
5. Watch real-time progress updates
6. Interact with the 3D visualization
7. Download STL/OBJ files when complete

### Uploading STL Files

1. Navigate to http://localhost:5173
2. Click **"Upload STL"** tab
3. Drag and drop 1-2 STL files:
   - **Single file**: Automatically classified or user selects role
   - **Two files**: Auto-detected as brain + tumor via filename/volume
4. View immediately (no processing needed)
5. Adjust visibility, opacity, and colors

### Mesh Controls

- **Zoom**: Use `+` / `-` buttons or mouse wheel
- **Rotate**: Click and drag
- **Pan**: Right-click and drag (or two-finger drag on trackpad)
- **Toggle Visibility**: Use checkboxes for brain/tumor
- **Adjust Opacity**: Use sliders to see through meshes
- **Download**: Click "Download STLs" to save meshes locally

---

## 🛠 Technology Stack

### Frontend
- **React** 18 with TypeScript
- **Vite** for build tooling
- **Three.js** for 3D rendering
- **@react-three/fiber** + **@react-three/drei** for React integration
- **Socket.io-client** for WebSocket communication

### Backend
- **NestJS** (TypeScript framework)
- **TypeORM** for database access
- **BullMQ** for job queue management
- **Socket.io** for WebSocket server
- **AWS SDK** for S3/MinIO integration

### Imaging Pipeline
- **Python** 3.10+
- **SimpleITK** / **ITK** for medical image processing
- **NumPy** / **SciPy** for numerical computing
- **scikit-image** for segmentation algorithms
- **trimesh** / **pyvista** for mesh manipulation
- **Custom Marching Cubes** implementation

### Infrastructure
- **PostgreSQL** 15 for metadata
- **Redis** 7 for job queue
- **MinIO** for S3-compatible storage
- **Docker Compose** for orchestration

---

## 📁 Project Structure

```
AnatomicalModeling/
├── frontend/                    # React + Three.js web application
│   ├── src/
│   │   ├── components/         # React components (MeshViewer, etc.)
│   │   ├── hooks/              # Custom hooks (useMeshes)
│   │   ├── utils/              # Mesh analysis and classification
│   │   ├── api.ts              # API client
│   │   ├── types.ts            # TypeScript types
│   │   └── App.tsx             # Main application
│   ├── package.json
│   └── vite.config.ts
│
├── orchestration/               # NestJS API server
│   ├── src/
│   │   ├── studies/            # Study upload & processing
│   │   │   ├── studies.controller.ts
│   │   │   ├── studies.service.ts
│   │   │   ├── studies.processor.ts  # BullMQ job processor
│   │   │   └── study.entity.ts
│   │   ├── events/             # WebSocket gateway
│   │   │   └── progress.gateway.ts
│   │   ├── jobs/               # Job entity
│   │   ├── models/             # Model entity
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── package.json
│   └── tsconfig.json
│
├── imaging-worker/              # Python image processing pipeline
│   ├── src/
│   │   ├── io/                 # File I/O utilities
│   │   ├── prep/               # Volume preprocessing
│   │   ├── seg/                # Segmentation algorithms
│   │   │   └── classical.py   # Otsu + morphology + level-set
│   │   ├── surf/               # Surface extraction
│   │   │   └── marching_cubes.py  # Custom implementation
│   │   ├── mesh/               # Mesh post-processing
│   │   │   └── postprocess.py # Smoothing, decimation, etc.
│   │   ├── export/             # Mesh export
│   │   │   ├── stl_export.py
│   │   │   ├── obj_export.py
│   │   │   └── ply_export.py
│   │   └── cli.py              # Command-line interface
│   ├── tests/                  # pytest test suite
│   ├── setup.py
│   └── pyproject.toml
│
├── infra/                       # Infrastructure as code
│   └── docker-compose.yml      # Postgres, Redis, MinIO
│
├── .gitignore
├── CLAUDE.md                    # Development playbook (optional)
├── FRONTEND_SETUP.md            # Frontend setup notes (optional)
└── README.md                    # This file
```

---

## 🧪 Development

### Running Tests

**Python Worker:**
```bash
cd imaging-worker
source .venv/bin/activate
pytest
pytest --cov=src tests/  # With coverage
```

**Backend API:**
```bash
cd orchestration
npm test
npm run test:watch  # Watch mode
```

**Frontend:**
```bash
cd frontend
npm run build  # Type checking via tsc
```

### Building for Production

**Frontend:**
```bash
cd frontend
npm run build
# Output in dist/
```

**Backend:**
```bash
cd orchestration
npm run build
# Output in dist/
```

**Python Worker:**
```bash
cd imaging-worker
pip install -e .  # Install without dev dependencies
```

---

## 🎯 Key Features Explained

### Intelligent Mesh Classification

When uploading STL files, the system uses a multi-stage approach:

1. **Filename Analysis**: Checks for keywords like "brain", "tumor", "lesion", etc.
2. **Volume Calculation**: Computes mesh volume using signed tetrahedra method
3. **Ambiguity Detection**: If filename contains BOTH brain and tumor keywords → user decides
4. **Automatic Swap**: If volume suggests assignment is backwards, automatically corrects
5. **User Override**: Manual role selection modal for unknown files

**Examples:**
- `brain.stl` → Detected as brain (grey color)
- `tumor.stl` → Detected as tumor (red color)
- `brain_tumor.stl` → Ambiguous → Shows selection modal
- `model.stl` → Unknown → Shows selection modal

### Custom Marching Cubes Implementation

Built from scratch with:
- Edge intersection interpolation
- Gradient-based normal calculation
- Watertight mesh guarantee
- Performance benchmarking vs VTK
- Property-based testing (manifold checks, normal orientation)

### Mesh Post-Processing Pipeline

1. **Smoothing**: Laplacian or Humphrey's Class smoothing
2. **Decimation**: Quadric error metric for intelligent polygon reduction
3. **Hole Filling**: Closes gaps in mesh surface
4. **Manifold Repair**: Ensures mesh is watertight and 2-manifold

---

## 📊 Performance

- **Mesh Generation**: ~10-60 seconds for typical brain scans
- **File Upload**: Streaming with progress tracking
- **3D Rendering**: 60 FPS for meshes up to 500K triangles
- **WebSocket Latency**: <100ms for progress updates
- **Storage**: MinIO S3 with presigned URLs for fast downloads

---

## 🔒 Security Notes

- NIfTI uploads are de-identified (PHI removed)
- Files stored with UUID-based keys
- Presigned URLs with expiration for downloads
- CORS configured for frontend access
- No authentication in demo (add for production)

---

## 🤝 Contributing

This is a research/demonstration project. For the complete development roadmap and technical decisions, see `CLAUDE.md`.

---

## 📝 License

ISC

---

## 🙏 Acknowledgments

Built using:
- **SimpleITK** for medical image processing
- **Three.js** for 3D rendering
- **NestJS** for backend architecture
- **React Three Fiber** for React + Three.js integration

---

## 📧 Support

For questions or issues, please open an issue on GitHub or contact the development team.
