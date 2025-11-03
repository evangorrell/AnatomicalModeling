# Imaging Worker

Python worker for DICOM to 3D mesh processing pipeline.

## Setup

1. Create virtual environment and install dependencies:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

2. Configure environment (optional):
```bash
cp .env.example .env
# Edit .env with your settings
```

## Usage

### Phase A1: Ingest & Isotropic Resampling

Run the full Phase A1 pipeline:
```bash
python -m src.cli pipeline input.zip output_dir/
```

Options:
- `--spacing FLOAT`: Target isotropic spacing in mm (default: uses minimum of current spacing)
- `--interpolation {linear,bspline,nearest}`: Interpolation method (default: linear)
- `--no-deidentify`: Skip DICOM de-identification

### Individual Commands

Ingest DICOM ZIP:
```bash
python -m src.cli ingest input.zip output_dir/
```

Resample existing volume:
```bash
python -m src.cli resample volume.nii.gz output_dir/ --spacing 1.0
```

## Testing

Run tests:
```bash
pytest
```

With coverage:
```bash
pytest --cov=src --cov-report=html
```

## Project Structure

```
imaging-worker/
├── src/
│   ├── io/              # DICOM ingestion
│   ├── prep/            # Volume preprocessing (resampling)
│   ├── seg/             # Segmentation (Phase A2)
│   ├── surf/            # Surface extraction (Phase A3)
│   ├── mesh/            # Mesh post-processing (Phase A4)
│   └── export/          # Mesh export (Phase A4)
└── tests/               # Unit and integration tests
```

## Completed Phases

- ✅ **Phase A1**: DICOM Ingest & Isotropic Resampling
  - ZIP upload → de-identify → sort → 3D NIfTI volume
  - Isotropic resampling with configurable spacing
  - Metadata generation (spacing, origin, direction, transforms)
  - Comprehensive tests (spacing calc, slice sorting, transform consistency)
