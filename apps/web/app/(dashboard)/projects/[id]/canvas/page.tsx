'use client';

import { useParams } from 'next/navigation';
import { ProjectCanvas } from '@/components/canvas/project-canvas';

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] ?? '';
  }
  return param ?? '';
}

export default function CanvasPage() {
  const params = useParams();
  const projectId = resolveRouteParam(params.id);

  return <ProjectCanvas projectId={projectId} />;
}
