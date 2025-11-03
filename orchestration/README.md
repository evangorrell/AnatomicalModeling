# Orchestration API

NestJS-based orchestration API for DICOM to 3D mesh pipeline.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Start infrastructure (requires Docker):
```bash
cd ../infra
docker-compose up -d
```

4. Run migrations (auto in dev mode):
```bash
npm run start:dev
```

## Development

Start in development mode with hot reload:
```bash
npm run start:dev
```

Build for production:
```bash
npm run build
npm run start:prod
```

## API Documentation

Once running, visit:
- API Docs: http://localhost:3000/api
- Health Check: http://localhost:3000

## Endpoints (Phase A1)

### Studies
- `POST /studies/upload` - Upload DICOM ZIP file
- `GET /studies/:id` - Get study by ID
- `GET /studies` - List all studies

## Tech Stack

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL (TypeORM)
- **Queue**: BullMQ (Redis)
- **Storage**: S3/MinIO
- **API Docs**: Swagger/OpenAPI
