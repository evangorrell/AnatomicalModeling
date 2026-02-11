import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Res,
  Query,
  Logger,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { StudiesService } from './studies.service';
import type { Response } from 'express';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  private readonly logger = new Logger(StudiesController.name);

  constructor(private readonly studiesService: StudiesService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Upload MRI image and segmentation labels',
    description: 'Upload an MRI image (.nii.gz) and a ground-truth label file (.nii.gz). The pipeline segments the brain from the image, extracts the tumor from the labels, generates 3D meshes (STL/OBJ) for both, and streams progress via WebSocket.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'MRI image file (.nii.gz)',
        },
        labels: {
          type: 'string',
          format: 'binary',
          description: 'Ground truth tumor label file (.nii.gz)',
        },
      },
      required: ['image', 'labels'],
    },
  })
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'image', maxCount: 1 },
    { name: 'labels', maxCount: 1 },
  ]))
  async upload(
    @UploadedFiles() files: { image?: Express.Multer.File[], labels?: Express.Multer.File[] }
  ) {
    if (!files.image?.[0] || !files.labels?.[0]) {
      throw new BadRequestException('Both image and labels files are required');
    }

    const file1 = files.image[0];
    const file2 = files.labels[0];

    // Validate file types
    const isFile1Nifti = file1.originalname.endsWith('.nii.gz') || file1.originalname.endsWith('.nii');
    const isFile2Nifti = file2.originalname.endsWith('.nii.gz') || file2.originalname.endsWith('.nii');

    if (!isFile1Nifti || !isFile2Nifti) {
      throw new BadRequestException('Both files must be NIfTI volumes (.nii.gz or .nii)');
    }

    // Determine which is image vs labels based on file size
    // MRI images are typically MB, tumor labels are typically KB (sparse masks)
    let imageFile: Express.Multer.File;
    let labelsFile: Express.Multer.File;

    if (file1.size >= file2.size) {
      imageFile = file1;
      labelsFile = file2;
    } else {
      imageFile = file2;
      labelsFile = file1;
    }

    this.logger.log(`File assignment by size: Image="${imageFile.originalname}" (${(imageFile.size / 1024 / 1024).toFixed(2)} MB), Labels="${labelsFile.originalname}" (${(labelsFile.size / 1024).toFixed(2)} KB)`);

    const { study, jobId } = await this.studiesService.processUploadWithLabels(imageFile, labelsFile);

    return {
      studyId: study.id,
      jobId,
      message: 'Image and labels uploaded. Brain will be segmented from image, tumor from labels.',
      fileType: 'nifti_with_labels',
      status: 'processing',
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get study by ID' })
  async getStudy(@Param('id') id: string) {
    return this.studiesService.findById(id);
  }

  @Get()
  @ApiOperation({ summary: 'List all studies' })
  async listStudies() {
    return this.studiesService.findAll();
  }

  @Get(':id/artifacts')
  @ApiOperation({ summary: 'Get signed URLs for all study artifacts' })
  async getArtifacts(@Param('id') id: string) {
    return this.studiesService.getArtifactUrls(id);
  }

  @Get(':id/download/original')
  @ApiOperation({
    summary: 'Download original uploaded file',
    description: 'Downloads the file directly. Add info = true to get JSON with download URL.'
  })
  @ApiQuery({ name: 'info', required: false, type: Boolean, description: 'Return JSON info instead of downloading' })
  async downloadOriginal(
    @Param('id') id: string,
    @Query('info') info: string,
    @Res() res: Response,
  ) {
    const study = await this.studiesService.findById(id);
    const s3Key = study.s3Key;
    const filename = (study.metadata?.filename as string) || 'original.nii.gz';

    if (info === 'true') {
      const url = await this.studiesService.getSignedUrl(s3Key);
      return res.json({ studyId: id, filename, downloadUrl: url, suggestedPath: `~/Downloads/${filename}`, expiresIn: '1 hour' });
    }

    // Stream file from S3 with Content-Disposition header
    try {
      const s3Object = await this.studiesService.getS3Object(s3Key);
      res.setHeader('Content-Type', s3Object.ContentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', s3Object.ContentLength || 0);
      res.send(s3Object.Body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to download file: ${message}`);
    }
  }

  @Get(':id/download/volume')
  @ApiOperation({
    summary: 'Download processed volume',
    description: 'Downloads the file directly. Add info = true to get JSON with download URL.'
  })
  @ApiQuery({ name: 'info', required: false, type: Boolean, description: 'Return JSON info instead of downloading' })
  async downloadVolume(
    @Param('id') id: string,
    @Query('info') info: string,
    @Res() res: Response,
  ) {
    const study = await this.studiesService.findById(id);
    const s3Key = study.volumeS3Key;
    const filename = 'volume.nii.gz';

    if (info === 'true') {
      const url = await this.studiesService.getSignedUrl(s3Key);
      return res.json({ studyId: id, filename, downloadUrl: url, suggestedPath: `~/Downloads/${filename}`, expiresIn: '1 hour' });
    }

    // Stream file from S3 with Content-Disposition header
    try {
      const s3Object = await this.studiesService.getS3Object(s3Key);
      res.setHeader('Content-Type', s3Object.ContentType || 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', s3Object.ContentLength || 0);
      res.send(s3Object.Body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to download volume: ${message}`);
    }
  }

  @Get(':id/download/mask')
  @ApiOperation({
    summary: 'Download segmentation mask',
    description: 'Downloads the file directly. Add info = true to get JSON with download URL.'
  })
  @ApiQuery({ name: 'info', required: false, type: Boolean, description: 'Return JSON info instead of downloading' })
  async downloadMask(
    @Param('id') id: string,
    @Query('info') info: string,
    @Res() res: Response,
  ) {
    await this.studiesService.findById(id); // Verify study exists
    const s3Key = `studies/${id}/mask.nii.gz`;
    const filename = 'mask.nii.gz';

    if (info === 'true') {
      const url = await this.studiesService.getSignedUrl(s3Key);
      return res.json({ studyId: id, filename, downloadUrl: url, suggestedPath: `~/Downloads/${filename}`, expiresIn: '1 hour' });
    }

    // Stream file from S3 with Content-Disposition header
    try {
      const s3Object = await this.studiesService.getS3Object(s3Key);
      res.setHeader('Content-Type', s3Object.ContentType || 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', s3Object.ContentLength || 0);
      res.send(s3Object.Body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Mask not found or download failed: ${message}`);
    }
  }

  @Get(':id/meshes')
  @ApiOperation({ summary: 'Get list of generated 3D meshes' })
  async listMeshes(@Param('id') id: string) {
    return this.studiesService.listMeshes(id);
  }

  @Get(':id/download/mesh/:filename')
  @ApiOperation({
    summary: 'Download 3D mesh file (STL, OBJ, MTL)',
    description: 'Downloads the mesh file directly. Add info = true to get JSON with download URL instead of downloading.'
  })
  @ApiQuery({ name: 'info', required: false, type: Boolean, description: 'Return JSON info instead of downloading file' })
  async downloadMesh(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Query('info') info: string,
    @Res() res: Response,
  ) {
    await this.studiesService.findById(id); // Verify study exists
    const s3Key = `studies/${id}/meshes/${filename}`;

    // If info=true, return JSON with download details
    if (info === 'true') {
      const url = await this.studiesService.getSignedUrl(s3Key);
      return res.json({
        studyId: id,
        filename: filename,
        downloadUrl: url,
        s3Path: s3Key,
        suggestedPath: `~/Downloads/${filename}`,
        expiresIn: '1 hour',
        instructions: `Use the downloadUrl to download the file. In your browser, it will save to your Downloads folder (typically ~/Downloads/${filename})`,
      });
    }

    // Default: Stream file from S3 with Content-Disposition header
    try {
      const s3Object = await this.studiesService.getS3Object(s3Key);

      // Set headers to force download
      res.setHeader('Content-Type', s3Object.ContentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', s3Object.ContentLength || 0);

      // Stream the file
      res.send(s3Object.Body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to download mesh file: ${message}`);
    }
  }
}
