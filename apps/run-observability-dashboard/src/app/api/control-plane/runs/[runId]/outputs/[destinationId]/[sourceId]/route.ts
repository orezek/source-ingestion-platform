import { NextResponse } from 'next/server';
import { getControlPlaneRunStructuredOutputDownload } from '@/server/control-plane/outputs';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ runId: string; destinationId: string; sourceId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { runId, destinationId, sourceId } = await context.params;
  const disposition =
    new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';

  try {
    const output = await getControlPlaneRunStructuredOutputDownload({
      runId,
      destinationId,
      sourceId,
    });
    return new Response(output.contents, {
      headers: {
        'Content-Type': output.contentType,
        'Content-Disposition': `${disposition}; filename="${output.fileName}"`,
        'Content-Length': String(output.contents.byteLength),
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Structured output download failed.',
      },
      { status: 400 },
    );
  }
}
