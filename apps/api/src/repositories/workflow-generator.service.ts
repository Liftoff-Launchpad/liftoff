import { Injectable } from '@nestjs/common';
import { LIFTOFF_DEPLOY_SECRET_NAME } from '@liftoff/shared';
import { DoApiService } from '../do-api/do-api.service';

/**
 * Build spec for one Service participating in the env's GitHub Actions workflow.
 * Becomes one entry in the workflow's `strategy.matrix` so all services build in
 * parallel and each reports back to /webhooks/deploy-complete with its own name.
 */
export interface ServiceBuildSpec {
  /** Service.name — used as both matrix key and `serviceName` in deploy-complete. */
  name: string;
  /** Path within the repo to build from. */
  context: string;
  /** Dockerfile path, relative to context. Ignored when buildStrategy=nixpacks. */
  dockerfilePath: string;
  buildStrategy: 'auto' | 'dockerfile' | 'nixpacks';
  /**
   * DOCR repository slug for this service's images. Phase 1 uses
   * `<projectName>/<envName>/<serviceName>` for multi-service envs and
   * `<projectName>/<envName>` for the single legacy service to preserve
   * existing image-by-repository matching in DeploymentProcessor.
   */
  imageRepository: string;
}

/**
 * Workflow generation configuration.
 */
export interface GenerateWorkflowConfig {
  projectName: string;
  environmentId: string;
  branch: string;
  liftoffApiUrl: string;
  /**
   * Each entry becomes a matrix job that builds and pushes one image. Must have
   * at least one entry. Single-service envs pass a 1-element array.
   */
  services: ServiceBuildSpec[];
  doToken: string;
  doAccountId?: string;
}

/**
 * Generates a GitHub Actions workflow for Liftoff image build + deploy notification.
 *
 * Emits a `strategy.matrix` over the env's Services so each builds independently;
 * a per-service `Notify Liftoff` step posts to /webhooks/deploy-complete with
 * the service's name so the API can aggregate images into a DeploymentBundle.
 */
@Injectable()
export class WorkflowGeneratorService {
  public constructor(private readonly doApiService: DoApiService) {}

  /**
   * Returns workflow YAML content for `.github/workflows/liftoff-deploy.yml`.
   */
  public async generate(config: GenerateWorkflowConfig): Promise<string> {
    if (config.services.length === 0) {
      throw new Error('WorkflowGeneratorService.generate requires at least one service');
    }

    const registryName = await this.doApiService.getOrCreateContainerRegistryName(
      config.doToken,
      config.doAccountId,
    );
    const branch = this.escapeYamlSingleQuoted(config.branch);
    const environmentId = this.escapeJsonString(config.environmentId);
    const docrName = this.escapeJsonString(registryName);
    const liftoffApiUrl = this.trimTrailingSlash(config.liftoffApiUrl);

    const matrixEntries = config.services
      .map((service) => this.renderMatrixEntry(service))
      .join('\n');

    return `name: Liftoff Deploy

on:
  push:
    branches: ['${branch}']

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        service:
${matrixEntries}
    steps:
      - uses: actions/checkout@v4

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: \${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Log in to DigitalOcean Container Registry
        run: doctl registry login --expiry-seconds 1200

      - name: Build and push image
        id: build
        env:
          SERVICE_NAME: \${{ matrix.service.name }}
          IMAGE_URI: registry.digitalocean.com/${docrName}/\${{ matrix.service.imageRepository }}:\${{ github.sha }}
          CONFIGURED_BUILD_STRATEGY: \${{ matrix.service.buildStrategy }}
          CONFIGURED_DOCKERFILE_PATH: \${{ matrix.service.dockerfilePath }}
          CONFIGURED_DOCKER_CONTEXT: \${{ matrix.service.context }}
        run: |
          set -euo pipefail

          BUILD_STRATEGY=""
          BUILD_PLAN=""

          # auto-detect: Dockerfile in context wins, otherwise Nixpacks; explicit overrides honored.
          if [ "$CONFIGURED_BUILD_STRATEGY" = "dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            docker build -f "$CONFIGURED_DOCKERFILE_PATH" -t "$IMAGE_URI" "$CONFIGURED_DOCKER_CONTEXT"
          elif [ "$CONFIGURED_BUILD_STRATEGY" = "nixpacks" ]; then
            BUILD_STRATEGY="nixpacks"
            curl -fsSL https://nixpacks.com/install.sh | bash
            export PATH="$HOME/.local/bin:$PATH"
            BUILD_PLAN="$(nixpacks plan "$CONFIGURED_DOCKER_CONTEXT" --format json | tr -d '\\n')"
            nixpacks build "$CONFIGURED_DOCKER_CONTEXT" --name "$IMAGE_URI"
          elif [ -f "$CONFIGURED_DOCKER_CONTEXT/Dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            docker build -f "$CONFIGURED_DOCKER_CONTEXT/Dockerfile" -t "$IMAGE_URI" "$CONFIGURED_DOCKER_CONTEXT"
          else
            BUILD_STRATEGY="nixpacks"
            curl -fsSL https://nixpacks.com/install.sh | bash
            export PATH="$HOME/.local/bin:$PATH"
            BUILD_PLAN="$(nixpacks plan "$CONFIGURED_DOCKER_CONTEXT" --format json | tr -d '\\n')"
            nixpacks build "$CONFIGURED_DOCKER_CONTEXT" --name "$IMAGE_URI"
          fi

          docker push "$IMAGE_URI"

          {
            echo "image_uri=$IMAGE_URI"
            echo "build_strategy=$BUILD_STRATEGY"
            echo "build_plan<<LIFTOFF_BUILD_PLAN"
            echo "$BUILD_PLAN"
            echo "LIFTOFF_BUILD_PLAN"
          } >> "$GITHUB_OUTPUT"

      - name: Notify Liftoff
        if: always()
        env:
          SERVICE_NAME: \${{ matrix.service.name }}
          JOB_STATUS: \${{ job.status }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          IMAGE_URI: \${{ steps.build.outputs.image_uri }}
          BUILD_STRATEGY: \${{ steps.build.outputs.build_strategy }}
          BUILD_PLAN: \${{ steps.build.outputs.build_plan }}
        run: |
          BUILD_PLAN_JSON=""
          if [ -n "$BUILD_PLAN" ]; then
            BUILD_PLAN_JSON="$(printf '%s' "$BUILD_PLAN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
          fi

          if [ -n "$BUILD_PLAN_JSON" ]; then
            PAYLOAD="{\\"environmentId\\":\\"${environmentId}\\",\\"serviceName\\":\\"$SERVICE_NAME\\",\\"imageUri\\":\\"$IMAGE_URI\\",\\"commitSha\\":\\"$GITHUB_SHA\\",\\"status\\":\\"$JOB_STATUS\\",\\"runUrl\\":\\"$RUN_URL\\",\\"buildStrategy\\":\\"$BUILD_STRATEGY\\",\\"buildPlan\\":$BUILD_PLAN_JSON}"
          else
            PAYLOAD="{\\"environmentId\\":\\"${environmentId}\\",\\"serviceName\\":\\"$SERVICE_NAME\\",\\"imageUri\\":\\"$IMAGE_URI\\",\\"commitSha\\":\\"$GITHUB_SHA\\",\\"status\\":\\"$JOB_STATUS\\",\\"runUrl\\":\\"$RUN_URL\\",\\"buildStrategy\\":\\"$BUILD_STRATEGY\\"}"
          fi

          curl -X POST ${liftoffApiUrl}/api/v1/webhooks/deploy-complete \\
            -H "X-Liftoff-Secret: \${{ secrets.${LIFTOFF_DEPLOY_SECRET_NAME} }}" \\
            -H "Content-Type: application/json" \\
            -d "$PAYLOAD"
`;
  }

  private renderMatrixEntry(service: ServiceBuildSpec): string {
    // YAML matrix entries — each is an object on one line. Strings are JSON-escaped
    // (double-quoted) so service names with hyphens and paths with dots stay safe.
    const name = JSON.stringify(service.name);
    const context = JSON.stringify(service.context);
    const dockerfilePath = JSON.stringify(service.dockerfilePath);
    const buildStrategy = JSON.stringify(service.buildStrategy);
    const imageRepository = JSON.stringify(service.imageRepository);
    return `          - name: ${name}
            context: ${context}
            dockerfilePath: ${dockerfilePath}
            buildStrategy: ${buildStrategy}
            imageRepository: ${imageRepository}`;
  }

  private trimTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }

  private escapeYamlSingleQuoted(value: string): string {
    return value.replace(/'/g, "''");
  }

  private escapeJsonString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
