import { Controller, Post, Body, UseGuards, HttpException, HttpStatus, Request, Get, Query, Res, UseInterceptors, UploadedFile, Param, ParseIntPipe } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { JwtAuthGuard } from 'src/common/guards/auth-guard';
import { RolesGuard } from 'src/common/guards/roles-guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { DocumentsService, EndorsePlacements } from './documents.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('documents')
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private prisma: PrismaService,
  ) {}

  @Post('sign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async signDocument(
    @Body() body: { submissionId: number; documentType?: 'postingLetter' | 'appointmentLetter'; pages?: number[]; placements?: Partial<EndorsePlacements> },
    @Request() req,
  ) {
    const { submissionId, pages, placements } = body;

    // Validate submission
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { user: true },
    });
    if (!submission) {
      throw new HttpException('Submission not found', HttpStatus.NOT_FOUND);
    }
    if (submission.status !== 'PENDING_ENDORSEMENT') {
      throw new HttpException('Submission not ready for endorsement', HttpStatus.BAD_REQUEST);
    }
    if (submission.uploadRejected) {
      throw new HttpException('This posting and appointment letter was rejected and is waiting for a new PDF', HttpStatus.BAD_REQUEST);
    }

    const admin = await this.prisma.user.findUnique({
      where: { id: req.user.id },
    });
    if (!admin || !admin.signage || !admin.stamp) {
      throw new HttpException(
        'Admin signature or stamp not configured',
        HttpStatus.BAD_REQUEST,
      );
    }

    const normalizeToFileKey = (url: string) => {
      if (!url) return '';
      if (url.startsWith('/files/')) return url.replace('/files/', '');
      try {
        const u = new URL(url);
        const marker = '/storage/v1/object/public/killermike/';
        const idx = u.pathname.indexOf(marker);
        if (idx !== -1) {
          return u.pathname.substring(idx + marker.length);
        }
      } catch {}
      return url;
    };

    const rawUrl = submission.appointmentLetterUrl || submission.postingLetterUrl;
    const fileName = normalizeToFileKey(rawUrl);
console.log('Raw URL:', submission.appointmentLetterUrl, 'Parsed fileName:', fileName);

    if (!fileName) {
      throw new HttpException('No posting and appointment letter found for submission', HttpStatus.BAD_REQUEST);
    }

    // Sign document
    const { signedUrl, documentId } = await this.documentsService.signDocument(
      submissionId,
      fileName,
      req.user.id,
      admin.signage,
      admin.stamp,
      rawUrl,
      pages,
      placements,
    );

    return {
      message: `Posting and appointment letter signed successfully`,
      signedUrl,
      documentId,
    };
  }

  // Retrieve signed document
  @Get('signed/:submissionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PERSONNEL', 'ADMIN')
  async getSignedDocument(@Request() req, @Body() body: { submissionId: number }) {
    const { submissionId } = body;

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { user: true },
    });
    if (!submission) {
      throw new HttpException('Submission not found', HttpStatus.NOT_FOUND);
    }

    if (req.user.role !== 'ADMIN' && submission.userId !== req.user.id) {
      throw new HttpException('Unauthorized access to submission', HttpStatus.FORBIDDEN);
    }

    const document = await this.prisma.document.findFirst({
      where: { submissionId },
      orderBy: { signedAt: 'desc' },
    });
    if (!document || !document.signedUrl) {
      throw new HttpException('No signed document found for this submission', HttpStatus.NOT_FOUND);
    }

    return {
      message: 'Signed document retrieved successfully',
      signedUrl: document.signedUrl,
      documentId: document.id,
    };
  }

@Get('personnel/download-appointment-letter')
@UseGuards(JwtAuthGuard)
async downloadAppointmentLetter(
  @Request() req,
  @Query('type') type: 'appointment' | 'endorsed' | 'job_confirmation',
  @Res() res: Response,
) {
  if (!['appointment', 'endorsed', 'job_confirmation'].includes(type)) {
    throw new HttpException('Invalid type parameter', HttpStatus.BAD_REQUEST);
  }

  const fileStream = await this.documentsService.downloadAppointmentLetter(req.user.id, type);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${type}-letter.pdf"`,
  });
  fileStream.pipe(res);
  }

  //upload template
  @Post('/upload-template')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(FileInterceptor('template', {
  fileFilter: (req, file, cb) => {
    if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype)) {
      return cb(new Error('Only PDF or Word files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
}))
async uploadTemplate(
  @Request() req,
  @UploadedFile() template: Express.Multer.File,
  @Body('name') name: string,
) {
  return this.documentsService.uploadTemplate(req.user.id, template, name);
  }

   @Get('notifications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF', 'PERSONNEL')
  async getNotifications(@Request() req) {
    return this.documentsService.getNotifications(req.user.id, req.user.role);
  }

  @Post('send-appointment-letter/:submissionId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@UseInterceptors(FileInterceptor('file'))
async sendAppointmentLetter(
  @Request() req,
  @Param('submissionId', ParseIntPipe) submissionId: number,
  @UploadedFile() file: Express.Multer.File,
  @Body() dto: { status: string },
) {
  return this.documentsService.sendAppointmentLetter(req.user.id, submissionId, file, dto);
}
}