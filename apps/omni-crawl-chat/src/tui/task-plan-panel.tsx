import React from 'react';
import { Box, Text } from 'ink';

import type { PlannedTask } from '../graph/state.js';
import { formatTaskArg } from '../graph/task-utils.js';

const statusColorByTask: Record<PlannedTask['status'], 'green' | 'yellow' | 'red'> = {
  pending: 'yellow',
  running: 'yellow',
  done: 'green',
  failed: 'red',
};

export type TaskPlanPanelProps = {
  tasks: PlannedTask[];
};

export const TaskPlanPanel = ({ tasks }: TaskPlanPanelProps) => {
  if (tasks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>TASK PLAN</Text>
        <Text>No tasks were planned.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>TASK PLAN</Text>
      {tasks.map((task) => (
        <Box key={task.id} flexDirection="column" marginTop={1}>
          <Text>
            {task.id}{' '}
            <Text color={statusColorByTask[task.status]}>{task.status.toUpperCase()}</Text>
          </Text>
          <Text> {task.description}</Text>
          <Text> OP: {task.operation}</Text>
          <Text> ARGS: {task.args.map(formatTaskArg).join(', ')}</Text>
          <Text> DEPS: {task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'none'}</Text>
          <Text> RESULT: {task.result ?? 'n/a'}</Text>
          {task.error ? <Text color="red"> ERROR: {task.error}</Text> : null}
        </Box>
      ))}
    </Box>
  );
};
