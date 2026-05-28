import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request payload for scanning a repo branch for `.env.example` (or `.env.sample`,
 * `.env.template`) so we can pre-populate the onboarding "what env vars does your
 * app need?" step before the first deploy.
 */
export class ScanEnvExampleDto {
  @ApiProperty({ example: 'main' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  public branch!: string;

  @ApiPropertyOptional({
    example: './backend',
    description: 'Folder within the repo to look for the env example file. Defaults to repo root.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public sourceDir?: string;
}

export interface ScanEnvExampleResult {
  /** Path of the file we actually found (e.g. `.env.example` or `backend/.env.template`). */
  foundAt: string | null;
  /** Parsed keys with optional default values + inline comment hints from the file. */
  keys: Array<{
    key: string;
    defaultValue: string | null;
    hint: string | null;
  }>;
}
