import { VariableKind, VariableScope } from '@prisma/client';

/**
 * Public-facing variable response.
 *
 * For SECRET variables the value is ALWAYS `null` regardless of the requesting user's
 * role — secrets are write-only after creation by design. `hasValue` lets the UI show
 * "set" vs "unset" without leaking the value.
 */
export interface VariableResponse {
  id: string;
  key: string;
  /** Plain-text value for PLAIN kind. `null` for SECRET kind. */
  value: string | null;
  scope: VariableScope;
  kind: VariableKind;
  /** True when the row has a non-empty encrypted value. */
  hasValue: boolean;
  createdBy: string | null;
  lastRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-key result row returned by a bulk import. Lets the UI show "added 5,
 * updated 2, skipped 3 (already existed)".
 */
export interface BulkImportResult {
  key: string;
  status: 'created' | 'updated' | 'skipped' | 'invalid';
  reason?: string;
}

/**
 * Resolved-view entry: a single variable visible to a service at runtime,
 * with where it came from. Used by the debug UI and by the Pulumi/Workflow
 * integrations to know what env to inject.
 */
export interface ResolvedVariableEntry {
  key: string;
  /** The actual value to inject. For SECRET kind, this is redacted in API responses
   *  (callers that need the real value use the internal resolver, not the HTTP endpoint). */
  value: string | null;
  scope: VariableScope;
  kind: VariableKind;
  source: 'environment' | 'service';
}
