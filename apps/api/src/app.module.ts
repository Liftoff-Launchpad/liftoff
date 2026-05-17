import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { LiftoffThrottlerGuard } from './common/guards/throttler.guard';
import { DeploymentsModule } from './deployments/deployments.module';
import { DOAccountsModule } from './do-accounts/do-accounts.module';
import { DoApiModule } from './do-api/do-api.module';
import { EnvironmentsModule } from './environments/environments.module';
import { EventsModule } from './events/events.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { QueuesModule } from './queues/queues.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { UploadModule } from './upload/upload.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { CanvasModule } from './canvas/canvas.module';

/**
 * Root application module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(4000),
        FRONTEND_URL: Joi.string().uri().required(),
        WEBHOOK_BASE_URL: Joi.string().uri().required(),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().required(),
        JWT_REFRESH_EXPIRES_IN: Joi.string().required(),
        GITHUB_CLIENT_ID: Joi.string().required(),
        GITHUB_CLIENT_SECRET: Joi.string().required(),
        GITHUB_CALLBACK_URL: Joi.string().uri().required(),
        GITHUB_WEBHOOK_SECRET: Joi.string().required(),
        DO_API_TOKEN: Joi.string().required(),
        DO_SPACES_ACCESS_KEY: Joi.string().required(),
        DO_SPACES_SECRET_KEY: Joi.string().required(),
        DO_SPACES_BUCKET: Joi.string().required(),
        DO_SPACES_ENDPOINT: Joi.string().uri().required(),
        DO_SPACES_REGION: Joi.string().required(),
        PULUMI_PASSPHRASE: Joi.string().required(),
        ENCRYPTION_KEY: Joi.string().length(64).required(),
        THROTTLE_TTL: Joi.number().default(60000),
        THROTTLE_LIMIT: Joi.number().default(100),
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('THROTTLE_TTL', 60000),
          limit: configService.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    DoApiModule,
    QueuesModule,
    EventsModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    EnvironmentsModule,
    RepositoriesModule,
    DeploymentsModule,
    DOAccountsModule,
    InfrastructureModule,
    MonitoringModule,
    WebhooksModule,
    UploadModule,
    PipelineModule,
    CanvasModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: LiftoffThrottlerGuard },
  ],
})
export class AppModule {}
