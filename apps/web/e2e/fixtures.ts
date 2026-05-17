import { test as base, type Page, type BrowserContext } from '@playwright/test';
import { setAuthState } from './auth-setup';
import type { UserPublicDto } from '@liftoff/shared';

const JWT_TOKEN = process.env.E2E_JWT_TOKEN!;

const GITHUB_TOKEN = process.env.E2E_GITHUB_TOKEN!;

export const test = base.extend<{
  projectId: string;
  environmentId: string;
  doAccountId: string;
}>({
  projectId: '',
  environmentId: '',
  doAccountId: '',
});

export { expect } from '@playwright/test';

export async function seedUserAndGetContext(page: Page): Promise<BrowserContext> {
  await setAuthState(page, JWT_TOKEN, {
    id: 'cmozri5j20000ntxjgjbdw08w',
    email: 'munimahmad2@gmail.com',
    githubUsername: 'munimx',
    name: 'Munim Ahmad',
    avatarUrl: 'https://avatars.githubusercontent.com/u/202656505',
    createdAt: new Date().toISOString(),
  });
  return page.context();
}

export { JWT_TOKEN, GITHUB_TOKEN };