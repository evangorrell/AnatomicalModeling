# Troubleshooting Guide

## Common Issues

### 1. "database 'dicom_pipeline' does not exist"

**Symptoms:**
```
ERROR [TypeOrmModule] Unable to connect to the database. Retrying (1)...
error: database "dicom_pipeline" does not exist
```

**This is usually normal!** TypeORM retries automatically. Wait 10-30 seconds for it to connect.

**If it keeps failing:**

```bash
# Check if Docker is running
cd infra
docker-compose ps

# If services are down, start them
docker-compose up -d

# Create the database manually
docker exec dicom-postgres psql -U postgres -c "CREATE DATABASE dicom_pipeline;"
```

### 2. Port Already in Use

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**

```bash
# Find what's using port 3000
lsof -ti:3000

# Kill the process (replace PID with actual number)
kill -9 <PID>

# Or use a different port
export PORT=3001
npm run start:dev
```

### 3. TypeScript Compilation Errors

**Symptoms:**
```
error TS2307: Cannot find module '@nestjs/common'
```

**Solution:**

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### 4. Docker Services Not Healthy

**Symptoms:**
```
ERROR [TypeOrmModule] connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**

```bash
cd infra

# Check service status
docker-compose ps

# Restart unhealthy services
docker-compose restart postgres

# Or restart all
docker-compose down
docker-compose up -d

# View logs
docker-compose logs -f postgres
```

### 5. AWS SDK v2 Warning

**Symptoms:**
```
NOTE: The AWS SDK for JavaScript (v2) is in maintenance mode.
```

**This is just a warning** - not an error. The code works fine. We use AWS SDK v2 for S3/MinIO compatibility. You can safely ignore this warning.

### 6. MinIO Bucket Not Found

**Symptoms:**
```
NoSuchBucket: The specified bucket does not exist
```

**Solution:**

```bash
# Recreate bucket
docker exec dicom-minio mc alias set myminio http://localhost:9000 minioadmin minioadmin
docker exec dicom-minio mc mb myminio/dicom-artifacts --ignore-existing

# Or restart minio-init service
cd infra
docker-compose up minio-init
```

### 7. Worker Script Not Found

**Symptoms:**
```
Error: Cannot find module '../imaging-worker/src/cli.py'
```

**Solution:**

Update `.env` with correct paths:

```bash
# For conda/system Python
WORKER_PYTHON_PATH=/opt/anaconda3/bin/python

# For venv
WORKER_PYTHON_PATH=/Users/yourname/.../imaging-worker/.venv/bin/python

# Relative path to worker script
WORKER_SCRIPT_PATH=../imaging-worker/src/cli.py
```

## Startup Checklist

Before starting the API, verify:

```bash
# 1. Infrastructure is running
cd infra
docker-compose ps
# All services should show "healthy"

# 2. Database exists
docker exec dicom-postgres psql -U postgres -c "\l dicom_pipeline"

# 3. MinIO bucket exists
docker exec dicom-minio mc ls myminio/dicom-artifacts

# 4. Environment configured
cd ../orchestration
cat .env
# Verify DB_HOST, DB_PORT, etc.

# 5. Dependencies installed
ls node_modules/@nestjs/core
# Should exist

# 6. Start API
npm run start:dev
```

## Expected Startup Output

Successful startup looks like:

```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] AppModule dependencies initialized
[Nest] LOG [InstanceLoader] TypeOrmModule dependencies initialized
[Nest] LOG [RoutesResolver] StudiesController {/studies}
[Nest] LOG [RouterExplorer] Mapped {/studies/upload, POST} route
[Nest] LOG [RouterExplorer] Mapped {/studies/:id, GET} route
[Nest] LOG [RouterExplorer] Mapped {/studies, GET} route
[Nest] LOG [NestApplication] Nest application successfully started
🚀 Application is running on: http://localhost:3000
📚 API Documentation: http://localhost:3000/api
```

## Getting Help

If you're still stuck:

1. Check the logs:
   ```bash
   # Infrastructure
   cd infra && docker-compose logs -f

   # API (in another terminal)
   cd orchestration && npm run start:dev
   ```

2. Verify all prerequisites:
   - Docker Desktop running
   - Node.js 18+ installed
   - Python 3.10+ installed
   - Ports 3000, 5432, 6379, 9000, 9001 available

3. Try a clean restart:
   ```bash
   # Stop everything
   cd infra && docker-compose down
   cd ../orchestration && # stop the dev server (Ctrl+C)

   # Start fresh
   cd ../infra && docker-compose up -d
   cd ../orchestration && npm run start:dev
   ```
