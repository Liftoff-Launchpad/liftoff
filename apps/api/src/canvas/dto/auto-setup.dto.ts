import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class AutoSetupDto {
  @IsInt()
  @Min(1)
  githubRepoId!: number;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  branch!: string;

  @IsString()
  @IsNotEmpty()
  doAccountId!: string;

  @IsString()
  @IsOptional()
  environmentId?: string;
}
