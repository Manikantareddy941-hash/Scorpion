import React from 'react';
import { ShieldCheck, Award, Lock, FileCheck, Download } from 'lucide-react';

interface CertificateProps {
  repoName: string;
  version: string;
  approvalDate: string;
  approvedBy: string;
  scanId: string;
  stats: {
    criticalResolved: number;
    highResolved: number;
    testsPassed: number;
    coverage: number;
  };
}

const Certificate: React.FC<CertificateProps> = ({ 
  repoName, 
  version, 
  approvalDate, 
  approvedBy, 
  scanId,
  stats 
}) => {
  const downloadCertificate = () => {
    window.print();
  };

  return (
    <div className="relative max-w-4xl mx-auto p-1 bg-gradient-to-br from-orange-500 via-red-500 to-orange-600 rounded-3xl shadow-2xl overflow-hidden group">
      {/* Animated Glow Backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(249,115,22,0.2),transparent_70%)] animate-pulse" />
      
      <div className="relative bg-[#0a0a0a] rounded-[22px] p-8 md:p-12 border border-white/10 backdrop-blur-3xl overflow-hidden">
        
        {/* Decorative Corner Icons */}
        <ShieldCheck className="absolute -top-6 -left-6 w-24 h-24 text-orange-500/10 rotate-12" />
        <Award className="absolute -bottom-8 -right-8 w-32 h-32 text-orange-500/10 -rotate-12" />

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(249,115,22,0.4)] mb-6">
            <Lock className="text-white w-10 h-10" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter mb-2 uppercase">
            Security Clearance
          </h1>
          <p className="text-orange-500 font-bold tracking-[0.3em] text-sm uppercase">
            Scorpion DevSecOps Verified
          </p>
        </div>

        {/* Body */}
        <div className="space-y-8 text-center">
          <div>
            <p className="text-white/60 text-lg mb-1">This document certifies that</p>
            <h2 className="text-3xl font-bold text-white mb-1">{repoName}</h2>
            <p className="text-white/40 text-sm font-mono">v{version} | ID: {scanId}</p>
          </div>

          <div className="h-px w-32 bg-gradient-to-r from-transparent via-orange-500 to-transparent mx-auto" />

          <p className="text-white/80 max-w-lg mx-auto leading-relaxed">
            has successfully passed all automated security gates, rigorous vulnerability remediation cycles, 
            and compliance checks. The codebase is hereby marked as <span className="text-orange-400 font-bold">SECURE FOR RELEASE</span>.
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1">Criticals Fixed</p>
              <p className="text-2xl font-black text-green-400">{stats.criticalResolved}</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1">Highs Fixed</p>
              <p className="text-2xl font-black text-green-400">{stats.highResolved}</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1">Tests Passed</p>
              <p className="text-2xl font-black text-blue-400">{stats.testsPassed}%</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1">Code Coverage</p>
              <p className="text-2xl font-black text-purple-400">{stats.coverage}%</p>
            </div>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-12 flex flex-col md:flex-row justify-between items-end gap-8 pt-8 border-t border-white/5">
          <div className="text-left">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest mb-4">Authorized By</p>
            <div className="space-y-1">
              <p className="text-white font-bold text-xl italic font-serif underline decoration-orange-500/50 underline-offset-8">
                {approvedBy}
              </p>
              <p className="text-white/40 text-xs">Security Team Lead</p>
            </div>
          </div>
          
          <div className="text-right">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest mb-1">Date of Approval</p>
            <p className="text-white font-mono text-sm">{approvalDate}</p>
          </div>

          <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <FileCheck className="text-orange-500 w-4 h-4" />
            <span className="text-orange-500 text-[10px] font-black uppercase tracking-widest">Seal of Scorpion</span>
          </div>
        </div>

        {/* Print Button (Hidden on Print) */}
        <button 
          onClick={downloadCertificate}
          className="absolute bottom-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors print:hidden"
          title="Print Certificate"
        >
          <Download className="text-white w-5 h-5" />
        </button>

      </div>
    </div>
  );
};

export default Certificate;
