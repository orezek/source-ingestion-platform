import { NextResponse } from 'next/server';
import { z } from 'zod';
import type {
  CreatePipelineInput,
  CreateRuntimeProfileInput,
  CreateSearchSpaceInput,
  CreateStructuredOutputDestinationInput,
  StartRunRequest,
} from '@repo/control-plane-contracts';
import {
  createPipeline,
  createRuntimeProfile,
  createSearchSpace,
  createStructuredOutputDestination,
  deletePipeline,
  deleteRuntimeProfile,
  deleteSearchSpace,
  deleteStructuredOutputDestination,
  getControlPlaneOverview,
  startRun,
  updatePipeline,
  updateRuntimeProfile,
  updateSearchSpace,
  updateStructuredOutputDestination,
} from '@/server/control-plane/service';

const resourceSchema = z.enum([
  'overview',
  'search-spaces',
  'runtime-profiles',
  'structured-output-destinations',
  'pipelines',
  'runs',
]);

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ resource: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { resource } = await context.params;
  const parsedResource = resourceSchema.safeParse(resource);
  if (!parsedResource.success) {
    return NextResponse.json(
      { ok: false, error: 'Unknown control-plane resource.' },
      { status: 404 },
    );
  }

  const overview = await getControlPlaneOverview();
  switch (parsedResource.data) {
    case 'overview':
      return NextResponse.json({ ok: true, data: overview });
    case 'search-spaces':
      return NextResponse.json({ ok: true, data: overview.searchSpaces });
    case 'runtime-profiles':
      return NextResponse.json({ ok: true, data: overview.runtimeProfiles });
    case 'structured-output-destinations':
      return NextResponse.json({ ok: true, data: overview.structuredOutputDestinations });
    case 'pipelines':
      return NextResponse.json({ ok: true, data: overview.pipelines });
    case 'runs':
      return NextResponse.json({ ok: true, data: overview.runs });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { resource } = await context.params;
  const parsedResource = resourceSchema.safeParse(resource);
  if (!parsedResource.success || parsedResource.data === 'overview') {
    return NextResponse.json(
      { ok: false, error: 'Unknown control-plane resource.' },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as unknown;

  try {
    switch (parsedResource.data) {
      case 'search-spaces':
        return NextResponse.json({
          ok: true,
          data: await createSearchSpace(body as CreateSearchSpaceInput),
        });
      case 'runtime-profiles':
        return NextResponse.json({
          ok: true,
          data: await createRuntimeProfile(body as CreateRuntimeProfileInput),
        });
      case 'structured-output-destinations':
        return NextResponse.json({
          ok: true,
          data: await createStructuredOutputDestination(
            body as CreateStructuredOutputDestinationInput,
          ),
        });
      case 'pipelines':
        return NextResponse.json({
          ok: true,
          data: await createPipeline(body as CreatePipelineInput),
        });
      case 'runs':
        return NextResponse.json(
          { ok: true, data: await startRun(body as StartRunRequest) },
          { status: 202 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected control-plane error.',
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { resource } = await context.params;
  const parsedResource = resourceSchema.safeParse(resource);
  if (
    !parsedResource.success ||
    parsedResource.data === 'overview' ||
    parsedResource.data === 'runs'
  ) {
    return NextResponse.json(
      { ok: false, error: 'Unknown control-plane resource.' },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : null;

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing required field "id".' }, { status: 400 });
  }

  try {
    switch (parsedResource.data) {
      case 'search-spaces':
        return NextResponse.json({
          ok: true,
          data: await updateSearchSpace(id, body as CreateSearchSpaceInput),
        });
      case 'runtime-profiles':
        return NextResponse.json({
          ok: true,
          data: await updateRuntimeProfile(id, body as CreateRuntimeProfileInput),
        });
      case 'structured-output-destinations':
        return NextResponse.json({
          ok: true,
          data: await updateStructuredOutputDestination(
            id,
            body as CreateStructuredOutputDestinationInput,
          ),
        });
      case 'pipelines':
        return NextResponse.json({
          ok: true,
          data: await updatePipeline(id, body as CreatePipelineInput),
        });
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected control-plane error.',
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { resource } = await context.params;
  const parsedResource = resourceSchema.safeParse(resource);
  if (
    !parsedResource.success ||
    parsedResource.data === 'overview' ||
    parsedResource.data === 'runs'
  ) {
    return NextResponse.json(
      { ok: false, error: 'Unknown control-plane resource.' },
      { status: 404 },
    );
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'Missing required query param "id".' },
      { status: 400 },
    );
  }

  try {
    switch (parsedResource.data) {
      case 'search-spaces':
        await deleteSearchSpace(id);
        break;
      case 'runtime-profiles':
        await deleteRuntimeProfile(id);
        break;
      case 'structured-output-destinations':
        await deleteStructuredOutputDestination(id);
        break;
      case 'pipelines':
        await deletePipeline(id);
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected control-plane error.',
      },
      { status: 400 },
    );
  }
}
