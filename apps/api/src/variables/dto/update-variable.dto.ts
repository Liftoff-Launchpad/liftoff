import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request payload for updating an existing variable's value, scope, or kind.
 * Used to "change value" on SECRET variables (no separate rotate endpoint).
 */
export class UpdateVariableDto {
  @ApiPropertyOptional({ description: 'New value. Triggers lastRotatedAt bump.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  public value?: string;

  @ApiPropertyOptional({ enum: ['BUILD', 'RUNTIME', 'BOTH'] })
  @IsOptional()
  @IsString()
  @IsIn(['BUILD', 'RUNTIME', 'BOTH'])
  public scope?: 'BUILD' | 'RUNTIME' | 'BOTH';

  @ApiPropertyOptional({ enum: ['PLAIN', 'SECRET'] })
  @IsOptional()
  @IsString()
  @IsIn(['PLAIN', 'SECRET'])
  public kind?: 'PLAIN' | 'SECRET';
}
