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
  /**
   * Optional start command (Service.command). Passed to `nixpacks build
   * --start-cmd` so repos with no detectable start (e.g. a Node app with no
   * `start` script) build successfully. Ignored for Dockerfile builds.
   */
  command?: string;
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
  /**
   * Phase 2: BUILD-scope variable keys to expose to every matrix job as build args.
   * Values are pulled from `LIFTOFF_BUILD_<KEY>` Actions secrets that
   * `RepositoriesService.syncBuildVariablesForEnvironment` upserts. Empty array
   * means no build args (legacy single-service envs without variables).
   */
  buildVariableKeys?: string[];
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

    const buildVariableKeys = (config.buildVariableKeys ?? []).filter((key) =>
      /^[A-Z_][A-Z0-9_]*$/.test(key),
    );
    const buildVarEnvLines = buildVariableKeys
      .map(
        (key) =>
          `          ${key}: \${{ secrets.LIFTOFF_BUILD_${key} }}`,
      )
      .join('\n');
    const buildArgFlagsScript = this.renderBuildArgFlagsScript(buildVariableKeys);

    return `name: Liftoff Deploy

on:
  push:
    branches: ['${branch}']
  # Allows POST /api/v1/.../build to trigger a fresh build without a code push.
  # The API hits GitHub's workflows/{file}/dispatches endpoint with this branch.
  workflow_dispatch:

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
          CONFIGURED_START_COMMAND: \${{ matrix.service.command }}
${buildVarEnvLines}
        # Capture every command's stdout+stderr to /tmp/build.log via tee. Notify
        # Liftoff (always-runs) reads the tail of this file so failed builds
        # surface the actual error in our UI instead of just "FAILED".
        run: |
          set -euo pipefail
          : > /tmp/build.log
          exec > >(tee -a /tmp/build.log) 2>&1

          BUILD_STRATEGY=""
          BUILD_PLAN=""
${buildArgFlagsScript}

          echo "::group::Resolving build strategy"
          # auto-detect: Dockerfile in context wins, otherwise Nixpacks; explicit overrides honored.
          if [ "$CONFIGURED_BUILD_STRATEGY" = "dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            echo "Strategy: dockerfile (explicit) — context=$CONFIGURED_DOCKER_CONTEXT dockerfile=$CONFIGURED_DOCKERFILE_PATH"
            echo "::endgroup::"
            echo "::group::docker build"
            docker build $DOCKER_BUILD_ARGS -f "$CONFIGURED_DOCKERFILE_PATH" -t "$IMAGE_URI" "$CONFIGURED_DOCKER_CONTEXT"
            echo "::endgroup::"
          elif [ "$CONFIGURED_BUILD_STRATEGY" = "nixpacks" ]; then
            BUILD_STRATEGY="nixpacks"
            echo "Strategy: nixpacks (explicit) — context=$CONFIGURED_DOCKER_CONTEXT"
            echo "::endgroup::"
            echo "::group::nixpacks install"
            curl -fsSL https://nixpacks.com/install.sh | bash
            export PATH="$HOME/.local/bin:$PATH"
            echo "::endgroup::"
            echo "::group::nixpacks build"
            BUILD_PLAN="$(nixpacks plan "$CONFIGURED_DOCKER_CONTEXT" --format json | tr -d '\\n')"
            if [ -n "$CONFIGURED_START_COMMAND" ]; then
              nixpacks build "$CONFIGURED_DOCKER_CONTEXT" $NIXPACKS_ENV_ARGS --start-cmd "$CONFIGURED_START_COMMAND" --name "$IMAGE_URI"
            else
              nixpacks build "$CONFIGURED_DOCKER_CONTEXT" $NIXPACKS_ENV_ARGS --name "$IMAGE_URI"
            fi
            echo "::endgroup::"
          elif [ -f "$CONFIGURED_DOCKER_CONTEXT/Dockerfile" ]; then
            BUILD_STRATEGY="dockerfile"
            echo "Strategy: dockerfile (auto-detected) — context=$CONFIGURED_DOCKER_CONTEXT"
            echo "::endgroup::"
            echo "::group::docker build"
            docker build $DOCKER_BUILD_ARGS -f "$CONFIGURED_DOCKER_CONTEXT/Dockerfile" -t "$IMAGE_URI" "$CONFIGURED_DOCKER_CONTEXT"
            echo "::endgroup::"
          else
            BUILD_STRATEGY="nixpacks"
            echo "Strategy: nixpacks (auto-detected — no Dockerfile in context) — context=$CONFIGURED_DOCKER_CONTEXT"
            echo "::endgroup::"
            echo "::group::nixpacks install"
            curl -fsSL https://nixpacks.com/install.sh | bash
            export PATH="$HOME/.local/bin:$PATH"
            echo "::endgroup::"
            echo "::group::nixpacks build"
            BUILD_PLAN="$(nixpacks plan "$CONFIGURED_DOCKER_CONTEXT" --format json | tr -d '\\n')"
            if [ -n "$CONFIGURED_START_COMMAND" ]; then
              nixpacks build "$CONFIGURED_DOCKER_CONTEXT" $NIXPACKS_ENV_ARGS --start-cmd "$CONFIGURED_START_COMMAND" --name "$IMAGE_URI"
            else
              nixpacks build "$CONFIGURED_DOCKER_CONTEXT" $NIXPACKS_ENV_ARGS --name "$IMAGE_URI"
            fi
            echo "::endgroup::"
          fi

          echo "::group::docker push"
          docker push "$IMAGE_URI"
          echo "::endgroup::"

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
        # On any outcome we POST to /webhooks/deploy-complete. On failure, we
        # also slurp the last ~96KB of /tmp/build.log (base64-encoded so JSON-safe)
        # so the Liftoff UI can show the actual build error without the user having
        # to leave for the GitHub Actions UI.
        run: |
          BUILD_PLAN_JSON="null"
          if [ -n "$BUILD_PLAN" ]; then
            BUILD_PLAN_JSON="$(printf '%s' "$BUILD_PLAN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
          fi

          BUILD_LOGS_B64=""
          if [ -f /tmp/build.log ]; then
            # Tail ~96KB so payload stays well under any reasonable JSON body limit.
            BUILD_LOGS_B64="$(tail -c 98304 /tmp/build.log | base64 -w 0)"
          fi

          BUILD_LOGS_JSON="null"
          if [ -n "$BUILD_LOGS_B64" ]; then
            BUILD_LOGS_JSON="\\"$BUILD_LOGS_B64\\""
          fi

          PAYLOAD=$(cat <<JSONEOF
          {"environmentId":"${environmentId}","serviceName":"$SERVICE_NAME","imageUri":"$IMAGE_URI","commitSha":"$GITHUB_SHA","status":"$JOB_STATUS","runUrl":"$RUN_URL","buildStrategy":"$BUILD_STRATEGY","buildPlan":$BUILD_PLAN_JSON,"buildLogsBase64":$BUILD_LOGS_JSON}
          JSONEOF
          )

          curl -X POST ${liftoffApiUrl}/api/v1/webhooks/deploy-complete \\
            -H "X-Liftoff-Secret: \${{ secrets.${LIFTOFF_DEPLOY_SECRET_NAME} }}" \\
            -H "Content-Type: application/json" \\
            -d "$PAYLOAD"
`;
  }

  /**
   * Emits the shell that constructs `DOCKER_BUILD_ARGS` (for `docker build`) and
   * `NIXPACKS_ENV_ARGS` (for `nixpacks build`) from the BUILD-scope env vars
   * already in the job's environment via the workflow-level `env:` block.
   *
   * Empty BUILD set → both vars are unset/empty so downstream commands stay valid.
   */
  private renderBuildArgFlagsScript(buildVariableKeys: string[]): string {
    if (buildVariableKeys.length === 0) {
      return `          DOCKER_BUILD_ARGS=""\n          NIXPACKS_ENV_ARGS=""`;
    }

    const dockerLines = buildVariableKeys
      .map(
        (key) =>
          `          if [ -n "\${${key}+x}" ]; then DOCKER_BUILD_ARGS="$DOCKER_BUILD_ARGS --build-arg ${key}"; fi`,
      )
      .join('\n');
    const nixpacksLines = buildVariableKeys
      .map(
        (key) =>
          `          if [ -n "\${${key}+x}" ]; then NIXPACKS_ENV_ARGS="$NIXPACKS_ENV_ARGS --env ${key}=\${${key}}"; fi`,
      )
      .join('\n');

    return `          DOCKER_BUILD_ARGS=""
          NIXPACKS_ENV_ARGS=""
${dockerLines}
${nixpacksLines}`;
  }

  private renderMatrixEntry(service: ServiceBuildSpec): string {
    // YAML matrix entries — each is an object on one line. Strings are JSON-escaped
    // (double-quoted) so service names with hyphens and paths with dots stay safe.
    const name = JSON.stringify(service.name);
    const context = JSON.stringify(service.context);
    const dockerfilePath = JSON.stringify(service.dockerfilePath);
    const buildStrategy = JSON.stringify(service.buildStrategy);
    const imageRepository = JSON.stringify(service.imageRepository);
    const command = JSON.stringify(service.command ?? '');
    return `          - name: ${name}
            context: ${context}
            dockerfilePath: ${dockerfilePath}
            buildStrategy: ${buildStrategy}
            imageRepository: ${imageRepository}
            command: ${command}`;
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
