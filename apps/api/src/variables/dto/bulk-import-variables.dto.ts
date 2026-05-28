import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request payload for the "raw editor" — paste a .env-style blob and have the API
 * parse + upsert each `KEY=value` line as a variable. Lines starting with `#` and
 * blank lines are ignored. Quoted values (`KEY="hello world"`) are unwrapped.
 */
export class BulkImportVariablesDto {
  @ApiProperty({
    example: 'NODE_ENV=production\nOPENAI_API_KEY=sk-proj-abc123\n# Optional\nDEBUG=false',
    description: 'Raw .env-formatted text. Comments (#) and blank lines are skipped.',
  })
  @IsString()
  @MaxLength(100000)
  public envFileContent!: string;

  @ApiPropertyOptional({
    enum: ['BUILD', 'RUNTIME', 'BOTH'],
    default: 'RUNTIME',
    description: 'Scope applied to every imported variable.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['BUILD', 'RUNTIME', 'BOTH'])
  public defaultScope?: 'BUILD' | 'RUNTIME' | 'BOTH';

  @ApiPropertyOptional({
    default: false,
    description: 'If true, all imported values are stored as SECRET (write-only after).',
  })
  @IsOptional()
  @IsBoolean()
  public markAllAsSecret?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, overwrite existing variables with the same key. If false, keys that already ' +
      'exist are skipped and reported in the response.',
  })
  @IsOptional()
  @IsBoolean()
  public overwriteExisting?: boolean;
}
