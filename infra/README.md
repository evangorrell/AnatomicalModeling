# Infrastructure

Docker Compose setup for local development infrastructure.

## Services

- **PostgreSQL** (port 5432): Main database
- **Redis** (port 6379): Job queue backend
- **MinIO** (port 9000/9001): S3-compatible object storage

## Usage

Start all services:
```bash
docker-compose up -d
```

Stop all services:
```bash
docker-compose down
```

Stop and remove all data:
```bash
docker-compose down -v
```

View logs:
```bash
docker-compose logs -f
```

## Access

- **PostgreSQL**: `postgresql://postgres:postgres@localhost:5432/dicom_pipeline`
- **Redis**: `redis://localhost:6379`
- **MinIO API**: `http://localhost:9000`
- **MinIO Console**: `http://localhost:9001`
  - Username: `minioadmin`
  - Password: `minioadmin`

## Health Checks

Check service status:
```bash
docker-compose ps
```

All services include health checks and will show as "healthy" when ready.
