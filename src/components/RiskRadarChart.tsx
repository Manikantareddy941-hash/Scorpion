import {
  Radar, RadarChart as ReRadarChart, PolarGrid, 
  PolarAngleAxis, ResponsiveContainer
} from 'recharts';

const data = [
  { subject: 'CODE', A: 120, fullMark: 150 },
  { subject: 'NETWORK', A: 98, fullMark: 150 },
  { subject: 'ACCESS', A: 86, fullMark: 150 },
  { subject: 'DEPLOY', A: 99, fullMark: 150 },
  { subject: 'SECRETS', A: 85, fullMark: 150 },
  { subject: 'DAST', A: 65, fullMark: 150 },
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
