import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Study } from './study.entity';
import { ProgressGateway } from '../events/progress.gateway';
import * as AWS from 'aws-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface ProcessNiftiJobData {
  studyId: string;
  s3Key: string;
  filename: string;
}

@Processor('studies', {
  concurrency: 3, // Process up to 3 studies concurrently
})
export class StudiesProcessor extends WorkerHost {
  private logger = new Logger(StudiesProcessor.name);
  private s3: AWS.S3;

  constructor(
    @InjectRepository(Study)
    private studyRepository: Repository<Study>,
    private configService: ConfigService,
    private progressGateway: ProgressGateway,
  ) {
    super();
    this.s3 = new AWS.S3({
      endpoint: this.configService.get('S3_ENDPOINT'),
      accessKeyId: this.configService.get('S3_ACCESS_KEY'),
      secretAccessKey: this.configService.get('S3_SECRET_KEY'),
      s3ForcePathStyle: this.configService.get('S3_FORCE_PATH_STYLE') === 'true',
      region: this.configService.get('S3_REGION', 'us-east-1'),
      signatureVersion: 'v4',
    });
  }

  async process(job: Job<ProcessNiftiJobData>): Promise<any> {
    const { studyId, s3Key, filename } = job.data;
    this.logger.log(`Processing study ${studyId}`);

    const tempDir = `/tmp/${studyId}`;
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Stage 1: Download from S3 (0-15%)
      await this.emitProgress(studyId, 0, 'upload', 'Downloading file from storage...');
      const niftiBuffer = await this.downloadFromS3(s3Key);
      await this.emitProgress(studyId, 15, 'upload', 'File ready for processing');

      // Save NIfTI temporarily
      const niftiPath = path.join(tempDir, 'input.nii.gz');
      fs.writeFileSync(niftiPath, niftiBuffer);

      // Stage 2: Segmentation (15-60%)
      await this.emitProgress(studyId, 15, 'segmentation', 'Starting brain segmentation...');
      const outputDir = path.join(tempDir, 'output');
      const segMetadata = await this.runSegmentation(studyId, niftiPath, outputDir);
      await this.emitProgress(studyId, 60, 'segmentation', 'Segmentation complete');

      // Upload mask to S3
      const maskPath = path.join(outputDir, 'mask.nii.gz');
      if (fs.existsSync(maskPath)) {
        const maskS3Key = `studies/${studyId}/mask.nii.gz`;
        await this.uploadToS3(maskS3Key, fs.readFileSync(maskPath), 'application/gzip');
      }

      // Stage 3: Mesh Generation (60-95%)
      await this.emitProgress(studyId, 60, 'mesh_generation', 'Generating 3D meshes...');
      const meshDir = path.join(outputDir, 'meshes');
      const meshMetadata = await this.runMeshGeneration(studyId, maskPath, meshDir);
      await this.emitProgress(studyId, 95, 'mesh_generation', '3D meshes generated');

      // Upload mesh files to S3
      const meshFiles = ['brain.stl', 'brain.obj', 'brain.mtl', 'tumor.stl', 'tumor.obj', 'tumor.mtl', 'mesh_metadata.json'];
      for (const meshFile of meshFiles) {
        const meshFilePath = path.join(meshDir, meshFile);
        if (fs.existsSync(meshFilePath)) {
          const meshS3Key = `studies/${studyId}/meshes/${meshFile}`;
          const contentType = this.getContentType(meshFile);
          await this.uploadToS3(meshS3Key, fs.readFileSync(meshFilePath), contentType);
        }
      }

      // Stage 4: Finalizing (95-100%)
      await this.emitProgress(studyId, 95, 'finalizing', 'Saving results...');

      // Update study record
      segMetadata['meshes'] = meshMetadata;
      const study = await this.studyRepository.findOne({ where: { id: studyId } });
      if (study) {
        study.metadata = {
          source: 'nifti_upload',
          segmentation: segMetadata,
          filename,
        };
        await this.studyRepository.save(study);
      }

      await this.emitProgress(studyId, 100, 'finalizing', 'Processing complete!');

      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Emit completion event
      this.progressGateway.emitComplete(studyId, {
        studyId,
        status: 'completed',
        meshes: meshFiles.filter(f => fs.existsSync(path.join(meshDir, f))),
      });

      return { studyId, status: 'completed' };
    } catch (error) {
      this.logger.error(`Study ${studyId} processing failed: ${error.message}`, error.stack);

      // Cleanup on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Emit error event
      this.progressGateway.emitError(studyId, {
        message: error.message,
        details: error.stack,
      });

      throw error;
    }
  }

  private async downloadFromS3(s3Key: string): Promise<Buffer> {
    const params = {
      Bucket: this.configService.get('S3_BUCKET'),
      Key: s3Key,
    };
    const result = await this.s3.getObject(params).promise();
    return result.Body as Buffer;
  }

  private async uploadToS3(s3Key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3
      .upload({
        Bucket: this.configService.get('S3_BUCKET'),
        Key: s3Key,
        Body: body,
        ContentType: contentType,
      })
      .promise();
  }

  private async runSegmentation(studyId: string, niftiPath: string, outputDir: string): Promise<any> {
    const pythonPath = this.configService.get('WORKER_PYTHON_PATH', 'python3');
    const workerDir = path.resolve(process.cwd(), '../imaging-worker');
    const args = ['-m', 'src.cli', 'segment', niftiPath, outputDir];

    this.logger.log(`Running segmentation: ${pythonPath} ${args.join(' ')}`);

    await this.runPythonCommand(
      pythonPath,
      args,
      workerDir,
      (line) => {
        // Parse progress from Python output
        const progressMatch = line.match(/PROGRESS:\s*(\d+)/);
        if (progressMatch) {
          const pythonProgress = parseInt(progressMatch[1]);
          // Map Python progress (0-100) to our segmentation stage (15-60%)
          const normalizedProgress = 15 + (pythonProgress * 0.45);
          this.emitProgress(studyId, normalizedProgress, 'segmentation', line.replace(/PROGRESS:\s*\d+\s*-?\s*/, ''));
        }
      }
    );

    // Read segmentation metadata
    const segMetadataPath = path.join(outputDir, 'segmentation_metadata.json');
    return JSON.parse(fs.readFileSync(segMetadataPath, 'utf-8'));
  }

  private async runMeshGeneration(studyId: string, maskPath: string, meshDir: string): Promise<any> {
    const pythonPath = this.configService.get('WORKER_PYTHON_PATH', 'python3');
    const workerDir = path.resolve(process.cwd(), '../imaging-worker');
    const args = ['-m', 'src.cli', 'mesh', maskPath, meshDir, '--formats', 'stl,obj', '--step-size', '1'];

    this.logger.log(`Running mesh generation: ${pythonPath} ${args.join(' ')}`);

    await this.runPythonCommand(
      pythonPath,
      args,
      workerDir,
      (line) => {
        // Parse progress from Python output
        const progressMatch = line.match(/PROGRESS:\s*(\d+)/);
        if (progressMatch) {
          const pythonProgress = parseInt(progressMatch[1]);
          // Map Python progress (0-100) to our mesh generation stage (60-95%)
          const normalizedProgress = 60 + (pythonProgress * 0.35);
          this.emitProgress(studyId, normalizedProgress, 'mesh_generation', line.replace(/PROGRESS:\s*\d+\s*-?\s*/, ''));
        }
      }
    );

    // Read mesh metadata
    const meshMetadataPath = path.join(meshDir, 'mesh_metadata.json');
    if (fs.existsSync(meshMetadataPath)) {
      return JSON.parse(fs.readFileSync(meshMetadataPath, 'utf-8'));
    }
    return null;
  }

  private runPythonCommand(
    pythonPath: string,
    args: string[],
    cwd: string,
    onLine?: (line: string) => void
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonPath, args, {
        cwd,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onLine) {
          text.split('\n').forEach(line => {
            if (line.trim()) {
              onLine(line);
            }
          });
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        this.logger.debug(text);
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python command failed with code ${code}: ${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  private async emitProgress(
    studyId: string,
    percentage: number,
    stage: 'upload' | 'segmentation' | 'mesh_generation' | 'finalizing',
    message: string
  ): Promise<void> {
    this.progressGateway.emitProgress(studyId, {
      studyId,
      percentage: Math.round(percentage),
      stage,
      message,
      timestamp: new Date(),
    });
    // Small delay to ensure progress is visible
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private getContentType(filename: string): string {
    if (filename.endsWith('.stl')) return 'application/vnd.ms-pki.stl';
    if (filename.endsWith('.obj')) return 'text/plain';
    if (filename.endsWith('.mtl')) return 'text/plain';
    if (filename.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
  }
}
