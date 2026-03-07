import React, { useEffect } from 'react';
import { Box, Text, useApp } from 'ink';

import type { ChatState } from '../graph/state.js';
import { TaskPlanPanel } from './task-plan-panel.js';
import { TracePanel } from './trace-panel.js';

export type AppScreenProps = {
  state: ChatState;
};

export const AppScreen = ({ state }: AppScreenProps) => {
  const { exit } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => exit(), 0);
    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>JOB COMPASS CHAT</Text>
      <Text>Planner output is structured and observable.</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>USER REQUEST</Text>
        <Text>{state.userMessage}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>PLANNER TRACE</Text>
        <Text>SUMMARY: {state.plannerTrace.userMessageSummary ?? 'n/a'}</Text>
        <Text>DECOMPOSITION: {state.plannerTrace.decompositionSummary ?? 'n/a'}</Text>
        <Text>ROUTING: {state.plannerTrace.routingSummary ?? 'n/a'}</Text>
        <Text>COMPLETION: {state.plannerTrace.completionSummary ?? 'n/a'}</Text>
        <Text>
          WARNINGS:{' '}
          {state.plannerTrace.warnings.length > 0 ? state.plannerTrace.warnings.join('; ') : 'none'}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>FINAL ANSWER</Text>
        <Text>{state.finalAnswer ?? 'No final answer produced.'}</Text>
      </Box>

      <Box marginTop={1}>
        <TaskPlanPanel tasks={state.tasks} />
      </Box>

      <Box marginTop={1}>
        <TracePanel entries={state.traceEntries} />
      </Box>
    </Box>
  );
};
