import React, { useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5percent from '@amcharts/amcharts5/percent';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { useThemeColors } from './useThemeColors';

export interface StatusDonutDatum {
  label: string;
  value: number;
  /** CSS custom property name (e.g. '--severity-critical') resolved at render time. */
  colorVar: string;
}

interface StatusDonutProps {
  data: StatusDonutDatum[];
  size?: number;
  className?: string;
}

const StatusDonut: React.FC<StatusDonutProps> = ({ data, size = 110, className = '' }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<am5.Root | null>(null);
  const seriesRef = useRef<am5percent.PieSeries | null>(null);
  const labelRef = useRef<am5.Label | null>(null);
  const colors = useThemeColors(['--text-primary', '--text-secondary', ...data.map((d) => d.colorVar)]);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  useEffect(() => {
    if (!chartRef.current) return;

    const root = am5.Root.new(chartRef.current);
    rootRef.current = root;
    root.setThemes([am5themes_Animated.new(root)]);
    root._logo?.dispose();

    const chart = root.container.children.push(
      am5percent.PieChart.new(root, { layout: root.verticalLayout })
    );

    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        valueField: 'value',
        categoryField: 'label',
        radius: am5.percent(95),
        innerRadius: am5.percent(70),
      })
    );
    series.ticks.template.set('forceHidden', true);
    series.labels.template.set('forceHidden', true);
    series.slices.template.setAll({ strokeWidth: 0, cornerRadius: 6, tooltipText: '{category}: {value}' });
    series.slices.template.adapters.add('fill', (_fill, target) => {
      const colorVar = (target.dataItem?.dataContext as any)?.colorVar as string | undefined;
      return colorVar ? am5.color(colorsRef.current[colorVar] || '#888888') : _fill;
    });
    seriesRef.current = series;

    const centerLabel = chart.seriesContainer.children.push(
      am5.Label.new(root, { textAlign: 'center', centerY: am5.p50, centerX: am5.p50, text: '' })
    );
    labelRef.current = centerLabel;

    series.appear(600, 100);

    return () => {
      root.dispose();
      rootRef.current = null;
      seriesRef.current = null;
      labelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.data.setAll(data.length > 0 ? data : [{ label: 'None', value: 1, colorVar: '--text-secondary' }]);
  }, [data, colors]);

  useEffect(() => {
    if (!labelRef.current) return;
    const total = data.reduce((sum, d) => sum + d.value, 0);
    const textColor = colors['--text-primary'] || '#ffffff';
    const subColor = colors['--text-secondary'] || '#999999';
    labelRef.current.set(
      'text',
      `[${subColor} fontSize:9px]TOTAL[/]\n[${textColor} bold fontSize:20px]${total}[/]`
    );
  }, [data, colors]);

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default StatusDonut;
