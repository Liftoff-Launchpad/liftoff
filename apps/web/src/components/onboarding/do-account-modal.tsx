'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { useCreateDoAccount, useDoAccounts } from '@/hooks/queries/use-do-accounts';

const DO_REGIONS = ['nyc1', 'nyc3', 'sfo3', 'ams3', 'sgp1', 'lon1', 'fra1', 'tor1', 'blr1', 'syd1'] as const;

const schema = z.object({
  doToken: z.string().min(50, 'DigitalOcean token must be at least 50 characters'),
  region: z.enum(DO_REGIONS),
});

type FormValues = z.infer<typeof schema>;

export function DoAccountOnboardingModal() {
  const { data: doAccounts, isLoading } = useDoAccounts();
  const createMutation = useCreateDoAccount();
  const [dismissed, setDismissed] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { doToken: '', region: 'nyc3' },
  });

  const showModal = !isLoading && (!doAccounts || doAccounts.length === 0) && !dismissed;

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await createMutation.mutateAsync(values);
      toast({ title: 'Account connected', description: 'Your DigitalOcean account is ready.' });
    } catch {
      toast({ title: 'Connection failed', description: 'Check your token and try again.', variant: 'destructive' });
    }
  });

  if (!showModal) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setDismissed(true); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect DigitalOcean</DialogTitle>
          <DialogDescription>
            Liftoff deploys to your own DigitalOcean account. Add your API token to get started.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="onboard-token">API Token</Label>
            <Input
              id="onboard-token"
              type="password"
              autoComplete="off"
              placeholder="dop_v1_..."
              {...form.register('doToken')}
            />
            {form.formState.errors.doToken?.message && (
              <p className="text-xs text-destructive">{form.formState.errors.doToken.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Default Region</Label>
            <Select
              value={form.watch('region')}
              onValueChange={(v) => form.setValue('region', v as FormValues['region'], { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DO_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setDismissed(true)}>
              Skip for now
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
