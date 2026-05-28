import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import sodium from 'libsodium-wrappers';
import { firstValueFrom } from 'rxjs';

interface GitHubRepositoryApiResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
  html_url: string;
}

interface GitHubContentApiResponse {
  sha: string;
}

interface GitHubBlobApiResponse {
  sha: string;
}

interface GitHubTreeApiResponse {
  sha: string;
}

interface GitHubCommitApiResponse {
  sha: string;
}

interface GitHubRefApiResponse {
  object: {
    sha: string;
  };
}

interface GitHubWebhookApiResponse {
  id: number;
  config: {
    url?: string;
  };
}

interface GitHubActionsPublicKeyApiResponse {
  key: string;
  key_id: string;
}

/**
 * Minimal GitHub repository data used by Liftoff.
 */
export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
}

/**
 * Minimal GitHub webhook data used by Liftoff.
 */
export interface GitHubWebhook {
  id: number;
  url: string;
}

/**
 * GitHub REST API wrapper for repository and webhook operations.
 */
@Injectable()
export class GitHubService {
  private static readonly BASE_URL = 'https://api.github.com';
  private static readonly API_VERSION = '2022-11-28';
  private static readonly USER_AGENT = 'liftoff';
  private static sodiumReadyPromise: Promise<void> | null = null;

  public constructor(private readonly httpService: HttpService) {}

  /**
   * Lists repositories available to the authenticated GitHub user.
   */
  public async listRepositories(githubToken: string): Promise<GitHubRepo[]> {
    const { data } = await this.request<GitHubRepositoryApiResponse[]>(
      {
        method: 'GET',
        url: '/user/repos',
        params: {
          sort: 'updated',
          per_page: 100,
          type: 'all',
        },
      },
      githubToken,
    );

    return data.map((repository) => this.mapRepository(repository));
  }

  /**
   * Returns one repository by its owner/name path.
   */
  public async getRepository(githubToken: string, fullName: string): Promise<GitHubRepo> {
    const { data } = await this.request<GitHubRepositoryApiResponse>(
      {
        method: 'GET',
        url: `/repos/${fullName}`,
      },
      githubToken,
    );

    return this.mapRepository(data);
  }

  /**
   * Creates a GitHub webhook and returns the created hook id.
   */
  public async createWebhook(
    githubToken: string,
    fullName: string,
    webhookUrl: string,
    secret: string,
  ): Promise<number> {
    const { data } = await this.request<{ id: number }>(
      {
        method: 'POST',
        url: `/repos/${fullName}/hooks`,
        data: {
          name: 'web',
          active: true,
          events: ['push', 'pull_request'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
          },
        },
      },
      githubToken,
    );

    return data.id;
  }

  /**
   * Deletes a GitHub webhook by hook id.
   */
  public async deleteWebhook(githubToken: string, fullName: string, hookId: number): Promise<void> {
    await this.request(
      {
        method: 'DELETE',
        url: `/repos/${fullName}/hooks/${hookId}`,
      },
      githubToken,
    );
  }

  /**
   * Returns one webhook by hook id.
   */
  public async getWebhook(
    githubToken: string,
    fullName: string,
    hookId: number,
  ): Promise<GitHubWebhook> {
    const { data } = await this.request<GitHubWebhookApiResponse>(
      {
        method: 'GET',
        url: `/repos/${fullName}/hooks/${hookId}`,
      },
      githubToken,
    );

    return {
      id: data.id,
      url: data.config.url ?? '',
    };
  }

  /**
   * Updates a webhook callback URL.
   */
  public async updateWebhookUrl(
    githubToken: string,
    fullName: string,
    hookId: number,
    webhookUrl: string,
  ): Promise<void> {
    await this.request(
      {
        method: 'PATCH',
        url: `/repos/${fullName}/hooks/${hookId}`,
        data: {
          config: {
            url: webhookUrl,
          },
        },
      },
      githubToken,
    );
  }

  /**
   * Creates or updates a repository Actions secret.
   */
  public async upsertActionsSecret(
    githubToken: string,
    fullName: string,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    const { data: publicKey } = await this.request<GitHubActionsPublicKeyApiResponse>(
      {
        method: 'GET',
        url: `/repos/${fullName}/actions/secrets/public-key`,
      },
      githubToken,
    );

    const encryptedValue = await this.encryptActionsSecret(secretValue, publicKey.key);
    const encodedSecretName = encodeURIComponent(secretName);

    await this.request(
      {
        method: 'PUT',
        url: `/repos/${fullName}/actions/secrets/${encodedSecretName}`,
        data: {
          encrypted_value: encryptedValue,
          key_id: publicKey.key_id,
        },
      },
      githubToken,
    );
  }

  /**
   * Lists Actions secret names on a repository. Values are never returned by
   * the GitHub API (they're encrypted) — this is for enumerating which keys
   * exist so we can clean up stale `LIFTOFF_BUILD_*` entries.
   */
  public async listActionsSecrets(
    githubToken: string,
    fullName: string,
  ): Promise<string[]> {
    const names: string[] = [];
    let page = 1;
    while (true) {
      const { data } = await this.request<{ secrets: Array<{ name: string }> }>(
        {
          method: 'GET',
          url: `/repos/${fullName}/actions/secrets`,
          params: { per_page: 100, page },
        },
        githubToken,
      );
      for (const secret of data.secrets ?? []) {
        names.push(secret.name);
      }
      if (!data.secrets || data.secrets.length < 100) break;
      page += 1;
    }
    return names;
  }

  /**
   * Deletes a repository Actions secret. 404 is swallowed (already gone).
   */
  public async deleteActionsSecret(
    githubToken: string,
    fullName: string,
    secretName: string,
  ): Promise<void> {
    try {
      await this.request(
        {
          method: 'DELETE',
          url: `/repos/${fullName}/actions/secrets/${encodeURIComponent(secretName)}`,
        },
        githubToken,
      );
    } catch (error) {
      if (this.isHttpStatus(error, 404)) return;
      throw error;
    }
  }

  /**
   * Fetches the raw UTF-8 contents of one file on a branch. Returns null on 404
   * so callers can probe multiple candidate filenames without try/catch boilerplate.
   * Used by `.env.example` detection (P2.8).
   */
  public async fetchFileContent(
    githubToken: string,
    fullName: string,
    path: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.request<{
        content?: string;
        encoding?: string;
        type?: string;
      }>(
        {
          method: 'GET',
          url: `/repos/${fullName}/contents/${this.encodeFilePath(path)}`,
          params: { ref: branch },
        },
        githubToken,
      );

      if (data.type !== 'file' || typeof data.content !== 'string') return null;

      const encoding = data.encoding ?? 'base64';
      if (encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
      return data.content;
    } catch (error) {
      if (this.isHttpStatus(error, 404)) return null;
      throw error;
    }
  }

  /**
   * Creates or updates a file in a GitHub repository by committing to a branch.
   */
  public async commitFile(
    githubToken: string,
    fullName: string,
    path: string,
    content: string,
    message: string,
    branch: string,
  ): Promise<void> {
    const encodedPath = this.encodeFilePath(path);
    const existingFileSha = await this.getExistingFileSha(githubToken, fullName, encodedPath, branch);
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');

    await this.request(
      {
        method: 'PUT',
        url: `/repos/${fullName}/contents/${encodedPath}`,
        data: {
          message,
          content: encodedContent,
          branch,
          ...(existingFileSha ? { sha: existingFileSha } : {}),
        },
      },
      githubToken,
    );
  }

  /**
   * Creates a new GitHub repository for the authenticated user.
   */
  public async createRepository(
    githubToken: string,
    name: string,
    isPrivate: boolean,
  ): Promise<GitHubRepo> {
    const { data } = await this.request<GitHubRepositoryApiResponse>(
      {
        method: 'POST',
        url: '/user/repos',
        data: {
          name,
          private: isPrivate,
          auto_init: true,
        },
      },
      githubToken,
    );

    return this.mapRepository(data);
  }

  /**
   * Pushes multiple files to a repository in a single commit using the Git Data API.
   */
  public async pushFiles(
    githubToken: string,
    fullName: string,
    files: Array<{ path: string; content: string }>,
    commitMessage: string,
    branch: string,
  ): Promise<string> {
    const headRef = await this.getRef(githubToken, fullName, branch);
    const parentSha = headRef;

    const blobShas = await Promise.all(
      files.map(async (file) => {
        const { data } = await this.request<GitHubBlobApiResponse>(
          {
            method: 'POST',
            url: `/repos/${fullName}/git/blobs`,
            data: {
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            },
          },
          githubToken,
        );
        return { path: file.path, sha: data.sha };
      }),
    );

    const { data: tree } = await this.request<GitHubTreeApiResponse>(
      {
        method: 'POST',
        url: `/repos/${fullName}/git/trees`,
        data: {
          base_tree: parentSha,
          tree: blobShas.map((blob) => ({
            path: blob.path,
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
          })),
        },
      },
      githubToken,
    );

    const { data: commit } = await this.request<GitHubCommitApiResponse>(
      {
        method: 'POST',
        url: `/repos/${fullName}/git/commits`,
        data: {
          message: commitMessage,
          tree: tree.sha,
          parents: [parentSha],
        },
      },
      githubToken,
    );

    await this.request(
      {
        method: 'PATCH',
        url: `/repos/${fullName}/git/refs/heads/${branch}`,
        data: { sha: commit.sha },
      },
      githubToken,
    );

    return commit.sha;
  }

  /**
   * Verifies a GitHub webhook signature using HMAC-SHA256.
   */
  public verifyWebhookSignature(
    payload: Buffer,
    signature: string | undefined,
    secret: string,
  ): boolean {
    if (!signature?.startsWith('sha256=')) {
      return false;
    }

    const providedHexDigest = signature.slice('sha256='.length);
    if (!/^[a-f0-9]{64}$/i.test(providedHexDigest)) {
      return false;
    }

    const expectedDigest = createHmac('sha256', secret).update(payload).digest();
    const providedDigest = Buffer.from(providedHexDigest, 'hex');
    if (providedDigest.length !== expectedDigest.length) {
      return false;
    }

    return timingSafeEqual(providedDigest, expectedDigest);
  }

  private async encryptActionsSecret(secretValue: string, base64PublicKey: string): Promise<string> {
    const sodiumLib = await this.getSodium();
    const publicKeyBytes = sodiumLib.from_base64(
      base64PublicKey,
      sodiumLib.base64_variants.ORIGINAL,
    );
    const secretBytes = sodiumLib.from_string(secretValue);
    const encryptedBytes = sodiumLib.crypto_box_seal(secretBytes, publicKeyBytes);
    return sodiumLib.to_base64(encryptedBytes, sodiumLib.base64_variants.ORIGINAL);
  }

  private async getSodium(): Promise<typeof sodium> {
    if (!GitHubService.sodiumReadyPromise) {
      GitHubService.sodiumReadyPromise = sodium.ready;
    }
    await GitHubService.sodiumReadyPromise;
    return sodium;
  }

  private async getExistingFileSha(
    githubToken: string,
    fullName: string,
    encodedPath: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.request<GitHubContentApiResponse>(
        {
          method: 'GET',
          url: `/repos/${fullName}/contents/${encodedPath}`,
          params: {
            ref: branch,
          },
        },
        githubToken,
      );

      return data.sha;
    } catch (error) {
      if (this.isHttpStatus(error, 404)) {
        return null;
      }

      throw error;
    }
  }

  private async getRef(
    githubToken: string,
    fullName: string,
    branch: string,
  ): Promise<string> {
    const { data } = await this.request<GitHubRefApiResponse>(
      {
        method: 'GET',
        url: `/repos/${fullName}/git/ref/heads/${branch}`,
      },
      githubToken,
    );

    return data.object.sha;
  }

  private encodeFilePath(path: string): string {
    return path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private mapRepository(repository: GitHubRepositoryApiResponse): GitHubRepo {
    return {
      id: repository.id,
      name: repository.name,
      fullName: repository.full_name,
      private: repository.private,
      defaultBranch: repository.default_branch,
      cloneUrl: repository.clone_url,
      htmlUrl: repository.html_url,
    };
  }

  private async request<T = unknown>(
    requestConfig: AxiosRequestConfig,
    githubToken: string,
  ): Promise<AxiosResponse<T>> {
    return firstValueFrom(
      this.httpService.request<T>({
        ...requestConfig,
        baseURL: GitHubService.BASE_URL,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': GitHubService.API_VERSION,
          'User-Agent': GitHubService.USER_AGENT,
          ...requestConfig.headers,
        },
      }),
    );
  }

  private isHttpStatus(error: unknown, statusCode: number): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybeError = error as {
      response?: {
        status?: unknown;
      };
    };

    return maybeError.response?.status === statusCode;
  }
}
