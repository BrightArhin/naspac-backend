import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';

@Processor('email')
export class EmailProcessor {
  private readonly port = Number(process.env.MAILER_PORT) || 587;
  private transporter = nodemailer.createTransport({
    host: process.env.MAILER_HOST,
    port: this.port,
    secure: this.port === 465,
    auth: {
      user: process.env.MAILER_USER,
      pass: process.env.MAILER_PASSWORD,
    },
  });

  @Process('send-email')
  async sendEmail(job: Job<{ to: string; subject: string; content: string }>) {
    try {
      await this.transporter.sendMail({
        from: `"COCOBOD NASPAC" <${process.env.MAILER_FROM_ADDRESS}>`,
        to: job.data.to,
        subject: job.data.subject,
        html: job.data.content,
      });
      console.log(`Email sent to ${job.data.to}`);
    } catch (error) {
      console.error(`Failed to send email to ${job.data.to}:`, error);
      throw error; // Trigger Bull retry mechanism
    }
  }
}