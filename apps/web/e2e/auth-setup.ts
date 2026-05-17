import type { Page } from '@playwright/test';
import type { UserPublicDto } from '@liftoff/shared';

/**
 * Authenticates by visiting the OAuth callback URL with the access token.
 * This simulates the real OAuth callback flow to properly hydrate the Zustand store.
 */
export async function setAuthState(
  page: Page,
  accessToken: string,
  user?: UserPublicDto,
): Promise<void> {
  // If we have a pre-built user, inject into localStorage first,
  // then let the app's auth rehydration pick it up
  if (user) {
    await page.goto('http://localhost:3000');
    await page.evaluate(
      ({ token, userData }) => {
        localStorage.setItem(
          'auth-store',
          JSON.stringify({
            state: {
              user: userData,
              accessToken: token,
              isAuthenticated: true,
              isLoading: false,
            },
            version: 0,
          }),
        );
      },
      { token: accessToken, userData: user },
    );
    // Navigate to dashboard — auth rehydration will detect localStorage state
    await page.goto('http://localhost:3000/dashboard');
    return;
  }

  // Use the real callback flow
  const callbackUrl = `http://localhost:3000/auth/callback?token=${encodeURIComponent(accessToken)}`;
  await page.goto(callbackUrl);
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

/**
 * Clears auth state from localStorage.
 */
export async function clearAuthState(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('auth-store');
  });
}