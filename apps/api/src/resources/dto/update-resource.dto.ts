import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CanvasPositionDto } from './create-resource.dto';

/**
 * Request payload for updating a graph Resource node. All fields optional.
 */
export class UpdateResourceDto {
  @ApiPropertyOptional({ example: 'main-db' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'name must contain lowercase letters, numbers, and hyphens only',
  })
  public name?: string;

  @ApiPropertyOptional({ description: 'Kind-specific config (e.g. { version, size }).' })
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
