# CLAUDE.md — MRI→3D Project Playbook

This file is the single source of truth for building an MRI DICOM → 3D mesh pipeline suitable for a YC‑grade demo.

---

## 0) Objective

Convert a single‑organ MR DICOM series into an interactive 3D model and export watertight STL/OBJ/PLY. Stretch: experimental CAD STEP/IGES via NURBS fitting.

**Showcase items:** custom Marching Cubes + benchmarks, deterministic classical segmentation with metrics, streaming jobs, viewer with slicing.

---

## 1) Phases & Linear Prompts

Use these exact prompts to move step‑by‑step. Each finishes with code, tests, and a short demo.

### Phase A — MVP Pipeline

1. **A1. Ingest & Isotropic Volume**
   *Prompt:* “Let’s build the **Ingest & Isotropic Volume** feature.”
   *Deliver:* ZIP upload → de‑identify → sort by orientation/position → 3D volume (NIfTI) resampled to isotropic; `metadata.json`.
   *Tests:* spacing calc on phantoms; image count/order; transform consistency.

2. **A2. Classical Segmentation**
   *Prompt:* “Implement **Classical Segmentation** (Otsu→morphology→level‑set refine).”
   *Deliver:* binary mask NIfTI; largest component; params in metadata.
   *Metrics:* Dice, Hausdorff‑95 on sample set (if labels available).

3. **A3. Custom Marching Cubes**
   *Prompt:* “Implement **Custom Marching Cubes + normals** and benchmark vs VTK.”
   *Deliver:* `marching_cubes` module (edge/tri tables, interpolation, normals).
   *Tests:* watertightness, non‑manifold check, triangle count parity vs reference; perf timing.

4. **A4. Mesh Post‑proc & Export**
   *Prompt:* “Add **mesh post‑processing** (Laplacian smoothing, decimation) and **export STL/OBJ/PLY**.”
   *Deliver:* manifold mesh, target tri budget, normals.

5. **A5. Orchestrator + Jobs + Preview**
   *Prompt:* “Stand up the **NestJS API** with file upload, Redis jobs, progress WS, S3/MinIO storage, and a **web preview** (orthogonal slice planes + iso slider).”
   *Deliver:* OpenAPI spec, BullMQ, signed URLs, GLB low‑poly preview.

### Phase B — v1 Polish

6. **B1. Observability & Hardening**
   *Prompt:* “Add auth, rate limits, Sentry, Prometheus/Grafana, CI, and resumable uploads.”

7. **B2. DL Path (optional)**
   *Prompt:* “Wire **U‑Net** inference via ONNXRuntime and compare vs classical (metrics + runtime).”

### Phase C — Stretch (Researchy)

8. **C1. CAD Prototype**
   *Prompt:* “Attempt **quad‑remesh → NURBS fit → STEP/IGES export** on one organ; report RMS surface error.”

---

## 2) Tech Stack (decision)

* **API/Orchestrator:** TypeScript (NestJS), BullMQ/Redis, Postgres, S3/MinIO, WebSockets.
* **Imaging Worker:** Python (`pydicom`, `SimpleITK/ITK`, `scikit‑image`, `trimesh`, `pyvista/VTK`, optional `MONAI`, `onnxruntime`).
* **Viewer (later):** React + VTK.js/itk‑wasm + Three.js (web first; RN later if needed).

**Why:** TS for product polish and jobs; Python for mature medical‑imaging numerics. Custom Marching Cubes gives math depth without reinventing DICOM.

---

## 3) API Contracts (v0)

* `POST /studies/upload` → `{ studyId }` (ZIP of DICOMs)
* `POST /studies/:studyId/reconstruct` → `{ jobId }` with body `{ method:"classical"|"unet", organ, isoSpacing, smooth:{type,iters}, export:["stl","obj","ply"] }`
* `GET /jobs/:jobId` → `{ status, pct, stage, logs, artifacts[] }`
* `GET /models/:modelId/preview` → signed URLs (slices, low‑poly GLB)
* `GET /models/:modelId/mesh?format=stl|obj|ply`
* `GET /models/:modelId/metadata`

Artifacts: `volume.nii.gz`, `mask.nii.gz`, `model.(stl|obj|ply|glb)`, `metadata.json` (spacing, origin, direction, resample matrix, params).

---

## 4) Imaging Worker — Minimal Modules

* `io/dicom_ingest.py` — read, de‑ID, group by SeriesInstanceUID, sort by ImagePositionPatient using normal from ImageOrientationPatient.
* `prep/resample.py` — isotropic resample (trilinear; optional BSpline), record transforms.
* `seg/classical.py` — Otsu → largest component → close → level‑set refine (Chan–Vese).
* `surf/marching_cubes.py` — custom implementation (edge/tri tables, linear edge interp, gradient normals).
* `mesh/postprocess.py` — manifold check, Laplacian/HC smoothing, quadric‑error decimation.
* `export/mesh_export.py` — STL/OBJ/PLY + GLB preview; normals; units/mm.

---

## 5) From‑Scratch Algorithms (commitments)

* **Custom Marching Cubes + vertex normals** (benchmarked vs VTK; perf + parity plots).
* **Watertightness/manifold validator** (property tests on phantoms).
* (Optional) **Simple decimator**; advanced decimation can use library.

Non‑goals to re‑implement: DICOM parsing, ITK resampling kernels, full NURBS stack.

---

## 6) Testing & Benchmarks

* **Unit:** slice sorting, spacing, resample correctness on phantoms.
* **Property:** watertightness, normal orientation, connected components.
* **E2E:** upload→reconstruct→download STL; viewer opens GLB.
* **Metrics:** Dice, Hausdorff‑95, runtime, memory, triangle count, FPS.

---

## 7) Repo Layout

```
repo/
  orchestration/           # NestJS API
  imaging-worker/          # Python worker
  infra/                   # Docker, docker-compose (Redis, PG, MinIO), k8s
  docs/                    # api.md, pipeline.md, datasets.md
```

---

## 8) Acceptance Criteria per Phase

* **A1:** Given a DICOM ZIP, API returns `studyId`; `volume.nii.gz` has isotropic spacing; metadata includes spacing/origin/direction; tests pass.
* **A2:** `mask.nii.gz` exists; largest component retained; metrics script runs.
* **A3:** `model_lowpoly.glb` renders; custom MC triangle count within ±5% of VTK at same iso; watertight true.
* **A4:** STL/OBJ/PLY downloadable; normals present; decimation target met.
* **A5:** Jobs stream progress; preview shows slices + iso slider; artifacts signed URLs.
* **B1:** Auth enabled; Sentry traces; Prom/Grafana dashboard live; uploads resumable.
* **B2:** Inference path selectable; metrics compare classical vs DL.
* **C1:** STEP file produced for one case with RMS surface error report.

---

## 9) Time & Difficulty (solo, heavy AI assist)

* **MVP (A1–A5):** ~3–5 weeks (120–200 hrs)
* **v1 polish (B1/B2):** ~6–10 weeks total (240–400 hrs)
* **CAD stretch (C1):** +4–8 weeks

Risk multipliers: data quirks (+10–20h), MC edge cases (+10–24h), GPU wrangling (+6–12h), cloud/IaC (+1–2wk).

---

## 10) Datasets (dev/test)

Public, de‑identified MR sets (kidney/brain/liver); include synthetic phantoms for exact geometry tests.

---

## 11) Demo Script (YC‑ready, 60–90s)

1. Upload DICOM → live progress. 2) Interactive viewer: slice planes + iso slider. 3) Export STL; import in CAD as reference. 4) Toggle VTK vs Custom MC with perf overlay. 5) (Optional) Show U‑Net vs classical metrics.

---

## 12) Security & Scope

De‑identify DICOM on ingest; store provenance + hashes. No medical claims; research visualization only.

---
-

* **Orchestrator:** create NestJS app, Multer ZIP upload, BullMQ queue, Redis, S3 client, OpenAPI, WS gateway.
* **Worker:** CLI to run pipeline; S3 in/out; logs to stdout; exit codes; ONNXRuntime hooks.
* **Infra:** docker‑compose with API, worker, Redis, Postgres, MinIO.

> Use the Phase prompts to proceed. Start with: **“Let’s build the Ingest & Isotropic Volume feature.”**
