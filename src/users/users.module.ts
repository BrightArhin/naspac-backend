import { HttpException, HttpStatus, Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from 'prisma/prisma.service';
import { MulterModule } from '@nestjs/platform-express';
import { HttpModule, HttpService } from '@nestjs/axios';
import { LocalStorageService } from 'src/documents/local-storage.service';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    HttpModule,
    NotificationsModule,
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 2, // Signature upload sends two images; letter upload sends one PDF
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(new HttpException('Only PDF files are allowed', HttpStatus.BAD_REQUEST), false);
        }
      },
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, PrismaService, LocalStorageService],
  exports: [UsersService, HttpModule],
})
export class UsersModule {}
