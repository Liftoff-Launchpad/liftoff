import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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

export const RESOURCE_KINDS = ['POSTGRES', 'REDIS', 'SPACES_BUCKET'] as const;
export type ResourceKindLiteral = (typeof RESOURCE_KINDS)[number];

/**
 * Request payload for creating a graph Resource node under an environment.
 * Created in DRAFT status; provisioned on apply (Phase B+).
 */
export class CreateResourceDto {
  @ApiProperty({ enum: RESOURCE_KINDS, example: 'POSTGRES' })
  @IsString()
  @IsIn(RESOURCE_KINDS)
  public kind!: ResourceKindLiteral;

  @ApiPropertyOptional({
    example: 'main-db',
    description:
      'Unique name within the env. Defaults to a kind-based name (main-db / cache / main-bucket) when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'name must contain lowercase letters, numbers, and hyphens only',
  })
  public name?: string;

  @ApiPropertyOptional({
    description: 'Kind-specific config (e.g. { version, size }). Validated per-kind in Phase C.',
  })
  @IsOptional()
  @IsObject()
  public config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CanvasPositionDto)
  public canvasPosition?: CanvasPositionDto;
}
