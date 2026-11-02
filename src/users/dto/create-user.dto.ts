import { IsString, IsEmail, IsEnum, IsOptional, IsInt, IsArray, IsNotEmpty, Min, Matches, IsBoolean } from 'class-validator';
import { Role, SubmissionStatus } from '@prisma/client';

export class CreateUserDto {
   @IsString()
  @IsOptional()
  nssNumber?: string;

  @IsString()
  @IsOptional()
  staffId?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsEnum(Role)
  role: Role;

  @IsString()
  @IsOptional()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone number must include country code (e.g., +233557484584)' })
  phoneNumber?: string;

  @IsOptional()
  enable2FA?: boolean;
}

export class InitUserDto {
  @IsString()
  staffId: string;

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsEnum(Role, { message: 'Role must be STAFF, ADMIN, or SUPERVISOR' })
  role: 'STAFF' | 'ADMIN' | 'SUPERVISOR';

  @IsString()
  @IsOptional()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone number must include country code (e.g., +233557484584)' })
  phoneNumber?: string;

  @IsOptional()
  enable2FA?: boolean;
}

export class CreateDepartmentDto {
  @IsString()
  name: string;

  @IsInt()
  supervisorId: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  unitIds?: number[];
}

export class GetPersonnelDto {
  @IsOptional()
  @IsArray()
  @IsEnum(SubmissionStatus, { each: true })
  statuses?: SubmissionStatus[];

  @IsOptional()
  @IsInt()
  year?: number;
}

export class AssignPersonnelToDepartmentDto {
  @IsArray()
  @IsInt({ each: true })
  @IsNotEmpty()
  submissionIds: number[];

  @IsInt()
  @IsNotEmpty()
  departmentId: number;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  supervisorId?: number;
}

export class ChangePersonnelDepartmentDto {
  @IsArray()
  @IsInt({ each: true })
  userIds: number[];

  @IsInt()
  @Min(1)
  departmentId: number;

  @IsOptional()
  @IsBoolean()
  resendLetter?: boolean;
}

export class PreviewAppointmentLetterDto {
  @IsInt()
  @IsNotEmpty()
  submissionId: number;

  @IsInt()
  @IsNotEmpty()
  departmentId: number;
}

export class SendAppointmentLettersDto {
  @IsArray()
  @IsInt({ each: true })
  @IsNotEmpty()
  userIds: number[];
}