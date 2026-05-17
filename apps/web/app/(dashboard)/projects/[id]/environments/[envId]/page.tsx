'use client';

import { useParams } from 'next/navigation';
import { redirect } from 'next/navigation';

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

export default function EnvironmentDetailPage(): JSX.Element {
  const params = useParams();
  const projectId = resolveRouteParam(params.id);
  redirect(`/projects/${projectId}/canvas`);
}
