import { parseLiftoffConfig } from '@liftoff/shared';

/**
 * Unit tests for LiftoffConfigSchema build settings.
 */
describe('LiftoffConfigSchema build settings', () => {
  it('applies backward-compatible build defaults', () => {
    const config = parseLiftoffConfig({
      version: '1.0',
      service: {
        name: 'my-app',
        type: 'app',
      },
      runtime: {
        port: 3000,
      },
    });

    expect(config.build.strategy).toBe('auto');
    expect(config.build.dockerfile_path).toBe('Dockerfile');
    expect(config.build.context).toBe('.');
  });

  it('parses custom build strategy, dockerfile_path and context', () => {
    const config = parseLiftoffConfig({
      version: '1.0',
      service: {
        name: 'my-app',
        type: 'app',
      },
      runtime: {
        port: 3000,
      },
      build: {
        strategy: 'dockerfile',
        dockerfile_path: './deploy/Dockerfile',
        context: './apps/web',
      },
    });

    expect(config.build.strategy).toBe('dockerfile');
    expect(config.build.dockerfile_path).toBe('./deploy/Dockerfile');
    expect(config.build.context).toBe('./apps/web');
  });

  it('supports nixpacks strategy for Dockerfile fallback workflows', () => {
    const config = parseLiftoffConfig({
      version: '1.0',
      service: {
        name: 'my-app',
        type: 'app',
      },
      runtime: {
        port: 3000,
      },
      build: {
        strategy: 'nixpacks',
      },
    });

    expect(config.build.strategy).toBe('nixpacks');
    expect(config.build.dockerfile_path).toBe('Dockerfile');
    expect(config.build.context).toBe('.');
  });
});
