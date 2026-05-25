import type { DeploymentStatusType } from '../constants/deployment-status';

export interface DeploymentDto {
  id: string;
  environmentId: string;
  status: DeploymentStatusType;
  commitSha: string | null;
  commitMessage: string | null;
  branch: string | null;
  imageUri: string | null;
  buildStrategy: string | null;
  buildRunUrl: string | null;
  buildPlan: unknown | null;
  triggeredBy: string | null;
  endpoint: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLogDto {
  id: string;
  deploymentId: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source: string;
  timestamp: string;
}
