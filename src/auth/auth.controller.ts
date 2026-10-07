import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Req,
  HttpException,
  HttpStatus,
  Param,
  Delete,
  Query,
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Roles } from '../common/decorators/roles.decorator';
import { InitOnboardingDto } from '../users/dto/init-onboarding.dto';
import { JwtAuthGuard } from 'src/common/guards/auth-guard';
import { RolesGuard } from 'src/common/guards/roles-guard';
import { LoginStaffAdminDto } from './dto/login-staff-admin.dto';
import { LoginPersonnelDto } from './dto/login-personnel.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RequestForgotPasswordDto } from './dto/request-forgot-password.dto';
import { OnboardingResetPasswordDto } from './dto/onboarding-reset-password.dto';
import { InitUserDto } from 'src/users/dto/create-user.dto';
import { SmsService } from './sms.service';
import { TwoFactorAuthGuard } from 'src/common/guards/two-factor-auth.guard';
import { TwoFaDto } from './dto/two-fa.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { UpdateOnboardedPersonnelDto } from './dto/update-onboarded-personnel.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private smsService: SmsService,
  ) {}

  @Post('login-personnel')
  async loginPersonnel(@Body() body: LoginPersonnelDto) {
    return this.authService.loginPersonnel(body.nssNumber, body.password);
  }

  @Post('login-staff-admin')
  async loginStaffAdmin(@Body() body: LoginStaffAdminDto) {
    return this.authService.loginStaffAdmin(body.staffId, body.password);
  }

  @Post('verifyTfa')
  @UseGuards(JwtAuthGuard)
  async verifyTfa(@Req() req: any, @Body() body: TwoFaDto) {
    if (!req.user.isTfaRequired) {
      throw new HttpException(
        '2FA not required for this token',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.authService.verifyTfa(req.user.id, body.tfaToken);
  }

  @Post('resendTfa')
  @UseGuards(JwtAuthGuard)
  async resendOtp(@Req() req: any) {
    if (!req.user.isTfaRequired) {
      throw new HttpException(
        'No pending 2FA verification',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.authService.resendOtp(req.user.id);
  }

  @Get('validate')
  @UseGuards(TwoFactorAuthGuard)
  async validateToken(@Req() req: any) {
    return {
      success: true,
      userId: req.user.id,
      role: req.user.role,
      email: req.user.email,
      name: req.user.name,
    };
  }

  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshSession(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Body() body: LogoutDto) {
    await this.authService.logout(body.refreshToken);
    return { success: true, message: 'Logged out successfully' };
  }

  @Post('init-onboarding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMIN')
  async initOnboarding(@Body() body: InitOnboardingDto, @Request() req) {
    return this.authService.initOnboarding(
      body.nssNumber,
      body.email,
      req.user,
      body.phoneNumber,
    );
  }

  @Post('init-user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async initUser(@Body() body: InitUserDto, @Request() req) {
    return this.authService.initUser(
      body.staffId,
      body.email,
      body.name,
      body.role,
      req.user,
      body.phoneNumber,
      body.enable2FA,
    );
  }

  @Post('request-forgot-password')
  async requestForgotPassword(@Body() body: RequestForgotPasswordDto) {
    return this.authService.requestForgotPassword(body.email);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.token, body.password);
  }

  @Post('onboarding-reset-password')
  async onboardingResetPassword(@Body() body: OnboardingResetPasswordDto) {
    return this.authService.onboardingResetPassword(
      body.nssNumber,
      body.token,
      body.password,
      body.confirmPassword,
    );
  }

  @Get('onboarded')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMIN')
  async getOnboardedUsers(@Query('year') year?: string) {
    return this.authService.getOnboardedUsers(
      year ? parseInt(year) : undefined,
    );
  }

  @Patch('onboarded/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMIN')
  async updateOnboardedPersonnel(
    @Param('id') id: string,
    @Body() body: UpdateOnboardedPersonnelDto,
    @Request() req,
  ) {
    return this.authService.updateOnboardedPersonnel(
      parseInt(id),
      req.user.id,
      body,
    );
  }

  @Delete('onboarded/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteOnboardedUser(@Param('id') id: string, @Request() req) {
    try {
      const userRole = req.user.role;
      if (!['STAFF', 'ADMIN', 'SUPERADMIN'].includes(userRole)) {
        throw new HttpException(
          'Unauthorized: Only staff or admins can delete users',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.authService.deleteOnboardedUser(parseInt(id), req.user.id);
      return { message: 'User deleted successfully' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete onboarded user',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('renew-token/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async renewOnboardingToken(@Param('id') id: string, @Request() req) {
    try {
      const userRole = req.user.role;
      if (!['STAFF', 'ADMIN', 'SUPERADMIN'].includes(userRole)) {
        throw new HttpException(
          'Unauthorized: Only staff or admins can renew tokens',
          HttpStatus.FORBIDDEN,
        );
      }
      const result = await this.authService.renewOnboardingToken(
        parseInt(id),
        req.user.id,
      );
      return {
        message: 'Onboarding token renewed and email sent',
        email: result.email,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to renew onboarding token',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Debug endpoint to check user 2FA status
  @Get('check-2fa-status/:staffId')
  async checkUser2FAStatus(@Param('staffId') staffId: string) {
    return this.authService.checkUser2FAStatus(staffId);
  }
}
