'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/use-toast';
import {
  useCreateDoAccount,
  useDeleteDoAccount,
  useDoAccounts,
  useValidateDoAccount,
} from '@/hooks/queries/use-do-accounts';
import { useAuthStore } from '@/store/auth.store';

const DO_REGIONS = ['nyc1', 'nyc3', 'sfo3', 'ams3', 'sgp1', 'lon1', 'fra1', 'tor1', 'blr1', 'syd1'] as const;

const connectAccountSchema = z.object({
  doToken: z.string().min(50, 'DigitalOcean token must be at least 50 characters'),
  region: z.enum(DO_REGIONS),
});

type ConnectAccountValues = z.infer<typeof connectAccountSchema>;

/**
 * Account settings page for profile and connected DigitalOcean accounts.
 */
export default function SettingsPage(): JSX.Element {
  const [validatingAccountId, setValidatingAccountId] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const user = useAuthStore((state) => state.user);
  const { data: doAccounts, isLoading } = useDoAccounts();
  const createDoAccountMutation = useCreateDoAccount();
  const validateDoAccountMutation = useValidateDoAccount();
  const deleteDoAccountMutation = useDeleteDoAccount();

  const form = useForm<ConnectAccountValues>({
    resolver: zodResolver(connectAccountSchema),
    defaultValues: {
      doToken: '',
      region: 'nyc3',
    },
  });

  const handleConnectAccount = form.handleSubmit(async (values) => {
    try {
      await createDoAccountMutation.mutateAsync(values);
      toast({
        title: 'Account connected',
        description: 'DigitalOcean account was validated and connected.',
      });
      form.reset({
        doToken: '',
        region: values.region,
      });
    } catch {
      toast({
        title: 'Connection failed',
        description: 'Token validation failed. Check the token and retry.',
        variant: 'destructive',
      });
    }
  });

  const handleValidateAccount = async (accountId: string): Promise<void> => {
    setValidatingAccountId(accountId);
    try {
      const result = await validateDoAccountMutation.mutateAsync(accountId);
      if (result.valid) {
        toast({
          title: 'Account validated',
          description: result.email ? `Validated for ${result.email}` : 'Token is valid.',
        });
      } else {
        toast({
          title: 'Validation failed',
          description: result.error ?? 'Token could not be validated.',
          variant: 'destructive',
        });
      }
    } finally {
      setValidatingAccountId(null);
    }
  };

  const handleDeleteAccount = async (accountId: string): Promise<void> => {
    const confirmed = window.confirm(
      'Delete this DigitalOcean account connection? Environments using it must be removed first.',
    );
    if (!confirmed) {
      return;
    }

    setDeletingAccountId(accountId);
    try {
      await deleteDoAccountMutation.mutateAsync(accountId);
      toast({
        title: 'Account deleted',
        description: 'DigitalOcean account connection has been removed.',
      });
    } catch {
      toast({
        title: 'Delete failed',
        description: 'This account may still be used by active environments.',
        variant: 'destructive',
      });
    } finally {
      setDeletingAccountId(null);
    }
  };

  return (
    <section className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your profile and DigitalOcean connections.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your authenticated GitHub identity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Name:</span> {user?.name || 'Not set'}
          </p>
          <p>
            <span className="font-medium">GitHub:</span> {user?.githubUsername || 'Unknown'}
          </p>
          <p>
            <span className="font-medium">Email:</span> {user?.email || 'Unknown'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DigitalOcean accounts</CardTitle>
          <CardDescription>Connect one or more DigitalOcean API tokens.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={(event) => void handleConnectAccount(event)} className="space-y-4 rounded-md border p-4">
            <h3 className="text-sm font-semibold">Connect account</h3>
            <div className="space-y-2">
              <Label htmlFor="do-token">DigitalOcean token</Label>
              <Input
                id="do-token"
                type="password"
                autoComplete="off"
                placeholder="dop_v1_..."
                {...form.register('doToken')}
              />
              {form.formState.errors.doToken?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.doToken.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Default region</Label>
              <Select
                value={form.watch('region')}
                onValueChange={(value) =>
                  form.setValue('region', value as ConnectAccountValues['region'], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {DO_REGIONS.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={createDoAccountMutation.isPending}>
              {createDoAccountMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Connect account'}
            </Button>
          </form>

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner className="h-6 w-6" />
            </div>
          ) : doAccounts && doAccounts.length > 0 ? (
            <div className="space-y-3">
              {doAccounts.map((account) => (
                <Card key={account.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{account.id}</p>
                      <p className="text-xs text-muted-foreground">Region: {account.region}</p>
                      <Badge variant={account.validatedAt ? 'secondary' : 'destructive'}>
                        {account.validatedAt ? 'Validated' : 'Not validated'}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void handleValidateAccount(account.id)}
                        disabled={validatingAccountId === account.id}
                      >
                        {validatingAccountId === account.id ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          'Validate'
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void handleDeleteAccount(account.id)}
                        disabled={deletingAccountId === account.id}
                      >
                        {deletingAccountId === account.id ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No DigitalOcean accounts connected yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
