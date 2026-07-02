import React, { useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5radar from '@amcharts/amcharts5/radar';
import * as am5xy from '@amcharts/amcharts5/xy';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { useThemeColors } from './useThemeColors';

export interface ThreatRadarDatum {
  axis: string;
  value: number;
  fullMark?: number;
}

interface ThreatRadarProps {
  data: ThreatRadarDatum[];
  size?: number;
  max?: number;
  label?: string;
  className?: string;
}

export const DEFAULT_THREAT_AXES: ThreatRadarDatum[] = [
  { axis: 'Secrets', value: 0 },
  { axis: 'Vulnerabilities', value: 0 },
  { axis: 'SAST', value: 0 },
  { axis: 'Dependencies', value: 0 },
  { axis: 'IaC', value: 0 },
  { axis: 'Licenses', value: 0 },
];

const ThreatRadar: React.FC<ThreatRadarProps> = ({
  data,
  size = 260,
  max = 100,
  label,
  className = '',
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<am5.Root | null>(null);
  const chartObjRef = useRef<am5radar.RadarChart | null>(null);
  const seriesRef = useRef<am5radar.RadarColumnSeries | null>(null);
  const xAxisRef = useRef<am5xy.CategoryAxis<am5radar.AxisRendererCircular> | null>(null);
  const yAxisRef = useRef<am5xy.ValueAxis<am5radar.AxisRendererRadial> | null>(null);
  const colors = useThemeColors(['--chart-grid', '--chart-label']);

  useEffect(() => {
    if (!chartRef.current) return;

    const root = am5.Root.new(chartRef.current);
    rootRef.current = root;
    root.setThemes([am5themes_Animated.new(root)]);
    root._logo?.dispose();

    // Full 0–360° radar with a donut hole at center — same proportions as
    // the reference. No panning/zooming: this is a small dashboard widget,
    // not an explorable chart.
    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        panX: false,
        panY: false,
        innerRadius: am5.percent(40),
      }),
    );
    chartObjRef.current = chart;
    chart.zoomOutButton.set('forceHidden', true);

    const xRenderer = am5radar.AxisRendererCircular.new(root, { minGridDistance: 30 });
    xRenderer.grid.template.set('visible', false);

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        maxDeviation: 0.3,
        categoryField: 'axis',
        renderer: xRenderer,
      }),
    ) as am5xy.CategoryAxis<am5radar.AxisRendererCircular>;
    xAxisRef.current = xAxis;

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        maxDeviation: 0.3,
        min: 0,
        max,
        renderer: am5radar.AxisRendererRadial.new(root, {}),
      }),
    ) as am5xy.ValueAxis<am5radar.AxisRendererRadial>;
    yAxisRef.current = yAxis;

    const series = chart.series.push(
      am5radar.RadarColumnSeries.new(root, {
        name: 'Coverage',
        xAxis,
        yAxis,
        valueYField: 'value',
        categoryXField: 'axis',
      }),
    );

    series.columns.template.setAll({
      cornerRadius: 5,
      tooltipText: '{categoryX}: {valueY}',
      // Minimum visible height so a 0-value domain still shows a small nub
      // instead of disappearing entirely — six axes should always be
      // visually present, even when a domain has nothing to report yet.
      minHeight: 6,
    });

    // Distinct color per security domain, same as the reference — each
    // axis (Secrets/Vulnerabilities/SAST/Dependencies/IaC/Licenses) gets
    // its own hue from amCharts' built-in color set rather than a single
    // severity color. This trades "severity at a glance" for "which
    // domain has coverage at a glance" — flagged as a deliberate choice,
    // not an accident.
    series.columns.template.adapters.add('fill', (fill, target) => {
      return chart.get('colors')!.getIndex(series.columns.indexOf(target));
    });
    series.columns.template.adapters.add('stroke', (stroke, target) => {
      return chart.get('colors')!.getIndex(series.columns.indexOf(target));
    });

    seriesRef.current = series;

    series.appear(1000);
    chart.appear(1000, 100);

    return () => {
      root.dispose();
      rootRef.current = null;
      chartObjRef.current = null;
      seriesRef.current = null;
      xAxisRef.current = null;
      yAxisRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sort + animate ONLY when real data changes (new scan, realtime
  // update) — NOT on a fake timer. This is the deliberate departure from
  // the reference's setInterval demo: security metrics should never
  // appear to change unless they actually did.
  useEffect(() => {
    if (!xAxisRef.current || !seriesRef.current) return;
    xAxisRef.current.data.setAll(data);
    seriesRef.current.data.setAll(data.map((d) => ({ axis: d.axis, value: d.value })));
    sortCategoryAxis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!yAxisRef.current) return;
    yAxisRef.current.set('max', max);
  }, [max]);

  // Axis-label re-sort animation, adapted directly from the reference's
  // sortCategoryAxis() — descending by value, with the same delta-position
  // smoothing so labels glide into their new rank instead of jumping.
  function sortCategoryAxis() {
    const series = seriesRef.current;
    const xAxis = xAxisRef.current;
    if (!series || !xAxis) return;

    series.dataItems.sort((x, y) => (y.get('valueY') ?? 0) - (x.get('valueY') ?? 0));

    am5.array.each(xAxis.dataItems, (dataItem) => {
      const category = dataItem.get('category');
      const seriesDataItem = series.dataItems.find((di) => di.get('categoryX') === category);
      if (seriesDataItem) {
        const index = series.dataItems.indexOf(seriesDataItem);
        const deltaPosition = (index - (dataItem.get('index') ?? 0)) / series.dataItems.length;
        dataItem.set('index', index);
        dataItem.set('deltaPosition', -deltaPosition);
        dataItem.animate({
          key: 'deltaPosition',
          to: 0,
          duration: 1000,
          easing: am5.ease.out(am5.ease.cubic),
        });
      }
    });

    xAxis.dataItems.sort((x, y) => (x.get('index') ?? 0) - (y.get('index') ?? 0));
  }

  // Theme-aware label/grid colors, applied after creation so the chart
  // stays legible in both light and dark themes.
  useEffect(() => {
    if (!xAxisRef.current || !yAxisRef.current) return;
    const gridColor = am5.color(colors['--chart-grid'] || '#888888');
    const labelColor = am5.color(colors['--chart-label'] || '#888888');
    xAxisRef.current.get('renderer')?.labels.template.setAll({ fill: labelColor, fontSize: 11 });
    yAxisRef.current
      .get('renderer')
      ?.grid.template.setAll({ stroke: gridColor, strokeOpacity: 0.4 });
    yAxisRef.current.get('renderer')?.labels.template.setAll({ fill: labelColor, fontSize: 9 });
  }, [colors]);

  return (
    <div className={className}>
      {label && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {label}
        </div>
      )}
      <div ref={chartRef} style={{ width: '100%', height: size }} />
    </div>
  );
};

export default ThreatRadar;
