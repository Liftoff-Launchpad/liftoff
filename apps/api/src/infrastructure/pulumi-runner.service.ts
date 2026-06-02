import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PulumiLogLevel,
  PulumiPreviewResult,
  PulumiResourceProgress,
  PulumiRunOptions,
  PulumiRunResult,
  PulumiStackOutputs,
} from './types/pulumi.types';

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  parsePulumiJson?: boolean;
  onLog?: (line: string, level: PulumiLogLevel) => void;
  onResourceProgress?: (progress: PulumiResourceProgress) => void;
  onSummary?: (changes: Record<string, number>) => void;
};

type PulumiDiagnosticEvent = {
  severity?: string;
  message?: string;
};

type PulumiResourceMetadata = {
  op?: string;
  type?: string;
  urn?: string;
};

type PulumiResourcePreEvent = {
  metadata?: PulumiResourceMetadata;
};

type PulumiResourceOutputsEvent = {
  metadata?: PulumiResourceMetadata;
};

type PulumiSummaryEvent = {
  resourceChanges?: Record<string, number>;
};

type PulumiJsonEvent = {
  diagnosticEvent?: PulumiDiagnosticEvent;
  resourcePreEvent?: PulumiResourcePreEvent;
  resOutputsEvent?: PulumiResourceOutputsEvent;
  summaryEvent?: PulumiSummaryEvent;
};

/**
 * Executes Pulumi programs for user infrastructure provisioning in temporary workspaces.
 */
@Injectable()
export class PulumiRunnerService {
  private readonly logger = new Logger(PulumiRunnerService.name);

  public constructor(private readonly configService: ConfigService) {}

  /**
   * Runs `pulumi up` for an environment stack and returns stack outputs.
   */
  public async run(options: PulumiRunOptions): Promise<PulumiRunResult> {
    const tempDir = await this.createTempDir();

    try {
      const stackName = this.resolveSynchronizedStackName(
        options.stackName,
        options.args.projectId,
        options.args.environmentName,
      );
      await this.generatePulumiProgram(options.args, tempDir, stackName);
      const env = this.buildPulumiEnv(options.doToken);

      await this.runCommand({
        command: 'npm',
        args: ['install', '--silent', '--no-audit', '--no-fund'],
        cwd: tempDir,
        env,
      });
      await this.selectStack(tempDir, env, stackName);

      await this.runCommand({
        command: 'pulumi',
        args: ['up', '--stack', stackName, '--yes', '--skip-preview', '--non-interactive', '--json'],
        cwd: tempDir,
        env,
        parsePulumiJson: true,
        onLog: options.onLog,
        onResourceProgress: options.onResourceProgress,
      });

      const outputs = await this.readStackOutputs(tempDir, env, stackName);
      return {
        success: true,
        outputs,
      };
    } catch (error) {
      return {
        success: false,
        outputs: {},
        error: this.resolveErrorMessage(error),
      };
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  /**
   * Runs `pulumi preview` and returns the summary of resource change counts.
   */
  public async preview(options: PulumiRunOptions): Promise<PulumiPreviewResult> {
    const tempDir = await this.createTempDir();
    let changeSummary: Record<string, number> = {};

    try {
      const stackName = this.resolveSynchronizedStackName(
        options.stackName,
        options.args.projectId,
        options.args.environmentName,
      );
      await this.generatePulumiProgram(options.args, tempDir, stackName);
      const env = this.buildPulumiEnv(options.doToken);

      await this.runCommand({
        command: 'npm',
        args: ['install', '--silent', '--no-audit', '--no-fund'],
        cwd: tempDir,
        env,
      });
      await this.selectStack(tempDir, env, stackName);

      await this.runCommand({
        command: 'pulumi',
        args: ['preview', '--stack', stackName, '--non-interactive', '--json'],
        cwd: tempDir,
        env,
        parsePulumiJson: true,
        onLog: options.onLog,
        onResourceProgress: options.onResourceProgress,
        onSummary: (summary) => {
          changeSummary = summary;
        },
      });

      return {
        success: true,
        changeSummary,
      };
    } catch (error) {
      return {
        success: false,
        changeSummary,
        error: this.resolveErrorMessage(error),
      };
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  /**
   * Runs `pulumi destroy` for an environment stack.
   */
  public async destroy(options: PulumiRunOptions): Promise<void> {
    const tempDir = await this.createTempDir();

    try {
      const stackName = this.resolveSynchronizedStackName(
        options.stackName,
        options.args.projectId,
        options.args.environmentName,
      );
      await this.generatePulumiProgram(options.args, tempDir, stackName);
      const env = this.buildPulumiEnv(options.doToken);

      await this.runCommand({
        command: 'npm',
        args: ['install', '--silent', '--no-audit', '--no-fund'],
        cwd: tempDir,
        env,
      });
      await this.selectStack(tempDir, env, stackName);

      await this.runCommand({
        command: 'pulumi',
        args: [
          'destroy',
          '--stack',
          stackName,
          '--yes',
          '--skip-preview',
          '--non-interactive',
          '--json',
        ],
        cwd: tempDir,
        env,
        parsePulumiJson: true,
        onLog: options.onLog,
        onResourceProgress: options.onResourceProgress,
      });
    } catch (error) {
      throw new Error(this.resolveErrorMessage(error));
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  private async createTempDir(): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `liftoff-pulumi-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(`Failed to clean Pulumi temp directory ${tempDir}: ${this.resolveErrorMessage(error)}`);
    }
  }

  private buildPulumiEnv(doToken: string): NodeJS.ProcessEnv {
    const spacesBucket = this.configService.getOrThrow<string>('DO_SPACES_BUCKET');
    const spacesAccessKey = this.configService.getOrThrow<string>('DO_SPACES_ACCESS_KEY');
    const spacesSecretKey = this.configService.getOrThrow<string>('DO_SPACES_SECRET_KEY');
    const spacesEndpoint = this.configService.getOrThrow<string>('DO_SPACES_ENDPOINT');
    const spacesRegion = this.configService.getOrThrow<string>('DO_SPACES_REGION');
    const pulumiPassphrase = this.configService.getOrThrow<string>('PULUMI_PASSPHRASE');
    const normalizedSpacesEndpoint = spacesEndpoint.replace(/\/+$/g, '');
    const spacesBackendUrl = this.buildSpacesBackendUrl(
      spacesBucket,
      normalizedSpacesEndpoint,
      spacesRegion,
    );

    return {
      ...process.env,
      PULUMI_BACKEND_URL: spacesBackendUrl,
      AWS_ACCESS_KEY_ID: spacesAccessKey,
      AWS_SECRET_ACCESS_KEY: spacesSecretKey,
      AWS_ENDPOINT_URL_S3: normalizedSpacesEndpoint,
      AWS_REGION: spacesRegion,
      AWS_S3_FORCE_PATH_STYLE: 'true',
      PULUMI_CONFIG_PASSPHRASE: pulumiPassphrase,
      DIGITALOCEAN_TOKEN: doToken,
      PATH: process.env.PATH ?? '',
    };
  }

  private async selectStack(cwd: string, env: NodeJS.ProcessEnv, stackName: string): Promise<void> {
    await this.runCommand({
      command: 'pulumi',
      args: ['login', env.PULUMI_BACKEND_URL ?? ''],
      cwd,
      env,
    });
    await this.runCommand({
      command: 'pulumi',
      args: ['stack', 'select', stackName, '--create'],
      cwd,
      env,
    });
  }

  private async readStackOutputs(
    cwd: string,
    env: NodeJS.ProcessEnv,
    stackName: string,
  ): Promise<Partial<PulumiStackOutputs>> {
    const result = await this.runCommand({
      command: 'pulumi',
      args: ['stack', 'output', '--stack', stackName, '--json'],
      cwd,
      env,
    });

    const raw = result.stdout.trim();
    if (!raw) {
      return {};
    }

    const parsed = this.parseJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Pulumi stack output returned non-JSON content');
    }

    const output = parsed as Record<string, unknown>;
    return {
      appUrl: this.toStringOutput(output.appUrl),
      appId: this.toStringOutput(output.appId),
      repositoryUrl: this.toStringOutput(output.repositoryUrl),
      dbClusterName: this.toStringOutput(output.dbClusterName),
      dbUri: this.toStringOutput(output.dbUri),
      bucketName: this.toStringOutput(output.bucketName),
      bucketEndpoint: this.toStringOutput(output.bucketEndpoint),
    };
  }

  private toStringOutput(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value && typeof value === 'object') {
      const objectValue = value as { value?: unknown };
      if (typeof objectValue.value === 'string') {
        return objectValue.value;
      }
    }
    return undefined;
  }

  private async generatePulumiProgram(
    args: PulumiRunOptions['args'],
    tempDir: string,
    stackName: string,
  ): Promise<void> {
    const stackProjectName = this.extractProjectNameFromStackName(stackName);
    if (stackProjectName !== args.projectId) {
      throw new Error(
        `Stack project "${stackProjectName}" must match projectId "${args.projectId}"`,
      );
    }

    const stackModulePath = this.resolveStackModulePath();
    const { doToken: _unusedDoToken, ...argsWithoutToken } = args;

    const packageJson = {
      name: 'liftoff-user-infra',
      private: true,
      dependencies: {
        '@pulumi/digitalocean': '^4',
        '@pulumi/pulumi': '^3',
      },
      devDependencies: {
        typescript: '^5.6.3',
      },
    };

    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['index.ts'],
    };

    const pulumiYaml = `name: ${stackProjectName}\nruntime: nodejs\n`;
    const indexTs = `import { createAppPlatformStack, type AppPlatformStackArgs } from ${JSON.stringify(
      stackModulePath,
    )};

const baseArgs = ${JSON.stringify(argsWithoutToken, null, 2)} as Omit<AppPlatformStackArgs, 'doToken'>;
const doToken = process.env.DIGITALOCEAN_TOKEN;

if (!doToken) {
  throw new Error('DIGITALOCEAN_TOKEN is required');
}

const stackArgs: AppPlatformStackArgs = {
  ...baseArgs,
  doToken,
};

const outputs = createAppPlatformStack(stackArgs);

export const appUrl = outputs.appUrl;
export const appId = outputs.appId;
export const repositoryUrl = outputs.repositoryUrl;
export const dbClusterName = outputs.dbClusterName;
export const dbUri = outputs.dbUri;
export const bucketName = outputs.bucketName;
export const bucketEndpoint = outputs.bucketEndpoint;
`;

    await Promise.all([
      writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8'),
      writeFile(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf8'),
      writeFile(path.join(tempDir, 'Pulumi.yaml'), pulumiYaml, 'utf8'),
      writeFile(path.join(tempDir, 'index.ts'), indexTs, 'utf8'),
    ]);
  }

  private resolveStackModulePath(): string {
    let current = process.cwd();

    for (let index = 0; index < 8; index += 1) {
      const candidateFile = path.join(
        current,
        'packages',
        'pulumi-components',
        'src',
        'stacks',
        'app-platform-stack.ts',
      );
      if (existsSync(candidateFile)) {
        const withoutExtension = candidateFile.replace(/\.ts$/, '');
        return withoutExtension.split(path.sep).join(path.posix.sep);
      }

      const next = path.dirname(current);
      if (next === current) {
        break;
      }
      current = next;
    }

    throw new Error('Unable to resolve packages/pulumi-components/src/stacks/app-platform-stack.ts');
  }

  private buildSpacesBackendUrl(bucket: string, endpoint: string, region: string): string {
    return `s3://${bucket}?endpoint=${endpoint}&region=${region}`;
  }

  private resolveSynchronizedStackName(
    stackName: string,
    projectId: string,
    environmentName: string,
  ): string {
    const expectedStackName = this.buildStackName(projectId, environmentName);
    if (stackName !== expectedStackName) {
      this.logger.warn(
        `Stack name "${stackName}" does not match expected "${expectedStackName}". Using expected stack name.`,
      );
    }

    return expectedStackName;
  }

  private buildStackName(projectId: string, environmentName: string): string {
    return `organization/${projectId}/${environmentName}`;
  }

  private extractProjectNameFromStackName(stackName: string): string {
    const segments = stackName.split('/');
    if (segments.length !== 3 || segments[0] !== 'organization') {
      throw new Error(
        `Stack name "${stackName}" must follow organization/<project-id>/<environment-name>`,
      );
    }

    const projectName = segments[1];
    if (!projectName) {
      throw new Error(`Stack name "${stackName}" must include a non-empty project-id segment`);
    }

    return projectName;
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private async runCommand(options: CommandRunOptions): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const childProcess = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const recentOutputLines: string[] = [];

      const appendRecentLine = (line: string): void => {
        recentOutputLines.push(line);
        if (recentOutputLines.length > 30) {
          recentOutputLines.shift();
        }
      };

      const handleStdoutLine = (line: string): void => {
        stdout = stdout.length > 0 ? `${stdout}\n${line}` : line;
        appendRecentLine(line);

        if (!options.parsePulumiJson) {
          options.onLog?.(line, 'info');
          return;
        }

        const event = this.parseJson(line);
        if (!event || typeof event !== 'object') {
          options.onLog?.(line, 'info');
          return;
        }

        this.handlePulumiEvent(event as PulumiJsonEvent, options);
      };

      const handleStderrLine = (line: string): void => {
        stderr = stderr.length > 0 ? `${stderr}\n${line}` : line;
        appendRecentLine(line);
        options.onLog?.(line, 'error');
      };

      if (childProcess.stdout) {
        const stdoutReader = readline.createInterface({ input: childProcess.stdout });
        stdoutReader.on('line', handleStdoutLine);
      }

      if (childProcess.stderr) {
        const stderrReader = readline.createInterface({ input: childProcess.stderr });
        stderrReader.on('line', handleStderrLine);
      }

      childProcess.on('error', (error) => {
        reject(error);
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(new Error(this.buildExitErrorSummary(recentOutputLines, options, code)));
      });
    });
  }

  /**
   * Builds a human-readable error summary from the tail of a failed command's
   * output. When the command streams Pulumi `--json` events, the raw lines are
   * JSON blobs (`{"sequence":12,...,"diagnosticEvent":{...}}`) — dumping those
   * verbatim into `Deployment.errorMessage` is what made failures unreadable.
   * Here we parse the event tail and surface the actual diagnostic messages,
   * preferring error/fatal severity. Non-JSON lines (plain stderr) are kept
   * as-is; we fall back to a generic exit-code message when nothing usable
   * was captured.
   */
  private buildExitErrorSummary(
    recentLines: string[],
    options: CommandRunOptions,
    code: number | null,
  ): string {
    const genericFallback = `Command "${options.command}" exited with code ${code ?? -1}`;
    if (recentLines.length === 0) {
      return genericFallback;
    }

    if (!options.parsePulumiJson) {
      return recentLines.join('\n');
    }

    const diagnostics: { severity: string; message: string }[] = [];
    const plainLines: string[] = [];
    for (const line of recentLines) {
      const parsed = this.parseJson(line);
      if (parsed && typeof parsed === 'object') {
        const event = parsed as PulumiJsonEvent;
        const message = event.diagnosticEvent?.message?.trim();
        if (message) {
          diagnostics.push({
            severity: (event.diagnosticEvent?.severity ?? 'info').toLowerCase(),
            message,
          });
        }
        // Non-diagnostic events (resource/summary) carry no user-facing text — skip.
        continue;
      }
      // Not JSON -> plain stderr text worth keeping.
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        plainLines.push(trimmed);
      }
    }

    const errors = diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal');
    const chosen = errors.length > 0 ? errors : diagnostics;
    if (chosen.length > 0) {
      // Newest-last tail, like a normal log; a few lines give context.
      return chosen
        .slice(-3)
        .map((d) => d.message)
        .join('\n');
    }

    if (plainLines.length > 0) {
      return plainLines.slice(-3).join('\n');
    }

    return genericFallback;
  }

  private handlePulumiEvent(event: PulumiJsonEvent, options: CommandRunOptions): void {
    if (event.diagnosticEvent?.message) {
      options.onLog?.(
        event.diagnosticEvent.message.trimEnd(),
        this.toLogLevel(event.diagnosticEvent.severity),
      );
    }

    const preMetadata = event.resourcePreEvent?.metadata;
    if (preMetadata?.type && preMetadata.urn) {
      options.onResourceProgress?.({
        resourceType: preMetadata.type,
        resourceName: this.extractResourceName(preMetadata.urn),
        action: preMetadata.op ?? 'update',
        status: 'started',
      });
    }

    const outputMetadata = event.resOutputsEvent?.metadata;
    if (outputMetadata?.type && outputMetadata.urn) {
      options.onResourceProgress?.({
        resourceType: outputMetadata.type,
        resourceName: this.extractResourceName(outputMetadata.urn),
        action: outputMetadata.op ?? 'update',
        status: 'completed',
      });
    }

    if (event.summaryEvent?.resourceChanges) {
      options.onSummary?.(event.summaryEvent.resourceChanges);
    }
  }

  private extractResourceName(urn: string): string {
    const segments = urn.split('::');
    return segments[segments.length - 1] ?? urn;
  }

  private toLogLevel(severity: string | undefined): PulumiLogLevel {
    if (severity === 'warning') {
      return 'warn';
    }
    if (severity === 'error') {
      return 'error';
    }
    return 'info';
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return this.sanitizeErrorMessage(error.message);
    }
    return 'Pulumi command execution failed';
  }

  private sanitizeErrorMessage(message: string): string {
    const withoutDoToken = message.replace(/dop_v1_[A-Za-z0-9]+/g, '[REDACTED_DO_TOKEN]');
    const withoutBearer = withoutDoToken.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    return withoutBearer.length > 2000 ? withoutBearer.slice(0, 2000) : withoutBearer;
  }
}
