import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class NotificationsService {
  private readonly frontendUrl = process.env.FRONTEND_URL;

  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendOnboardingEmail(to: string, nssNumber: string, token: string) {
    const setPasswordUrl = `${this.frontendUrl}/reset-password?nssNumber=${encodeURIComponent(nssNumber)}&token=${encodeURIComponent(token)}`;
    const enqueue = this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Welcome to COCOBOD NASPAC',
        content: `
          <div style="font-family: Georgia, 'Times New Roman', serif; color: #2c241f; line-height: 1.6; max-width: 640px;">
            <p style="margin: 0 0 8px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #8a6844;">Ghana Cocoa Board</p>
            <h1 style="margin: 0 0 16px; font-size: 26px; font-weight: 600;">Welcome to COCOBOD NASPAC</h1>
            <p>Your national service record has been opened. Set your password to continue your onboarding.</p>
            <p style="margin: 24px 0;">
              <a href="${setPasswordUrl}" style="display: inline-block; background: #3c2a22; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 8px;">Set your password</a>
            </p>
            <p>This link expires in 24 hours. Your NSS number is <strong>${nssNumber}</strong>.</p>
            <p style="margin-top: 28px;">If you have successfully reset your password, please visit the NSS login page:<br>
            <a href="https://nss.cocobod.net/login">https://nss.cocobod.net/login</a><br>
            Log in using your NSS Number and the new password you created.</p>
            <p>If you encounter any difficulties logging in, click on “Forgot Password?”, located directly below the password field on the login page. Enter your registered email address, and a new password reset link will be sent to your email.</p>
            <p>You will be communicated with by email about the status of your application. Please also log in to your portal to check the status of your application.</p>
            <p style="margin-top: 28px;">Best regards,<br>Human Resource, Ghana Cocoa Board</p>
          </div>
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
          <div style="font-family: Georgia, 'Times New Roman', serif; color: #2c241f; line-height: 1.6; max-width: 640px;">
            <h1 style="font-size: 24px; font-weight: 600;">Upload your verification form</h1>
            <p>Dear ${personnelName},</p>
            <p>Your posting and appointment letter has been endorsed. The next step is to upload your verification form.</p>
            <p>Log in at <a href="https://nss.cocobod.net/login">https://nss.cocobod.net/login</a> with your NSS number <strong>${nssNumber}</strong>, then open <strong>Upload Verification</strong> and submit the PDF.</p>
            <p>If you have questions, contact hr.training@cocobod.gh or call 030 266 1877.</p>
            <p>Best regards,<br>Human Resource, Ghana Cocoa Board</p>
          </div>
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

  async sendAppointmentLetterReadyEmail(to: string, fullName: string, nssNumber: string) {
    await this.emailQueue.add(
      'send-email',
      {
        to,
        subject: 'Your COCOBOD appointment letter is ready',
        content: `
          <div style="font-family: Georgia, 'Times New Roman', serif; color: #2c241f; line-height: 1.6; max-width: 640px;">
            <h1 style="font-size: 24px; font-weight: 600;">Your appointment letter is ready</h1>
            <p>Dear ${fullName},</p>
            <p>Your COCOBOD appointment letter has been issued. Log in to download it.</p>
            <p>Visit <a href="https://nss.cocobod.net/login">https://nss.cocobod.net/login</a> and sign in with your NSS number <strong>${nssNumber}</strong>. Open <strong>Appointment Letter</strong> in the menu.</p>
            <p>If you have questions, contact hr.training@cocobod.gh or call 030 266 1877.</p>
            <p>Best regards,<br>Human Resource, Ghana Cocoa Board</p>
          </div>
        `,
      },
      { attempts: 3, backoff: 5000 },
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
