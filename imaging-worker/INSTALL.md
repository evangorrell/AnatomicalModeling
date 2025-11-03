# Installation Guide

## Quick Fix for Dependency Conflicts

If you encounter dependency conflicts with `aiobotocore` and `botocore`, use one of these solutions:

### Option 1: Fresh Virtual Environment (Recommended)

```bash
# Remove old venv
rm -rf .venv

# Create fresh venv
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install with pinned dependencies
pip install -e ".[dev]"
```

### Option 2: Fix Existing Environment

```bash
source .venv/bin/activate

# Uninstall conflicting packages
pip uninstall -y aiobotocore botocore boto3

# Reinstall with compatible versions
pip install -e ".[dev]"
```

### Option 3: Install Without aiobotocore

If you don't need `aiobotocore` (we only use `boto3`):

```bash
source .venv/bin/activate
pip uninstall -y aiobotocore
pip install -e ".[dev]"
```

## Verify Installation

```bash
# Check for conflicts
pip check

# Run tests to verify everything works
pytest
```

## Common Issues

### Import Error: No module named 'xxx'

Make sure virtual environment is activated:
```bash
source .venv/bin/activate
```

Then reinstall:
```bash
pip install -e ".[dev]"
```

### SimpleITK Installation Fails

On some systems, you may need to install system dependencies first:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install python3-dev build-essential
```

**macOS:**
```bash
brew install python@3.10
```

### VTK/PyVista Issues

If you encounter VTK-related errors:
```bash
pip install --upgrade vtk pyvista
```

## Development Dependencies

Optional dependencies for deep learning:
```bash
pip install -e ".[dl]"
```

This installs:
- `onnxruntime` - For running ONNX models
- `monai` - Medical imaging deep learning framework
