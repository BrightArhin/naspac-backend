import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [
    // Single Redis source: REDIS_URL takes priority, falls back to host/port
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (url) {
          return { redis: url };
        }
        return {
          redis: {
            host: configService.get<string>('REDIS_HOST') || '127.0.0.1',
            port: configService.get<number>('REDIS_PORT') || 6379,
          },
        };
      },
      inject: [ConfigService],
      imports: [ConfigModule],
    }),
    BullModule.registerQueue({ name: 'email' }),
  ],
  providers: [NotificationsService, EmailProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
