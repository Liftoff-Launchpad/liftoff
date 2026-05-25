import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AutoSetupDto } from './auto-setup.dto';

describe('AutoSetupDto', () => {
  it('allows payload without optional doAccountId and environmentId', async () => {
    const dto = plainToInstance(AutoSetupDto, {
      githubRepoId: 42,
      fullName: 'liftoff/my-app',
      branch: 'main',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('allows payload with optional doAccountId and environmentId', async () => {
    const dto = plainToInstance(AutoSetupDto, {
      githubRepoId: 42,
      fullName: 'liftoff/my-app',
      branch: 'main',
      doAccountId: 'do-1',
      environmentId: 'env-1',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
