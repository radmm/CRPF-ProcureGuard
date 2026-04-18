/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  FileText, 
  Users, 
  BarChart3, 
  Plus, 
  ChevronRight, 
  Search, 
  Bell, 
  CheckCircle2, 
  XCircle, 
  HelpCircle,
  LogOut,
  ArrowLeft,
  Filter,
  Download,
  Clock,
  ExternalLink,
  Gavel,
  RefreshCcw,
  Maximize2,
  X,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  orderBy,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import { cn, formatDate } from './lib/utils';
import { FileUploader } from './components/FileUploader';
import { analyzeTender, evaluateBidder, TenderCriterion, EvaluationResult } from './services/aiService';
import ReactMarkdown from 'react-markdown';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- Types ---

interface Tender {
  id: string;
  title: string;
  description: string;
  organization: string;
  status: 'draft' | 'active' | 'evaluated';
  criteria: TenderCriterion[];
  createdAt: string;
  createdBy: string;
}

interface Bidder {
  id: string;
  tenderId: string;
  companyName: string;
  status: 'eligible' | 'not-eligible' | 'review' | 'pending';
  evaluations: Record<string, EvaluationResult>;
  submittedAt: string;
  manualOverride?: {
    by: string;
    at: string;
  } | null;
}

// --- App Component ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'tenders' | 'create-tender' | 'tender-details' | 'bidder-details' | 'all-bidders' | 'audit-logs' | 'config'>('tenders');
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [allBidders, setAllBidders] = useState<Bidder[]>([]);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [selectedBidder, setSelectedBidder] = useState<Bidder | null>(null);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCriterion, setSelectedCriterion] = useState<TenderCriterion | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Tenders Listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'tenders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tender));
      setTenders(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Global Bidders Listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'bidders'), orderBy('submittedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bidder));
      setAllBidders(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Bidders Listener for selected tender
  useEffect(() => {
    if (!selectedTender) return;
    const q = query(collection(db, 'bidders'), where('tenderId', '==', selectedTender.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bidder));
      setBidders(data);
    });
    return () => unsubscribe();
  }, [selectedTender]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleLogout = () => {
    signOut(auth);
    setActiveView('tenders');
    setSelectedTender(null);
  };

  const handleTenderUpload = async (files: { name: string; type: string; data: string }[]) => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeTender(files.map(f => ({ data: f.data, mimeType: f.type })));
      if (result) {
        const docRef = await addDoc(collection(db, 'tenders'), {
          ...result,
          status: 'draft',
          createdAt: new Date().toISOString(),
          createdBy: user?.uid
        });
        setActiveView('tenders');
      }
    } catch (error) {
      console.error("Tender analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleBidderUpload = async (companyName: string, files: { name: string; type: string; data: string }[]) => {
    if (!selectedTender) return;
    setIsAnalyzing(true);
    try {
      // Evaluation requires the criteria
      const evaluations = await evaluateBidder(
        files.map(f => ({ data: f.data, mimeType: f.type })),
        selectedTender.criteria
      );

      // Determine overall status
      let overallStatus: 'eligible' | 'not-eligible' | 'review' = 'eligible';
      const evals = Object.values(evaluations);
      if (evals.some(e => e.status === 'review')) overallStatus = 'review';
      if (evals.some(e => e.status === 'not-eligible' && selectedTender.criteria.find(c => c.id === Object.keys(evaluations)[evals.indexOf(e)])?.isMandatory)) {
        overallStatus = 'not-eligible';
      }

      await addDoc(collection(db, 'bidders'), {
        tenderId: selectedTender.id,
        companyName,
        status: overallStatus,
        evaluations,
        submittedAt: new Date().toISOString(),
        manualOverride: null
      });
    } catch (error) {
      console.error("Bidder evaluation failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleOverride = async (status: 'eligible' | 'not-eligible') => {
    if (!selectedBidder) return;
    try {
      await updateDoc(doc(db, 'bidders', selectedBidder.id), {
        status,
        manualOverride: {
          by: user?.displayName,
          at: new Date().toISOString()
        }
      });
      setSelectedBidder(prev => prev ? { ...prev, status, manualOverride: { by: user?.displayName || '', at: new Date().toISOString() } } as Bidder : null);
    } catch (error) {
      console.error("Override failed:", error);
    }
  };

  const handleExportCriteria = () => {
    if (!selectedTender) return;
    const headers = "ID,Type,Title,Description,Mandatory\n";
    const rows = selectedTender.criteria.map(c => 
      `"${c.id}","${c.type}","${c.title.replace(/"/g, '""')}","${c.description.replace(/"/g, '""')}","${c.isMandatory ? 'Yes' : 'No'}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Criteria_${selectedTender.title.replace(/\s+/g, '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const filteredTenders = tenders.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBidders = bidders.filter(b => 
    b.companyName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAllBidders = allBidders.filter(b => 
    b.companyName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <Loader className="w-10 h-10 text-slate-800 animate-spin mx-auto mb-4" />
        <p className="text-slate-600 font-medium">Initializing Procurement Platform...</p>
      </div>
    </div>
  );

  if (!user) return <LoginView onLogin={handleLogin} />;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-brand-bg flex font-sans text-brand-ink">
        {/* Sidebar */}
        <aside className="w-[220px] bg-brand-sidebar text-white/70 flex flex-col border-r border-brand-line no-print">
          <div className="p-5 flex items-center gap-3 text-white border-b border-white/10 mb-5">
            <div className="w-8 h-8 bg-brand-accent rounded-[4px] flex items-center justify-center">
              <Gavel size={18} className="text-white" />
            </div>
            <div className="font-bold text-xs tracking-widest uppercase">CRPF Eval Hub</div>
          </div>

          <nav className="flex-1 space-y-0.5">
            <SidebarItem 
              icon={<FileText size={16} />} 
              label="Active Evaluations" 
              active={activeView === 'tenders' || activeView === 'tender-details'} 
              onClick={() => setActiveView('tenders')}
            />
            <SidebarItem 
              icon={<Users size={16} />} 
              label="Bidder Analysis" 
              active={activeView === 'all-bidders' || activeView === 'bidder-details'} 
              onClick={() => setActiveView('all-bidders')} 
            />
            <SidebarItem 
              icon={<BarChart3 size={16} />} 
              label="System Audit Logs" 
              active={activeView === 'audit-logs'}
              onClick={() => setActiveView('audit-logs')} 
            />
            <SidebarItem 
              icon={<Bell size={16} />} 
              label="Configuration" 
              active={activeView === 'config'}
              onClick={() => setActiveView('config')} 
            />
          </nav>

          <div className="p-5 mt-auto border-t border-white/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-[4px] bg-white/10 flex items-center justify-center overflow-hidden border border-white/20">
                {user.photoURL ? <img src={user.photoURL} referrerPolicy="no-referrer" alt="" /> : <Users size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-white truncate">{user.displayName || 'Officer'}</p>
                <p className="text-[9px] text-white/40 uppercase tracking-wider">Procurement Officer</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-2 text-[11px] hover:text-white transition-colors uppercase tracking-widest font-bold"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          {/* Header */}
          <header className="h-[64px] bg-white border-b border-brand-line flex items-center justify-between px-6 shrink-0 no-print">
            <div className="flex items-center gap-4">
              {activeView !== 'tenders' && (
                <button 
                  onClick={() => {
                    if (activeView === 'tender-details') setActiveView('tenders');
                    if (activeView === 'bidder-details') setActiveView('tender-details');
                    if (activeView === 'create-tender') setActiveView('tenders');
                  }}
                  className="p-1.5 hover:bg-brand-bg rounded-[4px] text-brand-ink"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <div>
                <h2 className="text-[18px] font-bold text-brand-ink uppercase tracking-tight">
                  {activeView === 'tenders' && "Evaluation Inventory"}
                  {activeView === 'create-tender' && "New Evaluation Engine"}
                  {activeView === 'tender-details' && selectedTender?.title}
                  {activeView === 'all-bidders' && "Global Bidder Repository"}
                  {activeView === 'bidder-details' && `Audit Report: ${selectedBidder?.companyName}`}
                  {activeView === 'audit-logs' && "System Audit Logs"}
                  {activeView === 'config' && "System Configuration"}
                </h2>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest font-medium">CRPFSYSTEMS // DATAHUB_NODE_ALPHA</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-line" />
                <input 
                  type="text" 
                  placeholder="SEARCH RECO..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 bg-brand-bg border border-brand-line rounded-[4px] text-[11px] font-mono focus:ring-1 focus:ring-brand-accent w-48 uppercase"
                />
              </div>
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 relative">
            <AnimatePresence mode="wait">
              {activeView === 'tenders' && (
                <motion.div 
                  key="tenders-list"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <div className="flex justify-between items-end mb-8">
                    <div>
                      <h3 className="text-[20px] font-bold text-brand-ink uppercase tracking-tight">Technical Tender Inventory</h3>
                      <p className="text-slate-500 text-[11px] uppercase tracking-widest font-bold mt-1">Status: Operational / Latency: 42ms</p>
                    </div>
                    <button 
                      onClick={() => setActiveView('create-tender')}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-brand-sidebar text-white rounded-[4px] font-bold text-[11px] uppercase tracking-widest hover:bg-brand-sidebar-hover transition-all"
                    >
                      <Plus size={16} />
                      Post New Tender
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTenders.map(tender => (
                      <TenderCard 
                        key={tender.id} 
                        tender={tender} 
                        onClick={() => {
                          setSelectedTender(tender);
                          setActiveView('tender-details');
                          setSearchQuery('');
                        }} 
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {activeView === 'create-tender' && (
                <motion.div 
                  key="create-tender"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="max-w-3xl mx-auto"
                >
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <div className="mb-8">
                      <h3 className="text-xl font-bold text-slate-900">Post New Tender</h3>
                      <p className="text-slate-500 mt-1">Upload the tender document. AI will extract eligibility criteria automatically.</p>
                    </div>
                    
                    <FileUploader 
                      label="Upload Tender Document (PDF/Images)" 
                      onFilesSelected={handleTenderUpload} 
                    />

                    {isAnalyzing && (
                      <div className="mt-8 p-6 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-4">
                        <div className="shrink-0 w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <div>
                          <p className="font-semibold text-blue-900">Extracting Criteria...</p>
                          <p className="text-sm text-blue-700">Gemini is analyzing technical, financial, and compliance requirements.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeView === 'tender-details' && selectedTender && (
                <motion.div 
                  key="tender-details"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  {/* Tender Overview */}
                  <div className="bg-white border border-brand-line p-6 rounded-[4px]">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <span className="px-2 py-0.5 bg-brand-accent text-white text-[9px] font-bold uppercase tracking-widest rounded-[2px]">Active Evaluation</span>
                          <span className="text-slate-400 font-mono text-[10px] uppercase tracking-widest leading-none border-l border-brand-line pl-3">RECID: {selectedTender.id.slice(0, 8).toUpperCase()}</span>
                        </div>
                        <h1 className="text-[24px] font-bold text-brand-ink uppercase tracking-tight">{selectedTender.title}</h1>
                        <p className="text-slate-500 text-[12px] mt-1 max-w-2xl italic leading-relaxed">{selectedTender.description}</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={handleExportCriteria}
                          className="px-3 py-1.5 border border-brand-line text-[11px] font-bold uppercase tracking-widest hover:bg-brand-bg transition-colors flex items-center gap-2"
                        >
                          <Download size={14} /> Export Criteria
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-brand-line rounded-[4px] overflow-hidden">
                      <CriteriaSummaryStat label="Technical Parameters" count={selectedTender.criteria.filter(c => c.type === 'technical').length} color="text-brand-accent" />
                      <CriteriaSummaryStat label="Financial Thresholds" count={selectedTender.criteria.filter(c => c.type === 'financial').length} color="text-brand-success" />
                      <CriteriaSummaryStat label="Compliance Checks" count={selectedTender.criteria.filter(c => c.type === 'compliance').length} color="text-brand-warning" />
                    </div>
                  </div>

                  {/* Criteria List */}
                  <div className="space-y-4">
                    <h3 className="text-[14px] font-bold text-brand-ink uppercase tracking-tight pl-1 border-l-4 border-brand-accent leading-none h-[14px]">Eligibility Parameters ({selectedTender.criteria.length})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {selectedTender.criteria.map(criterion => (
                        <div 
                          key={criterion.id} 
                          className="p-4 bg-white border border-brand-line rounded-[4px] hover:border-brand-accent transition-all flex flex-col gap-2 cursor-pointer group hover:shadow-sm"
                          onClick={() => setSelectedCriterion(criterion)}
                        >
                          <div className="flex justify-between items-start">
                            <span className={cn(
                              "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-[2px]",
                              criterion.type === 'technical' && "bg-brand-bg text-brand-accent",
                              criterion.type === 'financial' && "bg-[#E8F5E9] text-brand-success",
                              criterion.type === 'compliance' && "bg-[#FFF3E0] text-brand-warning",
                            )}>
                              {criterion.type}
                            </span>
                            <div className="flex gap-2">
                              {criterion.isMandatory && (
                                <span className="text-[9px] font-bold text-brand-error bg-red-50 px-1.5 py-0.5 rounded-[2px] uppercase">Mandatory</span>
                              )}
                              <Maximize2 size={10} className="text-slate-300 group-hover:text-brand-accent transition-colors" />
                            </div>
                          </div>
                          <h4 className="font-bold text-brand-ink text-[13px] uppercase tracking-tight leading-tight group-hover:text-brand-accent transition-colors">{criterion.title}</h4>
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed italic">{criterion.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bidders Section */}
                  <div className="space-y-6">
                    <div className="flex justify-between items-center px-1">
                      <h3 className="text-lg font-bold text-slate-800">Bidder Submissions</h3>
                      <button 
                        onClick={() => {
                          const name = prompt("Enter Bidder Company Name:");
                          if (name) {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.multiple = true;
                            input.onchange = async (e: any) => {
                              const files = Array.from(e.target.files as FileList);
                              const results = await Promise.all(
                                files.map(file => new Promise<{ name: string; type: string; data: string }>((resolve) => {
                                  const reader = new FileReader();
                                  reader.onload = () => resolve({ name: file.name, type: file.type, data: (reader.result as string).split(',')[1] });
                                  reader.readAsDataURL(file);
                                }))
                              ) as { name: string; type: string; data: string }[];
                              handleBidderUpload(name, results);
                            };
                            input.click();
                          }
                        }}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Plus size={16} /> New Submission
                      </button>
                    </div>

                    <div className="bg-white border border-brand-line rounded-[4px] overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#F8FAFC] border-b-2 border-brand-line">
                            <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">SEQ</th>
                            <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Bidder Entity</th>
                            <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Submission Date</th>
                            <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Evaluation</th>
                            <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-line">
                          {filteredBidders.map((bidder, idx) => (
                            <tr key={bidder.id} className="hover:bg-[#F1F5F9] transition-colors group">
                              <td className="px-5 py-3 text-[12px] font-mono border-r border-slate-100">{(idx + 1).toString().padStart(2, '0')}</td>
                              <td className="px-5 py-4 text-[13px] font-bold text-brand-ink border-r border-slate-100">{bidder.companyName}</td>
                              <td className="px-5 py-4 text-[12px] font-mono text-slate-500 border-r border-slate-100 uppercase tracking-tighter">{formatDate(bidder.submittedAt)}</td>
                              <td className="px-5 py-4 border-r border-slate-100">
                                <StatusBadge status={bidder.status} />
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => {
                                    setSelectedBidder(bidder);
                                    setActiveView('bidder-details');
                                    setSearchQuery('');
                                  }}
                                  className="text-[11px] font-bold text-brand-accent hover:underline uppercase tracking-widest"
                                >
                                  View Audit
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filteredBidders.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                                <Users size={32} className="mx-auto mb-3 opacity-20" />
                                <p className="uppercase tracking-widest font-bold text-[10px]">No bidder submissions found</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeView === 'bidder-details' && selectedBidder && selectedTender && (
                <motion.div 
                  key="bidder-details"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  {/* Evaluation Summary */}
                  <div className="bg-white border border-brand-line p-6 rounded-[4px]">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <StatusBadge status={selectedBidder.status} large />
                          <span className="text-slate-400 font-mono text-[10px] uppercase tracking-widest border-l border-brand-line pl-3">NODE_AUDIT_LOG // STABLE</span>
                        </div>
                        <h1 className="text-[24px] font-bold text-brand-ink uppercase tracking-tight">{selectedBidder.companyName}</h1>
                        <p className="text-slate-500 text-[12px] mt-1 border-b border-brand-line/50 pb-2 mb-2">TENDER_TARGET: {selectedTender.title}</p>
                      </div>
                      <div className="flex gap-2">
                        {selectedBidder.status === 'review' && (
                          <div className="flex gap-2 mr-4 border-r border-brand-line pr-4 no-print">
                            <button 
                              onClick={() => handleOverride('eligible')}
                              className="px-3 py-1.5 bg-brand-success text-white rounded-[2px] font-bold text-[11px] uppercase tracking-widest hover:opacity-90 transition-all flex items-center gap-2"
                            >
                              <CheckCircle2 size={14} /> Approve
                            </button>
                            <button 
                              onClick={() => handleOverride('not-eligible')}
                              className="px-3 py-1.5 bg-brand-error text-white rounded-[2px] font-bold text-[11px] uppercase tracking-widest hover:opacity-90 transition-all flex items-center gap-2"
                            >
                              <XCircle size={14} /> Reject
                            </button>
                          </div>
                        )}
                        <button 
                          onClick={() => window.print()}
                          className="px-4 py-2 bg-brand-sidebar text-white rounded-[4px] font-bold text-[11px] uppercase tracking-widest hover:bg-brand-sidebar-hover transition-all flex items-center gap-2 no-print"
                        >
                          <Download size={16} /> Sign & Export
                        </button>
                      </div>
                    </div>

                    {selectedBidder.manualOverride && (
                      <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3 text-blue-800">
                        <Shield size={20} className="text-blue-600" />
                        <p className="text-sm font-medium">
                          <strong>Human Override Applied:</strong> This bidder was manually marked as <strong>{selectedBidder.status === 'eligible' ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</strong> by {selectedBidder.manualOverride.by} on {formatDate(selectedBidder.manualOverride.at)}.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <SummaryCard label="Eligible" value={Object.values(selectedBidder.evaluations).filter(e => e.status === 'eligible').length} icon={<CheckCircle2 size={20} className="text-emerald-600" />} />
                      <SummaryCard label="Ineligible" value={Object.values(selectedBidder.evaluations).filter(e => e.status === 'not-eligible').length} icon={<XCircle size={20} className="text-red-600" />} />
                      <SummaryCard label="Need Review" value={Object.values(selectedBidder.evaluations).filter(e => e.status === 'review').length} icon={<HelpCircle size={20} className="text-amber-600" />} />
                      <SummaryCard label="Missing Evidence" value={selectedTender.criteria.length - Object.keys(selectedBidder.evaluations).length} icon={<Clock size={20} className="text-slate-400" />} />
                    </div>
                  </div>

                  {/* Criterion-by-Criterion Audit */}
                  <div className="space-y-4">
                    <div className="flex items-baseline justify-between px-1 border-l-4 border-brand-accent pl-4">
                      <h3 className="text-[18px] font-bold text-brand-ink uppercase tracking-tight">Criterion Audit Trail</h3>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                        ENGINE: GEMINI_TECHNICAL_V1.2
                      </div>
                    </div>

                    <div className="space-y-4">
                      {selectedTender.criteria.map(criterion => {
                        const evalResult = selectedBidder.evaluations[criterion.id];
                        return (
                          <div key={criterion.id} className="bg-white border border-brand-line rounded-[4px] overflow-hidden">
                            <div className="flex flex-col md:flex-row">
                              <div className="p-5 md:w-1/3 border-b md:border-b-0 md:border-r border-brand-line bg-[#FAFBFC]">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className={cn(
                                    "text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-[2px]",
                                    criterion.type === 'technical' && "bg-brand-bg text-brand-accent",
                                    criterion.type === 'financial' && "bg-[#E8F5E9] text-brand-success",
                                    criterion.type === 'compliance' && "bg-[#FFF3E0] text-brand-warning",
                                  )}>
                                    {criterion.type}
                                  </span>
                                  {criterion.isMandatory && (
                                    <span className="text-[8px] font-bold text-brand-error bg-red-50 px-1 py-0.5 rounded-[2px] uppercase">Mandatory</span>
                                  )}
                                </div>
                                <h4 className="font-bold text-[13px] text-brand-ink mb-2 leading-tight uppercase tracking-tight">{criterion.title}</h4>
                                <p className="text-[10px] text-slate-500 leading-relaxed italic border-t border-brand-line/50 pt-2">{criterion.description}</p>
                              </div>

                              <div className="flex-1 p-5 space-y-4">
                                <div className="flex items-center justify-between border-b border-brand-line/50 pb-3">
                                  <div className="flex items-center gap-3">
                                    <EvaluationBadge status={evalResult?.status || 'review'} />
                                    <span className="text-brand-ink font-bold text-[12px] font-mono tracking-tight">{evalResult?.valueExtracted || "NO DATA"}</span>
                                  </div>
                                  {evalResult?.documentRef && (
                                    <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                                      REF: {evalResult.documentRef}
                                    </div>
                                  )}
                                </div>

                                {evalResult ? (
                                  <div className="grid grid-cols-1 gap-3">
                                    <div className="p-3 bg-brand-bg rounded-[2px] border border-brand-line/50">
                                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                        REASONING_ENGINE_OUTPUT:
                                      </p>
                                      <div className="text-[12px] text-brand-ink leading-relaxed font-sans">
                                        <ReactMarkdown>{evalResult.reason}</ReactMarkdown>
                                      </div>
                                    </div>
                                    <div className="p-3 bg-[#EEF2F6] border border-brand-line/50 rounded-[2px]">
                                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2">Primary Evidence Excerpt:</p>
                                      <p className="text-[11px] font-mono text-brand-ink border-l-2 border-brand-accent pl-3 leading-loose whitespace-pre-wrap">
                                        {evalResult.evidence}
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-8 text-center bg-brand-bg border border-dashed border-brand-line rounded-[2px] text-slate-400 text-[11px] uppercase font-bold tracking-widest font-mono">
                                    STATUS: PENDING_ANALYSIS
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeView === 'all-bidders' && (
                <motion.div 
                  key="all-bidders"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <div className="flex justify-between items-end mb-6">
                    <div>
                      <h3 className="text-[20px] font-bold text-brand-ink uppercase tracking-tight">Bidder Tracking Matrix</h3>
                      <p className="text-slate-500 text-[11px] uppercase tracking-widest font-bold mt-1">Cross-Tender Participant Records</p>
                    </div>
                  </div>

                  <div className="bg-white border border-brand-line rounded-[4px] overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b-2 border-brand-line">
                          <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">BID_ID</th>
                          <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Participant</th>
                          <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Tender Node</th>
                          <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest border-r border-slate-100">Status</th>
                          <th className="px-5 py-3 text-[11px] font-bold text-brand-ink uppercase tracking-widest text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-line">
                        {filteredAllBidders.map((bidder) => (
                          <tr key={bidder.id} className="hover:bg-[#F1F5F9] transition-colors group">
                            <td className="px-5 py-3 text-[12px] font-mono border-r border-slate-100 uppercase">{bidder.id.slice(0, 8)}</td>
                            <td className="px-5 py-4 text-[13px] font-bold text-brand-ink border-r border-slate-100">{bidder.companyName}</td>
                            <td className="px-5 py-4 text-[11px] font-bold text-slate-500 border-r border-slate-100 uppercase tracking-tight">
                              {tenders.find(t => t.id === bidder.tenderId)?.title || "Unknown Tender"}
                            </td>
                            <td className="px-5 py-4 border-r border-slate-100">
                              <StatusBadge status={bidder.status} />
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  const t = tenders.find(t => t.id === bidder.tenderId);
                                  if (t) {
                                    setSelectedTender(t);
                                    setSelectedBidder(bidder);
                                    setActiveView('bidder-details');
                                    setSearchQuery('');
                                  }
                                }}
                                className="text-[11px] font-bold text-brand-accent hover:underline uppercase tracking-widest"
                              >
                                Deep Audit
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredAllBidders.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                              <Users size={32} className="mx-auto mb-3 opacity-20" />
                              <p className="uppercase tracking-widest font-bold text-[10px]">No participants found in node history</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeView === 'audit-logs' && (
                <motion.div 
                  key="audit-logs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="p-12 text-center bg-white border border-brand-line rounded-[4px]">
                    <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-brand-ink uppercase">Audit Stream Offline</h3>
                    <p className="text-slate-500 text-sm mt-2 font-mono">Real-time system event logging restricted to Tier-1 nodes.</p>
                  </div>
                </motion.div>
              )}

              {activeView === 'config' && (
                <motion.div 
                  key="config"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="bg-white border border-brand-line rounded-[4px] p-8 max-w-2xl">
                    <h3 className="text-xl font-bold text-brand-ink uppercase mb-6">System Configuration</h3>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between p-4 bg-brand-bg border border-brand-line rounded-[2px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest">AI Engine Node</p>
                          <p className="text-xs text-slate-500 font-mono">Gemini 3.1 Pro (Multimodal)</p>
                        </div>
                        <span className="px-2 py-0.5 bg-brand-success/10 text-brand-success text-[10px] font-bold">CONNECTED</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-brand-bg border border-brand-line rounded-[2px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest">OCR Pre-processor</p>
                          <p className="text-xs text-slate-500 font-mono">Standard Alpha (Vision V2)</p>
                        </div>
                        <span className="px-2 py-0.5 bg-brand-success/10 text-brand-success text-[10px] font-bold">ACTIVE</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Criterion Detail Modal */}
            <AnimatePresence>
              {selectedCriterion && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setSelectedCriterion(null)}
                    className="absolute inset-0 bg-brand-sidebar/60 backdrop-blur-sm"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative bg-white border border-brand-line rounded-[4px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
                  >
                    <div className="p-6 border-b border-brand-line flex items-center justify-between bg-[#FAFBFC]">
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-[2px]",
                          selectedCriterion.type === 'technical' && "bg-brand-bg text-brand-accent",
                          selectedCriterion.type === 'financial' && "bg-[#E8F5E9] text-brand-success",
                          selectedCriterion.type === 'compliance' && "bg-[#FFF3E0] text-brand-warning",
                        )}>
                          {selectedCriterion.type}
                        </span>
                        {selectedCriterion.isMandatory && (
                          <span className="text-[10px] font-bold text-brand-error bg-red-50 px-2 py-0.5 rounded-[2px] uppercase">Mandatory Requirement</span>
                        )}
                      </div>
                      <button 
                        onClick={() => setSelectedCriterion(null)}
                        className="text-slate-400 hover:text-brand-ink transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    <div className="p-8 overflow-y-auto max-h-[70vh]">
                      <h3 className="text-[20px] font-bold text-brand-ink uppercase tracking-tight mb-4 leading-tight">{selectedCriterion.title}</h3>
                      <div className="p-5 bg-brand-bg rounded-[2px] border border-brand-line/50">
                        <div className="text-[14px] text-brand-ink leading-relaxed font-sans font-medium italic">
                          <ReactMarkdown>{selectedCriterion.description}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-[#FAFBFC] border-t border-brand-line flex justify-end">
                      <button 
                        onClick={() => setSelectedCriterion(null)}
                        className="px-4 py-2 bg-brand-sidebar text-white rounded-[4px] font-bold text-[11px] uppercase tracking-widest hover:bg-brand-sidebar-hover transition-all"
                      >
                        Close Registry Entry
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Global Loader overlay */}
            {isAnalyzing && (
              <div className="fixed inset-0 bg-brand-sidebar/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-6">
                <div className="bg-white p-8 rounded-[4px] border border-brand-line shadow-2xl flex items-center gap-6 max-w-sm w-full">
                  <div className="shrink-0 w-12 h-12 border-4 border-brand-accent/20 border-t-brand-accent rounded-full animate-spin" />
                  <div>
                    <h3 className="font-bold text-brand-ink uppercase text-[13px] tracking-tight">AI Audit Processing</h3>
                    <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono mt-1 animate-pulse">Analyzing multi-modal data node...</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function LoginView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col lg:flex-row">
      <div className="flex-1 bg-brand-sidebar p-12 flex flex-col justify-between relative overflow-hidden">
        {/* Background Accents */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-accent/5 rounded-full blur-[120px] -mr-48 -mt-48" />
        
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-accent rounded-[4px] flex items-center justify-center">
            <Gavel size={24} className="text-white" />
          </div>
          <h2 className="text-white font-bold text-lg tracking-widest uppercase">CRPF SYSTEMS</h2>
        </div>

        <div className="relative z-10 space-y-6 max-w-lg">
          <h1 className="text-4xl lg:text-6xl font-bold text-white tracking-tighter leading-[1] uppercase">
            Multimodal <br /> Tender Audit <br /> Infrastructure
          </h1>
          <p className="text-white/50 text-base leading-relaxed font-sans">
            Secure, AI-driven extraction and evaluation of eligibility criteria for CRFP procurement nodes. Stable, auditable, and transparent.
          </p>
          <div className="flex gap-4">
            <div className="p-4 bg-white/5 border border-white/10 rounded-[4px]">
              <p className="text-white font-bold text-xl font-mono">1.2.0</p>
              <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold">Engine Version</p>
            </div>
            <div className="p-4 bg-white/5 border border-white/10 rounded-[4px]">
              <p className="text-white font-bold text-xl font-mono">256B</p>
              <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold">Audit Encryption</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-white/30 text-[10px] font-mono tracking-[0.2em] uppercase">
          SECURE_ACCESS_NODE // ALPHA_PROTOCOL_ENABLED
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-12 bg-white">
        <div className="max-w-sm w-full border border-brand-line p-10 rounded-[4px] bg-[#FAFBFC]">
          <div className="mb-10 text-center">
            <h3 className="text-2xl font-bold text-brand-ink tracking-tight uppercase">Authentication</h3>
            <p className="text-slate-500 text-[11px] mt-2 uppercase tracking-widest font-bold opacity-60">Identity Verification Required</p>
          </div>
          
          <button 
            onClick={onLogin}
            className="w-full flex items-center justify-center gap-3 py-3 bg-white border border-brand-line rounded-[2px] transition-all hover:bg-brand-bg group shadow-sm"
          >
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_Logo.svg" className="w-4 h-4" alt="" />
            <span className="text-brand-ink font-bold text-[12px] uppercase tracking-widest">Sign In with Infrastructure ID</span>
          </button>
          
          <p className="text-center text-[9px] text-slate-400 mt-8 uppercase tracking-[0.1em] font-bold leading-relaxed">
            Unauthorized access is prohibited. All activities are logged and monitored by the Directorate General.
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, onClick, active }: { icon: any, label: string, onClick: () => void, active?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-5 py-3 text-[12px] font-bold transition-all border-l-[3px] border-transparent uppercase tracking-wider text-white h-[48px]",
        active ? "bg-brand-sidebar-hover border-l-brand-accent opacity-100" : "opacity-60 hover:opacity-100 hover:bg-brand-sidebar-hover/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TenderCard({ tender, onClick }: { tender: Tender, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="bg-white border border-brand-line rounded-[4px] p-5 text-left hover:border-brand-accent transition-all group relative flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="p-2 bg-brand-bg rounded-[2px] text-brand-ink">
          <FileText size={16} />
        </div>
        <span className="text-[10px] font-mono font-bold tracking-widest text-slate-400">#REC_{tender.id.slice(0, 6).toUpperCase()}</span>
      </div>
      
      <div>
        <h3 className="text-[14px] font-bold text-brand-ink leading-tight mb-1 uppercase tracking-tight">
          {tender.title}
        </h3>
        <p className="text-[11px] text-slate-500 line-clamp-2 h-[32px] leading-relaxed italic">{tender.description}</p>
      </div>
      
      <div className="pt-4 border-t border-brand-line/50 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tighter">
          <Clock size={12} />
          {formatDate(tender.createdAt)}
        </div>
        <div className="text-[10px] font-bold text-brand-accent uppercase tracking-widest flex items-center gap-1">
          Grid View <ChevronRight size={12} />
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status, large }: { status: string, large?: boolean }) {
  const styles = {
    'eligible': 'bg-[#E8F5E9] text-brand-success',
    'not-eligible': 'bg-[#FFEBEE] text-brand-error',
    'review': 'bg-[#FFF3E0] text-brand-warning',
    'pending': 'bg-slate-100 text-slate-500',
  };
  
  const labels = {
    'eligible': 'ELIGIBLE',
    'not-eligible': 'FAILED',
    'review': 'REVIEW',
    'pending': 'PENDING',
  };

  return (
    <span className={cn(
      "font-bold uppercase tracking-widest rounded-[2px]",
      large ? "px-3 py-1.5 text-[11px]" : "px-2 py-1 text-[10px]",
      styles[status as keyof typeof styles]
    )}>
      {labels[status as keyof typeof labels]}
    </span>
  );
}

function EvaluationBadge({ status }: { status: string }) {
  const icons = {
    'eligible': <CheckCircle2 size={12} />,
    'not-eligible': <XCircle size={12} />,
    'review': <HelpCircle size={12} />,
  };
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-[2px] font-bold text-[10px] uppercase tracking-widest",
      status === 'eligible' && "bg-[#E8F5E9] text-brand-success",
      status === 'not-eligible' && "bg-[#FFEBEE] text-brand-error",
      status === 'review' && "bg-[#FFF3E0] text-brand-warning",
    )}>
      {icons[status as keyof typeof icons]}
      {status === 'eligible' ? 'Pass' : status === 'not-eligible' ? 'Fail' : 'Flag'}
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string, value: number, icon: any }) {
  return (
    <div className="p-5 bg-white border border-brand-line rounded-[4px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold font-mono tracking-tighter text-brand-ink">{value.toString().padStart(2, '0')}</div>
    </div>
  );
}

function CriteriaSummaryStat({ label, count, color }: { label: string, count: number, color: string }) {
  return (
    <div className="p-6 text-center border-r border-brand-line last:border-r-0">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">{label}</p>
      <p className={cn("text-3xl font-bold font-mono tracking-tighter", color)}>{count.toString().padStart(2, '0')}</p>
    </div>
  );
}

function Loader({ className, size = 24 }: { className?: string, size?: number }) {
  return (
    <div className={cn("animate-spin", className)}>
      <RefreshCcw size={size} />
    </div>
  );
}
