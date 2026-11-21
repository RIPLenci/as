'use client';

import React, { useEffect, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';

interface EChartProps {
  option: EChartsOption;
  height?: number;
  className?: string;
  isDark?: boolean;
}

export function EChart({ option, height = 300, className = '', isDark = true }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const latestOptionRef = useRef<{ option: EChartsOption; isDark: boolean }>({ option, isDark });

  useEffect(() => {
    latestOptionRef.current = { option, isDark };
  }, [option, isDark]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let ro: ResizeObserver | null = null;

    void import('echarts').then((echarts) => {
      if (disposed || !containerRef.current) return;

      const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
      chartRef.current = chart;

      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const current = latestOptionRef.current;

      chart.setOption(
        {
          animation: !prefersReduced,
          animationDuration: 350,
          backgroundColor: 'transparent',
          textStyle: {
            color: current.isDark ? '#94A3B8' : '#475569',
            fontFamily: 'var(--font-dm-sans), system-ui, sans-serif',
          },
          ...current.option,
        },
        { notMerge: true }
      );

      ro = new ResizeObserver(() => {
        chart.resize();
      });
      ro.observe(containerRef.current);
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    chartRef.current.setOption(
      {
        animation: !prefersReduced,
        animationDuration: 350,
        backgroundColor: 'transparent',
        textStyle: {
          color: isDark ? '#94A3B8' : '#475569',
          fontFamily: 'var(--font-dm-sans), system-ui, sans-serif',
        },
        ...option,
      },
      { notMerge: true }
    );
  }, [option, isDark]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%' }}
      className={className}
    />
  );
}
