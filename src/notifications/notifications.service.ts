import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class NotificationsService {
  private readonly frontendUrl = process.env.FRONTEND_URL;

  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendOnboardingEmail(to: string, nssNumber: string, token: string) {
    const enqueue = this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Welcome to COCOBOD!',
        content: `
          <h1>Welcome to COCOBOD</h1>
          <p>Click <a href="${this.frontendUrl}/reset-password?nssNumber=${nssNumber}&token=${token}">here</a> to set your password to access your dashboard.</p>
          <p>This link expires in 24 hours.</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Email queue is not reachable')), 8000),
    );
    await Promise.race([enqueue, timeout]);
  }

  async sendForgotPasswordEmail(to: string, token: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'COCOBOD Password Reset',
        content: `
          <h1>Password Reset Request</h1>
          <p>You requested to reset your password.</p>
          <p>Click <a href="${this.frontendUrl}/reset-password?token=${token}">here</a> to reset your password.</p>
          <p>This link expires in 1 hour.</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendSubmissionConfirmationEmail(to: string, fullName: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Onboarding Submission Confirmation',
        content: `
          <h1>Thank You for Your Submission!</h1>
          <p>Dear ${fullName},</p>
          <p>Your onboarding submission has been successfully received.</p>
          <p>We will review it and notify you of any updates. If you have any questions, please contact our support team at hr.training@cocobod.gh or call 030 266 1877.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendRejectionEmail(to: string, fullName: string, submissionId: number, reason: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'An Update on Your Submission',
        content: `
          <p>Hi ${fullName},</p>
          <p>We're writing to let you know that we couldn't accept your National Service placement at this time. Our institution has reached its capacity, and we simply don't have any more available slots.</p>
          <p>To secure a new placement, please follow the instructions from the National Service Secretariat to go through the reposting process. We wish you the best of luck with your reposting and your service year!</p>
          <p>If you have any questions or need further clarification, please contact our support team at hr.training@cocobod.gh or call 030 266 1877.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendSupervisorAssignmentEmail(to: string, supervisorName: string, departmentName: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'COCOBOD Supervisor Assignment',
        content: `
          <h1>Supervisor Assignment Notification</h1>
          <p>Dear ${supervisorName},</p>
          <p>You have been assigned as the supervisor over NSPs for the <strong>${departmentName}</strong> department.</p>
          <p>Please review your responsibilities and contact the administration if you have any questions.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendVerificationFormEmail(
    to: string,
    staffName: string,
    personnelName: string,
    nssNumber: string,
    submissionId: number
  ) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Regional Validated Letter Submission',
        content: `
          <h1>New Validated Letter Submission</h1>
          <p>Dear ${staffName},</p>
          <p>A validated letter has been submitted by ${personnelName} (NSS: ${nssNumber}) for Submission ID: ${submissionId}.</p>
          <p>Please review the submission in your dashboard and take appropriate action.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendDocumentEndorsedEmail(
    to: string,
    personnelName: string,
    nssNumber: string,
    submissionId: number
  ) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Appointment Letter Endorsement Notification',
        content: `
          <h1>Appointment Letter Endorsement Notification</h1>
          <p>Dear ${personnelName},</p>
          <p>Your appointment letter has been successfully endorsed.</p>
          <p>Please check your dashboard for further details or contact the administration at hr.training@cocobod.gh or call 030 266 1877, should you have any questions.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendUploadRejectedEmail(
    to: string,
    fullName: string,
    documentName: string,
    reason: string,
  ) {
    const safeReason = reason
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: `Action required: ${documentName} was not accepted`,
        content: `
          <h1>Please upload the correct document</h1>
          <p>Dear ${fullName},</p>
          <p>Your <strong>${documentName}</strong> was not accepted because:</p>
          <p>${safeReason}</p>
          <p>Log in to your dashboard and upload the correct PDF. The file must be a PDF no larger than 10MB.</p>
          <p>If you have any questions, contact hr.training@cocobod.gh or call 030 266 1877.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }

  async sendOtpEmail(to: string, name: string, otp: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'COCOBOD OTP Verification',
        content: `
          <h1>OTP Verification Code</h1>
          <p>Dear ${name},</p>
          <p>Your OTP verification code is: <strong>${otp}</strong></p>
          <p>This code expires in 3 minutes. Please enter it in your dashboard to complete the verification process.</p>
          <p>If you did not request this code, please ignore this email and contact support immediately.</p>
          <p>Best regards,<br>HR Team</p>
        `,
      },
      {
        attempts: 3,
        backoff: 5000,
      },
    );
  }
}
