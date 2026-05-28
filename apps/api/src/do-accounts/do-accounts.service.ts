import type { DOAccount } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDOAccountDto } from './dto/create-do-account.dto';
import { DOAccountResponseDto } from './dto/do-account-response.dto';

type SanitizedDOAccountRecord = Pick<DOAccount, 'id' | 'region' | 'validatedAt' | 'createdAt'>;

type ErrorWithResponseStatus = {
  response?: {
    status?: unknown;
  };
};

type ValidationResult = {
  valid: boolean;
  email?: string;
  error?: string;
};

/**
 * Handles DigitalOcean account creation, ownership checks, and token validation.
 */
@Injectable()
export class DOAccountsService {
  private readonly logger = new Logger(DOAccountsService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly doApiService: DoApiService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Connects a DigitalOcean account after validating and encrypting the token.
   */
  public async create(userId: string, dto: CreateDOAccountDto): Promise<DOAccountResponseDto> {
    await this.validateTokenOrThrow(dto.doToken);

    const account = await this.prismaService.dOAccount.create({
      data: {
        userId,
        doToken: this.encryptionService.encrypt(dto.doToken),
        region: dto.region,
        validatedAt: new Date(),
      },
      select: {
        id: true,
        region: true,
        validatedAt: true,
        createdAt: true,
      },
    });

    return this.toResponseDto(account);
  }

  /**
   * Lists all DigitalOcean accounts for the current user.
   */
  public async findAllByUser(userId: string): Promise<DOAccountResponseDto[]> {
    const accounts = await this.prismaService.dOAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        region: true,
        validatedAt: true,
        createdAt: true,
      },
    });

    return accounts.map((account) => this.toResponseDto(account));
  }

  /**
   * Returns one DigitalOcean account if it belongs to the current user.
   */
  public async findOne(id: string, userId: string): Promise<DOAccountResponseDto> {
    const account = await this.prismaService.dOAccount.findFirst({
      where: {
        id,
        userId,
      },
      select: {
        id: true,
        region: true,
        validatedAt: true,
        createdAt: true,
      },
    });

    if (!account) {
      throw Exceptions.notFound('DigitalOcean account not found', ErrorCodes.DO_ACCOUNT_NOT_FOUND);
    }

    return this.toResponseDto(account);
  }

  /**
   * Re-validates a connected DigitalOcean token and refreshes validation timestamp.
   */
  public async validate(id: string, userId: string): Promise<ValidationResult> {
    const account = await this.getAccountOrThrow(id, userId);
    const decryptedToken = this.decryptToken(account.doToken);

    try {
      const validation = await this.doApiService.validateToken(decryptedToken, account.id);
      await this.prismaService.dOAccount.update({
        where: { id: account.id },
        data: {
          validatedAt: new Date(),
        },
      });

      return {
        valid: true,
        email: validation.email,
      };
    } catch (error) {
      return {
        valid: false,
        error: this.resolveDoApiErrorReason(error),
      };
    }
  }

  /**
   * Deletes a DigitalOcean account. Active envs (project + env both not
   * soft-deleted) block the delete with a clean 409. Orphan envs left behind
   * by prior soft-deletes still hold the do_account FK in Postgres, so we
   * hard-delete those first (cascades to deployments, bundles, stacks) — they're
   * invisible to the UI anyway. Any residual FK violation surfaces as 409, not 500.
   */
  public async delete(id: string, userId: string): Promise<void> {
    await this.getAccountOrThrow(id, userId);

    const activeEnvironments = await this.prismaService.environment.findMany({
      where: {
        doAccountId: id,
        deletedAt: null,
        project: {
          userId,
          deletedAt: null,
        },
      },
      select: {
        name: true,
        project: { select: { name: true } },
      },
    });

    if (activeEnvironments.length > 0) {
      const environmentNames = activeEnvironments
        .map((environment) => `${environment.project.name}/${environment.name}`)
        .join(', ');
      throw Exceptions.conflict(
        `DigitalOcean account is in use by environments: ${environmentNames}. Delete those environments first.`,
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    const orphanEnvironments = await this.prismaService.environment.findMany({
      where: {
        doAccountId: id,
        OR: [{ deletedAt: { not: null } }, { project: { deletedAt: { not: null } } }],
      },
      select: { id: true },
    });

    if (orphanEnvironments.length > 0) {
      await this.prismaService.environment.deleteMany({
        where: { id: { in: orphanEnvironments.map((environment) => environment.id) } },
      });
      this.logger.log(
        `Cleaned ${orphanEnvironments.length} orphan environment(s) referencing DO account ${id} before delete`,
      );
    }

    try {
      await this.prismaService.dOAccount.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2014')
      ) {
        throw Exceptions.conflict(
          'DigitalOcean account still has dependent resources. Please remove related environments and try again.',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }
  }

  /**
   * Returns the decrypted token for internal infrastructure operations.
   */
  public async getDecryptedToken(id: string, userId: string): Promise<string> {
    const account = await this.getAccountOrThrow(id, userId);
    return this.decryptToken(account.doToken);
  }

  private toResponseDto(account: SanitizedDOAccountRecord): DOAccountResponseDto {
    return {
      id: account.id,
      region: account.region,
      validatedAt: account.validatedAt ? account.validatedAt.toISOString() : null,
      createdAt: account.createdAt.toISOString(),
    };
  }

  private async getAccountOrThrow(id: string, userId: string): Promise<DOAccount> {
    const account = await this.prismaService.dOAccount.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!account) {
      throw Exceptions.notFound('DigitalOcean account not found', ErrorCodes.DO_ACCOUNT_NOT_FOUND);
    }

    return account;
  }

  private async validateTokenOrThrow(doToken: string): Promise<void> {
    try {
      await this.doApiService.validateToken(doToken);
    } catch (error) {
      if (this.isInvalidOrForbiddenTokenError(error)) {
        throw Exceptions.badRequest(
          'DigitalOcean token is invalid or lacks permissions',
          ErrorCodes.DO_ACCOUNT_INVALID_TOKEN,
        );
      }

      throw Exceptions.internalError(
        'DigitalOcean token validation failed',
        ErrorCodes.DO_ACCOUNT_VALIDATION_FAILED,
      );
    }
  }

  private decryptToken(encryptedToken: string): string {
    try {
      return this.encryptionService.decrypt(encryptedToken);
    } catch {
      throw Exceptions.internalError(
        'Stored DigitalOcean token cannot be decrypted',
        ErrorCodes.DO_ACCOUNT_VALIDATION_FAILED,
      );
    }
  }

  private resolveDoApiErrorReason(error: unknown): string {
    const status = this.resolveDoApiStatus(error);
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      return 'DigitalOcean token is invalid or lacks permissions';
    }

    if (typeof status === 'number') {
      return `DigitalOcean API responded with status ${status}`;
    }

    return 'DigitalOcean API validation failed';
  }

  private isInvalidOrForbiddenTokenError(error: unknown): boolean {
    const status = this.resolveDoApiStatus(error);
    return status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN;
  }

  private resolveDoApiStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const maybeError = error as ErrorWithResponseStatus;
    const status = maybeError.response?.status;
    return typeof status === 'number' ? status : null;
  }
}
