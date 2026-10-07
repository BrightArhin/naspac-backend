import { IsEmail, IsString, Matches } from 'class-validator';

export class UpdateOnboardedPersonnelDto {
  @IsString()
  nssNumber: string;

  @IsEmail()
  email: string;

  @Matches(/^\+?\d{10,15}$/, {
    message: 'Enter a valid mobile number (10-15 digits, optional +)',
  })
  phoneNumber: string;
}
