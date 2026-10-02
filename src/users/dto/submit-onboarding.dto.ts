import { SubmissionStatus } from '@prisma/client';
import { IsString, IsEnum, IsEmail, IsInt, MinLength, IsOptional, Matches, IsArray, IsNotEmpty, IsIn } from 'class-validator';

enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export class SubmitOnboardingDto {
  @IsString()
  fullName: string;

  @IsString()
  nssNumber: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsEmail()
  email: string;

  @IsString()
  placeOfResidence: string;

   @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone number must include country code (e.g., +233557484584)' })
  phoneNumber: string;

  @IsString()
  universityAttended: string;

  @IsString()
  regionOfSchool: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Year of NSS must be a valid 4-digit year' })
  yearOfNss: string;

  @IsString()
  programStudied: string;

  @IsString()
  divisionPostedTo: string;

  @IsOptional()
  postingAppointmentLetter: any;

  @IsOptional()
  verificationForm: any;
}

export class RejectUploadDto {
  @IsIn(['letter', 'verification'])
  target: 'letter' | 'verification';

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}

export class UpdateSubmissionStatusDto {
  @IsEnum(SubmissionStatus)
  status: SubmissionStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class GetSubmissionStatusCountsDto {
  @IsArray()
  @IsEnum(SubmissionStatus, { each: true })
  statuses: SubmissionStatus[];

  @IsOptional()
  @IsInt()
  year?: number;
}