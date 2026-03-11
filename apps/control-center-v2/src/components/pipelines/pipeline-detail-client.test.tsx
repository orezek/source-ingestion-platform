import { controlPlanePipelineV2Fixture } from '@repo/control-plane-contracts/v2';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineDetailClient } from '@/components/pipelines/pipeline-detail-client';

const push = vi.fn();
const refresh = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    refresh,
  }),
}));

vi.mock('@/lib/live', () => ({
  upsertRun: (runs: unknown[]) => runs,
  useControlStream: () => 'live',
}));

describe('PipelineDetailClient', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('React', React);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps page title unchanged while editing and updates only after successful save', async () => {
    const pipeline = {
      ...controlPlanePipelineV2Fixture,
      name: 'Original Pipeline Name',
    };

    render(<PipelineDetailClient pipeline={pipeline} initialRuns={[]} />);

    expect(screen.getByText('Original Pipeline Name', { selector: 'h2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Pipeline' }));

    const nameInput = screen.getByLabelText(/display name/i);
    fireEvent.change(nameInput, { target: { value: 'Unsaved Name Draft' } });

    expect(screen.getByText('Original Pipeline Name', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved Name Draft', { selector: 'h2' })).not.toBeInTheDocument();

    const updatedPipeline = {
      ...pipeline,
      name: 'Validated Pipeline Name',
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => updatedPipeline,
    } as Response);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Pipeline Config' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Validated Pipeline Name', { selector: 'h2' })).toBeInTheDocument();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
