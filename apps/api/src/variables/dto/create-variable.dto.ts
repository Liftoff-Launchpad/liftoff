import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Request payload for creating a single env-scoped or service-scoped variable.
 */
export class CreateVariableDto {
  @ApiProperty({
    example: 'OPENAI_API_KEY',
    description: 'POSIX env var name (uppercase, underscores, digits; must not start with a digit).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Z_][A-Z0-9_]*$/, {
    message: 'key must match ^[A-Z_][A-Z0-9_]*$ (uppercase letters, digits, underscores)',
  })
  public key!: string;

  @ApiProperty({ example: 'sk-proj-abc123', description: 'Raw value. Encrypted at rest with AES-256-GCM.' })
  @IsString()
  @MaxLength(20000)
  public value!: string;

  @ApiPropertyOptional({ enum: ['BUILD', 'RUNTIME', 'BOTH'], default: 'RUNTIME' })
  @IsOptional()
  @IsString()
  @IsIn(['BUILD', 'RUNTIME', 'BOTH'])
  public scope?: 'BUILD' | 'RUNTIME' | 'BOTH';

  @ApiPropertyOptional({
    enum: ['PLAIN', 'SECRET'],
    default: 'PLAIN',
    description:
      'SECRET kind is write-only after creation (UI shows ••••). PLAIN kind is readable via API.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['PLAIN', 'SECRET'])
  public kind?: 'PLAIN' | 'SECRET';
}
