import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PrismaService } from 'prisma/prisma.service';
import { SmsService } from './sms.service';
import { authenticator } from 'otplib';

const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private notificationsService: NotificationsService,
    private prisma: PrismaService,
    private smsService: SmsService,
  ) {}

  private buildAccessPayload(user: {
    id: number;
    role: string;
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    staffId?: string | null;
    nssNumber?: string | null;
    isTfaEnabled?: boolean;
  }) {
    const identifier =
      user.role === 'PERSONNEL' ? user.nssNumber : user.staffId;
    return {
      sub: user.id,
      identifier,
      role: user.role,
      name: user.name,
      email: user.email || '',
      phoneNumber: user.phoneNumber || '',
      isTfaRequired: false,
      isTfaEnabled: user.isTfaEnabled ?? false,
    };
  }

  private hashRefreshToken(refreshToken: string) {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
  }

  private async createSessionTokens(user: {
    id: number;
    role: string;
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    staffId?: string | null;
    nssNumber?: string | null;
    isTfaEnabled?: boolean;
  }) {
    const accessToken = this.jwtService.sign(this.buildAccessPayload(user));
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  // Validate STAFF or ADMIN user
  async validateStaffAdmin(staffId: string, password: string): Promise<any> {
    const user = await this.usersService.findByStaffId(staffId);

    if (!user) {
      throw new HttpException(
        'Invalid staff ID or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.deletedAt !== null) {
      throw new HttpException(
        'Account is disabled. Please contact support.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (
      user.role !== 'STAFF' &&
      user.role !== 'ADMIN' &&
      user.role !== 'SUPERADMIN' &&
      user.role !== 'SUPERVISOR'
    ) {
      throw new HttpException(
        'Access denied. Only Staff or Admin roles are allowed.',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!user.password) {
      throw new HttpException(
        'Password not set. Please reset your password.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new HttpException(
        'Invalid staff ID or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return {
      id: user.id,
      staffId: user.staffId,
      role: user.role,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber,
      isTfaEnabled: user.isTfaEnabled,
      tfaSecret: user.tfaSecret,
    };
  }

  async validatePersonnel(nssNumber: string, password: string): Promise<any> {
    let user = await this.usersService.findByNssNumber(nssNumber);

    // try with current year appended
    if (!user) {
      const currentYear = new Date().getFullYear();
      const nssNumberWithYear = `${nssNumber}${currentYear}`;
      user = await this.usersService.findByNssNumber(nssNumberWithYear);
    }

    if (!user) {
      throw new HttpException(
        'Invalid NSS number or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.role !== 'PERSONNEL') {
      throw new HttpException(
        'Access denied. Only Personnel role is allowed.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.deletedAt !== null) {
      throw new HttpException(
        'Account is disabled. Please contact support.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!user.password) {
      throw new HttpException(
        'Password not set. Please reset your password.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new HttpException(
        'Invalid NSS number or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const submission = await this.prisma.submission.findUnique({
      where: {
        userId_nssNumber: { userId: user.id, nssNumber: user.nssNumber },
      },
    });
    return {
      id: user.id,
      nssNumber: user.nssNumber,
      role: user.role,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber || submission?.phoneNumber,
      isTfaEnabled: user.isTfaEnabled || true, // Personnel always have 2FA enabled
      tfaSecret: user.tfaSecret,
    };
  }

  async loginStaffAdmin(staffId: string, password: string) {
    const user = await this.validateStaffAdmin(staffId, password);
    if (user.isTfaEnabled) {
      if (!user.tfaSecret || !user.email) {
        throw new HttpException(
          '2FA is enabled but no email is set',
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.smsService.sendOtp(user.id);
      const tempPayload = {
        sub: user.id,
        identifier: user.staffId,
        role: user.role,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        isTfaRequired: true,
        isTfaEnabled: user.isTfaEnabled, // Include in payload
      };
      return {
        tempAccessToken: this.jwtService.sign(tempPayload, { expiresIn: '5m' }),
        message: '2FA required. OTP sent to your email.',
        phoneNumber: user.phoneNumber,
        email: user.email,
      };
    } else {
      const session = await this.createSessionTokens({
        id: user.id,
        staffId: user.staffId,
        role: user.role,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        isTfaEnabled: user.isTfaEnabled,
      });
      return {
        ...session,
        role: user.role,
        message: 'Login successful',
      };
    }
  }

  // async loginStaffAdmin(staffId: string, password: string) {
  //      const user = await this.validateStaffAdmin(staffId, password);
  //     if (!user.phoneNumber) {
  //       throw new HttpException('Phone number not set. Please update your profile.', HttpStatus.BAD_REQUEST);
  //     }
  //     // await this.smsService.sendOtp(user.id);
  //     const payload = { sub: user.id, identifier: user.staffId, role: user.role, name: user.name, email: user.email, isTfaRequired: true };
  //      return {
  //     accessToken: this.jwtService.sign(payload),
  //     role: user.role,
  //   };
  //   }

  async loginPersonnel(nssNumber: string, password: string) {
    const user = await this.validatePersonnel(nssNumber, password);
    // if (!user.phoneNumber) {
    //   throw new HttpException('Phone number not set. Please complete onboarding.', HttpStatus.BAD_REQUEST);
    // }
    // Personnel always require 2FA
    await this.smsService.sendOtp(user.id);
    const tempPayload = {
      sub: user.id,
      userId: user.id,
      identifier: user.nssNumber,
      role: user.role,
      name: user.name,
      email: user.email || '',
      phoneNumber: user.phoneNumber,
      isTfaRequired: true,
      isTfaEnabled: user.isTfaEnabled,
    };
    return {
      tempAccessToken: this.jwtService.sign(tempPayload, { expiresIn: '5m' }),
      message: '2FA required. OTP sent to your email.',
      phoneNumber: user.phoneNumber,
      email: user.email,
    };
  }

  async verifyTfa(userId: number, token: string) {
    const isValid = await this.smsService.verifyOtp(userId, token);
    if (!isValid) {
      throw new HttpException('Invalid OTP', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.usersService.findById(userId);
    if (
      !user.staffId &&
      (        user.role === 'STAFF' ||
        user.role === 'ADMIN' ||
        user.role === 'SUPERADMIN' ||
        user.role === 'SUPERVISOR')
    ) {
      throw new HttpException(
        'Staff ID not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const identifier =
      user.role === 'PERSONNEL' ? user.nssNumber : user.staffId;
    if (!identifier) {
      throw new HttpException(
        'User identifier not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const session = await this.createSessionTokens({
      id: user.id,
      staffId: user.staffId,
      nssNumber: user.nssNumber,
      role: user.role,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isTfaEnabled: user.isTfaEnabled,
    });
    return {
      ...session,
      role: user.role,
    };
  }

  async validateToken(user: any) {
    return {
      success: true,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }

  async refreshSession(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      throw new HttpException(
        'Invalid or expired refresh token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (storedToken.user.deletedAt) {
      throw new HttpException(
        'Account is disabled. Please contact support.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const session = await this.createSessionTokens({
      id: storedToken.user.id,
      staffId: storedToken.user.staffId,
      nssNumber: storedToken.user.nssNumber,
      role: storedToken.user.role,
      name: storedToken.user.name,
      email: storedToken.user.email,
      phoneNumber: storedToken.user.phoneNumber,
      isTfaEnabled: storedToken.user.isTfaEnabled,
    });

    return {
      ...session,
      role: storedToken.user.role,
    };
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async initOnboarding(
    nssNumber: string,
    email: string,
    initiatedBy: { id: number; role: string },
    phoneNumber: string,
  ) {
    if (!['STAFF', 'ADMIN', 'SUPERADMIN'].includes(initiatedBy.role)) {
      throw new HttpException(
        'Unauthorized: Only staff or admins can initiate onboarding',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpException('Invalid email address', HttpStatus.BAD_REQUEST);
    }
    const currentYear = new Date().getFullYear();
    const nssNumberWithYear = `${nssNumber}${currentYear}`;
    const normalizedEmail = email.trim();

    const [existingByNss, existingByEmail] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { nssNumber: { equals: nssNumber, mode: 'insensitive' } },
            { nssNumber: { equals: nssNumberWithYear, mode: 'insensitive' } },
          ],
        },
      }),
      this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          email: { equals: normalizedEmail, mode: 'insensitive' },
        },
      }),
    ]);

    if (existingByEmail && existingByEmail.role !== 'PERSONNEL') {
      throw new HttpException(
        'This email is already used by a staff account. Enter the personnel email address.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (existingByNss && existingByNss.role !== 'PERSONNEL') {
      throw new HttpException(
        'NSS number already registered',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      existingByNss &&
      existingByEmail &&
      existingByNss.id !== existingByEmail.id
    ) {
      throw new HttpException(
        'This NSS number and email belong to different accounts.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existingPersonnel = existingByNss ?? existingByEmail;
    if (existingPersonnel) {
      await this.renewOnboardingToken(existingPersonnel.id, initiatedBy.id);
      return {
        message:
          'This personnel already has an account. A new onboarding link was sent to their email.',
        email: existingPersonnel.email,
      };
    }

    const user = await this.usersService.createUser({
      nssNumber: nssNumberWithYear,
      email: normalizedEmail,
      phoneNumber,
      role: 'PERSONNEL',
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

    await this.prisma.onboardingToken.create({
      data: {
        token,
        nssNumber: nssNumberWithYear,
        userId: user.id,
        expiresAt,
      },
    });

    try {
      await this.notificationsService.sendOnboardingEmail(
        email,
        nssNumberWithYear,
        token,
      );
    } catch {
      throw new HttpException(
        'The personnel account was created, but the onboarding email could not be sent. The email queue is not reachable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { message: 'Onboarding link sent to email', email };
  }

  async getOnboardedUsers(year?: number) {
    const targetYear = year || new Date().getFullYear();

    const users = await this.prisma.user.findMany({
      where: {
        role: 'PERSONNEL',
        deletedAt: null,
        nssNumber: { endsWith: String(targetYear) },
        OR: [
          { OnboardingToken: { some: { deletedAt: null } } },
          { submissions: { some: { deletedAt: null } } },
        ],
      },
      select: {
        id: true,
        name: true,
        nssNumber: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
        submissions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            fullName: true,
            email: true,
            phoneNumber: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => {
      const submission = user.submissions[0];
      return {
        id: user.id,
        name: user.name || submission?.fullName || '',
        nssNumber: user.nssNumber,
        email: user.email || submission?.email || '',
        phoneNumber: user.phoneNumber || submission?.phoneNumber || '',
        status: submission?.status || 'AWAITING_FORM',
        userCreatedAt: user.createdAt,
      };
    });
  }

  async updateOnboardedPersonnel(
    userId: number,
    initiatorId: number,
    dto: { nssNumber: string; email: string; phoneNumber: string },
  ) {
    const nssNumber = dto.nssNumber?.trim();
    const email = dto.email?.trim();
    const phoneNumber = dto.phoneNumber?.trim();

    if (!nssNumber) {
      throw new HttpException('NSS number is required', HttpStatus.BAD_REQUEST);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpException('Enter a valid email address', HttpStatus.BAD_REQUEST);
    }
    if (!phoneNumber || !/^\+?\d{10,15}$/.test(phoneNumber)) {
      throw new HttpException(
        'Enter a valid mobile number (10-15 digits, optional +)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'PERSONNEL', deletedAt: null },
      select: { id: true, nssNumber: true, name: true },
    });
    if (!user) {
      throw new HttpException('Personnel not found', HttpStatus.NOT_FOUND);
    }

    const [nssTaken, emailTaken] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          id: { not: userId },
          nssNumber: { equals: nssNumber, mode: 'insensitive' },
        },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          id: { not: userId },
          email: { equals: email, mode: 'insensitive' },
        },
        select: { id: true },
      }),
    ]);
    if (nssTaken) {
      throw new HttpException(
        'This NSS number is already used',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (emailTaken) {
      throw new HttpException(
        'This email is already used',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.$transaction(async (prisma) => {
      const saved = await prisma.user.update({
        where: { id: userId },
        data: { nssNumber, email, phoneNumber },
        select: { id: true, name: true, nssNumber: true, email: true, phoneNumber: true },
      });

      const tokens = await prisma.onboardingToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (tokens.length > 1) {
        await prisma.onboardingToken.deleteMany({
          where: { userId, id: { not: tokens[0].id } },
        });
      }
      if (tokens.length > 0) {
        await prisma.onboardingToken.update({
          where: { id: tokens[0].id },
          data: { nssNumber },
        });
      }

      await prisma.submission.updateMany({
        where: { userId, deletedAt: null },
        data: { nssNumber, email, phoneNumber },
      });

      const submission = await prisma.submission.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { fullName: true, status: true },
      });

      await prisma.auditLog.create({
        data: {
          action: 'ONBOARDED_PERSONNEL_UPDATED',
          userId: initiatorId,
          submissionId: null,
          details: `Personnel ${user.nssNumber} updated to NSS ${nssNumber}, email ${email}, mobile ${phoneNumber}`,
        },
      });

      return {
        id: saved.id,
        name: saved.name || submission?.fullName || '',
        nssNumber: saved.nssNumber,
        email: saved.email || '',
        phoneNumber: saved.phoneNumber || '',
        status: submission?.status || 'AWAITING_FORM',
      };
    });

    return updated;
  }

  async deleteOnboardedUser(userId: number, initiatorId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { OnboardingToken: true },
    });

    if (!user || !user.OnboardingToken.length) {
      throw new HttpException(
        'User not found or not onboarded',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.delete({
        where: { id: userId },
      }),
      // Log the action in AuditLog
      this.prisma.auditLog.create({
        data: {
          action: 'DELETE_ONBOARDED_USER',
          userId: initiatorId,
          details: `User with NSS Number ${user.nssNumber} deleted for re-onboarding`,
        },
      }),
    ]);
  }

  async renewOnboardingToken(userId: number, initiatorId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { OnboardingToken: true },
    });

    if (!user || !user.nssNumber) {
      throw new HttpException(
        'User not found or not onboarded',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!user.email) {
      throw new HttpException(
        'This personnel has no email address',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (user.deletedAt) {
      throw new HttpException(
        'User is deleted and cannot have their token renewed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

    await this.prisma.$transaction([
      // Delete existing onboarding tokens
      this.prisma.onboardingToken.deleteMany({
        where: { userId },
      }),
      // Create new onboarding token
      this.prisma.onboardingToken.create({
        data: {
          token,
          nssNumber: user.nssNumber,
          userId,
          expiresAt,
        },
      }),
      // Log the action
      this.prisma.auditLog.create({
        data: {
          action: 'RENEW_ONBOARDING_TOKEN',
          userId: initiatorId,
          details: `Onboarding token renewed for user with NSS Number ${user.nssNumber}`,
        },
      }),
    ]);

    // Send onboarding email
    await this.notificationsService.sendOnboardingEmail(
      user.email,
      user.nssNumber,
      token,
    );

    return { email: user.email };
  }

  async onboardingResetPassword(
    nssNumber: string,
    token: string,
    password: string,
    confirmPassword: string,
  ) {
    if (password !== confirmPassword) {
      throw new HttpException('Passwords do not match', HttpStatus.BAD_REQUEST);
    }

    const onboardingToken = await this.prisma.onboardingToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (
      !onboardingToken ||
      onboardingToken.nssNumber !== nssNumber ||
      onboardingToken.used ||
      onboardingToken.expiresAt < new Date()
    ) {
      throw new HttpException(
        'This password reset link is invalid or has expired. Please try logging in with your new password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // if (onboardingToken.user.password) {
    //   throw new HttpException('Password already set for this account', HttpStatus.BAD_REQUEST);
    // }

    await this.usersService.updateUser(onboardingToken.userId, { password });

    await this.prisma.onboardingToken.update({
      where: { token },
      data: { used: true },
    });

    return { message: 'Password set successfully' };
  }

  async requestForgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return { message: 'If an account exists, a reset link will be sent' };
    }
    if (user.deletedAt !== null) {
      throw new HttpException(
        'Account is disabled. Please contact support.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour expiry

    await this.prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    await this.notificationsService.sendForgotPasswordEmail(email, token);

    return { message: 'If an account exists, a reset link will be sent' };
  }

  async forgotPassword(token: string, password: string) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new HttpException(
        'This password reset link is invalid or has expired. Please try logging in with your new password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.usersService.updateUser(resetToken.userId, { password });

    await this.prisma.passwordResetToken.delete({ where: { token } });

    return { message: 'Password reset successfully' };
  }

  async initUser(
    staffId: string,
    email: string,
    name: string,
    role: 'STAFF' | 'ADMIN' | 'SUPERVISOR',
    initiatedBy: { id: number; role: string },
    phoneNumber?: string,
    enable2FA?: boolean,
  ) {
    if (initiatedBy.role !== 'ADMIN' && initiatedBy.role !== 'SUPERADMIN') {
      throw new HttpException(
        'Unauthorized: Only admins can initiate user creation',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpException('Invalid email address', HttpStatus.BAD_REQUEST);
    }
    if (enable2FA && (!phoneNumber || !/^\+\d{10,15}$/.test(phoneNumber))) {
      throw new HttpException(
        'Valid phone number with country code required when enabling 2FA (e.g., +233557484584)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [existingUser, existingEmail, existingPhone] = await Promise.all([
      this.usersService.findByNssNumberOrStaffId(staffId),
      this.usersService.findByEmail(email),
      phoneNumber ? this.usersService.findByPhoneNumber(phoneNumber) : null,
    ]);
    if (existingUser) {
      throw new HttpException(
        'Staff ID already registered',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (existingEmail) {
      throw new HttpException(
        'Email already registered',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (existingPhone) {
      throw new HttpException(
        'Phone number already registered',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!['STAFF', 'ADMIN', 'SUPERVISOR'].includes(role)) {
      throw new HttpException(
        'Invalid role: Must be STAFF, ADMIN, or SUPERVISOR',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.usersService.createUser({
      staffId,
      email,
      name,
      role,
      phoneNumber,
      enable2FA,
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000);

    await this.prisma.onboardingToken.create({
      data: {
        token,
        nssNumber: staffId,
        userId: user.id,
        expiresAt,
      },
    });

    await this.notificationsService.sendOnboardingEmail(email, staffId, token);

    return {
      message: 'Onboarding link sent to email',
      email,
      has2FA: user.isTfaEnabled,
    };
  }

  async resendOtp(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    }
    await this.smsService.sendOtp(userId);
    return { message: 'OTP resent to your email' };
  }

  // Debug method to check user 2FA status
  async checkUser2FAStatus(staffId: string) {
    const user = await this.usersService.findByStaffId(staffId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return {
      id: user.id,
      staffId: user.staffId,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isTfaEnabled: user.isTfaEnabled,
      hasTfaSecret: !!user.tfaSecret,
      role: user.role,
    };
  }
}
