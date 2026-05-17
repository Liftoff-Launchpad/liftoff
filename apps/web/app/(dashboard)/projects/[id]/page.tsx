'use client';

import { redirect } from 'next/navigation';
import { useParams } from 'next/navigation';

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] ?? '';
  }
  return param ?? '';
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = resolveRouteParam(params.id);
  redirect(`/projects/${projectId}/canvas`);
}
