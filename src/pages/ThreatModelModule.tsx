import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  Plus, Trash2, Shield, Sparkles, Settings, ChevronRight, X, AlertTriangle,
  Play, Check, Edit3, ArrowRight, User, Tag, Zap, RefreshCw, Layers, ListTodo,
  MoreVertical, ChevronDown, FileText, Save, Eye, EyeOff, ZoomIn, ZoomOut,
  Maximize2, Minimize2, Database, Server, Globe, Lock, Unlock
} from 'lucide-react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  NodeTypes,
  BackgroundVariant
} from 'reactflow';
import 'reactflow/dist/style.css';
import toast from 'react-hot-toast';

// Types
interface ThreatModel {
  $id?: string;
  name: string;
  description: string;
  diagramData: any;
  threats: Threat[];
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  status: 'draft' | 'review' | 'final';
}

interface Threat {
  threatId: string;
  component: string;
  strideCategory: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigations: string[];
}

// Custom Node Types
const ProcessNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 bg-gradient-to-br from-blue-500/20 to-blue-600/20 border-2 border-blue-400 rounded-lg backdrop-blur-sm shadow-lg">
    <div className="flex items-center gap-2">
      <Server className="w-4 h-4 text-blue-400" />
      <span className="text-sm font-medium text-white">{data.label}</span>
    </div>
  </div>
);

const ExternalEntityNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 bg-gradient-to-br from-purple-500/20 to-purple-600/20 border-2 border-purple-400 rounded-lg backdrop-blur-sm shadow-lg">
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-purple-400" />
      <span className="text-sm font-medium text-white">{data.label}</span>
    </div>
  </div>
);

const DataStoreNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 bg-gradient-to-br from-green-500/20 to-green-600/20 border-2 border-green-400 rounded-lg backdrop-blur-sm shadow-lg">
    <div className="flex items-center gap-2">
      <Database className="w-4 h-4 text-green-400" />
      <span className="text-sm font-medium text-white">{data.label}</span>
    </div>
  </div>
);

const TrustBoundaryNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 bg-gradient-to-br from-orange-500/20 to-orange-600/20 border-2 border-orange-400 rounded-lg backdrop-blur-sm shadow-lg">
    <div className="flex items-center gap-2">
      <Lock className="w-4 h-4 text-orange-400" />
      <span className="text-sm font-medium text-white">{data.label}</span>
    </div>
  </div>
);

const nodeTypes: NodeTypes = {
  process: ProcessNode,
  externalEntity: ExternalEntityNode,
  dataStore: DataStoreNode,
  trustBoundary: TrustBoundaryNode,
};

export default function ThreatModelModule() {
  const { getJWT } = useAuth();
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [models, setModels] = useState<ThreatModel[]>([]);
  const [currentModel, setCurrentModel] = useState<ThreatModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showThreats, setShowThreats] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // React Flow State
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const API_BASE = process.env.VITE_API_BASE || 'http://localhost:3001';

  // Fetch all threat models
  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getJWT();
      const response = await fetch(`${API_BASE}/api/threat-models`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      setModels(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load threat models');
    } finally {
      setLoading(false);
    }
  }, [getJWT, API_BASE]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Create new model
  const createModel = async () => {
    try {
      const token = await getJWT();
      const response = await fetch(`${API_BASE}/api/threat-models`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'New Threat Model',
          description: 'Describe your system architecture',
          diagramData: { nodes: [], edges: [] },
          threats: [],
          createdBy: 'user',
          status: 'draft'
        })
      });
      if (!response.ok) throw new Error('Failed to create model');
      const newModel = await response.json();
      setCurrentModel(newModel);
      setNodes(newModel.diagramData.nodes || []);
      setEdges(newModel.diagramData.edges || []);
      setView('editor');
      toast.success('Threat model created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create model');
    }
  };

  // Open existing model
  const openModel = async (model: ThreatModel) => {
    setCurrentModel(model);
    setNodes(model.diagramData.nodes || []);
    setEdges(model.diagramData.edges || []);
    setView('editor');
  };

  // Delete model
  const deleteModel = async (id: string) => {
    if (!confirm('Are you sure you want to delete this threat model?')) return;
    try {
      const token = await getJWT();
      const response = await fetch(`${API_BASE}/api/threat-models/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to delete model');
      await fetchModels();
      toast.success('Threat model deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete model');
    }
  };

  // Save model
  const saveModel = async () => {
    if (!currentModel) return;
    try {
      const token = await getJWT();
      const response = await fetch(`${API_BASE}/api/threat-models/${currentModel.$id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: currentModel.name,
          description: currentModel.description,
          diagramData: { nodes, edges },
          threats: currentModel.threats,
          status: currentModel.status
        })
      });
      if (!response.ok) throw new Error('Failed to save model');
      const updated = await response.json();
      setCurrentModel(updated);
      toast.success('Threat model saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save model');
    }
  };

  // Run AI Analysis
  const runAnalysis = async () => {
    if (!currentModel) return;
    try {
      setAnalyzing(true);
      const token = await getJWT();
      const response = await fetch(`${API_BASE}/api/threat-models/${currentModel.$id}/analyze`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to analyze model');
      const analyzed = await response.json();
      setCurrentModel(analyzed);
      toast.success('STRIDE analysis completed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze model');
    } finally {
      setAnalyzing(false);
    }
  };

  // Add node to diagram
  const addNode = (type: string) => {
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type,
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: { label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${nodes.length + 1}` }
    };
    setNodes([...nodes, newNode]);
  };

  // React Flow callbacks
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({
      ...connection,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#6db87a', strokeWidth: 2 }
    }, eds));
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Status badge colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-500/20 text-gray-300 border-gray-500';
      case 'review': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500';
      case 'final': return 'bg-green-500/20 text-green-300 border-green-500';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500';
    }
  };

  // Severity badge colors
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-300 border-red-500';
      case 'high': return 'bg-orange-500/20 text-orange-300 border-orange-500';
      case 'medium': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500';
      case 'low': return 'bg-blue-500/20 text-blue-300 border-blue-500';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500';
    }
  };

  // STRIDE category colors
  const getStrideColor = (category: string) => {
    const colors: Record<string, string> = {
      'Spoofing': 'bg-purple-500/20 text-purple-300 border-purple-500',
      'Tampering': 'bg-red-500/20 text-red-300 border-red-500',
      'Repudiation': 'bg-orange-500/20 text-orange-300 border-orange-500',
      'Information Disclosure': 'bg-blue-500/20 text-blue-300 border-blue-500',
      'Denial of Service': 'bg-yellow-500/20 text-yellow-300 border-yellow-500',
      'Elevation of Privilege': 'bg-pink-500/20 text-pink-300 border-pink-500'
    };
    return colors[category] || 'bg-gray-500/20 text-gray-300 border-gray-500';
  };

  // Dashboard View
  const DashboardView = () => (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-green-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Threat Models</h1>
            <p className="text-sm text-gray-400">Design and analyze system security with STRIDE</p>
          </div>
        </div>
        <button
          onClick={createModel}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" />
          New Model
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-green-400 animate-spin" />
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-700 rounded-xl">
          <Shield className="w-16 h-16 text-gray-600 mb-4" />
          <p className="text-gray-400 mb-4">No threat models yet</p>
          <button
            onClick={createModel}
            className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-300 border border-green-500 rounded-lg hover:bg-green-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create First Model
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <div
              key={model.$id}
              className="p-4 bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-gray-700 rounded-xl backdrop-blur-sm hover:border-green-500/50 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-green-400" />
                  <h3 className="font-semibold text-white">{model.name}</h3>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(model.status)}`}>
                  {model.status}
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-3 line-clamp-2">{model.description}</p>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{model.threats?.length || 0} threats</span>
                <span>{new Date(model.updatedAt || '').toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-700">
                <button
                  onClick={() => openModel(model)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30 transition-all text-sm"
                >
                  <Eye className="w-3 h-3" />
                  Open
                </button>
                <button
                  onClick={() => deleteModel(model.$id!)}
                  className="px-3 py-1.5 bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Editor View
  const EditorView = () => (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-gray-900/80 to-gray-800/80 border-b border-gray-700 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setView('dashboard');
              setCurrentModel(null);
            }}
            className="p-2 hover:bg-gray-700 rounded-lg transition-all"
          >
            <ChevronRight className="w-5 h-5 text-gray-400 rotate-180" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-green-400" />
            <input
              type="text"
              value={currentModel?.name || ''}
              onChange={(e) => setCurrentModel({ ...currentModel!, name: e.target.value })}
              className="bg-transparent text-lg font-semibold text-white border-none focus:outline-none focus:ring-0"
            />
          </div>
          <select
            value={currentModel?.status || 'draft'}
            onChange={(e) => setCurrentModel({ ...currentModel!, status: e.target.value as any })}
            className={`px-3 py-1 text-sm rounded-lg border ${getStatusColor(currentModel?.status || 'draft')} bg-transparent focus:outline-none`}
          >
            <option value="draft" className="bg-gray-900">Draft</option>
            <option value="review" className="bg-gray-900">Review</option>
            <option value="final" className="bg-gray-900">Final</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={saveModel}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-lg"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Diagram Canvas */}
        <div className="flex-1 relative bg-gradient-to-br from-gray-900 to-gray-800">
          {/* Toolbar */}
          <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 p-2 bg-gray-800/80 backdrop-blur-sm rounded-lg border border-gray-700">
            <button
              onClick={() => addNode('process')}
              className="flex items-center gap-2 px-3 py-2 bg-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/30 transition-all text-sm"
              title="Add Process"
            >
              <Server className="w-4 h-4" />
              Process
            </button>
            <button
              onClick={() => addNode('externalEntity')}
              className="flex items-center gap-2 px-3 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-all text-sm"
              title="Add External Entity"
            >
              <Globe className="w-4 h-4" />
              External
            </button>
            <button
              onClick={() => addNode('dataStore')}
              className="flex items-center gap-2 px-3 py-2 bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30 transition-all text-sm"
              title="Add Data Store"
            >
              <Database className="w-4 h-4" />
              Data Store
            </button>
            <button
              onClick={() => addNode('trustBoundary')}
              className="flex items-center gap-2 px-3 py-2 bg-orange-500/20 text-orange-300 rounded-lg hover:bg-orange-500/30 transition-all text-sm"
              title="Add Trust Boundary"
            >
              <Lock className="w-4 h-4" />
              Boundary
            </button>
          </div>

          {/* React Flow Canvas */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-gradient-to-br from-gray-900 to-gray-800"
          >
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#4a5568" />
            <Controls className="bg-gray-800/80 backdrop-blur-sm border border-gray-700" />
            <MiniMap
              className="bg-gray-800/80 backdrop-blur-sm border border-gray-700"
              nodeColor="#6db87a"
              maskColor="rgba(0, 0, 0, 0.8)"
            />
          </ReactFlow>
        </div>

        {/* Right Panel - Properties & Threats */}
        <div className="w-96 bg-gradient-to-br from-gray-900/90 to-gray-800/90 border-l border-gray-700 backdrop-blur-sm flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setShowThreats(false)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-all ${!showThreats ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400 hover:text-gray-300'}`}
            >
              Properties
            </button>
            <button
              onClick={() => setShowThreats(true)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-all ${showThreats ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400 hover:text-gray-300'}`}
            >
              Threats ({currentModel?.threats?.length || 0})
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {!showThreats ? (
              /* Properties Panel */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Description</label>
                  <textarea
                    value={currentModel?.description || ''}
                    onChange={(e) => setCurrentModel({ ...currentModel!, description: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 resize-none"
                    rows={4}
                    placeholder="Describe your system architecture..."
                  />
                </div>

                {selectedNode && (
                  <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                    <h4 className="text-sm font-medium text-white mb-3">Selected Node</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Label</label>
                        <input
                          type="text"
                          value={selectedNode.data.label}
                          onChange={(e) => {
                            setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: e.target.value } } : n));
                          }}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Trust Level</label>
                        <select
                          value={selectedNode.data.trustLevel || 'medium'}
                          onChange={(e) => {
                            setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, trustLevel: e.target.value } } : n));
                          }}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Threats Panel */
              <div className="space-y-4">
                <button
                  onClick={runAnalysis}
                  disabled={analyzing || nodes.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {analyzing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Run AI Analysis
                    </>
                  )}
                </button>

                {currentModel?.threats && currentModel.threats.length > 0 ? (
                  <div className="space-y-3">
                    {currentModel.threats.map((threat) => (
                      <div
                        key={threat.threatId}
                        className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-green-500/50 transition-all"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getStrideColor(threat.strideCategory)}`}>
                            {threat.strideCategory}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getSeverityColor(threat.severity)}`}>
                            {threat.severity}
                          </span>
                        </div>
                        <h4 className="text-sm font-medium text-white mb-1">{threat.title}</h4>
                        <p className="text-xs text-gray-400 mb-2">{threat.description}</p>
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">Component:</span> {threat.component}
                        </div>
                        {threat.mitigations && threat.mitigations.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <p className="text-xs font-medium text-gray-400 mb-1">Mitigations:</p>
                            <ul className="text-xs text-gray-500 space-y-1">
                              {threat.mitigations.map((mit, idx) => (
                                <li key={idx} className="flex items-start gap-1">
                                  <span className="text-green-400">•</span>
                                  <span>{mit}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Shield className="w-12 h-12 text-gray-600 mb-3" />
                    <p className="text-sm text-gray-400">No threats yet</p>
                    <p className="text-xs text-gray-500">Add components to your diagram and run AI analysis</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {view === 'dashboard' ? <DashboardView /> : <EditorView />}
    </div>
  );
}
