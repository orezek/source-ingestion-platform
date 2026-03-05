'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

type PipelineOption = {
  id: string;
  name: string;
};

type ActivePipelineRun = {
  runId: string;
  status: 'queued' | 'running';
};

type StartRunFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  pipelines: PipelineOption[];
  activePipelineRuns: Record<string, ActivePipelineRun>;
};

function StartRunSubmitButton(input: { disabled: boolean }): JSX.Element {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={input.disabled || pending}
      data-testid="start-run-submit"
      aria-disabled={input.disabled || pending}
    >
      {pending ? 'Starting…' : 'Start run'}
    </button>
  );
}

export function StartRunForm(input: StartRunFormProps): JSX.Element {
  const initialPipelineId = input.pipelines[0]?.id ?? '';
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const activeRun = pipelineId ? input.activePipelineRuns[pipelineId] : undefined;

  return (
    <form action={input.action} className="control-form control-form--stacked">
      <label>
        <span>PIPELINE</span>
        <select
          name="pipelineId"
          required
          value={pipelineId}
          onChange={(event) => setPipelineId(event.target.value)}
          data-testid="start-run-pipeline"
        >
          {input.pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </label>
      <div className="control-form__actions">
        {activeRun ? (
          <p className="form-inline-note" data-testid="start-run-conflict">
            Active run {activeRun.runId} is already {activeRun.status} for this pipeline.
          </p>
        ) : null}
        <StartRunSubmitButton disabled={input.pipelines.length === 0 || Boolean(activeRun)} />
      </div>
    </form>
  );
}
