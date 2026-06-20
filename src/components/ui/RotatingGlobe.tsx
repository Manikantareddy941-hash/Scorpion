import React, { useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5map from '@amcharts/amcharts5/map';
import am4geodata_worldLow from '@amcharts/amcharts4-geodata/worldLow';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { useThemeColors } from './useThemeColors';

interface RotatingGlobeProps {
  size?: number;
  className?: string;
}

const RotatingGlobe: React.FC<RotatingGlobeProps> = ({ size = 120, className = '' }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<am5.Root | null>(null);
  const polygonSeriesRef = useRef<am5map.MapPolygonSeries | null>(null);
  const backgroundSeriesRef = useRef<am5map.MapPolygonSeries | null>(null);
  const colors = useThemeColors(['--accent-primary', '--bg-card', '--bg-primary']);

  useEffect(() => {
    if (!chartRef.current) return;

    const root = am5.Root.new(chartRef.current);
    rootRef.current = root;
    root.setThemes([am5themes_Animated.new(root)]);
    root._logo?.dispose();

    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        panX: 'rotateX',
        panY: 'rotateY',
        projection: am5map.geoOrthographic(),
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      })
    );

    const backgroundSeries = chart.series.push(am5map.MapPolygonSeries.new(root, {}));
    backgroundSeries.mapPolygons.template.setAll({ fillOpacity: 0.3, strokeOpacity: 0 });
    backgroundSeries.data.push({ geometry: am5map.getGeoRectangle(90, 180, -90, -180) });
    backgroundSeriesRef.current = backgroundSeries;

    const polygonSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, { geoJSON: am4geodata_worldLow as any })
    );
    polygonSeries.mapPolygons.template.setAll({ tooltipText: '' });
    polygonSeriesRef.current = polygonSeries;

    chart.animate({ key: 'rotationX', from: 0, to: 360, duration: 30000, loops: Infinity });
    chart.appear(1000, 100);

    return () => {
      root.dispose();
      rootRef.current = null;
      polygonSeriesRef.current = null;
      backgroundSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!polygonSeriesRef.current || !backgroundSeriesRef.current) return;
    polygonSeriesRef.current.mapPolygons.template.setAll({
      fill: am5.color(colors['--accent-primary'] || '#2563eb'),
      stroke: am5.color(colors['--bg-card']),
    });
    backgroundSeriesRef.current.mapPolygons.template.setAll({
      fill: am5.color(colors['--bg-primary']),
    });
  }, [colors]);

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default RotatingGlobe;
