import { useLayoutEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import * as am5radar from '@amcharts/amcharts5/radar';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';

const THREATS = [
  'SQL Injection', 'XSS', 'CSRF', 'SSRF', 'RCE', 'Path Traversal',
  'Auth Bypass', 'Priv Esc', 'Secrets Leak', 'Insecure Deps', 'Misconfig', 'Broken Access',
  'Crypto Failure', 'Insecure Design', 'Logging Gaps', 'DoS', 'Supply Chain', 'Container Escape',
  'IAM Drift', 'Exposed Ports', 'Malware', 'Phishing', 'Data Exfil', 'Zero-Day',
];

// Deterministic counts within the specified ranges (active ~14-160, mitigated ~2.8-102.2).
const DATA = THREATS.map((threat, i) => ({
  threat,
  active: Math.round((14 + ((i * 37) % 147) + (i % 5) * 3) * 10) / 10,
  mitigated: Math.round((2.8 + ((i * 23) % 100) + (i % 3) * 2) * 10) / 10,
}));

const ACTIVE = 0xe11d48; // critical red — live exposure
const MITIGATED = 0x15a34a; // green — resolved

/**
 * Threat radar — stacked area radar (donut). 24 threat categories on a circular
 * axis, two stacked translucent zones (Active / Mitigated). Labels are rotated
 * along their spoke so they never collide; legend sits in the center hole.
 */
export default function CoverageRadar() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const root = am5.Root.new(ref.current);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        panX: false,
        panY: false,
        startAngle: -90,
        endAngle: 270,
        radius: am5.percent(78),
        innerRadius: am5.percent(40),
      })
    );

    const cursor = chart.set('cursor', am5radar.RadarCursor.new(root, { behavior: 'zoomX' }));
    cursor.lineY.set('visible', false);

    const xRenderer = am5radar.AxisRendererCircular.new(root, { minGridDistance: 10 });
    xRenderer.labels.template.setAll({
      textType: 'adjusted', // rotate each label along its spoke → no horizontal collision
      fontSize: 9,
      fill: am5.color(0x6a7686),
      radius: 8,
    });
    xRenderer.grid.template.setAll({ strokeDasharray: [3, 3], strokeOpacity: 0.5 });

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'threat',
        renderer: xRenderer,
      })
    );
    xAxis.data.setAll(DATA);

    const yRenderer = am5radar.AxisRendererRadial.new(root, {});
    yRenderer.labels.template.setAll({ fontSize: 9, fill: am5.color(0x6a7686) });
    yRenderer.grid.template.setAll({ strokeDasharray: [3, 3], strokeOpacity: 0.5 });

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, { min: 0, renderer: yRenderer })
    );

    const tooltipText = 'Active: {active}\nMitigated: {mitigated}';

    const makeSeries = (name: string, field: string, color: number) => {
      const series = chart.series.push(
        am5radar.RadarLineSeries.new(root, {
          name,
          xAxis,
          yAxis,
          valueYField: field,
          categoryXField: 'threat',
          stacked: true,
          fill: am5.color(color),
          stroke: am5.color(color),
          tooltip: am5.Tooltip.new(root, { labelText: tooltipText }),
        })
      );
      series.fills.template.setAll({ visible: true, fillOpacity: 0.45 });
      series.strokes.template.setAll({ strokeOpacity: 0 });
      series.data.setAll(DATA);
      series.appear(1000);
      return series;
    };

    makeSeries('Active threats', 'active', ACTIVE);
    makeSeries('Mitigated', 'mitigated', MITIGATED);

    // Legend in the center hole (matches the reference layout).
    const legend = chart.children.push(
      am5.Legend.new(root, {
        centerX: am5.percent(50),
        x: am5.percent(50),
        centerY: am5.percent(50),
        y: am5.percent(50),
        layout: root.verticalLayout,
      })
    );
    legend.markers.template.setAll({ width: 12, height: 12 });
    legend.labels.template.setAll({ fontSize: 10, fontWeight: '600' });
    legend.data.setAll(chart.series.values);

    chart.appear(1000, 100);

    return () => root.dispose();
  }, []);

  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 360 }} />;
}
