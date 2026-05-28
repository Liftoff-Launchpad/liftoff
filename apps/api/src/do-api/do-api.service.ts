import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

interface DigitalOceanAccountResponse {
  account: {
    email: string;
    uuid: string;
    status: string;
  };
}

interface DigitalOceanDeploymentResponse {
  deployment: DODepployment;
}

interface DigitalOceanRegistryResponse {
  registry: {
    name: string;
  };
}

export interface DODepployment {
  id: string;
  phase: string;
  created_at: string;
  updated_at: string;
  progress?: {
    success_steps: number;
    total_steps: number;
  };
}

export interface DOApp {
  id: string;
  live_url?: string;
  active_deployment?: {
    id: string;
    phase: string;
  };
  spec: Record<string, unknown>;
}

interface DigitalOceanAppResponse {
  app: DOApp;
}

interface DigitalOceanCreateDeploymentResponse {
  deployment: {
    id: string;
  };
}

type ErrorWithResponseStatus = {
  response?: {
    status?: unknown;
  };
};

/**
 * DigitalOcean API client wrapper for common platform operations.
 */
@Injectable()
export class DoApiService {
  private static readonly BASE_URL = 'https://api.digitalocean.com';
  private static readonly REGISTRY_CREATE_ATTEMPTS = 5;
  private static readonly REGISTRY_SUBSCRIPTION_TIER = 'starter';

  public constructor(
    private readonly httpService: HttpService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validates a user or platform DigitalOcean token against /v2/account.
   */
  public async validateToken(
    doToken: string,
    doAccountId?: string,
  ): Promise<{ email: string; uuid: string; status: string }> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.get<DigitalOceanAccountResponse>(`${DoApiService.BASE_URL}/v2/account`, {
          headers: this.getHeaders(doToken),
        }),
      ),
      doAccountId,
    );

    return {
      email: data.account.email,
      uuid: data.account.uuid,
      status: data.account.status,
    };
  }

  /**
   * Fetches one App Platform app with its current spec and deployment metadata.
   */
  public async getApp(doToken: string, appId: string, doAccountId?: string): Promise<DOApp> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.get<DigitalOceanAppResponse>(`${DoApiService.BASE_URL}/v2/apps/${appId}`, {
          headers: this.getHeaders(doToken),
        }),
      ),
      doAccountId,
    );

    return data.app;
  }

  /**
   * Updates an App Platform app spec, which triggers a new deployment.
   */
  public async updateApp(
    doToken: string,
    appId: string,
    appSpec: Record<string, unknown>,
    doAccountId?: string,
  ): Promise<void> {
    await this.executeRequest(
      firstValueFrom(
        this.httpService.put(
          `${DoApiService.BASE_URL}/v2/apps/${appId}`,
          { spec: appSpec },
          {
            headers: this.getHeaders(doToken),
          },
        ),
      ),
      doAccountId,
    );
  }

  /**
   * Creates a force deployment for the target app and returns the deployment ID.
   */
  public async createDeployment(
    doToken: string,
    appId: string,
    doAccountId?: string,
  ): Promise<string> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.post<DigitalOceanCreateDeploymentResponse>(
          `${DoApiService.BASE_URL}/v2/apps/${appId}/deployments`,
          {},
          {
            headers: this.getHeaders(doToken),
          },
        ),
      ),
      doAccountId,
    );

    return data.deployment.id;
  }

  /**
   * Returns one app deployment object.
   */
  public async getDeployment(
    doToken: string,
    appId: string,
    deploymentId: string,
    doAccountId?: string,
  ): Promise<DODepployment> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.get<DigitalOceanDeploymentResponse>(
          `${DoApiService.BASE_URL}/v2/apps/${appId}/deployments/${deploymentId}`,
          {
            headers: this.getHeaders(doToken),
          },
        ),
      ),
      doAccountId,
    );

    return data.deployment;
  }

  /**
   * Returns deployment run logs as serialized text.
   */
  public async getDeploymentLogs(
    doToken: string,
    appId: string,
    deploymentId: string,
    doAccountId?: string,
  ): Promise<string> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.get<unknown>(
          `${DoApiService.BASE_URL}/v2/apps/${appId}/deployments/${deploymentId}/logs`,
          {
            headers: this.getHeaders(doToken),
            params: { type: 'RUN' },
          },
        ),
      ),
      doAccountId,
    );

    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /**
   * Polls deployment status until ACTIVE, ERROR-like phase, or timeout.
   */
  public async waitForDeployment(
    doToken: string,
    appId: string,
    deploymentId: string,
    timeoutMs: number,
    doAccountId?: string,
  ): Promise<'ACTIVE' | 'ERROR' | 'TIMEOUT'> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const deployment = await this.getDeployment(doToken, appId, deploymentId, doAccountId);
      const phase = deployment.phase.toUpperCase();

      if (phase === 'ACTIVE') {
        return 'ACTIVE';
      }

      if (phase === 'ERROR' || phase === 'CANCELED' || phase === 'FAILED') {
        return 'ERROR';
      }

      await this.delay(10_000);
    }

    return 'TIMEOUT';
  }

  /**
   * Fetches App Platform deployment status.
   */
  public async getAppDeploymentStatus(
    doToken: string,
    appId: string,
    deploymentId: string,
    doAccountId?: string,
  ): Promise<string> {
    const deployment = await this.getDeployment(doToken, appId, deploymentId, doAccountId);
    return deployment.phase;
  }

  /**
   * Fetches raw App Platform deployment logs as serialized text.
   */
  public async getAppLogs(
    doToken: string,
    appId: string,
    deploymentId: string,
    doAccountId?: string,
  ): Promise<string> {
    const { data } = await this.executeRequest(
      firstValueFrom(
        this.httpService.get<unknown>(
          `${DoApiService.BASE_URL}/v2/apps/${appId}/deployments/${deploymentId}/logs`,
          {
            headers: this.getHeaders(doToken),
          },
        ),
      ),
      doAccountId,
    );

    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /**
   * Fetches app runtime logs (live application logs, not deployment logs).
   *
   * When `componentName` is given, DO scopes the log feed to that App spec
   * component (one `services[]` entry) via the `component_name` query param
   * on the app-wide logs endpoint. Returns [] on 404 — that's what DO returns
   * when the component name doesn't match anything in the current App spec,
   * which happens when:
   *   - the env has been re-provisioned with a different component name
   *   - the service was added in the DB but not yet deployed
   *   - logs for that type haven't started rolling yet
   * Either way, [] is the right user-facing answer; no need to spam the logger.
   */
  public async getAppRuntimeLogs(
    doToken: string,
    appId: string,
    logType: 'BUILD' | 'DEPLOY' | 'RUN' | 'RUN_RESTARTED' = 'RUN',
    doAccountId?: string,
    componentName?: string,
  ): Promise<string[]> {
    try {
      const { data } = await this.executeRequest(
        firstValueFrom(
          this.httpService.get<unknown>(`${DoApiService.BASE_URL}/v2/apps/${appId}/logs`, {
            headers: this.getHeaders(doToken),
            params: {
              type: logType,
              ...(componentName ? { component_name: componentName } : {}),
            },
          }),
        ),
        doAccountId,
      );

      if (typeof data === 'string') {
        return data.split('\n').filter((line) => line.length > 0);
      }

      if (Array.isArray(data)) {
        return data.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
      }

      return [JSON.stringify(data)];
    } catch (error) {
      // 404 = no logs / unknown component / no live tail. Stay quiet so the
      // 5s poll loop in `getLiveAppLogs` doesn't flood the logger.
      if (this.resolveStatus(error) !== 404) {
        this.logger.warn(`Failed to fetch app runtime logs: ${this.resolveErrorMessage(error)}`);
      }
      return [];
    }
  }

  /**
   * Polls app runtime logs with optional follow mode (returns only new lines).
   * `componentName` scopes the feed to a single App spec component.
   */
  public async *getLiveAppLogs(
    doToken: string,
    appId: string,
    logType: 'BUILD' | 'DEPLOY' | 'RUN' | 'RUN_RESTARTED' = 'RUN',
    pollIntervalMs: number = 5000,
    doAccountId?: string,
    componentName?: string,
  ): AsyncGenerator<string> {
    let lastLogCount = 0;

    while (true) {
      try {
        const logs = await this.getAppRuntimeLogs(
          doToken,
          appId,
          logType,
          doAccountId,
          componentName,
        );
        const newLogs = logs.slice(lastLogCount);

        for (const line of newLogs) {
          yield line;
        }

        lastLogCount = logs.length;
      } catch (error) {
        this.logger.debug(`Live log poll failed, retrying in ${pollIntervalMs}ms`);
      }

      await this.delay(pollIntervalMs);
    }
  }

  /**
   * Fetches app metrics from DO monitoring API.
   */
  public async getAppMetrics(
    doToken: string,
    appId: string,
    metricType: 'cpu_percentage' | 'memory_percentage' | 'network_bandwidth',
    doAccountId?: string,
  ): Promise<Array<{ timestamp: number; value: number }>> {
    try {
      const { data } = await this.executeRequest(
        firstValueFrom(
          this.httpService.get<unknown>(
            `${DoApiService.BASE_URL}/v2/monitoring/metrics/apps/${metricType}`,
            {
              headers: this.getHeaders(doToken),
              params: { app_id: appId },
            },
          ),
        ),
        doAccountId,
      );

      return this.parseMetricsData(data);
    } catch (error) {
      this.logger.warn(`Failed to fetch app metrics: ${this.resolveErrorMessage(error)}`);
      return [];
    }
  }

  private parseMetricsData(data: unknown): Array<{ timestamp: number; value: number }> {
    if (!data || typeof data !== 'object') {
      return [];
    }

    const record = data as Record<string, unknown>;
    if (!record.data || typeof record.data !== 'object') {
      return [];
    }

    const dataRecord = record.data as Record<string, unknown>;
    if (!Array.isArray(dataRecord.result)) {
      return [];
    }

    const results: Array<{ timestamp: number; value: number }> = [];

    for (const item of dataRecord.result) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const itemRecord = item as Record<string, unknown>;
      if (!Array.isArray(itemRecord.values)) {
        continue;
      }

      for (const [timestamp, value] of itemRecord.values as Array<[unknown, unknown]>) {
        if (typeof timestamp === 'string' && typeof value === 'string') {
          const ts = parseInt(timestamp, 10);
          const val = parseFloat(value);
          if (!isNaN(ts) && !isNaN(val)) {
            results.push({ timestamp: ts * 1000, value: val });
          }
        }
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  private logger: { warn: (msg: string) => void; debug: (msg: string) => void } = new Logger(
    DoApiService.name,
  ) as any;

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Downloads an object from DO Spaces (S3-compatible API).
   */
  public async getSpacesObject(bucket: string, key: string): Promise<Buffer> {
    const endpoint = this.configService.getOrThrow<string>('DO_SPACES_ENDPOINT');
    const accessKey = this.configService.getOrThrow<string>('DO_SPACES_ACCESS_KEY');
    const secretKey = this.configService.getOrThrow<string>('DO_SPACES_SECRET_KEY');
    const region = this.configService.getOrThrow<string>('DO_SPACES_REGION');

    const url = `${endpoint}/${bucket}/${key}`;

    const { data } = await firstValueFrom(
      this.httpService.get<Buffer>(url, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `AWS ${accessKey}:${secretKey}`,
        },
      }),
    );

    return Buffer.from(data);
  }

  /**
   * Returns the user's container registry name, creating one on demand when missing.
   */
  public async getOrCreateContainerRegistryName(
    doToken: string,
    doAccountId?: string,
  ): Promise<string> {
    try {
      const { data } = await this.executeRequest(
        firstValueFrom(
          this.httpService.get<DigitalOceanRegistryResponse>(
            `${DoApiService.BASE_URL}/v2/registry`,
            {
              headers: this.getHeaders(doToken),
            },
          ),
        ),
        doAccountId,
      );

      return data.registry.name;
    } catch (error) {
      if (this.resolveStatus(error) !== 404) {
        throw error;
      }
    }

    return this.createContainerRegistry(doToken, doAccountId);
  }

  private async executeRequest<T>(request: Promise<T>, doAccountId?: string): Promise<T> {
    try {
      return await request;
    } catch (error) {
      if (doAccountId && this.resolveStatus(error) === 401) {
        await this.invalidateAccount(doAccountId);
      }

      throw error;
    }
  }

  private async invalidateAccount(doAccountId: string): Promise<void> {
    await this.prismaService.dOAccount.updateMany({
      where: {
        id: doAccountId,
      },
      data: {
        validatedAt: null,
      },
    });
  }

  private async createContainerRegistry(doToken: string, doAccountId?: string): Promise<string> {
    for (let attempt = 1; attempt <= DoApiService.REGISTRY_CREATE_ATTEMPTS; attempt += 1) {
      const candidateName = this.generateRegistryName();

      try {
        const { data } = await this.executeRequest(
          firstValueFrom(
            this.httpService.post<DigitalOceanRegistryResponse>(
              `${DoApiService.BASE_URL}/v2/registry`,
              {
                name: candidateName,
                subscription_tier_slug: DoApiService.REGISTRY_SUBSCRIPTION_TIER,
              },
              {
                headers: this.getHeaders(doToken),
              },
            ),
          ),
          doAccountId,
        );

        return data.registry.name;
      } catch (error) {
        const statusCode = this.resolveStatus(error);
        const isLastAttempt = attempt === DoApiService.REGISTRY_CREATE_ATTEMPTS;

        if (statusCode === 422 && !isLastAttempt) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to create a container registry');
  }

  private generateRegistryName(): string {
    return `liftoff-${randomBytes(5).toString('hex')}`;
  }

  private resolveStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const maybeError = error as ErrorWithResponseStatus;
    const status = maybeError.response?.status;
    return typeof status === 'number' ? status : null;
  }

  private getHeaders(doToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${doToken}`,
    };
  }
}
