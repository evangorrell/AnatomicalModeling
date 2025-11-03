import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { StudiesService } from './studies.service';
import type { Response } from 'express';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Upload medical imaging file',
    description: 'Upload DICOM ZIP (.zip) or NIfTI volume (.nii.gz). ZIP files go through Phase A1 (ingest + resample), NIfTI files skip to Phase A2 (segmentation).'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'DICOM ZIP or NIfTI file (.nii.gz)',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDicom(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Detect file type
    const isZip = file.mimetype === 'application/zip' || file.originalname.endsWith('.zip');
    const isNifti = file.originalname.endsWith('.nii.gz') || file.originalname.endsWith('.nii');

    if (!isZip && !isNifti) {
      throw new BadRequestException('File must be a ZIP archive (.zip) or NIfTI volume (.nii.gz)');
    }

    const study = await this.studiesService.processUpload(file, isNifti);

    return {
      studyId: study.id,
      message: isNifti
        ? 'NIfTI volume uploaded and segmented successfully'
        : 'DICOM study uploaded and processed successfully',
      fileType: isNifti ? 'nifti' : 'dicom',
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
  @ApiOperation({ summary: 'Download original uploaded file' })
  async downloadOriginal(@Param('id') id: string, @Res() res: Response) {
    const { url, filename } = await this.studiesService.getDownloadUrl(id, 'original');
    res.redirect(url);
  }

  @Get(':id/download/volume')
  @ApiOperation({ summary: 'Download processed volume (NIfTI)' })
  async downloadVolume(@Param('id') id: string, @Res() res: Response) {
    const { url, filename } = await this.studiesService.getDownloadUrl(id, 'volume');
    res.redirect(url);
  }

  @Get(':id/download/mask')
  @ApiOperation({ summary: 'Download segmentation mask (NIfTI)' })
  async downloadMask(@Param('id') id: string, @Res() res: Response) {
    const { url, filename } = await this.studiesService.getDownloadUrl(id, 'mask');
    res.redirect(url);
  }

  @Get(':id/meshes')
  @ApiOperation({ summary: 'Get list of generated 3D meshes' })
  async listMeshes(@Param('id') id: string) {
    return this.studiesService.listMeshes(id);
  }

  @Get(':id/download/mesh/:filename')
  @ApiOperation({ summary: 'Download 3D mesh file (STL, OBJ, MTL)' })
  async downloadMesh(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response
  ) {
    const { url } = await this.studiesService.getMeshDownloadUrl(id, filename);
    res.redirect(url);
  }
}
