import {
  Radar, RadarChart as ReRadarChart, PolarGrid, 
  PolarAngleAxis, ResponsiveContainer
} from 'recharts';

const data = [
  { subject: 'Authentication', A: 85, fullMark: 100 },
  { subject: 'Network Access', A: 72, fullMark: 100 },
  { subject: 'Defense Evasion', A: 90, fullMark: 100 },
  { subject: 'Data Exfiltration', A: 65, fullMark: 100 },
  { subject: 'Asset Exposure', A: 45, fullMark: 100 },
  { subject: 'Privilege Use', A: 80, fullMark: 100 },
];

export default function RadarChart() {
  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ReRadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="#1E1E1E" />
          <PolarAngleAxis 
            dataKey="subject" 
            tick={{ fill: '#666', fontSize: 9, fontWeight: 900 }}
          />
          <Radar
            name="Risk Score"
            dataKey="A"
            stroke="#E8440A"
            fill="#E8440A"
            fillOpacity={0.15}
          />
        </ReRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
