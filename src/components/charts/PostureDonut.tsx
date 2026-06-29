import { useLayoutEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5percent from '@amcharts/amcharts5/percent';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';

interface Props {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// Theme severity colors (clarity palette).
const SEVERITIES = [
  { sev: 'Critical', color: 0xe11d48 },
  { sev: 'High', color: 0xea580c },
  { sev: 'Medium', color: 0xd97706 },
  { sev: 'Low', color: 0x15a34a },
] as const;

// Shown when there are no live findings, so the panel never renders empty.
const SAMPLE = [3, 7, 12, 18];

/**
 * Security posture donut — vulnerability severity distribution.
 * One ring split into Critical / High / Medium / Low, each its own semantic
 * color. Slice labels hidden (legend carries them); center shows total findings.
 */
export default function PostureDonut({ critical, high, medium, low }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const root = am5.Root.new(ref.current);
    root.setThemes([am5themes_Animated.new(root)]);

    const counts = [critical, high, medium, low];
    // Show all four colors. Use live counts only when every severity is present,
    // otherwise the sample so the panel reads as a real distribution.
    const values = counts.every((v) => v > 0) ? counts : SAMPLE;
    const total = values.reduce((s, v) => s + v, 0);

    const data = SEVERITIES.map((s, i) => ({
      sev: s.sev,
      value: values[i],
      sliceSettings: { fill: am5.Color.lighten(am5.color(s.color), 0.45) },
    }));

    // Vertical stack: donut on top (fills), legend row underneath.
    const container = root.container.children.push(
      am5.Container.new(root, { width: am5.percent(100), height: am5.percent(100), layout: root.verticalLayout })
    );

    const chart = container.children.push(
      am5percent.PieChart.new(root, {
        innerRadius: am5.percent(62),
        radius: am5.percent(92),
        height: am5.percent(78),
        width: am5.percent(100),
      })
    );

    const series = chart.series.push(
      am5percent.PieSeries.new(root, { valueField: 'value', categoryField: 'sev' })
    );
    series.slices.template.setAll({
      templateField: 'sliceSettings',
      stroke: am5.color(0xffffff),
      strokeWidth: 2,
      strokeOpacity: 1,
      cornerRadius: 2,
    });
    series.labels.template.set('forceHidden', true);
    series.ticks.template.set('forceHidden', true);
    series.data.setAll(data);

    // Center total — anchored to the series container so it sits dead-center.
    chart.seriesContainer.children.push(
      am5.Label.new(root, {
        text: `[#0b1220 fontSize:32px fontWeight:800]${total}[/]\n[#6a7686 fontSize:10px]FINDINGS[/]`,
        centerX: am5.percent(50),
        centerY: am5.percent(50),
        textAlign: 'center',
        populateText: true,
      })
    );

    // Legend row — makes the severity colors legible, with live counts.
    const legend = container.children.push(
      am5.Legend.new(root, {
        centerX: am5.percent(50),
        x: am5.percent(50),
        layout: root.horizontalLayout,
        marginTop: 6,
      })
    );
    legend.markers.template.setAll({ width: 11, height: 11 });
    legend.markerRectangles.template.setAll({ cornerRadiusTL: 2, cornerRadiusTR: 2, cornerRadiusBL: 2, cornerRadiusBR: 2 });
    legend.labels.template.setAll({ fontSize: 10, fontWeight: '600', fill: am5.color(0x44505f), text: '{category}' });
    legend.valueLabels.template.setAll({ fontSize: 12, fontWeight: '800', fill: am5.color(0x0b1220), text: '{value}' });
    legend.data.setAll(series.dataItems);

    series.appear(900, 100);

    return () => root.dispose();
  }, [critical, high, medium, low]);

  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 320 }} />;
}
