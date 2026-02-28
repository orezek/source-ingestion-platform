'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OverviewCharts } from '@/server/types';
import { ChartFrame } from '@/components/charts/chart-frame';

const colors = {
  ink: '#1D1A17',
  warm: '#F2E2B1',
  muted: '#D5C7A3',
  panel: '#BDB395',
  success: '#5F7A65',
  warning: '#8C6A2B',
  error: '#8A4B46',
  info: '#5D6C7A',
};

export function OverviewChartsPanel({ charts }: { charts: OverviewCharts }) {
  return (
    <div className="chart-grid">
      <ChartFrame title="Crawler status trend" description="Recent crawler outcomes by run.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={charts.crawlerStatusTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.panel} />
            <XAxis dataKey="label" stroke={colors.ink} />
            <YAxis allowDecimals={false} stroke={colors.ink} />
            <Tooltip />
            <Line type="monotone" dataKey="succeeded" stroke={colors.success} strokeWidth={2} />
            <Line
              type="monotone"
              dataKey="completedWithErrors"
              stroke={colors.warning}
              strokeWidth={2}
            />
            <Line type="monotone" dataKey="failed" stroke={colors.error} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Ingestion success rate"
        description="Success percentage over recent ingestion runs."
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={charts.ingestionSuccessTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.panel} />
            <XAxis dataKey="label" stroke={colors.ink} />
            <YAxis stroke={colors.ink} domain={[0, 100]} />
            <Tooltip />
            <Area type="monotone" dataKey="successRate" stroke={colors.info} fill={colors.warm} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Ingestion outcomes"
        description="Processed, skipped, and failed jobs per run."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.ingestionOutcomeTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.panel} />
            <XAxis dataKey="label" stroke={colors.ink} />
            <YAxis stroke={colors.ink} />
            <Tooltip />
            <Bar dataKey="processed" stackId="jobs" fill={colors.success} />
            <Bar dataKey="skipped" stackId="jobs" fill={colors.warning} />
            <Bar dataKey="failed" stackId="jobs" fill={colors.error} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Crawler outcomes"
        description="New, existing, and inactive-marked jobs by run."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.crawlerOutcomeTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.panel} />
            <XAxis dataKey="label" stroke={colors.ink} />
            <YAxis stroke={colors.ink} />
            <Tooltip />
            <Bar dataKey="newJobs" fill={colors.ink} />
            <Bar dataKey="existingJobs" fill={colors.muted} />
            <Bar dataKey="inactiveMarked" fill={colors.panel} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Tokens and cost"
        description="Total token volume and estimated cost by ingestion run."
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={charts.costAndTokensTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.panel} />
            <XAxis dataKey="label" stroke={colors.ink} />
            <YAxis yAxisId="left" stroke={colors.ink} />
            <YAxis yAxisId="right" orientation="right" stroke={colors.info} />
            <Tooltip />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="totalTokens"
              stroke={colors.ink}
              fill={colors.muted}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="costUsd"
              stroke={colors.info}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
