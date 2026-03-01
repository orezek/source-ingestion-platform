import React from 'react';
import { Box, Text } from 'ink';

import type { TraceEntry } from '../graph/state.js';

export type TracePanelProps = {
  entries: TraceEntry[];
};

export const TracePanel = ({ entries }: TracePanelProps) => {
  if (entries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>TRACE</Text>
        <Text>No execution trace was recorded.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>TRACE</Text>
      {entries.map((entry, index) => (
        <Box key={`${entry.step}-${entry.phase}-${index}`} flexDirection="column" marginTop={1}>
          <Text>
            STEP {entry.step} | {entry.phase.toUpperCase()}
            {entry.workerNode ? ` | ${entry.workerNode}` : ''}
            {entry.taskId ? ` | ${entry.taskId}` : ''}
          </Text>
          <Text> {entry.summary}</Text>
          {entry.result !== undefined ? <Text> RESULT: {entry.result}</Text> : null}
        </Box>
      ))}
    </Box>
  );
};
