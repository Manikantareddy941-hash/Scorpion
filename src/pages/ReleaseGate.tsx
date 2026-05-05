import React, { useState, useEffect } from 'react';
import { 
  Rocket, CheckCircle2, XCircle, AlertTriangle, Shield, 
  FileText, ClipboardCheck, UserCheck, RefreshCw, ChevronRight,
  ArrowRight, Award
} from 'lucide-react';
import { auditService } from '../services/auditService';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import Certificate from '../components/Certificate';

interface Repo {
  $id: string;
  name: string;
  vulnerability_count: number;
}

export default function ReleaseGate() {
  const { user, role } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [approvalDoc, setApprovalDoc] = useState<any>(null);

  // Checklist state
  const [checklist, setChecklist] = useState({
    noCriticals: false,
    testsPassing: false,
    reportGenerated: false,
    leadApproved: false
  });

  const [stats, setStats] = useState({
    criticalResolved: 0,
    highResolved: 0,
    testsPassed: 0,
    coverage: 0,
    scanId: ''
  });

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    try {
      console.log('ReleaseGate: Fetching repositories...');
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.orderDesc('$createdAt')
      ]);
      console.log('ReleaseGate: Repositories fetched:', res.documents.length);
      setRepos(res.documents as any);
    } catch (err) {
      console.error('ReleaseGate: Failed to load repositories:', err);
      toast.error('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  };

  const verifyReleaseCriteria = async (repo: Repo) => {
    setChecking(true);
    setChecklist({
      noCriticals: false,
      testsPassing: false,
      reportGenerated: false,
      leadApproved: false
    });

    try {
      console.log('Verifying release criteria for repo:', repo.name);
      
      // 1. Check Critical Vulnerabilities
      const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.equal('repo_id', repo.$id),
        Query.equal('severity', 'critical'),
        Query.equal('status', 'open')
      ]);
      
      const noCriticals = vulnsRes.total === 0;

      // 2. Check Tests (latest test run)
      const testsRes = await databases.listDocuments(DB_ID, COLLECTIONS.TEST_RUNS, [
        Query.equal('repo_id', repo.$id),
        Query.orderDesc('timestamp'),
        Query.limit(1)
      ]).catch(err => {
        console.error('Test runs fetch failed:', err);
        return { documents: [], total: 0 };
      });
      
      const latestTest = testsRes.documents[0] as any;
      const testsPassing = latestTest ? latestTest.status === 'passed' : false;

      // 3. Check for Scans/Reports
      const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('repo_id', repo.$id),
        Query.limit(1)
      ]).catch(err => {
        console.error('Scans fetch failed:', err);
        return { total: 0 };
      });
      
      const reportGenerated = scansRes.total > 0;

      // 4. Fetch stats for certificate
      const resolvedRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.equal('repo_id', repo.$id),
        Query.equal('status', ['fixed', 'resolved', 'verified'])
      ]).catch(err => {
        console.error('Resolved vulnerabilities fetch failed:', err);
        return { documents: [], total: 0 };
      });

      const passed = latestTest?.passed_tests || 0;
      const total = latestTest?.total_tests || 0;
      const testsPct = total > 0 ? Math.round((passed / total) * 100) : 0;

      setStats({
        criticalResolved: resolvedRes.documents.filter((v: any) => v.severity === 'critical').length || 0,
        highResolved: resolvedRes.documents.filter((v: any) => v.severity === 'high').length || 0,
        testsPassed: testsPct,
        coverage: latestTest?.coverage || 0,
        scanId: latestTest?.build_id || 'SCAN-AUTO-VAL'
      });

      setChecklist({
        noCriticals,
        testsPassing,
        reportGenerated,
        leadApproved: false 
      });

      // Check if already approved
      const existingApproval = await databases.listDocuments(DB_ID, COLLECTIONS.RELEASES, [
        Query.equal('repo_id', repo.$id),
        Query.equal('status', 'approved'),
        Query.limit(1)
      ]).catch(err => {
        console.error('Existing approval fetch failed:', err);
        return { total: 0, documents: [] };
      });

      if (existingApproval.total > 0) {
        setApprovalDoc(existingApproval.documents[0]);
        setChecklist(prev => ({ ...prev, leadApproved: true }));
      }

    } catch (err) {
      console.error('Release criteria verification error:', err);
      toast.error('Criteria verification failed. Check console for details.');
    } finally {
      setChecking(false);
    }
  };

  const handleFinalApproval = async () => {
    if (!selectedRepo || !user) return;
    
    setLoading(true);
    try {
      const payload = {
        repo_id: selectedRepo.$id,
        version: `1.0.${Math.floor(Date.now()/1000000)}`,
        status: 'approved',
        approved_by: user.name,
        approved_at: new Date().toISOString(),
        checks_json: JSON.stringify(checklist)
      };

      const doc = await databases.createDocument(DB_ID, COLLECTIONS.RELEASES, ID.unique(), payload);
      
      await databases.createDocument(DB_ID, COLLECTIONS.CERTIFICATES, ID.unique(), {
        repo_name: selectedRepo.name,
        version: payload.version,
        approval_date: payload.approved_at,
        approved_by: payload.approved_by,
        scan_id: stats.scanId,
        stats_json: JSON.stringify(stats)
      }).catch(err => console.error('Certificate storage failed:', err));

      await auditService.log(
        'RELEASE_APPROVED', 
        'Repository', 
        `Release version ${payload.version} approved by ${user.name}`,
        selectedRepo.$id
      );

      setApprovalDoc(doc);
      setChecklist(prev => ({ ...prev, leadApproved: true }));
      toast.success('Release Approved!');
    } catch (err) {
      console.error('Final approval error:', err);
      toast.error('Approval failed');
    } finally {
      setLoading(false);
    }
  };

  if (approvalDoc) {
    return (
      <div className="p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tighter italic">Release Authorized</h1>
            <p className="text-green-500 font-bold uppercase tracking-widest text-[10px]">The secure release gate is now open.</p>
          </div>
          <button 
            onClick={() => { setApprovalDoc(null); setSelectedRepo(null); }}
            className="btn-premium px-6 py-2 text-xs"
          >
            New Approval
          </button>
        </div>
        
        <Certificate 
          repoName={selectedRepo?.name || 'Unknown'}
          version={approvalDoc.version}
          approvalDate={new Date(approvalDoc.approved_at).toLocaleDateString()}
          approvedBy={approvalDoc.approved_by}
          scanId={stats.scanId}
          stats={stats}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-orange-500/10 rounded-2xl flex items-center justify-center border border-orange-500/20 shadow-[0_0_20px_rgba(249,115,22,0.1)]">
            <Rocket className="text-orange-500 w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tighter italic">Release Gate</h1>
            <p className="text-[var(--text-secondary)] font-bold uppercase tracking-[0.2em] text-[10px]">Final security authorization before production.</p>
          </div>
        </div>
      </div>

      {!selectedRepo ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {repos.length === 0 && !loading && (
            <div className="col-span-full py-20 text-center premium-card">
              <Shield className="w-12 h-12 text-[var(--text-secondary)]/20 mx-auto mb-4" />
              <p className="text-[var(--text-secondary)] font-bold uppercase tracking-widest text-xs">No repositories detected</p>
            </div>
          )}
          {repos.map(repo => (
            <div 
              key={repo.$id}
              onClick={() => { setSelectedRepo(repo); verifyReleaseCriteria(repo); }}
              className="premium-card group cursor-pointer hover:border-orange-500/50 transition-all p-6"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] group-hover:bg-orange-500/10 group-hover:border-orange-500/20 transition-all">
                  <Shield className="text-[var(--text-primary)] group-hover:text-orange-500 w-5 h-5" />
                </div>
                <ChevronRight className="text-[var(--text-secondary)]/40 group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="text-lg font-black text-[var(--text-primary)] mb-2 uppercase italic tracking-tight">{repo.name || 'Unnamed Repository'}</h3>
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
                <AlertTriangle className={(repo.vulnerability_count || 0) > 0 ? "text-orange-500" : "text-green-500"} size={12} />
                {(repo.vulnerability_count || 0)} Potential Issues
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="premium-card p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6">
                 {checking && <RefreshCw className="w-5 h-5 text-orange-500 animate-spin" />}
              </div>

              <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tighter mb-8 flex items-center gap-3 italic">
                <ClipboardCheck className="text-orange-500" />
                Security Check-off List
              </h2>

              <div className={`space-y-4 transition-opacity ${checking ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                <CheckItem 
                  title="Zero Critical Vulnerabilities" 
                  description={checklist.noCriticals ? "Clean: 0 critical vulnerabilities found." : "FAILED: Critical vulnerabilities must be resolved."} 
                  status={checklist.noCriticals} 
                />
                <CheckItem 
                  title="Build & Tests Successful" 
                  description={checklist.testsPassing ? "Success: Latest test run passed." : "FAILED: No passing test runs detected for this repo."} 
                  status={checklist.testsPassing} 
                />
                <CheckItem 
                  title="Compliance Report Generated" 
                  description={checklist.reportGenerated ? "Available: Scan telemetry is present." : "FAILED: No scan history found for this repository."} 
                  status={checklist.reportGenerated} 
                />
                <CheckItem 
                  title="Lead Approval" 
                  description={role === 'security_lead' ? "Final sign-off from the Security Team Lead." : "REQUIRED: A Security Lead must authorize this release."} 
                  status={checklist.leadApproved}
                  interactive={checklist.noCriticals && checklist.testsPassing && role === 'security_lead'}
                  onCheck={() => setChecklist(prev => ({ ...prev, leadApproved: !prev.leadApproved }))}
                />
              </div>

              <div className="mt-12 pt-8 border-t border-[var(--border-subtle)] flex justify-between items-center">
                <button 
                  onClick={() => setSelectedRepo(null)}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-black uppercase tracking-widest text-[9px] transition-colors italic"
                >
                  [ CANCEL ]
                </button>
                
                <button 
                  disabled={!Object.values(checklist).every(v => v) || loading}
                  onClick={handleFinalApproval}
                  className={`
                    flex items-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-tighter transition-all italic text-sm
                    ${Object.values(checklist).every(v => v) 
                      ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]' 
                      : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-not-allowed opacity-50'
                    }
                  `}
                >
                  {loading ? <RefreshCw className="animate-spin" /> : <Award />}
                  Authorize Release
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="premium-card p-6">
              <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-6 italic">Target Repository</h3>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-[var(--bg-primary)] rounded-xl flex items-center justify-center border border-[var(--border-subtle)]">
                  <Shield className="text-[var(--text-primary)] w-5 h-5" />
                </div>
                <div>
                  <p className="text-[var(--text-primary)] font-black uppercase italic tracking-tight">{selectedRepo.name || 'Unnamed'}</p>
                  <p className="text-[9px] text-[var(--text-secondary)] font-mono truncate max-w-[150px] opacity-60 uppercase">{selectedRepo.$id}</p>
                </div>
              </div>
              
              <div className="space-y-3">
                 <StatRow label="Resolved Criticals" value={stats.criticalResolved} color={stats.criticalResolved > 0 ? "text-green-500" : "text-[var(--text-secondary)]/40"} />
                 <StatRow label="Latest Test Success" value={`${stats.testsPassed}%`} color={stats.testsPassed === 100 ? "text-green-500" : "text-blue-500"} />
                 <StatRow label="Code Coverage" value={`${stats.coverage}%`} color="text-purple-500" />
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-orange-500/20 bg-orange-500/5">
              <div className="flex gap-4">
                <AlertTriangle className="text-orange-500 flex-shrink-0 w-5 h-5" />
                <p className="text-[10px] text-orange-200/60 leading-relaxed font-bold uppercase tracking-tight italic">
                  <span className="text-orange-500">WARNING:</span> Authorization will be recorded in the immutable audit log.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckItem({ title, description, status, interactive, onCheck }: any) {
  return (
    <div 
      className={`
        p-4 rounded-2xl border transition-all flex items-center justify-between gap-4
        ${status ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/10'}
        ${interactive ? 'cursor-pointer hover:border-[var(--accent-primary)]/30' : ''}
      `}
      onClick={interactive ? onCheck : undefined}
    >
      <div className="flex gap-4 items-center">
        <div className={`p-2 rounded-xl ${status ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {status ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        </div>
        <div>
          <h4 className={`text-xs font-black uppercase italic ${status ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]/60'}`}>{title}</h4>
          <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase tracking-widest italic">{description}</p>
        </div>
      </div>
      {interactive && !status && <ArrowRight className="text-[var(--text-secondary)]/40 w-4 h-4" />}
    </div>
  );
}

function StatRow({ label, value, color }: any) {
  return (
    <div className="flex justify-between items-center text-[10px]">
      <span className="text-[var(--text-secondary)] font-black uppercase tracking-widest italic">{label}</span>
      <span className={`font-black italic ${color}`}>{value}</span>
    </div>
  );
}

