import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Study } from './study.entity';
import * as AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { exec, spawn } from 'child_process';

@Injectable()
export class StudiesService {
  private s3: AWS.S3;

  private runPythonCommand(pythonPath: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonPath, args, {
        cwd,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
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

  constructor(
    @InjectRepository(Study)
    private studyRepository: Repository<Study>,
    private configService: ConfigService,
  ) {
    this.s3 = new AWS.S3({
      endpoint: this.configService.get('S3_ENDPOINT'),
      accessKeyId: this.configService.get('S3_ACCESS_KEY'),
      secretAccessKey: this.configService.get('S3_SECRET_KEY'),
      s3ForcePathStyle: this.configService.get('S3_FORCE_PATH_STYLE') === 'true',
      region: this.configService.get('S3_REGION', 'us-east-1'),
      signatureVersion: 'v4',
    });
  }

  async processUpload(file: Express.Multer.File): Promise<Study> {
    const studyId = uuidv4();
    return this.processNiftiUpload(file, studyId);
  }

  private async processNiftiUpload(file: Express.Multer.File, studyId: string): Promise<Study> {
    const s3Key = `studies/${studyId}/original.nii.gz`;

    // Upload NIfTI to S3
    await this.s3
      .upload({
        Bucket: this.configService.get('S3_BUCKET'),
        Key: s3Key,
        Body: file.buffer,
        ContentType: 'application/gzip',
      })
      .promise();

    // Process with imaging worker (Phase A2: segmentation)
    const tempDir = `/tmp/${studyId}`;
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Save NIfTI temporarily
      const niftiPath = path.join(tempDir, 'input.nii.gz');
      fs.writeFileSync(niftiPath, file.buffer);

      // Run segmentation worker
      const pythonPath = this.configService.get('WORKER_PYTHON_PATH', 'python3');
      const outputDir = path.join(tempDir, 'output');
      const args = ['-m', 'src.cli', 'segment', niftiPath, outputDir];

      console.log(`Running segmentation: ${pythonPath} ${args.join(' ')}`);
      const workerDir = path.resolve(process.cwd(), '../imaging-worker');
      console.log(`Worker directory: ${workerDir}`);
      const { stdout, stderr } = await this.runPythonCommand(
        pythonPath,
        args,
        workerDir,
      );

      console.log('Segmentation output:', stdout);
      if (stderr) console.error('Segmentation errors:', stderr);

      // Read segmentation metadata
      const segMetadataPath = path.join(outputDir, 'segmentation_metadata.json');
      const segMetadata = JSON.parse(fs.readFileSync(segMetadataPath, 'utf-8'));

      // Upload mask to S3
      const maskPath = path.join(outputDir, 'mask.nii.gz');
      const maskS3Key = `studies/${studyId}/mask.nii.gz`;

      if (fs.existsSync(maskPath)) {
        await this.s3
          .upload({
            Bucket: this.configService.get('S3_BUCKET'),
            Key: maskS3Key,
            Body: fs.readFileSync(maskPath),
            ContentType: 'application/gzip',
          })
          .promise();

        // Generate 3D meshes from segmentation (Phase A3 + A4)
        // Phase A3: Custom Marching Cubes surface extraction
        // Phase A4: Automated post-processing (hole filling, smoothing, manifold repair)
        //          Post-processing is ENABLED BY DEFAULT for 3D print-ready output
        console.log('Generating 3D meshes from segmentation...');
        const meshDir = path.join(outputDir, 'meshes');
        const meshArgs = ['-m', 'src.cli', 'mesh', maskPath, meshDir, '--formats', 'stl,obj', '--step-size', '1']; // KEEP STEP-SIZE AT 1 FOR WATERTIGHT
        // Note: --no-postprocess flag omitted intentionally (post-processing is default)

        try {
          const { stdout: meshStdout, stderr: meshStderr } = await this.runPythonCommand(
            pythonPath,
            meshArgs,
            workerDir,
          );

          console.log('Mesh generation output:', meshStdout);
          if (meshStderr) console.error('Mesh generation errors:', meshStderr);

          // Upload mesh files to S3
          const meshFiles = ['brain.stl', 'brain.obj', 'brain.mtl', 'tumor.stl', 'tumor.obj', 'tumor.mtl', 'mesh_metadata.json'];

          for (const meshFile of meshFiles) {
            const meshFilePath = path.join(meshDir, meshFile);
            if (fs.existsSync(meshFilePath)) {
              const meshS3Key = `studies/${studyId}/meshes/${meshFile}`;
              const contentType = meshFile.endsWith('.stl') ? 'application/vnd.ms-pki.stl' :
                                  meshFile.endsWith('.obj') ? 'text/plain' :
                                  meshFile.endsWith('.mtl') ? 'text/plain' : 'application/json';

              await this.s3
                .upload({
                  Bucket: this.configService.get('S3_BUCKET'),
                  Key: meshS3Key,
                  Body: fs.readFileSync(meshFilePath),
                  ContentType: contentType,
                })
                .promise();

              console.log(`Uploaded mesh: ${meshS3Key}`);
            }
          }

          // Read mesh metadata
          const meshMetadataPath = path.join(meshDir, 'mesh_metadata.json');
          let meshMetadata = null;
          if (fs.existsSync(meshMetadataPath)) {
            meshMetadata = JSON.parse(fs.readFileSync(meshMetadataPath, 'utf-8'));
          }

          segMetadata['meshes'] = meshMetadata;
        } catch (meshError) {
          console.error('Mesh generation failed (non-fatal):', meshError.message);
          // Continue even if mesh generation fails
        }
      }

      // Create study record
      const study = this.studyRepository.create({
        id: studyId,
        modality: 'MR',
        seriesDescription: 'NIfTI Upload',
        metadata: {
          source: 'nifti_upload',
          segmentation: segMetadata,
          filename: file.originalname,
        },
        s3Key,
        volumeS3Key: s3Key, // Original NIfTI is the volume
      });

      await this.studyRepository.save(study);

      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });

      return study;
    } catch (error) {
      // Cleanup on error
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }


  async findById(id: string): Promise<Study> {
    const study = await this.studyRepository.findOne({
      where: { id },
      relations: ['jobs'],
    });

    if (!study) {
      throw new NotFoundException(`Study ${id} not found`);
    }

    return study;
  }

  async findAll(): Promise<Study[]> {
    return this.studyRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async getSignedUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    const params: any = {
      Bucket: this.configService.get('S3_BUCKET'),
      Key: s3Key,
      Expires: expiresIn,
    };

    // Note: MinIO has issues with ResponseContentDisposition in presigned URLs
    // Downloads are handled by proxying through NestJS with Content-Disposition headers

    return this.s3.getSignedUrlPromise('getObject', params);
  }

  async getS3Object(s3Key: string): Promise<AWS.S3.GetObjectOutput> {
    const params = {
      Bucket: this.configService.get('S3_BUCKET'),
      Key: s3Key,
    };

    return this.s3.getObject(params).promise();
  }

  async getArtifactUrls(studyId: string): Promise<{ studyId: string; artifacts: Record<string, string>; metadata: any }> {
    const study = await this.findById(studyId);
    const bucket = this.configService.get('S3_BUCKET');

    const artifacts: Record<string, string> = {};

    // Original file
    if (study.s3Key) {
      artifacts.original = await this.getSignedUrl(study.s3Key);
    }

    // Volume
    if (study.volumeS3Key) {
      artifacts.volume = await this.getSignedUrl(study.volumeS3Key);
    }

    // Check for mask
    const maskKey = `studies/${studyId}/mask.nii.gz`;
    try {
      await this.s3.headObject({ Bucket: bucket, Key: maskKey }).promise();
      artifacts.mask = await this.getSignedUrl(maskKey);
    } catch (e) {
      // Mask doesn't exist
    }

    // Check for isotropic volume
    const isotropicKey = `studies/${studyId}/volume_isotropic.nii.gz`;
    try {
      await this.s3.headObject({ Bucket: bucket, Key: isotropicKey }).promise();
      artifacts.volume_isotropic = await this.getSignedUrl(isotropicKey);
    } catch (e) {
      // Isotropic volume doesn't exist
    }

    return {
      studyId,
      artifacts,
      metadata: study.metadata,
    };
  }

  async getDownloadUrl(
    studyId: string,
    type: 'original' | 'volume' | 'mask',
  ): Promise<{ url: string; filename: string }> {
    const study = await this.findById(studyId);

    let s3Key: string;
    let filename: string;

    switch (type) {
      case 'original':
        s3Key = study.s3Key;
        filename = study.metadata?.filename || 'original.nii.gz';
        break;
      case 'volume':
        s3Key = study.volumeS3Key;
        filename = 'volume.nii.gz';
        break;
      case 'mask':
        s3Key = `studies/${studyId}/mask.nii.gz`;
        filename = 'mask.nii.gz';
        // Verify mask exists
        try {
          await this.s3
            .headObject({
              Bucket: this.configService.get('S3_BUCKET'),
              Key: s3Key,
            })
            .promise();
        } catch (e) {
          throw new NotFoundException('Mask not found for this study');
        }
        break;
    }

    const url = await this.getSignedUrl(s3Key);
    return { url, filename };
  }

  async listMeshes(studyId: string): Promise<{ meshes: string[]; metadata: any }> {
    const study = await this.findById(studyId);
    const bucket = this.configService.get('S3_BUCKET');
    const prefix = `studies/${studyId}/meshes/`;

    // List all mesh files
    const response = await this.s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
      })
      .promise();

    const meshes = (response.Contents || []).map((obj) => obj.Key.replace(prefix, ''));

    // Get mesh metadata if available
    const meshMetadata = study.metadata?.segmentation?.meshes || null;

    return {
      meshes,
      metadata: meshMetadata,
    };
  }

  async getMeshDownloadUrl(studyId: string, filename: string): Promise<{ url: string; filename: string }> {
    await this.findById(studyId); // Verify study exists

    const s3Key = `studies/${studyId}/meshes/${filename}`;
    const bucket = this.configService.get('S3_BUCKET');

    // Verify file exists
    try {
      await this.s3.headObject({ Bucket: bucket, Key: s3Key }).promise();
    } catch (e) {
      throw new NotFoundException(`Mesh file not found: ${filename}`);
    }

    const url = await this.getSignedUrl(s3Key);
    return { url, filename };
  }
}
