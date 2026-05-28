import { HttpStatus } from '@nestjs/common';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDOAccountDto } from './dto/create-do-account.dto';
import { DOAccountsService } from './do-accounts.service';

type DOAccountRecord = {
  id: string;
  userId: string;
  doToken: string;
  region: string;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const now = new Date('2025-01-01T00:00:00.000Z');

const buildDOAccountRecord = (overrides: Partial<DOAccountRecord> = {}): DOAccountRecord => ({
  id: 'do-1',
  userId: 'user-1',
  doToken: 'encrypted-token',
  region: 'nyc3',
  validatedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

/**
 * Unit tests for DOAccountsService.
 */
describe('DOAccountsService', () => {
  let service: DOAccountsService;

  const prismaServiceMock = {
    dOAccount: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    environment: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const doApiServiceMock = {
    validateToken: jest.fn(),
  };

  const encryptionServiceMock = {
    encrypt: jest.fn((_plaintext: string): string => 'encrypted-token'),
    decrypt: jest.fn((_encrypted: string): string => 'dop_v1_real_token'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DOAccountsService(
      prismaServiceMock as unknown as PrismaService,
      doApiServiceMock as unknown as DoApiService,
      encryptionServiceMock as unknown as EncryptionService,
    );
  });

  it('create validates token, encrypts it, and returns sanitized dto', async () => {
    const dto: CreateDOAccountDto = {
      doToken: 'dop_v1_real_token',
      region: 'nyc3',
    };
    doApiServiceMock.validateToken.mockResolvedValue({
      email: 'do@liftoff.dev',
      uuid: 'uuid-1',
      status: 'active',
    });
    prismaServiceMock.dOAccount.create.mockResolvedValue(
      buildDOAccountRecord({
        doToken: 'encrypted-token',
      }),
    );

    const result = await service.create('user-1', dto);

    expect(doApiServiceMock.validateToken).toHaveBeenCalledWith('dop_v1_real_token');
    expect(encryptionServiceMock.encrypt).toHaveBeenCalledWith('dop_v1_real_token');
    expect(prismaServiceMock.dOAccount.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        doToken: 'encrypted-token',
        region: 'nyc3',
        validatedAt: expect.any(Date),
      },
      select: {
        id: true,
        region: true,
        validatedAt: true,
        createdAt: true,
      },
    });
    expect(result).toEqual({
      id: 'do-1',
      region: 'nyc3',
      validatedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
  });

  it('create throws bad request for invalid token status', async () => {
    const dto: CreateDOAccountDto = {
      doToken: 'dop_v1_invalid',
      region: 'nyc3',
    };
    doApiServiceMock.validateToken.mockRejectedValue({
      response: {
        status: HttpStatus.UNAUTHORIZED,
      },
    });

    await expect(service.create('user-1', dto)).rejects.toThrow(
      'DigitalOcean token is invalid or lacks permissions',
    );
  });

  it('validate returns invalid status without throwing when DO API rejects token', async () => {
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue(buildDOAccountRecord());
    doApiServiceMock.validateToken.mockRejectedValue({
      response: {
        status: HttpStatus.UNAUTHORIZED,
      },
    });

    const result = await service.validate('do-1', 'user-1');

    expect(result).toEqual({
      valid: false,
      error: 'DigitalOcean token is invalid or lacks permissions',
    });
    expect(doApiServiceMock.validateToken).toHaveBeenCalledWith('dop_v1_real_token', 'do-1');
    expect(prismaServiceMock.dOAccount.update).not.toHaveBeenCalled();
  });

  it('delete blocks removal when account is used by active environments', async () => {
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue(buildDOAccountRecord());
    prismaServiceMock.environment.findMany.mockResolvedValueOnce([
      { name: 'production', project: { name: 'liftoff' } },
      { name: 'staging', project: { name: 'liftoff' } },
    ]);

    await expect(service.delete('do-1', 'user-1')).rejects.toThrow(
      'DigitalOcean account is in use by environments: liftoff/production, liftoff/staging',
    );
    expect(prismaServiceMock.dOAccount.delete).not.toHaveBeenCalled();
    expect(prismaServiceMock.environment.deleteMany).not.toHaveBeenCalled();
  });

  it('delete cleans orphan environments (soft-deleted project/env) before removing the account', async () => {
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue(buildDOAccountRecord());
    prismaServiceMock.environment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'env-orphan-1' }, { id: 'env-orphan-2' }]);
    prismaServiceMock.environment.deleteMany.mockResolvedValue({ count: 2 });
    prismaServiceMock.dOAccount.delete.mockResolvedValue(buildDOAccountRecord());

    await service.delete('do-1', 'user-1');

    expect(prismaServiceMock.environment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['env-orphan-1', 'env-orphan-2'] } },
    });
    expect(prismaServiceMock.dOAccount.delete).toHaveBeenCalledWith({ where: { id: 'do-1' } });
  });

  it('delete succeeds without cleanup when no environments reference the account', async () => {
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue(buildDOAccountRecord());
    prismaServiceMock.environment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaServiceMock.dOAccount.delete.mockResolvedValue(buildDOAccountRecord());

    await service.delete('do-1', 'user-1');

    expect(prismaServiceMock.environment.deleteMany).not.toHaveBeenCalled();
    expect(prismaServiceMock.dOAccount.delete).toHaveBeenCalledWith({ where: { id: 'do-1' } });
  });

  it('getDecryptedToken returns decrypted token for internal use', async () => {
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue(buildDOAccountRecord());

    const token = await service.getDecryptedToken('do-1', 'user-1');

    expect(token).toBe('dop_v1_real_token');
    expect(encryptionServiceMock.decrypt).toHaveBeenCalledWith('encrypted-token');
  });
});
