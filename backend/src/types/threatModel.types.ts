export interface DiagramData {
  nodes: unknown[];
  edges: unknown[];
}

export interface Threat {
  threatId: string;
  component: string;
  strideCategory: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigations: string[];
}

export interface ThreatModel {
  $id?: string;
  name: string;
  description: string;
  diagramData: DiagramData;
  threats: Threat[];
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  status: 'draft' | 'review' | 'final';
}
