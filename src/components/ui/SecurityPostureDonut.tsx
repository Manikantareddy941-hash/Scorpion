import React, { useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5percent from '@amcharts/amcharts5/percent';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { useThemeColors } from './useThemeColors';

interface SecurityPostureDonutProps {
  score: number;
  critical: number;
  high: number;
  medium: number;
  size?: number;
  className?: string;
}

const SecurityPostureDonut: React.FC<SecurityPostureDonutProps> = ({
  score,
  critical,
  high,
  medium,
  size = 220,
  className = '',
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<am5.Root | null>(null);
  const seriesRef = useRef<am5percent.PieSeries | null>(null);
  const labelRef = useRef<am5.Label | null>(null);
  const colors = useThemeColors([
    '--severity-critical',
    '--severity-high',
    '--severity-medium',
    '--border-subtle',
    '--text-primary',
    '--text-secondary',
  ]);

  useEffect(() => {
    if (!chartRef.current) return;

    const root = am5.Root.new(chartRef.current);
    rootRef.current = root;
    root.setThemes([am5themes_Animated.new(root)]);
    root._logo?.dispose();

    // True upper-half semi-circle, matching the reference exactly
    // (180° → 360°), not the previous 160/380 tilt.
    const chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        startAngle: 180,
        endAngle: 360,
        layout: root.verticalLayout,
        innerRadius: am5.percent(70),
      })
    );

    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        startAngle: 180,
        endAngle: 360,
        valueField: 'value',
        categoryField: 'label',
        alignLabels: false,
      })
    );

    // Same hidden-state trick as the reference, for a clean collapse-from-
    // flat entrance animation instead of just fading in.
    series.states.create('hidden', { startAngle: 180, endAngle: 180 });

    series.slices.template.setAll({
      cornerRadius: 6,
      strokeWidth: 0,
      tooltipText: '{category}: {value}',
    });
    series.ticks.template.set('forceHidden', true);
    series.labels.template.set('forceHidden', true);
    seriesRef.current = series;

    const centerLabel = chart.seriesContainer.children.push(
      am5.Label.new(root, {
        textAlign: 'center',
        centerY: am5.p100,
        centerX: am5.p50,
        text: '',
      })
    );
    labelRef.current = centerLabel;

    series.appear(1000, 100);

    return () => {
      root.dispose();
      rootRef.current = null;
      seriesRef.current = null;
      labelRef.current = null;
    };
  }, []);

  // Still a single-score gauge: filled segment = score, remainder segment
  // = (100 - score), colored with the theme's neutral border tone so it
  // reads as "unfilled track," not a second meaningful category.
  useEffect(() => {
    if (!seriesRef.current) return;
    const filled = Math.max(0, Math.min(100, Math.round(score)));
    const remainder = 100 - filled;

    const severityColor =
      critical > 0 ? colors['--severity-critical']
      : high > 0 ? colors['--severity-high']
      : medium > 0 ? colors['--severity-medium']
      : colors['--severity-medium'];

    seriesRef.current.data.setAll([
      { label: 'Score', value: filled, key: 'score' },
      { label: 'Remainder', value: remainder, key: 'remainder' },
    ]);

    seriesRef.current.slices.template.adapters.add('fill', (_fill, target) => {
      const key = (target.dataItem?.dataContext as any)?.key;
      if (key === 'remainder') return am5.color(colors['--border-subtle'] ?? '#e5e7eb');
      return am5.color(severityColor ?? '#2563eb');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, critical, high, medium, colors]);

  useEffect(() => {
    if (!labelRef.current) return;
    const textColor = colors['--text-primary'] || '#0f1729';
    const subColor = colors['--text-secondary'] || '#5b6b85';
    labelRef.current.set(
      'text',
      `[${subColor} fontSize:11px]SCORE[/]\n[${textColor} bold fontSize:32px]${Math.round(score)}[/]`
    );
  }, [score, colors]);

  return (
    <div className={`inline-flex relative justify-center items-center w-full ${className}`} style={{ height: size }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default SecurityPostureDonut;