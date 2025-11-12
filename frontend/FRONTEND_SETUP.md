# Frontend Setup Guide

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Visit: **http://localhost:5173**

Backend should be running at: **http://localhost:3000**

## What Was Built

### **Single-Page Design**

Two main sections:

1. **Hero + Upload/Viewer Section**
   - Header: "ANATOMICAL MODELING"
   - Navigation: Upload, Contact
   - Hero content: "MRI TO 3D MESH PIPELINE"
   - Upload box with two modes:
     - **Convert NIfTI → 3D Mesh** (.nii.gz files)
     - **View STL Mesh** (.stl files)
   - After upload, box **transitions into** 3D viewer

2. **Contact Section**
   - "Get in Contact" heading
   - Form with Name, Email, Message
   - "Send Message" button

### **Key Features**

#### **Dual Upload Modes**

Users can choose between two options:

**Option 1: Convert NIfTI → 3D Mesh**
- Upload .nii.gz files
- Backend runs segmentation pipeline
- Generates brain + tumor meshes
- Full controls (visibility, opacity, download)

**Option 2: View STL Mesh**
- Upload .stl files directly
- Immediate viewing (no backend processing)
- Single mesh display

#### **Transition Behavior**

- Upload box → 3D Viewer (same section)
- No separate pages or sections
- "Back to Upload" button returns to upload mode

### **Color Palette**

```
Background: linear-gradient(135deg, #0B1B3D → #1e3a5f → #4a6fa5)
Accent: #ff6b4a (orange/coral)
Text: white
Glass panels: rgba(255, 255, 255, 0.05-0.1)
Form background: rgba(26, 49, 86, 0.6)
Input background: #0F2447
```

## User Flow

### NIfTI Upload Flow:
1. User selects "Convert NIfTI → 3D Mesh"
2. Drops .nii.gz file
3. Progress: "Uploading → Processing → Generating"
4. Upload box transitions to 3D viewer
5. User controls brain/tumor visibility/opacity
6. Downloads STL files if needed
7. Clicks "Back to Upload" to start over

### STL Upload Flow:
1. User selects "View STL Mesh"
2. Drops .stl file
3. Upload box immediately transitions to 3D viewer
4. User views mesh (no controls needed)
5. Clicks "Back to Upload" to start over

## Configuration

### API URL
```bash
# frontend/.env
VITE_API_BASE_URL=http://localhost:3000
```

### Colors
Edit `frontend/src/App.tsx`:

```typescript
// Line 153: Main gradient
background: 'linear-gradient(135deg, #0B1B3D 0%, #1e3a5f 50%, #4a6fa5 100%)'

// Line 242/259: Upload mode buttons
background: uploadType === 'nifti' ? '#ff6b4a' : 'rgba(255, 255, 255, 0.1)'

// Line 114: STL mesh color
color="#ff6b4a"
```

## Project Structure

```
frontend/src/
├── components/
│   └── MeshViewer.tsx       # 3D viewer (handles both modes)
├── hooks/
│   └── useMeshes.ts         # NIfTI mesh loading
├── api.ts                   # Backend API client
├── types.ts                 # TypeScript types
├── App.tsx                  # Main app (all sections)
└── main.tsx                 # Entry point
```

## Backend API

**For NIfTI uploads:**
- `POST /studies/upload` - Upload .nii.gz
  - Returns: `{ studyId: string }`
- `GET /studies/:id/download/mesh/brain.stl` - Download brain
- `GET /studies/:id/download/mesh/tumor.stl` - Download tumor

**For STL uploads:**
- No backend required (client-side only)

## Troubleshooting

### Upload not working
- Check backend is running: `http://localhost:3000`
- CORS enabled in `orchestration/src/main.ts`

### Meshes not loading (NIfTI mode)
- Verify backend processed file:
  ```bash
  curl http://localhost:3000/studies/<studyId>/meshes
  ```

### STL viewer not working
- Check browser console for errors
- Ensure file is valid STL format

## Production Build

```bash
npm run build
```

Output: `frontend/dist/`

Deploy to any static hosting (Vercel, Netlify, etc.).

## Summary

✅ Single-page layout (hero + contact)
✅ Two upload modes (NIfTI conversion vs STL viewing)
✅ Upload box transitions into viewer
✅ Contact form matching screenshot
✅ Dark gradient theme
✅ "ANATOMICAL MODELING" branding
✅ Clean, professional design

**Start it:**
```bash
cd frontend && npm install && npm run dev
```
