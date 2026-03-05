import { NextResponse } from 'next/server';
import { getControlPlaneRunArtifactDownload } from '@/server/control-plane/artifacts';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ runId: string; sourceId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { runId, sourceId } = await context.params;
  const disposition =
    new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';

  try {
    const artifact = await getControlPlaneRunArtifactDownload({ runId, sourceId });
    return new Response(artifact.contents, {
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Disposition': `${disposition}; filename="${artifact.fileName}"`,
        'Content-Length': String(artifact.contents.byteLength),
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Artifact download failed.',
      },
      { status: 400 },
    );
  }
}
