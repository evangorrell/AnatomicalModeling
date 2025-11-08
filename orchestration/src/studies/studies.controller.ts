import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { StudiesService } from './studies.service';
import type { Response } from 'express';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Upload NIfTI file',
    description: 'Upload NIfTI volume (.nii.gz) for automatic segmentation and 3D mesh generation.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'NIfTI file (.nii.gz or .nii)',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadNifti(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Only accept NIfTI files
    const isNifti = file.originalname.endsWith('.nii.gz') || file.originalname.endsWith('.nii');

    if (!isNifti) {
      throw new BadRequestException('File must be a NIfTI volume (.nii.gz or .nii)');
    }

    const study = await this.studiesService.processUpload(file);

    return {
      studyId: study.id,
      message: 'NIfTI volume uploaded and segmented successfully',
      fileType: 'nifti',
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
    description: 'Downloads the file directly. Add ?info=true to get JSON with download URL.'
  })
  @ApiQuery({ name: 'info', required: false, type: Boolean, description: 'Return JSON info instead of downloading' })
  async downloadOriginal(
    @Param('id') id: string,
    @Query('info') info: string,
    @Res() res: Response,
  ) {
    const study = await this.studiesService.findById(id);
    const s3Key = study.s3Key;
    const filename = study.metadata?.filename || 'original.nii.gz';

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
    } catch (error) {
      throw new BadRequestException(`Failed to download file: ${error.message}`);
    }
  }

  @Get(':id/download/volume')
  @ApiOperation({
    summary: 'Download processed volume (NIfTI)',
    description: 'Downloads the file directly. Add ?info=true to get JSON with download URL.'
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
    } catch (error) {
      throw new BadRequestException(`Failed to download volume: ${error.message}`);
    }
  }

  @Get(':id/download/mask')
  @ApiOperation({
    summary: 'Download segmentation mask (NIfTI)',
    description: 'Downloads the file directly. Add ?info=true to get JSON with download URL.'
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
    } catch (error) {
      throw new BadRequestException(`Mask not found or download failed: ${error.message}`);
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
    description: 'Downloads the mesh file directly to your browser\'s Downloads folder. Add ?info=true to get JSON with download URL instead of downloading.'
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
    } catch (error) {
      throw new BadRequestException(`Failed to download mesh file: ${error.message}`);
    }
  }
}
