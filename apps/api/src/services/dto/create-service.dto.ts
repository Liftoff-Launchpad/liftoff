import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CanvasPositionDto {
  @ApiProperty()
  @IsInt()
  public x!: number;

  @ApiProperty()
  @IsInt()
  public y!: number;
}

/**
 * Request payload for creating a Service under an environment.
 */
export class CreateServiceDto {
  @ApiProperty({ example: 'api', description: 'Service name, unique per environment.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'name must contain lowercase letters, numbers, and hyphens only',
  })
  public name!: string;

  @ApiPropertyOptional({
    enum: ['SERVICE', 'WORKER', 'JOB', 'STATIC_SITE'],
    default: 'SERVICE',
  })
  @IsOptional()
  @IsString()
  @IsIn(['SERVICE', 'WORKER', 'JOB', 'STATIC_SITE'])
  public kind?: 'SERVICE' | 'WORKER' | 'JOB' | 'STATIC_SITE';

  @ApiPropertyOptional({ example: './api', description: 'Path within the repo to build from.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public sourceDir?: string;

  @ApiPropertyOptional({ enum: ['AUTO', 'DOCKERFILE', 'NIXPACKS'], default: 'AUTO' })
  @IsOptional()
  @IsString()
  @IsIn(['AUTO', 'DOCKERFILE', 'NIXPACKS'])
  public buildStrategy?: 'AUTO' | 'DOCKERFILE' | 'NIXPACKS';

  @ApiPropertyOptional({ example: 'Dockerfile' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public dockerfilePath?: string;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  public port?: number;

  @ApiPropertyOptional({ example: 'apps-s-1vcpu-0.5gb' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  public instanceSize?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  public replicas?: number;

  @ApiPropertyOptional({
    example: '/api',
    description: 'HTTP route path served by this service. Omit for internal-only services.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public routePath?: string | null;

  @ApiPropertyOptional({ example: '/health' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public healthcheckPath?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public command?: string | null;

  @ApiPropertyOptional({
    enum: ['cron', 'pre_deploy', 'post_deploy', 'failed_deploy'],
    description:
      'JOB kind only. App Platform natively supports the deploy-lifecycle kinds; "cron" has no native scheduler and runs post-deploy.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['cron', 'pre_deploy', 'post_deploy', 'failed_deploy'])
  public jobKind?: 'cron' | 'pre_deploy' | 'post_deploy' | 'failed_deploy' | null;

  @ApiPropertyOptional({
    example: '0 3 * * *',
    description: 'JOB cron schedule (exported to liftoff.yml; see jobKind note on App Platform support).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  public jobSchedule?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CanvasPositionDto)
  public canvasPosition?: CanvasPositionDto;
}
