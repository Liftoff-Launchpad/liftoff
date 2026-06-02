import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

/**
 * Request payload for workflow deploy completion callbacks.
 */
export class DeployCompleteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public environmentId!: string;

  @ApiProperty({
    example: 'api',
    description:
      'Name of the Service this image belongs to. Optional for back-compat with ' +
      'single-service envs created before P1.7 — when omitted, the env\'s first ' +
      'Service is assumed.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  public serviceName?: string;

  @ApiProperty({
    example: 'registry.digitalocean.com/liftoff/my-webapp/production:abc1234',
    description:
      'Required for `status=success`. Empty/omitted is allowed when status=failure ' +
      'or status=cancelled — the build never produced an image, so the workflow ' +
      'still calls back so we can mark the deployment FAILED with the run URL.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  // Accepts both legacy 2-segment (`<project>/<env>`) and new 3-segment
  // (`<project>/<env>/<service>`) repositories in the path component.
  // When the matrix step failed, IMAGE_URI is set but empty — the regex
  // would reject an empty string, so we only validate when non-empty.
  @Matches(
    /^(|registry\.digitalocean\.com\/[a-z0-9-]+\/[a-z0-9-]+(\/[a-z0-9-]+)?(\/[a-z0-9-]+)?:[a-f0-9]+)$/i,
    { message: 'imageUri must be empty (on failure) or a fully-qualified DOCR URI' },
  )
  public imageUri?: string;

  @ApiProperty({ example: 'abc1234567890def' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-f0-9]+$/i)
  public commitSha!: string;

  @ApiProperty({ example: 'success', description: 'GitHub Actions job status' })
  @IsString()
  @IsOptional()
  @Matches(/^(success|failure|cancelled)$/i)
  public status?: string;

  @ApiProperty({
    example: 'https://github.com/user/repo/actions/runs/123456789',
    description: 'URL to the GitHub Actions workflow run',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  public runUrl?: string;

  @ApiProperty({
    example: 'dockerfile',
    description: 'Build strategy selected by the workflow. Omitted when the build failed before strategy detection.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^(|dockerfile|nixpacks)$/i, {
    message: 'buildStrategy must be empty or dockerfile/nixpacks',
  })
  public buildStrategy?: string;

  @ApiProperty({
    description: 'Optional compact Nixpacks plan payload as JSON string',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  public buildPlan?: string;

  @ApiProperty({
    description:
      'Optional base64-encoded tail of /tmp/build.log (workflow stdout+stderr). ' +
      'Sent by GitHub Actions on every callback so failures surface the actual build ' +
      'error in the Liftoff UI without the user needing to leave for the Actions tab. ' +
      'Max ~150KB encoded (~96KB plaintext).',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(200000)
  public buildLogsBase64?: string;
}
