import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AssignPersonnelToDepartmentDto, ChangePersonnelDepartmentDto, CreateDepartmentDto, CreateUserDto, GetPersonnelDto, UpdateDepartmentDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import moment from 'moment';
import { PrismaService } from 'prisma/prisma.service';
// import { createClient } from '@supabase/supabase-js';
import { HttpService } from '@nestjs/axios';
import { GetSubmissionStatusCountsDto, SubmitOnboardingDto, UpdateSubmissionStatusDto } from './dto/submit-onboarding.dto';
import { firstValueFrom } from 'rxjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UpdateStaffDto } from './dto/update-user.dto';
import { authenticator } from 'otplib';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import * as fs from 'fs';
import * as path from 'path';
import { LocalStorageService } from 'src/documents/local-storage.service';
import { buildJobConfirmationLetterDocDefinition } from 'src/templates/jobConfirmationLetter.template';

// function getBase64Image(filePath: string): string {
//   const absPath = path.resolve(filePath);
//   const file = fs.readFileSync(absPath);
//   return file.toString('base64');
// }
// const pdfParse = require('pdf-parse'); 

function readStoredFile(filePath: string): Buffer {
  const baseStoragePath = process.env.SERVER_ABSOLUTE_PATH || process.cwd();

  let normalizedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  if (normalizedPath.startsWith("files/")) {
    normalizedPath = normalizedPath.slice("files/".length);
  }

  const cwd = process.cwd();
  const possiblePaths = [
    path.resolve(cwd, "storage", normalizedPath),
    path.resolve(cwd, "files", normalizedPath),
    path.resolve(normalizedPath),
    path.resolve("src", normalizedPath),
    path.resolve("dist/src", normalizedPath),
    path.resolve(baseStoragePath, normalizedPath),
    path.resolve(baseStoragePath, "files", normalizedPath),
    path.resolve(baseStoragePath, "assets", normalizedPath),
    path.resolve(baseStoragePath, "storage", normalizedPath),
  ];

  for (const absPath of possiblePaths) {
    console.log(`Trying path: ${absPath}`);
    try {
      if (fs.existsSync(absPath)) {
        const file = fs.readFileSync(absPath);
        console.log(`Found file at: ${absPath}`);
        return file;
      }
    } catch (error) {
      console.error(`Error accessing ${absPath}:`, error);
    }
  }

  throw new Error(`Could not find file: ${filePath}. Tried paths: ${possiblePaths.join(', ')}`);
}

function getBase64Image(filePath: string): string {
  return readStoredFile(filePath).toString('base64');
}

function imageToDataUrl(filePath: string): string {
  const file = readStoredFile(filePath);
  const header = file.subarray(0, 3).toString('hex');
  const mime = header.startsWith('ffd8ff') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${file.toString('base64')}`;
}

(pdfMake as any).vfs = pdfFonts.vfs;

let letterheadBase64: string | null = null;
try {
  letterheadBase64 = getBase64Image('src/assets/letterhead.png');
} catch (error) {
  console.error('Failed to load letterhead:', error.message);
  letterheadBase64 = null; // Fallback to no letterhead
}
// const signatureBase64 = getBase64Image('src/assets/signature.png');

const fonts = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function assertPdfUpload(file: Express.Multer.File | undefined, label: string) {
  if (!file) {
    throw new HttpException(`${label} is required`, HttpStatus.BAD_REQUEST);
  }
  const name = file.originalname?.toLowerCase() || '';
  const header = file.buffer?.subarray(0, 5).toString('utf8');
  if (file.mimetype !== 'application/pdf' || !name.endsWith('.pdf') || header !== '%PDF-') {
    throw new HttpException(`${label} must be a PDF`, HttpStatus.BAD_REQUEST);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new HttpException(`${label} must be 10MB or smaller`, HttpStatus.BAD_REQUEST);
  }
}

@Injectable()
export class UsersService {
  // Removed Supabase client; using local storage instead

  constructor(private prisma: PrismaService,
    private httpService: HttpService,
    private notificationsService: NotificationsService,
    private localStorageService: LocalStorageService,
  ) {}

  private toAbsoluteFileUrl(url?: string | null): string | null {
    if (!url) return url ?? null;
    if (url.startsWith('/files/')) {
      const base = process.env.PUBLIC_BASE_URL || '';
      return `${base}${url}`;
    }
    return url;
  }

  async getUserProfile(userId: number) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      nssNumber: true,
      staffId: true,
      email: true,
      role: true,
      signage: true,
      stamp: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new HttpException('User not found or deleted', HttpStatus.NOT_FOUND);
  }

  return {
    name: user.name || null,
    nssNumber: user.nssNumber || null,
    staffId: user.staffId || null,
    email: user.email || null,
    role: user.role,
    signatureUrl: user.signage ? `/files/${user.signage}` : null,
    stampUrl: user.stamp ? `/files/${user.stamp}` : null,
  };
}

async createUser(dto: CreateUserDto) {
 const hashedPassword = dto.password ? await bcrypt.hash(dto.password, 10) : null;
  const isTfaEnabled = dto.role === 'PERSONNEL' ? true : !!dto.enable2FA; // Enforce for PERSONNEL
  const tfaSecret = isTfaEnabled ? authenticator.generateSecret() : null;
  return this.prisma.user.create({
    data: {
      nssNumber: dto.nssNumber ?? null,
      staffId: dto.staffId ?? null,
      email: dto.email,
      name: dto.name ?? null,
      phoneNumber: dto.phoneNumber ?? null,
      password: hashedPassword,
      role: dto.role,
     tfaSecret,
      isTfaEnabled,
    },
  });
}

   async findByStaffId(staffId: string) {
  return this.prisma.user.findFirst({
    where: {
      staffId: {
        equals: staffId.toLowerCase(),
        mode: 'insensitive',
      },
      deletedAt: null,
    },
  });
}

  async findByNssNumber(nssNumber: string) {
  return this.prisma.user.findFirst({
    where: {
      nssNumber: {
        equals: nssNumber.toLowerCase(),
        mode: 'insensitive',
      },
      deletedAt: null,
    },
  });
}

   async findByNssNumberOrStaffId(identifier: string) {
  return this.prisma.user.findFirst({
    where: {
      OR: [
        {
          nssNumber: {
            equals: identifier.toLowerCase(),
            mode: 'insensitive',
          },
        },
        {
          staffId: {
            equals: identifier.toLowerCase(),
            mode: 'insensitive',
          },
        },
      ],
      // deletedAt: null,
    },
  });
}


  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id, deletedAt: null } });
  }

   async updateUser(id: number, data: Partial<{ email: string; password: string; tfaSecret: string; phoneNumber: string }>) {
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }
    return this.prisma.user.update({ where: { id, deletedAt: null }, data });
  }

  async findByEmail(email: string) {
  return this.prisma.user.findUnique({ where: { email, deletedAt: null } });
  }

 async submitOnboarding(userId: number, dto: SubmitOnboardingDto, files: { postingAppointmentLetter?: Express.Multer.File }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user || user.role !== 'PERSONNEL' || user.nssNumber !== dto.nssNumber) {
      throw new HttpException('Unauthorized or invalid NSS number', HttpStatus.FORBIDDEN);
    }

    const existingSubmission = await this.prisma.submission.findUnique({
      where: { userId_nssNumber: { userId, nssNumber: dto.nssNumber } },
    });
    if (existingSubmission) {
      throw new HttpException('Submission already exists for this user', HttpStatus.BAD_REQUEST);
    }

    const yearOfNss = parseInt(dto.yearOfNss, 10);
    if (isNaN(yearOfNss) || yearOfNss < 1900 || yearOfNss > new Date().getFullYear()) {
      throw new HttpException('Invalid NSS year', HttpStatus.BAD_REQUEST);
    }

    assertPdfUpload(files.postingAppointmentLetter, 'Posting and appointment letter');

    const letterFile = files.postingAppointmentLetter!;
    const fileName = `posting-appointment-letters/${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    const letterUrl = await this.localStorageService.uploadFile(
      letterFile.buffer,
      fileName,
    );
    const postingLetterUrl = letterUrl;
    const appointmentLetterUrl = letterUrl;

  return this.prisma.$transaction(async (prisma) => {
    await prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: {
        name: dto.fullName,
        email: dto.email,
        // phoneNumber: dto.phoneNumber,
        tfaSecret: user.tfaSecret || authenticator.generateSecret(), 
        updatedAt: new Date(),
      },
    });

    const submission = await prisma.submission.create({
      data: {
        userId,
        fullName: dto.fullName,
        nssNumber: dto.nssNumber,
        gender: dto.gender,
        email: dto.email,
        placeOfResidence: dto.placeOfResidence,
        phoneNumber: dto.phoneNumber,
        universityAttended: dto.universityAttended,
        regionOfSchool: dto.regionOfSchool,
        yearOfNss,
        programStudied: dto.programStudied,
        divisionPostedTo: dto.divisionPostedTo,
        postingLetterUrl,
        appointmentLetterUrl,
        status: 'PENDING',
      },
    });

    await prisma.auditLog.create({
      data: {
        submissionId: submission.id,
        action: `STATUS_CHANGED_TO_PENDING`,
        userId,
        details: `${`Submission status changed to PENDING`}`,
        createdAt: new Date(),
      },
    });

    await prisma.notification.createMany({
      data: [
        {
          title: 'Submission Created',
          description: `Your onboarding submission has been submitted and is pending review.`,
          timestamp: new Date(),
          iconType: 'USER',
          userId,
          role: 'PERSONNEL',
        },
        {
          title: 'New Submission Received',
          description: `A new submission (ID: ${submission.id}, NSS: ${dto.nssNumber}) has been submitted by Personnel (ID: ${userId}).`,
          timestamp: new Date(),
          iconType: 'BELL',
          role: 'ADMIN',
        },
        {
          title: 'New Submission Received',
          description: `A new submission (ID: ${submission.id}, NSS: ${dto.nssNumber}) has been submitted by Personnel (ID: ${userId}).`,
          timestamp: new Date(),
          iconType: 'BELL',
          role: 'STAFF',
        },
      ],
    });

    await this.notificationsService.sendSubmissionConfirmationEmail(
      dto.email,
      dto.fullName,
    );

    return submission;
    });
  }

  async submitVerificationForm(userId: number, verificationForm: Express.Multer.File) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deletedAt: true, nssNumber: true },
  });
  if (!user || user.deletedAt) {
    throw new HttpException('User not found or deleted', HttpStatus.NOT_FOUND);
  }
  if (user.role !== 'PERSONNEL') {
    throw new HttpException('Only PERSONNEL can submit verification forms', HttpStatus.FORBIDDEN);
  }

  const submission = await this.prisma.submission.findFirst({
    where: { userId },
    select: { id: true, status: true, deletedAt: true, verificationFormUrl: true },
  });
  if (!submission || submission.deletedAt) {
    throw new HttpException('Submission not found or deleted', HttpStatus.NOT_FOUND);
  }

  assertPdfUpload(verificationForm, 'Verification form');
  if (submission.status !== 'ENDORSED') {
    throw new HttpException('Verification form can be uploaded after the letter is endorsed', HttpStatus.BAD_REQUEST);
  }

  // Upload file to local storage
  const fileName = `verification-forms/${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const verificationFormUrl = await this.localStorageService.uploadFile(
    verificationForm.buffer,
    fileName,
  );

  return this.prisma.$transaction(async (prisma) => {
    const updatedSubmission = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        verificationFormUrl,
        verificationRejected: false,
        verificationRejectionReason: null,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        userId: true,
        fullName: true,
        nssNumber: true,
        status: true,
        verificationFormUrl: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        submissionId: submission.id,
        action: 'VERIFICATION_FORM_SUBMITTED',
        userId,
        details: `Personnel (ID: ${userId}, NSS: ${user.nssNumber || 'Unknown'}) submitted verification form for submission ID ${submission.id}`,
        createdAt: new Date(),
      },
    });

      await this.prisma.notification.createMany({
        data: [
          {
            title: 'Submitted Validated Letter',
            description: 'Your validated letter has been submitted successfully.',
            timestamp: new Date(),
            iconType: 'USER',
            role: 'PERSONNEL',
            userId: userId,
          },
          {
            title: 'New Validated Letter Submitted',
            description: `A validated letter for submission (ID: ${submission.id}, NSS: ${user.nssNumber || 'Unknown'}) has been submitted by Personnel (ID: ${userId}).`,
            timestamp: new Date(),
            iconType: 'BELL',
            role: 'STAFF',
          },
          {
            title: 'New Validated Letter Submitted',
            description: `A validated letter for submission (ID: ${submission.id}, NSS: ${user.nssNumber || 'Unknown'}) has been submitted by Personnel (Name: ${updatedSubmission.fullName}).`,
            timestamp: new Date(),
            iconType: 'BELL',
            role: 'ADMIN',
          },
        ],
      });

    const staffUsers = await prisma.user.findMany({
      where: { role: 'STAFF', deletedAt: null },
      select: { email: true, name: true },
    });

    await Promise.all(
      staffUsers.map((staff) =>
        this.notificationsService.sendVerificationFormEmail(
          staff.email,
          staff.name,
          updatedSubmission.fullName,
          updatedSubmission.nssNumber,
          submission.id
        )
      )
    );

    return updatedSubmission;
  });
}

async getGhanaUniversities() {
  try {
    const universities = [
      "Academic City College",
      "Accra Metropolitan University",
      "Accra Technical University",
      "Accra Institute of Technology",
      "Accra College of Medicine",
      "Advanced Business University College",
      "Anglican University College of Technology",
      "African University of Communication and Business",
      "Akenten Appiah-Menka University of Skills Training and Entrepreneurial Development",
      "Akrofi-Christaller Institute of Theology, Mission and Culture",
      "All Nations University",
      "Ashesi University",
      "BlueCrest University College",
      "Bolgatanga Technical University",
      "C.K. Tedam University of Technology and Applied Sciences",
      "Cape Coast Technical University",
      "Catholic University",
      "Central University",
      "Christian Service University",
      "Christ Apostolic University College",
      "Consular and Diplomatic Service University",
      "Catholic Institute of Business and Technology",
      "China Europe International Business School (CEIBS) Ghana Campus",
      "Data Link University College",
      "Deltas University College",
      "Dominion University College",
      "Dr. Hilla Limann Technical University",
      "Ensign Global University",
      "Evangelical Presbyterian University College",
      "Entrance University of Health Sciences",
      "Family Health University",
      "Garden City University",
      "Ghana Armed Forces Command and Staff College",
      "Ghana Communication Technology University",
      "Ghana Institute of Journalism",
      "Ghana Institute of Languages",
      "Ghana Institute of Management and Public Administration (GIMPA)",
      "Ghana Technology University College",
      "Ghana Telecom University College",
      "Ghana University of Business and Integrated Development Studies",
      "Ghana Baptist University College",
      "Ghana Christian University College",
      "Heritage Christian University",
      "Ho Technical University",
      "Islamic University College",
      "Jayee University College",
      "KAAF University College",
      "KNUTSFORD University",
      "Kofi Annan International Peacekeeping Training Centre",
      "Koforidua Technical University",
      "Kumasi Technical University",
      "Kessben University College",
      "Kwame Nkrumah University of Science and Technology",
      "Lancaster University College",
      "Maranatha University College",
      "Methodist University",
      "Mountcrest University College",
      "Meridian (Insaaniyya) University College",
      "Marshalls University College",
      "Nobel International Business University",
      "Open University of West Africa",
      "Pentecost University",
      "Perez University College",
      "Presbyterian University",
      "Pan African Christian University College",
      "Radford University College",
      "Regent University College of Science and Technology",
      "Regional Maritime University",
      "S.D. Dombo University of Business and Integrated Development Studies",
      "Simon Diedong Dombo University of Business and Integrated Development Studies",
      "Sunyani Technical University",
      "Spiritan University College",
      "Sikkim Manipal University (Ghana Campus)",
      "Takoradi Technical Institute",
      "Takoradi Technical University",
      "Tamale Technical University",
      "Thrivus University for Biomedical Science and Technology",
      "Trinity Theological Seminary",
      "University for Development Studies",
      "University of Applied Management",
      "University of Cape Coast",
      "University of Education, Winneba",
      "University of Energy and Natural Resources",
      "University of Environment and Sustainable Development",
      "University of Ghana",
      "University of Gold Coast",
      "University of Health and Allied Sciences",
      "University of Media, Arts and Communication",
      "University of Mines and Technology",
      "University of Professional Studies",
      "University College of Agriculture and Environmental Studies",
      "University College of Design and Technology",
      "University College of Management Studies",
      "Valley View University",
      "West End University College",
      "Wisconsin International University College",
      "Webster University, Ghana Campus",
      "Zenith University College",
      "Other"
    ];

    return universities.map(name => ({ name }));
  } catch (error) {
    console.error('Failed to process universities:', error.message);
    return [];
  }
}

   async getOnboardingStatus(userId: number) {
    const submission = await this.prisma.submission.findFirst({
      where: { userId, deletedAt: null },
    });
    return { hasSubmitted: !!submission };
  }

   async getAllSubmissions(year?: number) {
    const now = new Date();
    const currentYear = year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
    const submissions = await this.prisma.submission.findMany({
        where: {
      yearOfNss: currentYear,
      deletedAt: null,
    },
      select: {
        id: true,
        fullName: true,
        nssNumber: true,
        gender: true,
        email: true,
        placeOfResidence: true,
        universityAttended: true,
        regionOfSchool: true,
        yearOfNss: true,
        programStudied: true,
        divisionPostedTo: true,
        postingLetterUrl: true,
        appointmentLetterUrl: true,
        verificationFormUrl: true,
        jobConfirmationLetterUrl: true,
        uploadRejected: true,
        uploadRejectionReason: true,
        verificationRejected: true,
        verificationRejectionReason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
         user: {
        select: {
          phoneNumber: true,
          department: { select: { name: true } },
        },
      },
    },
      orderBy: { createdAt: 'desc' },
    });
    return submissions.map((s) => ({
      ...s,
      phoneNumber: s.user?.phoneNumber || 'N/A',
      department: s.user?.department?.name || 'N/A',
      postingLetterUrl: this.toAbsoluteFileUrl(s.postingLetterUrl),
      appointmentLetterUrl: this.toAbsoluteFileUrl(s.appointmentLetterUrl),
      verificationFormUrl: this.toAbsoluteFileUrl(s.verificationFormUrl),
      jobConfirmationLetterUrl: this.toAbsoluteFileUrl(s.jobConfirmationLetterUrl),
      user: undefined, 
    }));
  }

  async getSubmissions(year?: number) {
    const now = new Date();
    const currentYear = year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
    const submissions = await this.prisma.submission.findMany({
      where: { deletedAt: null, yearOfNss: currentYear },
      select: {
        id: true,
        fullName: true,
        nssNumber: true,
        gender: true,
        email: true,
        placeOfResidence: true,
        universityAttended: true,
        regionOfSchool: true,
        yearOfNss: true,
        programStudied: true,
        divisionPostedTo: true,
        postingLetterUrl: true,
        appointmentLetterUrl: true,
        verificationFormUrl: true,
        jobConfirmationLetterUrl: true,
        uploadRejected: true,
        uploadRejectionReason: true,
        verificationRejected: true,
        verificationRejectionReason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            department: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return submissions.map((s) => ({
      ...s,
      postingLetterUrl: this.toAbsoluteFileUrl(s.postingLetterUrl),
      appointmentLetterUrl: this.toAbsoluteFileUrl(s.appointmentLetterUrl),
      verificationFormUrl: this.toAbsoluteFileUrl(s.verificationFormUrl),
      jobConfirmationLetterUrl: this.toAbsoluteFileUrl(s.jobConfirmationLetterUrl),
      phoneNumber: s.user?.phoneNumber || 'N/A',
    }));
  }

async updateSubmissionStatus(
 userId: number,
 submissionId: number,
 dto: UpdateSubmissionStatusDto,
) {
 const user = await this.prisma.user.findUnique({ 
 where: { id: userId, deletedAt: null },
 select: { role: true, name: true }
 });
 if (!user || !['ADMIN', 'STAFF'].includes(user.role)) {
 throw new HttpException('Unauthorized: Only ADMIN or STAFF can update submission status', HttpStatus.FORBIDDEN);
 }

 const submission = await this.prisma.submission.findUnique({
 where: { id: submissionId },
 select: { 
 id: true, 
 userId: true, 
 fullName: true, 
 nssNumber: true, 
 email: true, 
 status: true, 
 deletedAt: true, 
 jobConfirmationLetterUrl: true, 
//  phoneNumber: true, 
 divisionPostedTo: true, 
 user: { select: { department: true, phoneNumber: true } } 
 },
 });
 if (!submission || submission.deletedAt) {
 throw new HttpException('Submission not found', HttpStatus.NOT_FOUND);
 }

 const validStatusTransitions = {
 PENDING: ['PENDING_ENDORSEMENT', 'REJECTED'],
 PENDING_ENDORSEMENT: ['ENDORSED', 'REJECTED'],
 ENDORSED: ['VALIDATED', 'REJECTED'],
 VALIDATED: ['COMPLETED', 'REJECTED'],
 REJECTED: ['PENDING'], // Allow resubmission
 COMPLETED: ['VALIDATED'],
 };

 if (
 validStatusTransitions[submission.status] &&
 !validStatusTransitions[submission.status].includes(dto.status)
 ) {
 throw new HttpException(
 `Invalid status transition from ${submission.status} to ${dto.status}`,
 HttpStatus.BAD_REQUEST,
 );
 }

 const submissionFlags = await this.prisma.submission.findUnique({
  where: { id: submissionId },
  select: { uploadRejected: true, verificationRejected: true, verificationFormUrl: true },
 });
 if (dto.status === 'PENDING_ENDORSEMENT' && submissionFlags?.uploadRejected) {
  throw new HttpException(
    'This posting and appointment letter was rejected. Wait for the personnel to upload a new PDF.',
    HttpStatus.BAD_REQUEST,
  );
 }
 if (dto.status === 'VALIDATED' && submissionFlags?.verificationRejected && !submissionFlags.verificationFormUrl) {
  throw new HttpException(
    'The verification form was rejected. Wait for the personnel to upload a new PDF.',
    HttpStatus.BAD_REQUEST,
  );
 }

 return this.prisma.$transaction(async (prisma) => {
 let jobConfirmationLetterUrl = submission.jobConfirmationLetterUrl;

 if (dto.status === 'VALIDATED') {
 const currentYear = new Date().getFullYear();
 const yearRange = currentYear === 2025 ? '2025/2026' : `${currentYear}/${currentYear + 1}`;
 const nextYear = currentYear + 1;
 const today = moment().format('DD/MM/YYYY');
 const departmentName = submission.user.department.name;

  const currentUser = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { role: true, signaturePath: true, signage: true },
  });

  if (!currentUser) {
    throw new HttpException(`User ${userId} not found`, HttpStatus.NOT_FOUND);
  }

  if (!['ADMIN', 'STAFF'].includes(currentUser.role)) {
    throw new HttpException(
      `User ${userId} is not authorized to validate submissions`,
      HttpStatus.FORBIDDEN,
    );
  }

  let signaturePath: string | null = currentUser.signaturePath || currentUser.signage;

  if (!signaturePath) {
    const adminUser = await prisma.user.findFirst({
      where: {
        role: 'ADMIN',
        deletedAt: null,
        OR: [{ signaturePath: { not: null } }, { signage: { not: null } }],
      },
      select: { signaturePath: true, signage: true },
    });
    signaturePath = adminUser?.signaturePath || adminUser?.signage || null;
  }

  if (!signaturePath) {
    throw new HttpException(
      currentUser.role === 'ADMIN'
        ? 'Upload a signature on your profile before you validate.'
        : 'No signature is available. Upload one on your profile, or ask an admin to upload a signature on theirs.',
      HttpStatus.BAD_REQUEST,
    );
  }

  console.log('Signature path to use:', signaturePath);

 let signatureBase64;
 try {
 signatureBase64 = imageToDataUrl(signaturePath);
 } catch (error) {
 throw new HttpException(
 `Failed to load signature for user: ${error.message}`,
 HttpStatus.INTERNAL_SERVER_ERROR,
 );
 }

 const nssNumber = submission.nssNumber?.toString() || '';
const yearPart = nssNumber.slice(-4);
const nssPart = nssNumber.slice(0, -4);
const referenceNumber = `BOD/${yearPart}/${nssPart}`;


 // Define PDF document using external template builder
 const docDefinition = buildJobConfirmationLetterDocDefinition({
   submission: submission as any,
   currentYear,
   nextYear,
   yearRange,
   today,
   departmentName,
   referenceNumber,
   letterheadBase64,
   signatureBase64,
 });

 // Generate PDF and upload to local storage
 const pdfDoc = (pdfMake as any).createPdf(docDefinition, null, fonts);
 const pdfBuffer: Buffer = await new Promise((resolve) => {
 pdfDoc.getBuffer((buffer: Buffer) => resolve(buffer));
 });

 const fileName = `job-confirmation-letters/${submissionId}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
 jobConfirmationLetterUrl = await this.localStorageService.uploadFile(
 pdfBuffer,
 fileName,
 );
 }

 if (dto.status === 'REJECTED') {
 // Send rejection email
 await this.notificationsService.sendRejectionEmail(
 submission.email,
 submission.fullName,
 submissionId,
 dto.comment || 'No specific reason provided'
 );

 // Create audit log for rejection
 await prisma.auditLog.create({
 data: {
 submissionId,
 action: 'STATUS_CHANGED_TO_REJECTED',
 userId,
 details: `${dto.comment || `Submission status changed to REJECTED`}`,
 createdAt: new Date(),
 },
 });

 // Create notification for the user being deleted
 await prisma.notification.create({
 data: {
 title: 'Submission Rejected',
 description: `Your submission (ID: ${submissionId}) has been rejected.`,
 timestamp: new Date(),
 iconType: 'USER',
 role: 'PERSONNEL',
 userId: submission.userId,
 },
 });

 // Create notification for the admin/staff
 await prisma.notification.create({
 data: {
 title: 'Submission Rejected',
 description: `Submission (ID: ${submissionId}, NSS: ${submission.nssNumber}) rejected by ${user.name}.`,
 timestamp: new Date(),
 iconType: 'SETTING',
 role: user.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
 },
 });

 await prisma.user.delete({
 where: { id: submission.userId },
 });

 return { 
 message: `Submission (ID: ${submissionId}) rejected.` 
 };
 }

 const updatedSubmission = await prisma.submission.update({
 where: { id: submissionId, deletedAt: null },
 data: {
 status: dto.status,
 jobConfirmationLetterUrl,
 updatedAt: new Date(),
 },
 select: { id: true, userId: true, fullName: true, nssNumber: true, email: true, status: true, jobConfirmationLetterUrl: true },
 });

 await prisma.auditLog.create({
 data: {
 submissionId,
 action: `STATUS_CHANGED_TO_${dto.status}`,
 userId,
 details: `${dto.comment || `Submission status changed to ${dto.status}`}${
 dto.status === 'VALIDATED' && jobConfirmationLetterUrl ? ' and job confirmation letter generated' : ''
 }`,
 createdAt: new Date(),
 },
 });

 if (['ENDORSED', 'VALIDATED', 'COMPLETED'].includes(dto.status)) {
 await prisma.notification.create({
 data: {
 title: `Submission ${dto.status}`,
 description: `Your submission has been ${dto.status.toLowerCase()}.`,
 timestamp: new Date(),
 iconType: 'USER',
 role: 'PERSONNEL',
 userId: updatedSubmission.userId,
 },
 });
 }

 await prisma.notification.create({
 data: {
 title: `Submission Status Updated`,
 description: `Submission (ID: ${submissionId}, NSS: ${submission.nssNumber}) status changed to ${dto.status} by ${user.name}.`,
 timestamp: new Date(),
 iconType: 'SETTING',
 role: user.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
 },
 });

 return updatedSubmission;
 }, { timeout: 20000 });
}

// New endpoint to handle signature upload for appointment letter
async uploadAppointmentSignature(userId: number, file: Express.Multer.File) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, name: true },
  });
  if (!user || !['ADMIN', 'STAFF'].includes(user.role)) {
    throw new HttpException('Unauthorized: Only ADMIN or STAFF can upload signatures', HttpStatus.FORBIDDEN);
  }

  // Validate file type
  const allowedTypes = ['image/png', 'image/jpeg'];
  if (!file || !allowedTypes.includes(file.mimetype)) {
    throw new HttpException('Only PNG or JPEG files are allowed', HttpStatus.BAD_REQUEST);
  }

  // Save signature to local storage
  const extension = file.mimetype === 'image/jpeg' ? 'jpg' : 'png';
  const fileName = `signatures/user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  await this.localStorageService.uploadFile(
    file.buffer,
    fileName,
  );
  const signaturePath = fileName;

  return this.prisma.$transaction(async (prisma) => {
    // Update user with signature path
    const updatedUser = await prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: { signaturePath, updatedAt: new Date() },
      select: { id: true, name: true, role: true },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        action: 'SIGNATURE_UPLOADED',
        userId,
        details: `User (ID: ${userId}, Name: ${user.name}, Role: ${user.role}) uploaded a new signature.`,
        createdAt: new Date(),
      },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        title: 'Signature Uploaded',
        description: 'Your signature has been uploaded successfully.',
        timestamp: new Date(),
        iconType: 'USER',
        role: user.role,
        userId,
      },
    });

    // Notify admin/staff
    await prisma.notification.create({
      data: {
        title: 'New Signature Uploaded',
        description: `A new signature has been uploaded by ${user.name} (ID: ${userId}, Role: ${user.role}).`,
        timestamp: new Date(),
        iconType: 'BELL',
        role: 'ADMIN',
      },
    });

    return { message: 'Signature uploaded successfully', signaturePath };
  });
}

  async getSubmissionStatusCounts(userId: number, dto: GetSubmissionStatusCountsDto) {
  const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
  if (!user || !['ADMIN', 'STAFF'].includes(user.role)) {
    throw new HttpException(
      'Unauthorized: Only ADMIN or STAFF can access submission status counts',
      HttpStatus.FORBIDDEN,
    );
  }

  if (!dto.statuses || dto.statuses.length === 0) {
    throw new HttpException(
      'At least one status must be provided',
      HttpStatus.BAD_REQUEST,
    );
  }
  const now = new Date();
  const currentYear = dto.year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
  
  const statusGroups = await this.prisma.submission.groupBy({
    by: ['status'],
    where: {
      status: { in: dto.statuses as any },
      deletedAt: null,
      user: { role: 'PERSONNEL' },
      yearOfNss: currentYear,
    },
    _count: { id: true },
  });

  const counts = dto.statuses.map((status) => ({
    status,
    count: statusGroups.find((g) => g.status === status)?._count?.id || 0,
  }));

  const totalCount = await this.prisma.submission.count({
    where: {
      deletedAt: null,
      user: {
        role: 'PERSONNEL',
      },
      yearOfNss: currentYear,
    },
  });

  const result = counts.reduce(
    (acc, { status, count }) => ({ ...acc, [status]: count }),
    { total: totalCount }
  );

  return result;
 }

 async getStaff(requesterId: number) {
  const requester = await this.prisma.user.findUnique({ where: { id: requesterId, deletedAt: null } });
  if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException(
      'Unauthorized: Only admins or staff can access staff, admin, and supervisor data',
      HttpStatus.FORBIDDEN,
    );
  }

  return this.prisma.user.findMany({
    where: {
      role: {
        in: ['STAFF', 'ADMIN', 'SUPERVISOR'],
      },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      staffId: true,
      email: true,
      phoneNumber: true,
      role: true,
      departmentsSupervised: {
      select: {
        id: true,
        name: true,
        },
      },
      department: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      isTfaEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
 }

 async createDepartment(requesterId: number, dto: CreateDepartmentDto) {
  const requester = await this.prisma.user.findUnique({ where: { id: requesterId, deletedAt: null } });
  if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException('Unauthorized: Only admins and staff can create departments', HttpStatus.FORBIDDEN);
  }

  const supervisor = await this.prisma.user.findUnique({ where: { id: dto.supervisorId, deletedAt: null } });
  if (!supervisor || supervisor.role !== 'SUPERVISOR' || supervisor.deletedAt) {
    throw new HttpException('Invalid or deleted supervisor', HttpStatus.BAD_REQUEST);
  }

  const existingDepartment = await this.prisma.department.findUnique({ where: { name: dto.name, deletedAt: null } });
  if (existingDepartment) {
    throw new HttpException('Department name already exists', HttpStatus.BAD_REQUEST);
  }

  if (dto.unitIds && dto.unitIds.length > 0) {
    const units = await this.prisma.unit.findMany({
      where: { id: { in: dto.unitIds }, deletedAt: null },
    });
    if (units.length !== dto.unitIds.length) {
      throw new HttpException('One or more units are invalid or deleted', HttpStatus.BAD_REQUEST);
    }
  }

  return this.prisma.$transaction(async (prisma) => {
    const department = await prisma.department.create({
      data: {
        name: dto.name,
        supervisorId: dto.supervisorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        supervisorId: true,
        supervisor: { select: { id: true, name: true, email: true } },
        units: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (dto.unitIds && dto.unitIds.length > 0) {
      await prisma.unit.updateMany({
        where: { id: { in: dto.unitIds } },
        data: { departmentId: department.id, updatedAt: new Date() },
      });
      department.units = await prisma.unit.findMany({
        where: { id: { in: dto.unitIds } },
        select: { id: true, name: true },
      });
    }

     await this.notificationsService.sendSupervisorAssignmentEmail(
      supervisor.email,
      supervisor.name,
      department.name
    );

    return department;
  });
 }

 async getDepartments(requesterId: number) {
  const requester = await this.prisma.user.findUnique({ where: { id: requesterId, deletedAt: null } });
  if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException('Unauthorized: Only admins or staff can access departments', HttpStatus.FORBIDDEN);
  }

  return this.prisma.department.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      supervisorId: true,
      supervisor: { select: { id: true, name: true, email: true } },
      units: { select: { id: true, name: true }, where: { deletedAt: null } },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    });
  }

  async getPersonnel(requesterId: number, dto: GetPersonnelDto) {
  const requester = await this.prisma.user.findUnique({ where: { id: requesterId, deletedAt: null } });
  if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException(
      'Unauthorized: Only admins or staff can access personnel data',
      HttpStatus.FORBIDDEN,
    );
  }
  const now = new Date();
  const currentYear = dto.year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);

  const users = await this.prisma.user.findMany({
    where: {
      role: 'PERSONNEL',
      deletedAt: null,
      submissions: {
        some: {
          yearOfNss: currentYear,
          deletedAt: null,
          ...(dto.statuses && dto.statuses.length > 0
            ? { status: { in: dto.statuses } }
            : {}),
        },
      },
    },
     select: {
      id: true,
      name: true,
      nssNumber: true,
      email: true,
      role: true,
      department: {
        select: {
          id: true,
          name: true,
          supervisor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      unit: { select: { id: true, name: true } },
      submissions: {
        select: {
          id: true,
          fullName: true,
          nssNumber: true,
          email: true,
          gender: true,
          placeOfResidence: true,
          phoneNumber: true,
          universityAttended: true,
          regionOfSchool: true,
          yearOfNss: true,
          programStudied: true,
          divisionPostedTo: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        where: {
          yearOfNss: currentYear,
          deletedAt: null,
          ...(dto.statuses && dto.statuses.length > 0
            ? { status: { in: dto.statuses } }
            : {}),
        },
      },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
   });
   return users.map((u) => ({
     ...u,
     submissions: u.submissions.map((s) => ({
       ...s,
       postingLetterUrl: this.toAbsoluteFileUrl((s as any).postingLetterUrl),
       appointmentLetterUrl: this.toAbsoluteFileUrl((s as any).appointmentLetterUrl),
       verificationFormUrl: this.toAbsoluteFileUrl((s as any).verificationFormUrl),
       jobConfirmationLetterUrl: this.toAbsoluteFileUrl((s as any).jobConfirmationLetterUrl),
     })),
   }));
  }

 async assignPersonnelToDepartment(requesterId: number, dto: AssignPersonnelToDepartmentDto) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException(
      'Unauthorized: Only ADMIN or STAFF can assign personnel to departments',
      HttpStatus.FORBIDDEN,
    );
  }

  const department = await this.prisma.department.findUnique({
    where: { id: dto.departmentId },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!department || department.deletedAt) {
    throw new HttpException('Department not found or deleted', HttpStatus.NOT_FOUND);
  }

  const submissions = await this.prisma.submission.findMany({
    where: {
      id: { in: dto.submissionIds },
      deletedAt: null,
      user: { role: 'PERSONNEL', deletedAt: null },
    },
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, nssNumber: true, email: true } },
      fullName: true,
      nssNumber: true,
      status: true,
    },
  });

  if (submissions.length !== dto.submissionIds.length) {
    const invalidIds = dto.submissionIds.filter((id) => !submissions.some((sub) => sub.id === id));
    throw new HttpException(
      `Invalid or non-PERSONNEL submission IDs: ${invalidIds.join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const userIds = submissions.map((sub) => sub.userId);

  return this.prisma.$transaction(async (prisma) => {
    await prisma.user.updateMany({
      where: {
        id: { in: userIds },
        role: 'PERSONNEL',
        deletedAt: null,
      },
      data: {
        departmentId: dto.departmentId,
        updatedAt: new Date(),
      },
    });

    const auditLogs = submissions.map((sub) => ({
      submissionId: sub.id,
      action: 'PERSONNEL_ASSIGNED_TO_DEPARTMENT',
      userId: requesterId,
      details: `Personnel ${sub.user.name} (ID: ${sub.userId}, NSS: ${sub.nssNumber}) with submission ID ${sub.id} assigned to department: ${department.name} (ID: ${dto.departmentId}) by ${requester.role} (ID: ${requesterId})`,
      createdAt: new Date(),
    }));
    
    await prisma.auditLog.createMany({
      data: auditLogs,
    });

    const updatedUsers = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        nssNumber: true,
        email: true,
        role: true,
        department: { select: { id: true, name: true } },
        updatedAt: true,
        submissions: {
          select: { id: true, fullName: true, nssNumber: true, status: true },
          where: { id: { in: dto.submissionIds }, deletedAt: null },
        },
      },
    });

    return {
      message: `Successfully assigned ${submissions.length} personnel to department: ${department.name}`,
      users: updatedUsers,
    };
  });
  }
  
  async getReportCounts(requesterId?: number, year?: number) {
  if (requesterId) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
      throw new HttpException(
        'Unauthorized: Only ADMIN or STAFF can access report counts',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  const now = new Date();
  const currentYear = year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
  const nssNumberPattern = `%${currentYear}`;

  const [
    totalPersonnel,
    totalNonPersonnel,
    totalDepartments,
    personnelByDepartment,
    acceptedCount,
    auditLogCounts,
    onboardedStudentCount,
    pendingCount,
  ] = await Promise.all([
    // 1. Total personnel (not deleted)
    this.prisma.user.count({
     where: {
    role: 'PERSONNEL',
    deletedAt: null,
    submissions: {
      some: {
        status: { in: [ 'VALIDATED', 'COMPLETED'] },
        yearOfNss: currentYear,
      },
    },
  },
    }),

    // 2. Total non-personnel
    this.prisma.user.count({
      where: { role: { not: 'PERSONNEL' }, deletedAt: null },
    }),

    // 3. Total departments
    this.prisma.department.count({
      where: { deletedAt: null },
    }),

    // 4. Personnel by department
    this.prisma.user.groupBy({
      by: ['departmentId'],
      where: { role: 'PERSONNEL', deletedAt: null, departmentId: { not: null }, submissions: { some: { yearOfNss: currentYear, deletedAt: null } } },
      _count: { id: true },
    }).then(async (groups) => {
      const departmentIds = groups.map((g) => g.departmentId).filter((id) => id !== null);
      const departments = await this.prisma.department.findMany({
        where: { id: { in: departmentIds }, deletedAt: null },
        select: { id: true, name: true },
      });
      return groups.map((group) => ({
        departmentId: group.departmentId,
        departmentName: departments.find((d) => d.id === group.departmentId)?.name || 'Unknown',
        personnelCount: group._count.id,
      }));
    }),

    // 5. Combined count (ENDORSED, VALIDATED, COMPLETED)
    this.prisma.submission.count({
      where: {
        status: { in: ['ENDORSED', 'VALIDATED', 'COMPLETED'] },
        deletedAt: null,
        user: { role: 'PERSONNEL', deletedAt: null },
        yearOfNss: currentYear,
      },
    }),

    // 6. Submission status counts using groupBy instead of AuditLog
    this.prisma.submission.groupBy({
      by: ['status'],
      where: {
        status: { in: ['PENDING_ENDORSEMENT', 'REJECTED'] },
        deletedAt: null,
        user: { role: 'PERSONNEL', deletedAt: null },
        yearOfNss: currentYear,
      },
      _count: { id: true },
    }).then((groups) =>
      groups.map((g) => ({ status: g.status, count: g._count.id }))
    ),

    // 7. Onboarded student count
    this.prisma.user.count({
      where: {
        role: 'PERSONNEL',
        deletedAt: null,
        nssNumber: { endsWith: nssNumberPattern },
        OnboardingToken: {
          some: {
            // used: true,
            deletedAt: null,
          },
        },
      },
    }),

    // 8. Pending count
      this.prisma.submission.count({
      where: {
        status: { in: ['PENDING'] },
        deletedAt: null,
        user: { role: 'PERSONNEL', deletedAt: null },
        yearOfNss: currentYear,
      },
    }),
  ]);

  const statusCounts = {
    pending: auditLogCounts.find((c) => c.status === 'PENDING')?.count || 0,
    pendingEndorsement: auditLogCounts.find((c) => c.status === 'PENDING_ENDORSEMENT')?.count || 0,
    endorsed: 0,
    validated: 0,
    completed: 0,
    rejected: auditLogCounts.find((c) => c.status === 'REJECTED')?.count || 0,
  };

  return {
    totalPersonnel,
    totalNonPersonnel,
    totalDepartments,
    personnelByDepartment,
    statusCounts,
    acceptedCount,
    onboardedStudentCount,
    pendingCount,
   };
  }

  async getPersonnelStatus(userId: number, year?: number) {
  const now = new Date();
  const currentYear = year || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    throw new HttpException('User not found or deleted', HttpStatus.NOT_FOUND);
  }
  if (!user || !['ADMIN', 'STAFF', 'PERSONNEL'].includes(user.role)) {
    throw new HttpException('Only PERSONNEL can access this endpoint', HttpStatus.FORBIDDEN);
  }

  const submission = await this.prisma.submission.findFirst({
    where: { userId, yearOfNss: currentYear, deletedAt: null },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      uploadRejected: true,
      uploadRejectionReason: true,
      verificationRejected: true,
      verificationRejectionReason: true,
    },
  });

  const statusCompletionMap: Record<string, number> = {
    PENDING: 20,
    PENDING_ENDORSEMENT: 40,
    ENDORSED: 60,
    VALIDATED: 80,
    COMPLETED: 100,
    REJECTED: 0,
  };
  const completionPercentage = submission && !submission.deletedAt
    ? statusCompletionMap[submission.status] || 0
    : 0;

  // Calculate service days (from October 1st to today)
  let serviceDays = 0;
  if (submission && !submission.deletedAt && submission.status === 'COMPLETED') {
    const today = new Date();
    const currentYear = today.getFullYear();
    // Determine the start of the current service year (October 1st)
    const serviceStartYear = today.getMonth() >= 9 ? currentYear + 1 : currentYear; // 9 = October
    const serviceStart = new Date(serviceStartYear, 9, 1); // October 1st

    // Calculate days difference
    const timeDiff = today.getTime() - serviceStart.getTime();
    serviceDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    serviceDays = Math.max(0, serviceDays); // Ensure non-negative
  }

  return {
    submissionStatus: submission && !submission.deletedAt ? submission.status : null,
    completionPercentage,
    serviceDays,
    uploadRejected: submission && !submission.deletedAt ? submission.uploadRejected : false,
    uploadRejectionReason: submission && !submission.deletedAt ? submission.uploadRejectionReason : null,
    verificationRejected: submission && !submission.deletedAt ? submission.verificationRejected : false,
    verificationRejectionReason: submission && !submission.deletedAt ? submission.verificationRejectionReason : null,
   };
  }

  async rejectUpload(requesterId: number, submissionId: number, target: 'letter' | 'verification', reason: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId, deletedAt: null },
      select: { id: true, role: true, name: true },
    });
    if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
      throw new HttpException('Only staff or admins can reject an upload', HttpStatus.FORBIDDEN);
    }
    if (target === 'letter' && requester.role !== 'ADMIN' && requester.role !== 'STAFF') {
      throw new HttpException('Unauthorized', HttpStatus.FORBIDDEN);
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 5) {
      throw new HttpException('A reason of at least 5 characters is required', HttpStatus.BAD_REQUEST);
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        userId: true,
        fullName: true,
        nssNumber: true,
        email: true,
        status: true,
        deletedAt: true,
        verificationFormUrl: true,
      },
    });
    if (!submission || submission.deletedAt) {
      throw new HttpException('Submission not found', HttpStatus.NOT_FOUND);
    }

    if (target === 'letter') {
      if (!['PENDING', 'PENDING_ENDORSEMENT'].includes(submission.status)) {
        throw new HttpException('The posting and appointment letter can only be rejected before it is endorsed', HttpStatus.BAD_REQUEST);
      }
    } else if (submission.status !== 'ENDORSED' || !submission.verificationFormUrl) {
      throw new HttpException('There is no verification form to reject', HttpStatus.BAD_REQUEST);
    }

    const documentName = target === 'letter' ? 'Posting and Appointment Letter' : 'Verification form';

    return this.prisma.$transaction(async (prisma) => {
      const updated = await prisma.submission.update({
        where: { id: submissionId },
        data: target === 'letter'
          ? {
              status: 'PENDING',
              uploadRejected: true,
              uploadRejectionReason: trimmedReason,
              updatedAt: new Date(),
            }
          : {
              verificationFormUrl: null,
              verificationRejected: true,
              verificationRejectionReason: trimmedReason,
              updatedAt: new Date(),
            },
      });

      await prisma.auditLog.create({
        data: {
          submissionId,
          action: target === 'letter' ? 'LETTER_UPLOAD_REJECTED' : 'VERIFICATION_UPLOAD_REJECTED',
          userId: requesterId,
          details: `${documentName} rejected by ${requester.name}: ${trimmedReason}`,
          createdAt: new Date(),
        },
      });

      await prisma.notification.create({
        data: {
          title: `${documentName} rejected`,
          description: `Your ${documentName} was not accepted. ${trimmedReason}`,
          timestamp: new Date(),
          iconType: 'USER',
          role: 'PERSONNEL',
          userId: submission.userId,
        },
      });

      await this.notificationsService.sendUploadRejectedEmail(
        submission.email,
        submission.fullName,
        documentName,
        trimmedReason,
      );

      return {
        message: `${documentName} rejected and the personnel has been emailed`,
        submission: updated,
      };
    });
  }

  async replacePostingAppointmentLetter(userId: number, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, nssNumber: true },
    });
    if (!user || user.role !== 'PERSONNEL') {
      throw new HttpException('Only personnel can replace this letter', HttpStatus.FORBIDDEN);
    }

    const submission = await this.prisma.submission.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, status: true, uploadRejected: true, email: true, fullName: true, nssNumber: true },
    });
    if (!submission) {
      throw new HttpException('Submission not found', HttpStatus.NOT_FOUND);
    }
    if (!submission.uploadRejected || submission.status !== 'PENDING') {
      throw new HttpException('This letter can only be replaced after it is rejected', HttpStatus.BAD_REQUEST);
    }

    assertPdfUpload(file, 'Posting and appointment letter');
    const fileName = `posting-appointment-letters/${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    const letterUrl = await this.localStorageService.uploadFile(file.buffer, fileName);

    return this.prisma.$transaction(async (prisma) => {
      const updated = await prisma.submission.update({
        where: { id: submission.id },
        data: {
          postingLetterUrl: letterUrl,
          appointmentLetterUrl: letterUrl,
          uploadRejected: false,
          uploadRejectionReason: null,
          status: 'PENDING',
          updatedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          submissionId: submission.id,
          action: 'LETTER_UPLOAD_REPLACED',
          userId,
          details: `Personnel (NSS: ${user.nssNumber || submission.nssNumber}) uploaded a replacement posting and appointment letter`,
          createdAt: new Date(),
        },
      });

      await prisma.notification.createMany({
        data: [
          {
            title: 'Letter replaced',
            description: 'Your posting and appointment letter has been submitted again and is pending review.',
            timestamp: new Date(),
            iconType: 'USER',
            role: 'PERSONNEL',
            userId,
          },
          {
            title: 'Replacement letter uploaded',
            description: `${submission.fullName} (NSS: ${submission.nssNumber}) uploaded a new posting and appointment letter.`,
            timestamp: new Date(),
            iconType: 'BELL',
            role: 'STAFF',
          },
          {
            title: 'Replacement letter uploaded',
            description: `${submission.fullName} (NSS: ${submission.nssNumber}) uploaded a new posting and appointment letter.`,
            timestamp: new Date(),
            iconType: 'BELL',
            role: 'ADMIN',
          },
        ],
      });

      return updated;
    });
  }

  async updateStaff(staffId: number, dto: UpdateStaffDto, requesterId: number) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { role: true },
  });
  if (!requester || requester.role !== 'ADMIN') {
    throw new HttpException('Only ADMIN can update staff information', HttpStatus.FORBIDDEN);
  }

  const staff = await this.prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, deletedAt: true, email: true, phoneNumber: true, isTfaEnabled: true },
  });
  if (!staff || staff.deletedAt) {
    throw new HttpException('Staff user not found or deleted', HttpStatus.NOT_FOUND);
  }
  if (!['ADMIN', 'STAFF', 'SUPERVISOR'].includes(staff.role)) {
    throw new HttpException('Can only update ADMIN, STAFF or SUPERVISOR users', HttpStatus.BAD_REQUEST);
  }

  // Validate phoneNumber if enable2FA is true
  if (dto.enable2FA && (!dto.phoneNumber || !/^\+\d{10,15}$/.test(dto.phoneNumber))) {
    throw new HttpException(
      'Valid phone number with country code required when enabling 2FA (e.g., +233557484584)',
      HttpStatus.BAD_REQUEST
    );
  }

  return this.prisma.$transaction(async (prisma) => {
    const updateData: any = {
      name: dto.name,
      staffId: dto.staffId,
      email: dto.email,
      role: dto.role,
      phoneNumber: dto.phoneNumber,
      updatedAt: new Date(),
    };

    // Handle 2FA updates
    if (dto.enable2FA !== undefined) {
      updateData.isTfaEnabled = dto.enable2FA;
      if (dto.enable2FA && !staff.isTfaEnabled) {
        updateData.tfaSecret = authenticator.generateSecret(); // Generate new tfaSecret if enabling 2FA
      } else if (!dto.enable2FA && staff.isTfaEnabled) {
        updateData.tfaSecret = null; // Clear tfaSecret if disabling 2FA
      }
    }

    const updatedStaff = await prisma.user.update({
      where: { id: staffId },
      data: updateData,
      select: { id: true, name: true, staffId: true, email: true, role: true, phoneNumber: true, isTfaEnabled: true },
    });

    // Log 2FA status in audit log
    const auditDetails = `Admin (ID: ${requesterId}) updated staff (ID: ${staffId}, Email: ${updatedStaff.email}). Updated fields: ${
      dto.name ? `Name: ${dto.name}, ` : ''
    }${dto.staffId ? `StaffId: ${dto.staffId}, ` : ''}${dto.email ? `Email: ${dto.email}, ` : ''}${
      dto.role ? `Role: ${dto.role}, ` : ''
    }${dto.phoneNumber ? `PhoneNumber: ${dto.phoneNumber}, ` : ''}${
      dto.enable2FA !== undefined ? `2FA: ${dto.enable2FA ? 'Enabled' : 'Disabled'}` : ''
    }`;

    await prisma.auditLog.create({
      data: {
        submissionId: null,
        action: 'STAFF_UPDATED',
        userId: requesterId,
        details: auditDetails,
        createdAt: new Date(),
      },
    });

    // Notify user of profile update, including 2FA status
    const notificationDescription = `Your profile has been updated by admin. New details: ${
      dto.name ? `Name: ${dto.name}, ` : ''
    }${dto.email ? `Email: ${dto.email}, ` : ''}${dto.role ? `Role: ${dto.role}, ` : ''}${
      dto.phoneNumber ? `PhoneNumber: ${dto.phoneNumber}, ` : ''
    }${dto.enable2FA !== undefined ? `2FA: ${dto.enable2FA ? 'Enabled' : 'Disabled'}` : ''}.`;

    await prisma.notification.create({
      data: {
        title: 'Profile Updated',
        description: notificationDescription,
        timestamp: new Date(),
        iconType: 'USER',
        role: updatedStaff.role,
        userId: staffId,
      },
    });

    await prisma.notification.create({
      data: {
        title: 'Staff Profile Updated',
        description: `Staff (ID: ${staffId}, Email: ${updatedStaff.email}) profile updated by Admin (ID: ${requesterId}).`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: 'ADMIN',
      },
    });

    return updatedStaff;
  });
}

async updateDepartment(departmentId: number, dto: UpdateDepartmentDto, requesterId: number) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { role: true },
  });
  if (!requester || requester.role !== 'ADMIN') {
    throw new HttpException('Only ADMIN can update department information', HttpStatus.FORBIDDEN);
  }

  const department = await this.prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, supervisorId: true, deletedAt: true },
  });
  if (!department || department.deletedAt) {
    throw new HttpException('Department not found or deleted', HttpStatus.NOT_FOUND);
  }

  if (dto.supervisorId) {
    const supervisor = await this.prisma.user.findUnique({
      where: { id: dto.supervisorId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!supervisor || supervisor.deletedAt || !['ADMIN', 'STAFF', 'SUPERVISOR'].includes(supervisor.role)) {
      throw new HttpException('Invalid or deleted supervisor', HttpStatus.BAD_REQUEST);
    }
  }

  return this.prisma.$transaction(async (prisma) => {
    const updatedDepartment = await prisma.department.update({
      where: { id: departmentId },
      data: {
        name: dto.name,
        supervisorId: dto.supervisorId,
        updatedAt: new Date(),
      },
      select: { id: true, name: true, supervisorId: true },
    });

    await prisma.auditLog.create({
      data: {
        submissionId: null,
        action: 'DEPARTMENT_UPDATED',
        userId: requesterId,
        details: `Admin (ID: ${requesterId}) updated department (ID: ${departmentId}, Name: ${updatedDepartment.name})`,
        createdAt: new Date(),
      },
    });

    if (dto.supervisorId && dto.supervisorId !== department.supervisorId) {
      await prisma.notification.create({
        data: {
          title: 'Assigned as Department Supervisor',
          description: `You have been assigned as the supervisor for department ${updatedDepartment.name}.`,
          timestamp: new Date(),
          iconType: 'USER',
          role: 'STAFF',
          userId: dto.supervisorId,
        },
      });
    }

    await prisma.notification.create({
      data: {
        title: 'Department Updated',
        description: `Department (ID: ${departmentId}, Name: ${updatedDepartment.name}) updated by Admin (ID: ${requesterId}).`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: 'ADMIN',
      },
    });

    return updatedDepartment;
    });
  }

async deleteStaff(staffId: number, requesterId: number) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { role: true },
  });
  if (!requester || requester.role !== 'ADMIN') {
    throw new HttpException('Only ADMIN can delete staff', HttpStatus.FORBIDDEN);
  }

  const staff = await this.prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, email: true, name: true, staffId: true, deletedAt: true },
  });
  if (!staff || staff.deletedAt) {
    throw new HttpException('Staff user not found or already deleted', HttpStatus.NOT_FOUND);
  }
  if (!['ADMIN', 'STAFF', 'SUPERVISOR'].includes(staff.role)) {
    throw new HttpException('Can only delete ADMIN, STAFF or SUPERVISOR users', HttpStatus.BAD_REQUEST);
  }
  if (staffId === requesterId) {
    throw new HttpException('Cannot delete your own account', HttpStatus.BAD_REQUEST);
  }

  // Check for supervised departments
  // const supervisedDepartments = await this.prisma.department.count({
  //   where: { supervisorId: staffId, deletedAt: null },
  // });
  // if (supervisedDepartments > 0) {
  //   throw new HttpException('Cannot delete staff who supervises active departments', HttpStatus.BAD_REQUEST);
  // }

  return this.prisma.$transaction(async (prisma) => {
    // Log the original credentials in the audit log for traceability
    await prisma.auditLog.create({
      data: {
        submissionId: null,
        action: 'STAFF_DELETED',
        userId: requesterId,
        details: `Admin (ID: ${requesterId}) deleted staff (Name: ${staff.name}, Staff ID: ${staff.staffId})`,
        createdAt: new Date(),
      },
    });

    // Create notification for the staff being deleted
    await prisma.notification.create({
      data: {
        title: 'Account Deleted',
        description: `Your account has been deleted by admin.`,
        timestamp: new Date(),
        iconType: 'USER',
        role: staff.role,
        userId: staffId,
      },
    });

    // Create notification for the admin
    await prisma.notification.create({
      data: {
        title: 'Staff Account Deleted',
        description: `Staff (Name: ${staff.name}) account deleted by Admin (ID: ${requesterId}).`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: 'ADMIN',
      },
    });

    // Hard delete the user
    await prisma.user.delete({
      where: { id: staffId },
    });

    return { message: `Staff (ID: ${staffId}) successfully deleted` };
  });
}

 async deleteDepartment(departmentId: number, requesterId: number) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { role: true },
  });
  if (!requester || requester.role !== 'ADMIN') {
    throw new HttpException('Only ADMIN can delete departments', HttpStatus.FORBIDDEN);
  }

  const department = await this.prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, supervisorId: true, deletedAt: true },
  });
  if (!department || department.deletedAt) {
    throw new HttpException('Department not found or already deleted', HttpStatus.NOT_FOUND);
  }

  const activeUsers = await this.prisma.user.count({
    where: { departmentId, deletedAt: null },
  });
  const activeUnits = await this.prisma.unit.count({
    where: { departmentId, deletedAt: null },
  });
  if (activeUsers > 0 || activeUnits > 0) {
    throw new HttpException('Cannot delete department with active users or units', HttpStatus.BAD_REQUEST);
  }

  return this.prisma.$transaction(async (prisma) => {
    // Log the deletion in the audit log
    await prisma.auditLog.create({
      data: {
        submissionId: null,
        action: 'DEPARTMENT_DELETED',
        userId: requesterId,
        details: `Admin (ID: ${requesterId}) deleted department (ID: ${departmentId}, Name: ${department.name})`,
        createdAt: new Date(),
      },
    });

    if (department.supervisorId) {
      await prisma.notification.create({
        data: {
          title: 'Department Deleted',
          description: `The department ${department.name} (ID: ${departmentId}) you supervised has been deleted.`,
          timestamp: new Date(),
          iconType: 'USER',
          role: 'STAFF',
          userId: department.supervisorId,
        },
      });
    }

    await prisma.notification.create({
      data: {
        title: 'Department Deleted',
        description: `Department (ID: ${departmentId}, Name: ${department.name}) deleted by Admin (ID: ${requesterId}).`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: 'ADMIN',
      },
    });

    // Hard delete the department
    await prisma.department.delete({
      where: { id: departmentId },
    });

    return { message: `Department (ID: ${departmentId}) successfully deleted` };
  });
}

  async changePersonnelDepartment(dto: ChangePersonnelDepartmentDto, requesterId: number) {
  const requester = await this.prisma.user.findUnique({
    where: { id: requesterId, deletedAt: null },
    select: { role: true },
  });
 if (!requester || !['ADMIN', 'STAFF'].includes(requester.role)) {
    throw new HttpException('Only ADMIN or STAFF can change personnel departments', HttpStatus.FORBIDDEN);
  }

  const department = await this.prisma.department.findUnique({
    where: { id: dto.departmentId },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!department || department.deletedAt) {
    throw new HttpException('Department not found or deleted', HttpStatus.NOT_FOUND);
  }

  const users = await this.prisma.user.findMany({
    where: {
      id: { in: dto.userIds },
      role: 'PERSONNEL',
      deletedAt: null,
    },
    select: { id: true, name: true, nssNumber: true },
  });
  if (users.length !== dto.userIds.length) {
    throw new HttpException('One or more users not found or not PERSONNEL', HttpStatus.NOT_FOUND);
  }

  return this.prisma.$transaction(async (prisma) => {
    await prisma.user.updateMany({
      where: { id: { in: dto.userIds } },
      data: { departmentId: dto.departmentId, updatedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        submissionId: null,
        action: 'PERSONNEL_DEPARTMENT_CHANGED',
        userId: requesterId,
        details: `Admin (ID: ${requesterId}) reassigned ${users.length} personnel to department (ID: ${dto.departmentId}, Name: ${department.name})`,
        createdAt: new Date(),
      },
    });

    await prisma.notification.create({
      data: {
        title: 'Personnel Department Reassigned',
        description: `${users.length} personnel reassigned to department ${department.name} (ID: ${dto.departmentId}) by Admin (ID: ${requesterId}).`,
        timestamp: new Date(),
        iconType: 'SETTING',
        role: 'ADMIN',
      },
    });

    return { message: `Successfully reassigned ${users.length} personnel to department ${department.name}`, departmentId: dto.departmentId };
    });
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findFirst({ where: { phoneNumber, deletedAt: null } });
  }
}