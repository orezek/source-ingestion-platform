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
  text: '#E9E5DC',
  textSecondary: '#B7B2A8',
  structure: 'rgba(42, 52, 64, 0.48)',
  success: '#5F8A6E',
  warning: '#A78853',
  error: '#B66C7B',
  info: '#89A8D3',
  accentPower: '#132F57',
  accentPrecision: '#2A1E4A',
  muted: '#58697D',
};

const axisTick = {
  fill: colors.textSecondary,
  fontFamily: 'IBM Plex Mono, JetBrains Mono, monospace',
  fontSize: 11,
};

const tooltipStyle = {
  backgroundColor: '#0A1A2B',
  border: '1px solid rgba(42, 52, 64, 0.72)',
  borderRadius: 2,
  color: '#E9E5DC',
  fontFamily: 'IBM Plex Mono, JetBrains Mono, monospace',
  fontSize: '12px',
};

const tooltipLabelStyle = {
  color: '#B7B2A8',
  fontFamily: 'IBM Plex Mono, JetBrains Mono, monospace',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
};

const tooltipItemStyle = {
  color: '#E9E5DC',
  fontFamily: 'IBM Plex Mono, JetBrains Mono, monospace',
};

export function OverviewChartsPanel({ charts }: { charts: OverviewCharts }) {
  return (
    <div className="chart-grid chart-grid--overview">
      <ChartFrame title="Crawler status trend" description="Recent crawler outcomes by run.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={charts.crawlerStatusTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.structure} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
            />
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
            <CartesianGrid strokeDasharray="2 6" stroke={colors.structure} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} />
            <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
            />
            <Area
              type="monotone"
              dataKey="successRate"
              stroke={colors.info}
              fill={colors.accentPower}
              fillOpacity={0.42}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Ingestion outcomes"
        description="Processed, skipped, and failed jobs per run."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.ingestionOutcomeTrend}>
            <CartesianGrid strokeDasharray="2 6" stroke={colors.structure} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} />
            <YAxis tick={axisTick} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
            />
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
            <CartesianGrid strokeDasharray="2 6" stroke={colors.structure} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} />
            <YAxis tick={axisTick} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
            />
            <Bar dataKey="newJobs" fill={colors.text} />
            <Bar dataKey="existingJobs" fill={colors.muted} />
            <Bar dataKey="inactiveMarked" fill={colors.accentPrecision} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <div className="chart-grid__item--full">
        <ChartFrame
          title="Tokens and cost"
          description="Total token volume and estimated cost by ingestion run."
        >
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={charts.costAndTokensTrend}>
              <CartesianGrid strokeDasharray="2 6" stroke={colors.structure} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} />
              <YAxis yAxisId="left" tick={axisTick} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="totalTokens"
                stroke={colors.text}
                fill={colors.accentPrecision}
                fillOpacity={0.42}
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
    </div>
  );
}
