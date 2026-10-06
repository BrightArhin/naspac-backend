import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { createHash } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { Readable } from 'stream';
// Supabase removed in favor of local storage
import { NotificationsService } from 'src/notifications/notifications.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export type EndorseBox = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  size?: number;
};

export type EndorsePlacements = {
  date: EndorseBox;
  signature: EndorseBox;
  stamp: EndorseBox;
  company: EndorseBox;
  email: EndorseBox;
  phone1: EndorseBox;
  phone2: EndorseBox;
};

const defaultPlacements: EndorsePlacements = {
  date: { x: 0.36, y: 0.52, size: 20 },
  signature: { x: 0.28, y: 0.58, width: 0.18, height: 0.1 },
  stamp: { x: 0.5, y: 0.58, width: 0.16, height: 0.12 },
  company: { x: 0.3, y: 0.46, size: 18 },
  email: { x: 0.3, y: 0.52, size: 16 },
  phone1: { x: 0.3, y: 0.56, size: 16 },
  phone2: { x: 0.3, y: 0.6, size: 16 },
};

const placementNumber = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const mergeBox = (fallback: EndorseBox, input?: Partial<EndorseBox>): EndorseBox => ({
  x: Math.min(0.92, Math.max(0, placementNumber(input?.x, fallback.x))),
  y: Math.min(0.92, Math.max(0, placementNumber(input?.y, fallback.y))),
  width: Math.min(0.85, Math.max(0.05, placementNumber(input?.width, fallback.width || 0.18))),
  height: Math.min(0.6, Math.max(0.04, placementNumber(input?.height, fallback.height || 0.1))),
  size: Math.min(96, Math.max(10, placementNumber(input?.size, fallback.size || 16))),
});

const mergePlacements = (input?: Partial<EndorsePlacements>): EndorsePlacements => ({
  date: mergeBox(defaultPlacements.date, input?.date),
  signature: mergeBox(defaultPlacements.signature, input?.signature),
  stamp: mergeBox(defaultPlacements.stamp, input?.stamp),
  company: mergeBox(defaultPlacements.company, input?.company),
  email: mergeBox(defaultPlacements.email, input?.email),
  phone1: mergeBox(defaultPlacements.phone1, input?.phone1),
  phone2: mergeBox(defaultPlacements.phone2, input?.phone2),
});

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private localStorageService: LocalStorageService,
    private notificationsService: NotificationsService,
    private httpService: HttpService,
  ) {}

async signDocument(
  submissionId: number,
  fileName: string,
  adminId: number,
  signatureImagePath?: string,
  stampImagePath?: string,
  originalUrl?: string,
  pages?: number[],
  placements?: Partial<EndorsePlacements>,
) {
  try {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true, uploadRejected: true, userId: true, user: { select: { nssNumber: true, email: true, name: true } }, appointmentLetterUrl: true, postingLetterUrl: true, createdAt: true },
    });
    if (!submission || submission.status !== 'PENDING_ENDORSEMENT') {
      throw new Error('Submission not found or not ready for endorsement');
    }
    if (submission.uploadRejected) {
      throw new Error('This posting and appointment letter was rejected and is waiting for a new PDF');
    }

    console.log('Fetching file for signing:', { fileName });
    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.localStorageService.getFile(fileName);
    } catch (e) {
      if (originalUrl && /^https?:\/\//i.test(originalUrl)) {
        const response = await firstValueFrom(this.httpService.get(originalUrl, { responseType: 'arraybuffer' }));
        const buffer = Buffer.from(response.data);
        await this.localStorageService.uploadFile(buffer, fileName);
        fileBuffer = buffer;
      } else {
        throw e;
      }
    }
    console.log('PDF buffer size:', fileBuffer.length);
    if (!fileBuffer || fileBuffer.length === 0) {
      console.error('File buffer is null or empty for:', { fileName });
      throw new Error('Failed to retrieve file from Supabase');
    }

    const pdfDoc = await PDFDocument.load(fileBuffer);
    const pageCount = pdfDoc.getPageCount();
    const requestedPages = (pages && pages.length ? pages : [4, 5])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page > 0);
    const endorsePages = [...new Set(requestedPages)].sort((a, b) => a - b);
    if (endorsePages.length === 0) {
      throw new Error('Select at least one page to endorse');
    }
    if (endorsePages.some((page) => page > pageCount)) {
      throw new Error(`This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}. Choose pages between 1 and ${pageCount}.`);
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const signaturePages = endorsePages.length === 1 ? endorsePages : endorsePages.slice(0, -1);
    const contactPage = endorsePages.length > 1 ? endorsePages[endorsePages.length - 1] : null;

    const embedImage = async (imageBuffer: Buffer) => {
      const header = imageBuffer.subarray(0, 3).toString('hex');
      if (header.startsWith('ffd8ff')) {
        return pdfDoc.embedJpg(imageBuffer);
      }
      return pdfDoc.embedPng(imageBuffer);
    };

    let signatureImage: Awaited<ReturnType<typeof embedImage>> | null = null;
    let stampImage: Awaited<ReturnType<typeof embedImage>> | null = null;
    if (signatureImagePath && stampImagePath) {
      const signatureImageBuffer = await this.localStorageService.getFile(signatureImagePath);
      const stampImageBuffer = await this.localStorageService.getFile(stampImagePath);
      signatureImage = await embedImage(signatureImageBuffer);
      stampImage = await embedImage(stampImageBuffer);
    }

    const placed = mergePlacements(placements);
    const reportingDate = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    });

    const drawText = (page: ReturnType<typeof pdfDoc.getPage>, text: string, box: EndorseBox) => {
      const { width, height } = page.getSize();
      const size = box.size || 16;
      page.drawText(text, {
        x: box.x * width,
        y: height - box.y * height - size,
        size,
        font,
        color: rgb(0, 0, 0),
      });
    };

    const drawFittedImage = (
      page: ReturnType<typeof pdfDoc.getPage>,
      image: NonNullable<typeof signatureImage>,
      box: EndorseBox,
    ) => {
      const { width, height } = page.getSize();
      const boxWidth = (box.width || 0.18) * width;
      const boxHeight = (box.height || 0.1) * height;
      const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      page.drawImage(image, {
        x: box.x * width,
        y: height - box.y * height - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
    };

    const drawSignature = (pageNumber: number) => {
      const page = pdfDoc.getPage(pageNumber - 1);
      drawText(page, reportingDate, placed.date);
      if (signatureImage && stampImage) {
        drawFittedImage(page, signatureImage, placed.signature);
        drawFittedImage(page, stampImage, placed.stamp);
      } else {
        drawText(page, `Signed by Admin ID: ${adminId}`, placed.signature);
      }
    };

    signaturePages.forEach(drawSignature);

    if (contactPage) {
      const fourthPage = pdfDoc.getPage(contactPage - 1);
      drawText(fourthPage, 'GHANA COCOA BOARD', placed.company);
      drawText(fourthPage, 'cocobod@cocobod.gh', placed.email);
      drawText(fourthPage, '0302 - 661 - 752', placed.phone1);
      drawText(fourthPage, '0302 - 661 - 872', placed.phone2);
    }

    const modifiedPdfBuffer = Buffer.from(await pdfDoc.save());

    const documentHash = createHash('sha256').update(modifiedPdfBuffer).digest('hex');

    const signedFileName = `signed-${fileName}`;
    const signedUrl = await this.localStorageService.uploadFile(
      modifiedPdfBuffer,
      signedFileName,
    );

    const updatedSubmission = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'ENDORSED',
        appointmentLetterUrl: signedUrl,
        postingLetterUrl: signedUrl,
      },
    });

    const document = await this.prisma.document.create({
      data: {
        submissionId,
        adminId,
        originalUrl: await this.localStorageService.getPublicUrl(fileName),
        signedUrl,
        signedAt: new Date(),
        documentHash,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        submissionId,
        action: 'STATUS_CHANGED_TO_ENDORSED',
        userId: adminId,
        details: `Posting and appointment letter endorsed on pages ${endorsePages.join(', ')} for submission ${submissionId}`,
      },
    });

    await this.prisma.notification.create({
      data: {
        title: 'Document Endorsed',
        description: `Your document (Submission ID: ${submissionId}, NSS: ${submission.user.nssNumber || 'Unknown'}) has been endorsed successfully.`,
        timestamp: new Date(),
        iconType: 'USER',
        role: 'PERSONNEL',
        userId: submission.userId,
      },
    });

    await this.prisma.notification.create({
      data: {
        title: 'Appointment Letter Endorsed',
        description: `Appointment letter for ${submission.user.nssNumber || 'Unknown'} has been endorsed successfully.`,
        timestamp: new Date(),
        iconType: 'USER',
        role: 'ADMIN',
      },
    });

    await this.prisma.notification.create({
      data: {
        title: 'Appointment Letter Endorsed',
        description: `Document (Submission ID: ${submissionId}, NSS: ${submission.user.nssNumber || 'Unknown'}) has been endorsed by Admin (ID: ${adminId}).`,
        timestamp: new Date(),
        iconType: 'BELL',
        role: 'STAFF',
      },
    });

    await this.notificationsService.sendDocumentEndorsedEmail(
      submission.user.email,
      submission.user.name,
      submission.user.nssNumber || 'Unknown',
      submissionId
    );
    return { signedUrl, documentId: document.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error signing PDF:', {
      submissionId,
      fileName,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new Error(`Failed to sign PDF: ${errorMessage}`);
  }
}

  async downloadAppointmentLetter(userId: number, type: 'appointment' | 'endorsed' | 'job_confirmation') {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deletedAt: true, nssNumber: true },
  });
  if (!user || user.deletedAt) {
    throw new HttpException('User not found or deleted', HttpStatus.NOT_FOUND);
  }
  if (user.role !== 'PERSONNEL') {
    throw new HttpException('Only PERSONNEL can access this endpoint', HttpStatus.FORBIDDEN);
  }

  const submission = await this.prisma.submission.findFirst({
    where: { userId },
    select: { id: true, status: true, deletedAt: true, appointmentLetterUrl: true, jobConfirmationLetterUrl: true },
  });
  if (!submission || submission.deletedAt) {
    throw new HttpException('Submission not found or deleted', HttpStatus.NOT_FOUND);
  }

  const validStatuses = {
    appointment: ['VALIDATED', 'COMPLETED'],
    endorsed: ['ENDORSED'],
    job_confirmation: ['VALIDATED', 'COMPLETED'],
  };
  if (!validStatuses[type].includes(submission.status)) {
    throw new HttpException(
 `Cannot download ${type} letter with status: ${submission.status}`,     
  HttpStatus.BAD_REQUEST,
    );
  }

  let fileUrl: string | null = null;
  if (type === 'appointment') {
    fileUrl = submission.appointmentLetterUrl;
  } else if (type === 'endorsed') {
    const document = await this.prisma.document.findFirst({
      where: { submissionId: submission.id },
      orderBy: { signedAt: 'desc' },
      select: { signedUrl: true },
    });
    if (!document || !document.signedUrl) {
      throw new HttpException('No signed document found for this submission', HttpStatus.NOT_FOUND);
    }
    fileUrl = document.signedUrl;
  } else if (type === 'job_confirmation') {
    fileUrl = submission.jobConfirmationLetterUrl;
  }

  if (!fileUrl) {
    throw new HttpException(`No ${type} letter found for submission`, HttpStatus.NOT_FOUND);
  }

  const fileName = fileUrl.startsWith('/files/') ? fileUrl.replace('/files/', '') : fileUrl;
  if (!fileName) {
    throw new HttpException('Invalid file URL', HttpStatus.BAD_REQUEST);
  }

  try {
    const buffer = await this.localStorageService.getFile(fileName);
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    await this.prisma.$transaction(async (prisma) => {
      if (type === 'job_confirmation' && submission.status === 'VALIDATED') {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: 'COMPLETED',
            updatedAt: new Date(),
          },
        });

        await prisma.auditLog.create({
          data: {
            submissionId: submission.id,
            action: 'STATUS_CHANGED_TO_COMPLETED',
            userId,
            details: `Submission (ID: ${submission.id}, NSS: ${user.nssNumber || 'Unknown'}) status changed to COMPLETED after downloading job confirmation letter`,
            createdAt: new Date(),
          },
        });

          await prisma.notification.create({
            data: {
              title: 'Onboarding Completed',
              description: 'Your onboarding process is complete.',
              timestamp: new Date(),
              iconType: 'USER',
              role: 'PERSONNEL',
              userId,
            },
          });
      }

      await prisma.auditLog.create({
        data: {
          submissionId: submission.id,
          action: `DOWNLOAD_${type.toUpperCase()}_LETTER`,
          userId,
          details: `Personnel (ID: ${userId}, NSS: ${user.nssNumber || 'Unknown'}) downloaded ${type} letter for submission ID ${submission.id}`,
          createdAt: new Date(),
        },
      });
    });

    return stream;
  } catch (error) {
    console.error('Error downloading letter:', { userId, submissionId: submission.id, fileName, type, error: error.message });
    throw new HttpException(`Failed to retrieve ${type} letter: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

  //upload letter template
  async uploadTemplate(userId: number, template: Express.Multer.File, name: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN')) {
    throw new HttpException('Only ADMIN can upload templates', HttpStatus.FORBIDDEN);
  }

  if (!template || !['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(template.mimetype)) {
    throw new HttpException('Template must be a PDF or Word file', HttpStatus.BAD_REQUEST);
  }

  const fileExtension = template.mimetype === 'application/pdf' ? 'pdf' : 'docx';
  const fileKey = `templates/job-confirmation-${userId}-${Date.now()}.${fileExtension}`;
  const publicUrl = await this.localStorageService.uploadFile(template.buffer, fileKey);

  const templateRecord = await this.prisma.template.create({
    data: {
      name: name || 'Job Confirmation Letter Template',
      type: 'job_confirmation',
      fileUrl: publicUrl,
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await this.prisma.auditLog.create({
    data: {
      submissionId: null,
      action: 'TEMPLATE_UPLOADED',
      userId,
      details: `Admin (ID: ${userId}) uploaded job confirmation letter template: ${templateRecord.name}`,
      createdAt: new Date(),
    },
  });

  await this.prisma.notification.create({
    data: {
      title: 'Letter Template Uploaded',
      description: 'Your letter template has been uploaded successfully.',
      timestamp: new Date(),
      iconType: 'SETTING',
      role: 'ADMIN',
      userId,
    },
  });
  

  return { message: 'Template uploaded successfully', template: templateRecord };
  }

  async getNotifications(userId: number, role: string, skip = 0, take = 10) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new HttpException('User not found or deleted', HttpStatus.NOT_FOUND);
    }

    const audience = role === 'SUPERADMIN' ? 'ADMIN' : role;
    const notifications = await this.prisma.notification.findMany({
    where: {
      OR: [
        { role: audience, userId: audience === 'PERSONNEL' ? userId : undefined },
        { userId, role: audience },
      ],
    },
      orderBy: { timestamp: 'desc' },
      skip,
      take,
      select: {
        id: true,
        title: true,
        description: true,
        timestamp: true,
        iconType: true,
        role: true,
      },
    });

    return notifications;
  }

  async sendAppointmentLetter(userId: number, submissionId: number, file: Express.Multer.File, dto: { status: string }) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true },
  });
  if (!user || !['ADMIN', 'STAFF', 'SUPERADMIN'].includes(user.role)) {
    throw new HttpException('Unauthorized: Only ADMIN or STAFF can send appointment letters', HttpStatus.FORBIDDEN);
  }

  const submission = await this.prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, userId: true, fullName: true, nssNumber: true, status: true, deletedAt: true, jobConfirmationLetterUrl: true },
  });
  if (!submission || submission.deletedAt) {
    throw new HttpException('Submission not found or deleted', HttpStatus.NOT_FOUND);
  }

  if (!['ENDORSED', 'VALIDATED'].includes(submission.status)) {
    throw new HttpException(
      `Cannot send appointment letter for submission with status: ${submission.status}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  if (!file || file.mimetype !== 'application/pdf') {
    throw new HttpException('A valid PDF file is required', HttpStatus.BAD_REQUEST);
  }

  const fileKey = `job-confirmation-letters/${submissionId}-${Date.now()}.pdf`;

  return this.prisma.$transaction(async (prisma) => {
    const publicUrl = await this.localStorageService.uploadFile(file.buffer, fileKey);

    // Update submission with jobConfirmationLetterUrl and status
    const updatedSubmission = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'COMPLETED',
        jobConfirmationLetterUrl: publicUrl,
        updatedAt: new Date(),
      },
      select: { id: true, userId: true, fullName: true, nssNumber: true, status: true, jobConfirmationLetterUrl: true },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        submissionId,
        action: `APPOINTMENT_LETTER_SENT`,
        userId,
        details: `Appointment letter sent for submission (ID: ${submissionId}, NSS: ${submission.nssNumber}) by ${user.name}`,
        createdAt: new Date(),
      },
    });

    // Notify personnel
    await prisma.notification.create({
      data: {
        title: 'Appointment Letter Sent',
        description: 'Your COCOBOD Appointment Letter is available for download in your dashboard.',
        timestamp: new Date(),
        iconType: 'BELL',
        role: 'PERSONNEL',
        userId: updatedSubmission.userId,
      },
    });

    // Notify admin/staff
    await prisma.notification.create({
      data: {
        title: 'Appointment Letter Sent',
        description: `Appointment letter sent for submission (ID: ${submissionId}, NSS: ${submission.nssNumber}) by ${user.name}.`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: user.role === 'ADMIN' || user.role === 'SUPERADMIN' ? 'ADMIN' : 'STAFF',
      },
    });

    return updatedSubmission;
  });
}
}