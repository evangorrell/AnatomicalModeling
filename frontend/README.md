# Anatomical Modeling - Frontend

React + TypeScript frontend for the MRI → 3D Mesh pipeline.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Visit: **http://localhost:5173**

## Features

- **Single-page layout** with integrated upload and viewer
- **Two upload modes:**
  - Convert NIfTI (.nii.gz) → 3D Mesh (automatic segmentation)
  - View STL files directly
- **Upload box transitions** into 3D viewer after file selection
- **Contact form** for inquiries
- **Dark gradient theme** matching surgical simulation aesthetic

## Structure

- **Hero Section** - Title, description, and upload box with two modes
- **3D Viewer** - Replaces upload box after file upload
- **Contact Section** - Get in contact form

## Usage

1. **Choose upload mode:**
   - "Convert NIfTI → 3D Mesh" for .nii.gz files (runs backend pipeline)
   - "View STL Mesh" for .stl files (direct viewing)

2. **Upload file:**
   - Drag and drop or click to browse

3. **View 3D model:**
   - For NIfTI: control brain/tumor visibility and opacity
   - For STL: view the mesh directly
   - Click "Back to Upload" to start over

4. **Contact:**
   - Scroll down to contact form

## Tech Stack

- React 18 + TypeScript
- Vite
- Three.js + @react-three/fiber
- Axios

## Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
