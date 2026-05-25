import { Injectable } from '@nestjs/common';
import { LIFTOFF_DEPLOY_SECRET_NAME } from '@liftoff/shared';
import { DoApiService } from '../do-api/do-api.service';

/**
 * Workflow generation configuration.
 */
export interface GenerateWorkflowConfig {
  projectName: string;
  environmentId: string;
  branch: string;
  imageRepository: string;
  liftoffApiUrl: string;
  buildStrategy: 'auto' | 'dockerfile' | 'nixpacks';
  dockerfilePath: string;
  dockerBuildContext: string;
  doToken: string;
  doAccountId?: string;
  githubRunsUrl?: string;
}

/**
 * Generates a GitHub Actions workflow for Liftoff image build + deploy notification.
 */
@Injectable()
export class WorkflowGeneratorService {
  public constructor(private readonly doApiService: DoApiService) {}

  /**
   * Returns workflow YAML content for `.github/workflows/liftoff-deploy.yml`.
   */
  public async generate(config: GenerateWorkflowConfig): Promise<string> {
    const registryName = await this.doApiService.getOrCreateContainerRegistryName(
      config.doToken,
      config.doAccountId,
    );
    const branch = this.escapeYamlSingleQuoted(config.branch);
    const environmentId = this.escapeJsonString(config.environmentId);
    const imageRepository = this.escapeJsonString(config.imageRepository);
    const docrName = this.escapeJsonString(registryName);
    const liftoffApiUrl = this.trimTrailingSlash(config.liftoffApiUrl);
    const buildStrategy = this.escapeJsonString(config.buildStrategy);
    const dockerfilePath = this.escapeJsonString(config.dockerfilePath);
    const dockerBuildContext = this.escapeJsonString(config.dockerBuildContext);

    return `name: Liftoff Deploy

on:
  push:
    branches: ['${branch}']

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
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
          IMAGE_TAG: \${{ github.sha }}
          IMAGE_URI: registry.digitalocean.com/${docrName}/${imageRepository}:\${{ github.sha }}
          CONFIGURED_BUILD_STRATEGY: ${buildStrategy}
          CONFIGURED_DOCKERFILE_PATH: ${dockerfilePath}
          CONFIGURED_DOCKER_CONTEXT: ${dockerBuildContext}
        run: |
          set -euo pipefail

          BUILD_STRATEGY=""
          BUILD_PLAN=""

          if [ -f "./Dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            docker build -f Dockerfile -t "$IMAGE_URI" .
          elif [ "$CONFIGURED_BUILD_STRATEGY" = "dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            docker build -f "$CONFIGURED_DOCKERFILE_PATH" -t "$IMAGE_URI" "$CONFIGURED_DOCKER_CONTEXT"
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
            PAYLOAD="{\\"environmentId\\":\\"${environmentId}\\",\\"imageUri\\":\\"$IMAGE_URI\\",\\"commitSha\\":\\"$GITHUB_SHA\\",\\"status\\":\\"$JOB_STATUS\\",\\"runUrl\\":\\"$RUN_URL\\",\\"buildStrategy\\":\\"$BUILD_STRATEGY\\",\\"buildPlan\\":$BUILD_PLAN_JSON}"
          else
            PAYLOAD="{\\"environmentId\\":\\"${environmentId}\\",\\"imageUri\\":\\"$IMAGE_URI\\",\\"commitSha\\":\\"$GITHUB_SHA\\",\\"status\\":\\"$JOB_STATUS\\",\\"runUrl\\":\\"$RUN_URL\\",\\"buildStrategy\\":\\"$BUILD_STRATEGY\\"}"
          fi

          curl -X POST ${liftoffApiUrl}/api/v1/webhooks/deploy-complete \\
            -H "X-Liftoff-Secret: \${{ secrets.${LIFTOFF_DEPLOY_SECRET_NAME} }}" \\
            -H "Content-Type: application/json" \\
            -d "$PAYLOAD"
`;
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
