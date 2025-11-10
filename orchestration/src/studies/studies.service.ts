import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Study } from './study.entity';
import { ProcessNiftiJobData } from './studies.processor';
import * as AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StudiesService {
  private s3: AWS.S3;

  constructor(
    @InjectRepository(Study)
    private studyRepository: Repository<Study>,
    private configService: ConfigService,
    @InjectQueue('studies')
    private studiesQueue: Queue<ProcessNiftiJobData>,
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

  /**
   * Upload file and queue processing job
   */
  async processUpload(file: Express.Multer.File): Promise<{ study: Study; jobId: string }> {
    const studyId = uuidv4();
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

    // Create study record with pending status
    const study = this.studyRepository.create({
      id: studyId,
      modality: 'MR',
      seriesDescription: 'NIfTI Upload',
      metadata: {
        source: 'nifti_upload',
        filename: file.originalname,
        status: 'pending',
      },
      s3Key,
      volumeS3Key: s3Key,
    });

    await this.studyRepository.save(study);

    // Queue processing job
    const job = await this.studiesQueue.add('process-nifti', {
      studyId,
      s3Key,
      filename: file.originalname,
    });

    return { study, jobId: job.id as string };
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
