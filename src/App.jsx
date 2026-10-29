import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowLeftRight, Boxes, Check, ChevronDown, CircleHelp, ClipboardList, Command, FilePlus2, Filter, LayoutDashboard, LogOut, Menu, Moon, PackageCheck, PackageSearch, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sun, Truck, Warehouse, X } from 'lucide-react';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import MasterDataPage from './MasterDataPage';
import UOMMasterPage from './UOMMasterPage';
import InventoryPage from './InventoryPage';
import WarehouseLocationPage from './WarehouseLocationPage';
import StockTransactionsPage from './StockTransactionsPage';
import ReorderLevelsPage from './ReorderLevelsPage';
import StockReconciliationPage from './StockReconciliationPage';
import StockCycleCountPage from './StockCycleCountPage';
import StockReservationsPage from './StockReservationsPage';
import WarehouseTransfersPage from './WarehouseTransfersPage';
import ReceivingPage from './ReceivingPage';
import ProcurementPage from './ProcurementPage';


class ReorderPageErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Reorder Levels page crashed:', error); }
  render() {
    if (this.state.error) return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Reorder Levels & Alerts</h1><p className="muted">The page encountered an unexpected error instead of loading.</p></div></div><div className="alert error" role="alert"><b>Reorder Levels failed to render.</b><span>{this.state.error?.message || 'Unexpected page error'}</span></div><button className="secondary" onClick={() => this.setState({ error: null })}>Try again</button></div>;
    return this.props.children;
  }
}

const REQUEST_TIMEOUT_MS = 12000;
const withTimeout = (promise, label = 'Supabase request') => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after 12 seconds. Check the deployment's Supabase URL, publishable key, network access, and RLS policies.`)), REQUEST_TIMEOUT_MS))
]);

const blankItem = { item_code: '', item_name: '', description: '', item_type: 'RM', item_class: '', item_subclass: '', base_uom_id: '', hsn_code: '', gst_rate: '', standard_rate: '0', drawing_number: '', revision: '', is_batch_tracked: false, is_serial_tracked: false, is_active: true };
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const fallbackTypes = ['RM', 'SFG', 'FG', 'WIP', 'CONSUMABLE', 'SERVICE', 'PACKING'];

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [dark, setDark] = useState(() => { try { const saved = window.localStorage.getItem('kaido-erp-theme'); if (saved === 'dark' || saved === 'light') return saved === 'dark'; return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; } });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [company, setCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [items, setItems] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [classMasters, setClassMasters] = useState([]);
  const [subclassMasters, setSubclassMasters] = useState([]);
  const [itemTypes, setItemTypes] = useState(fallbackTypes);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [activeFilter, setActiveFilter] = useState('active');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankItem);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState('Materials Master');

  useEffect(() => { try { window.localStorage.setItem('kaido-erp-theme', dark ? 'dark' : 'light'); } catch {} }, [dark]);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) setSession(next);
    });
    withTimeout(supabase.auth.getSession(), 'Authentication check')
      .then(({ data, error: authError }) => {
        if (!alive) return;
        if (authError) setError(authError.message);
        setSession(data?.session || null);
      })
      .catch(e => { if (alive) setError(e?.message || 'Could not check authentication.'); })
      .finally(() => { if (alive) setAuthReady(true); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const [roleRes, uomRes] = await withTimeout(Promise.all([
        supabase.from('user_company_roles').select('company_id,is_default,companies(id,company_code,display_name,legal_name,is_active)').eq('user_id', session.user.id),
        supabase.from('uom_master').select('id,uom_code,uom_name,uom_category,decimal_places').eq('is_active', true).order('uom_code')
      ]), 'Company and UOM lookup');
      if (roleRes.error) throw roleRes.error;
      if (uomRes.error) throw uomRes.error;
      const available = (roleRes.data || []).map(row => ({ ...row.companies, is_default: row.is_default })).filter(c => c?.is_active);
      setCompanies(available); setUoms(uomRes.data || []);
      const selected = available.find(c => c.id === company?.id) || available.find(c => c.is_default) || available[0] || null;
      setCompany(selected);
      if (!selected) { setItems([]); setClassMasters([]); setSubclassMasters([]); setItemTypes(fallbackTypes); setError('No active company is assigned to this account. Ask your ERP administrator to assign a company role.'); return; }
      const [classRes, subclassRes, typeRes] = await withTimeout(Promise.all([
        supabase.from('class_master').select('id,class_code,class_name,is_active').eq('company_id', selected.id).eq('is_active', true).order('class_code'),
        supabase.from('subclass_master').select('id,class_id,subclass_code,subclass_name,is_active,class_master(class_code)').eq('company_id', selected.id).eq('is_active', true).order('subclass_code'),
        supabase.from('item_type_master').select('id,type_code,type_name,is_active').eq('company_id', selected.id).eq('is_active', true).order('type_name')
      ]), 'Classification master lookup');
      if (classRes.error) throw classRes.error;
      if (subclassRes.error) throw subclassRes.error;
      if (typeRes.error) throw typeRes.error;
      setClassMasters(classRes.data || []); setSubclassMasters(subclassRes.data || []);
      setItemTypes(typeRes.data?.length ? typeRes.data.map(t => t.type_name) : fallbackTypes);
      const itemRes = await withTimeout(supabase.from('item_master').select('id,company_id,item_code,item_name,description,item_type,item_class,item_subclass,base_uom_id,hsn_code,gst_rate,standard_rate,drawing_number,revision,is_batch_tracked,is_serial_tracked,is_active,created_at,updated_at,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code,uom_name)').eq('company_id', selected.id).order('item_code').limit(1000), 'Materials lookup');
      if (itemRes.error) throw itemRes.error;
      setItems(itemRes.data || []);
    } catch (e) {
      setError(e?.message || 'Could not load materials. Check your Supabase access policies and schema.');
    } finally { setLoading(false); }
  }, [session, company?.id]);

  useEffect(() => { if (session) loadWorkspace(); else { setItems([]); setCompany(null); setCompanies([]); } }, [session, loadWorkspace]);

  const classOptions = useMemo(() => [...new Set([...classMasters.map(c => c.class_code), ...items.map(i => i.item_class).filter(Boolean)])].sort((a,b)=>a.localeCompare(b)), [classMasters, items]);
  const subclassOptions = useMemo(() => [...new Set([...subclassMasters.filter(s => !form.item_class || s.class_master?.class_code === form.item_class).map(s => s.subclass_code), ...items.filter(i => !form.item_class || i.item_class === form.item_class).map(i => i.item_subclass).filter(Boolean)])].sort((a,b)=>a.localeCompare(b)), [subclassMasters, items, form.item_class]);
  const [classFilter, setClassFilter] = useState('ALL');
  const [subclassFilter, setSubclassFilter] = useState('ALL');

  const filteredItems = useMemo(() => items.filter(item => {
    const haystack = [item.item_code, item.item_name, item.description, item.item_class, item.item_subclass, item.hsn_code].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase()) && (typeFilter === 'ALL' || item.item_type === typeFilter) && (classFilter === 'ALL' || item.item_class === classFilter) && (subclassFilter === 'ALL' || item.item_subclass === subclassFilter) && (activeFilter === 'all' || (activeFilter === 'active' ? item.is_active : !item.is_active));
  }), [items, query, typeFilter, classFilter, subclassFilter, activeFilter]);

  const showNew = () => { setEditing(null); setForm({ ...blankItem, base_uom_id: uoms[0]?.id || '' }); setError(''); setDrawerOpen(true); };
  const showEdit = item => { setEditing(item); setForm({ ...blankItem, ...item, gst_rate: item.gst_rate ?? '', standard_rate: item.standard_rate ?? '0', base_uom_id: item.base_uom_id || '' }); setError(''); setDrawerOpen(true); };
  const setField = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const signIn = async event => {
    event.preventDefault(); if (!supabase) return;
    setAuthBusy(true); setError('');
    try {
      const { error: e } = await withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password }), 'Sign-in');
      if (e) setError(e.message);
    } catch (e) {
      setError(e?.message || 'Sign-in failed. Please try again.');
    } finally { setAuthBusy(false); }
  };
  const saveItem = async event => {
    event.preventDefault();
    if (!supabase || !company) return;
    const code = form.item_code.trim().toUpperCase();
    const name = form.item_name.trim();
    const rate = Number(form.standard_rate);
    const gst = form.gst_rate === '' ? null : Number(form.gst_rate);
    if (!code || !name || !form.base_uom_id) {
      setError('Item code, item name, and base UOM are required.');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Standard rate must be a valid non-negative number.');
      return;
    }
    if (gst !== null && (!Number.isFinite(gst) || gst < 0 || gst > 100)) {
      setError('GST rate must be between 0 and 100.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        company_id: company.id, item_code: code, item_name: name,
        description: form.description.trim() || null, item_type: form.item_type,
        item_class: form.item_class.trim() || null, item_subclass: form.item_subclass.trim() || null,
        base_uom_id: form.base_uom_id, hsn_code: form.hsn_code.trim() || null,
        gst_rate: gst, standard_rate: rate, drawing_number: form.drawing_number.trim() || null,
        revision: form.revision.trim() || null, is_batch_tracked: Boolean(form.is_batch_tracked),
        is_serial_tracked: Boolean(form.is_serial_tracked), is_active: Boolean(form.is_active),
        updated_at: new Date().toISOString()
      };
      const result = await withTimeout(editing
        ? supabase.from('item_master').update(payload).eq('id', editing.id).eq('company_id', company.id).select('id').maybeSingle()
        : supabase.from('item_master').insert(payload).select('id').maybeSingle(), 'Save material');
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No row was saved. Check item permissions and row-level security policies.');
      setDrawerOpen(false);
      setMessage(editing ? 'Material updated.' : 'Material created.');
      await loadWorkspace();
    } catch (e) {
      setError(e?.message || 'Could not save material. Please retry.');
    } finally {
      setSaving(false);
    }
  };
  const importCsv = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase || !company) return;
    setImporting(true); setError(''); setMessage('');
    try {
      const text = await file.text();
      const rows = [];
      let row = [], cell = '', quoted = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = !quoted;
        else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !quoted) {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row);
          row = []; cell = '';
        } else cell += ch;
      }
      row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row);
      if (rows.length < 2) throw new Error('CSV must contain a header row and at least one material row.');
      const headers = rows[0].map(h => h.replace(/^\uFEFF/, '').toLowerCase().replace(/[\s/-]+/g, '_'));
      const col = key => headers.indexOf(key);
      const required = ['item_code','item_name','item_type','base_uom_code'];
      const missing = required.filter(k => col(k) < 0);
      if (missing.length) throw new Error('Missing required CSV columns: ' + missing.join(', ') + '.');
      const uomByCode = new Map(uoms.map(u => [u.uom_code.toLowerCase(), u.id]));
      const seen = new Set(items.map(i => i.item_code.toUpperCase()));
      const payload = [];
      const rowErrors = [];
      rows.slice(1).forEach((r, idx) => {
        const value = key => col(key) < 0 ? '' : (r[col(key)] || '').trim();
        const code = value('item_code').toUpperCase();
        const name = value('item_name');
        const type = value('item_type').toUpperCase();
        const uom = uomByCode.get(value('base_uom_code').toLowerCase());
        const rateText = value('standard_rate');
        const rate = rateText ? Number(rateText) : 0;
        if (!code || !name) rowErrors.push(`Row ${idx + 2}: item_code and item_name are required.`);
        else if (seen.has(code)) rowErrors.push(`Row ${idx + 2}: duplicate item code ${code} (existing or repeated).`);
        else if (!itemTypes.includes(type)) rowErrors.push(`Row ${idx + 2}: unsupported item_type ${type}.`);
        else if (!uom) rowErrors.push(`Row ${idx + 2}: unknown base_uom_code ${value('base_uom_code')}.`);
        else if (!Number.isFinite(rate) || rate < 0) rowErrors.push(`Row ${idx + 2}: invalid standard_rate.`);
        else {
          const gstText = value('gst_rate');
          const gst = gstText ? Number(gstText) : null;
          if (gst !== null && (!Number.isFinite(gst) || gst < 0 || gst > 100)) rowErrors.push(`Row ${idx + 2}: invalid gst_rate.`);
          else {
            seen.add(code);
            payload.push({
              company_id: company.id, item_code: code, item_name: name,
              description: value('description') || null, item_type: type,
              item_class: value('item_class') || null, item_subclass: value('item_subclass') || null,
              base_uom_id: uom, standard_rate: rate, hsn_code: value('hsn_code') || null,
              gst_rate: gst, is_active: true, is_batch_tracked: false, is_serial_tracked: false
            });
          }
        }
      });
      if (!payload.length) throw new Error('No valid rows to import. ' + rowErrors.slice(0, 4).join(' '));
      const result = await withTimeout(supabase.from('item_master').insert(payload).select('id'), 'CSV material import');
      if (result.error) throw result.error;
      setMessage(`Imported ${result.data?.length ?? payload.length} materials.` + (rowErrors.length ? ` Skipped ${rowErrors.length} invalid row(s): ${rowErrors.slice(0, 3).join(' ')}` : ''));
      await loadWorkspace();
    } catch (e) {
      setError(e?.message || 'CSV import failed.');
    } finally { setImporting(false); }
  };

  const exportCsv = () => {
    const columns = ['item_code','item_name','description','item_type','item_class','item_subclass','uom_code','hsn_code','gst_rate','standard_rate','drawing_number','revision','is_batch_tracked','is_serial_tracked','is_active'];
    const csv = [columns.join(','), ...filteredItems.map(i => columns.map(k => {
      const value = k === 'uom_code' ? i.uom_master?.uom_code : i[k];
      return '"' + String(value ?? '').replaceAll('"', '""') + '"';
    }).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'kaidoerp-materials-master.csv'; a.click(); URL.revokeObjectURL(url);
  };

  if (!authReady) return <div className="boot"><div className="brand-mark">K</div><span>Loading KaidoERP…</span></div>;
  if (!isSupabaseConfigured) return <div className="boot"><div className="login-card"><div className="brand-mark">K</div><p className="eyebrow">SETUP REQUIRED</p><h1>Connect your ERP workspace</h1><p className="muted">Add the Supabase project URL and publishable key as Vercel environment variables to enable sign-in and Materials Master.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p className="muted small">Use a browser-safe publishable/anon key only. Never put a service-role key in frontend environment variables.</p></div></div>;
  if (!session) return <main className="login-shell"><div className="login-visual"><div className="brand-lockup"><div className="brand-mark">K</div><span>Kaido<span className="brand-light">ERP</span></span></div><div className="login-message"><span className="eyebrow">OPERATIONS, IN SYNC</span><h1>One source of truth.<br/><span>Every material.</span></h1><p>Control your item data, keep teams aligned, and build a cleaner manufacturing operation.</p></div><div className="login-foot"><span>SECURE WORKSPACE</span><span>·</span><span>BUILT FOR MANUFACTURING</span></div></div><div className="login-panel"><form className="login-form" onSubmit={signIn}><div className="brand-mark small-mark">K</div><p className="eyebrow">WELCOME BACK</p><h2>Sign in to KaidoERP</h2><p className="muted">Use your existing ERP account to continue.</p>{error && <div className="alert error">{error}</div>}<label>Email address<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/></label><button className="primary wide" disabled={authBusy}>{authBusy?'Signing in…':'Sign in'} <span>→</span></button><p className="muted small login-safe"><ShieldCheck size={15}/> Your session is managed by Supabase Auth.</p></form></div></main>;

  return <div className={dark ? 'app dark' : 'app light'}>
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={()=>setSidebarOpen(false)}/>} 
    <aside className={'sidebar '+(sidebarOpen?'sidebar-open':'')}><div className="side-brand"><div className="brand-mark">K</div><div><b>Kaido<span>ERP</span></b><small>MANUFACTURING SUITE</small></div><button className="icon-btn mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Close menu"><X size={18}/></button></div><div className="workspace-label">WORKSPACE</div><button className="company-select" onClick={()=>companies.length>1&&document.getElementById('company-picker')?.showPicker?.()}><span className="company-avatar">{(company?.display_name||'S').slice(0,1).toUpperCase()}</span><span className="company-meta"><b>{company?.display_name||'Company workspace'}</b><small>{company?.company_code||'NO COMPANY'}</small></span><ChevronDown size={15}/></button>{companies.length>1 && <select id="company-picker" className="company-picker" value={company?.id||''} onChange={e=>setCompany(companies.find(c=>c.id===e.target.value)||null)}>{companies.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select>}<nav className="sidebar-nav" aria-label="ERP navigation"><div className="nav-label">WORKSPACE</div><button className={"nav-item "+(view==="Overview"?"selected":"")} onClick={()=>setView('Overview')}><LayoutDashboard size={18}/> Overview</button><div className="nav-label">GENERAL MASTERS</div><button className={"nav-item "+(view==="UOM Master"?"selected":"")} onClick={()=>setView("UOM Master")}><Settings2 size={18}/> UOM Master</button><div className="nav-label">MATERIALS / DME MASTERS</div><button className={"nav-item "+(view==="Materials Master"?"selected":"")} onClick={()=>setView('Materials Master')}><Boxes size={18}/> Materials Master <span className="nav-count">{items.length}</span></button><button className={"nav-item "+(view==="Class Master"?"selected":"")} onClick={()=>setView("Class Master")}><Settings2 size={18}/> Class Master</button><button className={"nav-item "+(view==="Subclass Master"?"selected":"")} onClick={()=>setView("Subclass Master")}><Settings2 size={18}/> Subclass Master</button><button className={"nav-item "+(view==="Item Type Master"?"selected":"")} onClick={()=>setView("Item Type Master")}><Settings2 size={18}/> Item Type Master</button><div className="nav-label">STORES & INVENTORY</div><button className={"nav-item "+(view==="Warehouse & Locations"?"selected":"")} onClick={()=>setView("Warehouse & Locations")}><Warehouse size={18}/> Warehouse & Locations</button><button className={"nav-item "+(view==="Inventory & Stock"?"selected":"")} onClick={()=>setView("Inventory & Stock")}><Activity size={18}/> Inventory & Stock</button><button className={"nav-item "+(view==="Stock Transactions"?"selected":"")} onClick={()=>setView("Stock Transactions")}><ClipboardList size={18}/> Stock Transactions</button><button className={"nav-item "+(view==="Stock Reservations"?"selected":"")} onClick={()=>setView("Stock Reservations")}><Boxes size={18}/> Stock Reservations</button><button className={"nav-item "+(view==="Warehouse Transfers"?"selected":"")} onClick={()=>setView("Warehouse Transfers")}><ArrowLeftRight size={18}/> Warehouse Transfers</button><button className={"nav-item "+(view==="Receiving & GRN"?"selected":"")} onClick={()=>setView("Receiving & GRN")}><PackageCheck size={18}/> Receiving & GRN</button><button className={"nav-item "+(view==="Suppliers & Purchase Orders"?"selected":"")} onClick={()=>setView("Suppliers & Purchase Orders")}><Truck size={18}/> Suppliers & Purchase Orders</button><button className={"nav-item "+(view==="Reorder Levels"?"selected":"")} onClick={()=>setView("Reorder Levels")}><PackageSearch size={18}/> Reorder Levels</button><button className={"nav-item "+(view==="Stock Reconciliation"?"selected":"")} onClick={()=>setView("Stock Reconciliation")}><ShieldCheck size={18}/> Stock Reconciliation</button><button className={"nav-item "+(view==="Physical Stock Count"?"selected":"")} onClick={()=>setView("Physical Stock Count")}><ClipboardList size={18}/> Physical Stock Count</button></nav><div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><b>Need a hand?</b><p>Ask your ERP administrator for access or setup support.</p></div><div className="user-card"><div className="user-avatar">{(session.user.email||'U').slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{session.user.email}</b><small>Authenticated user</small></div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={()=>supabase.auth.signOut()}><LogOut size={17}/></button></div></div></aside>
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={()=>setSidebarOpen(true)} aria-label="Open menu"><Menu size={19}/></button><div className="breadcrumb">Workspace <span>/</span> <b>{view}</b></div></div><div className="top-actions"><span className="secure-status"><span/> Supabase connected</span><button className="icon-btn" onClick={()=>setDark(v=>!v)} title={dark?'Switch to light mode':'Switch to dark mode'} aria-label="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="avatar-top" title={session.user.email}>{(session.user.email||'U').slice(0,1).toUpperCase()}</button></div></header>
      {view === 'Warehouse & Locations' ? <WarehouseLocationPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Inventory & Stock' ? <InventoryPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Stock Transactions' ? <StockTransactionsPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Stock Reservations' ? <StockReservationsPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Warehouse Transfers' ? <WarehouseTransfersPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Receiving & GRN' ? <ReceivingPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Suppliers & Purchase Orders' ? <ProcurementPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'Reorder Levels' ? <ReorderPageErrorBoundary key={company?.id || 'no-company'}><ReorderLevelsPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /></ReorderPageErrorBoundary> : view === 'Stock Reconciliation' ? <StockReconciliationPage supabase={supabase} company={company} /> : view === 'Physical Stock Count' ? <StockCycleCountPage supabase={supabase} company={company} setMessage={setMessage} setError={setError} /> : view === 'UOM Master' ? <UOMMasterPage supabase={supabase} setMessage={setMessage} setError={setError} /> : view === 'Materials Master' ? <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> MASTER DATA / INVENTORY</div><h1>{view}</h1><p className="muted">A single, reliable catalog for every material in your operation.</p></div><div className="heading-actions"><button className="secondary" onClick={loadWorkspace} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={showNew}><Plus size={17}/> New material</button></div></div>
      {error && <div className="alert error"><span>{error}</span><button className="icon-btn" onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}{message && <div className="alert success"><Check size={17}/>{message}<button className="icon-btn" onClick={()=>setMessage('')} aria-label="Dismiss message"><X size={16}/></button></div>}
      <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Total materials</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{items.length.toLocaleString('en-IN')}</div><div className="stat-foot"><span className="stat-dot green"/> In selected company</div></div><div className="stat-card"><div className="stat-top"><span>Active items</span><span className="stat-icon"><Check size={17}/></span></div><div className="stat-value">{items.filter(i=>i.is_active).length.toLocaleString('en-IN')}</div><div className="stat-foot">Available for transactions</div></div><div className="stat-card"><div className="stat-top"><span>Item categories</span><span className="stat-icon"><Command size={17}/></span></div><div className="stat-value">{new Set(items.map(i=>i.item_type)).size}</div><div className="stat-foot">Types in your catalog</div></div><div className="stat-card"><div className="stat-top"><span>Tracked items</span><span className="stat-icon"><ShieldCheck size={17}/></span></div><div className="stat-value">{items.filter(i=>i.is_batch_tracked||i.is_serial_tracked).length}</div><div className="stat-foot">Batch or serial controlled</div></div></div>
      <section className="data-panel"><div className="panel-title"><div><h2>Material catalog</h2><p className="muted">Manage item definitions, units, classifications and costing.</p></div><div className="heading-actions"><label className="secondary export-btn" style={{cursor:importing?'wait':'pointer'}}><FilePlus2 size={16}/>{importing?'Importing…':'Import CSV'}<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={importing} hidden/></label><button className="secondary export-btn" onClick={exportCsv} disabled={!filteredItems.length}><ArrowDownToLine size={16}/> Export CSV</button></div></div><div className="toolbar"><div className="search-box"><Search size={17}/><input aria-label="Search materials" placeholder="Search code, name, description…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="clear-search" onClick={()=>setQuery('')} aria-label="Clear search"><X size={14}/></button>}</div><div className="filter-wrap"><Filter size={16}/><select aria-label="Filter by type" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="ALL">All item types</option>{itemTypes.map(t=><option key={t}>{t}</option>)}</select></div><div className="filter-wrap"><select aria-label="Filter by class" value={classFilter} onChange={e=>setClassFilter(e.target.value)}><option value="ALL">All classes</option>{classOptions.map(v=><option key={v}>{v}</option>)}</select></div><div className="filter-wrap"><select aria-label="Filter by subclass" value={subclassFilter} onChange={e=>setSubclassFilter(e.target.value)}><option value="ALL">All subclasses</option>{subclassOptions.map(v=><option key={v}>{v}</option>)}</select></div><div className="filter-wrap"><select aria-label="Filter by status" value={activeFilter} onChange={e=>setActiveFilter(e.target.value)}><option value="active">Active items</option><option value="inactive">Inactive items</option><option value="all">All statuses</option></select></div><span className="result-count">{filteredItems.length} results</span></div>
      <div className="table-scroll"><table><thead><tr><th>ITEM CODE / NAME</th><th>CLASSIFICATION</th><th>TYPE</th><th>BASE UOM</th><th>STANDARD RATE</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{loading ? <tr><td colSpan="7"><div className="empty-state"><RefreshCw className="spin" size={22}/><b>Loading materials…</b><span>Reading your company catalog</span></div></td></tr> : filteredItems.length ? filteredItems.map(item=><tr key={item.id}><td><div className="item-identity"><span className="item-symbol"><PackageSearch size={17}/></span><div><b>{item.item_code}</b><span>{item.item_name}</span>{item.description&&<small>{item.description}</small>}</div></div></td><td><div className="class-cell">{item.item_class||'—'}{item.item_subclass&&<small>{item.item_subclass}</small>}</div></td><td><span className={'type-pill type-'+String(item.item_type).toLowerCase()}>{item.item_type}</span></td><td><span className="uom-code">{item.uom_master?.uom_code||'—'}</span></td><td className="rate-cell">{money(item.standard_rate)}</td><td><span className={'status-pill '+(item.is_active?'active':'inactive')}><span/>{item.is_active?'Active':'Inactive'}</span></td><td><button className="row-action" aria-label={'Edit '+item.item_code} title="Edit material" onClick={()=>showEdit(item)}><Pencil size={16}/></button></td></tr>) : <tr><td colSpan="7"><div className="empty-state"><div className="empty-icon"><PackageSearch size={24}/></div><b>{items.length?'No matching materials':'Your material catalog is ready'}</b><span>{items.length?'Try a different search or filter.':'Create your first material to begin building the catalog.'}</span>{!items.length&&<button className="primary" onClick={showNew}><Plus size={16}/> Create first material</button>}</div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredItems.length}</b> of <b>{items.length}</b> materials</span><span><span className="live-dot"/> Live workspace data</span></div></section><footer className="page-footer"><span>KaidoERP <span className="footer-sep">/</span> Materials Master</span><span>Designed for precision manufacturing</span></footer></div> : <MasterDataPage supabase={supabase} company={company} view={view} setMessage={setMessage} setError={setError} />}</main>
    {drawerOpen && <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDrawerOpen(false)}}><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{editing?'UPDATE MASTER DATA':'NEW MASTER DATA'}</span><h2>{editing?'Edit material':'Create material'}</h2><p className="muted">Required fields are marked with an asterisk.</p></div><button className="icon-btn" onClick={()=>setDrawerOpen(false)} aria-label="Close form"><X size={19}/></button></div><form className="item-form" onSubmit={saveItem}><div className="form-section-title">Basic information</div><div className="form-grid"><label>Item code *<input required maxLength="80" value={form.item_code} onChange={e=>setField('item_code',e.target.value)} placeholder="e.g. MPFC20501500" disabled={Boolean(editing)}/>{editing&&<small>Item code is locked after creation.</small>}</label><label>Item type *<select required value={form.item_type} onChange={e=>setField('item_type',e.target.value)}>{itemTypes.map(t=><option key={t}>{t}</option>)}</select><small>Managed in Item Type Master.</small></label><label className="full-field">Item name *<input required maxLength="200" value={form.item_name} onChange={e=>setField('item_name',e.target.value)} placeholder="Short, searchable material name"/></label><label className="full-field">Description<textarea rows="3" value={form.description||''} onChange={e=>setField('description',e.target.value)} placeholder="Dimensions, material grade, finish, specifications…"/></label></div><div className="form-section-title">Classification & units</div><div className="form-grid"><label>Class<select value={form.item_class||''} onChange={e=>{setField('item_class',e.target.value);setField('item_subclass','')}}><option value="">Unclassified</option>{form.item_class&&!classOptions.includes(form.item_class)&&<option value={form.item_class}>{form.item_class} (legacy value)</option>}{classOptions.map(v=><option key={v} value={v}>{v}</option>)}</select><small>Managed in Class Master. Only active classes are selectable.</small></label><label>Subclass<select value={form.item_subclass||''} onChange={e=>setField('item_subclass',e.target.value)}><option value="">No subclass</option>{form.item_subclass&&!subclassOptions.includes(form.item_subclass)&&<option value={form.item_subclass}>{form.item_subclass} (legacy value)</option>}{subclassOptions.map(v=><option key={v} value={v}>{v}</option>)}</select><small>Subclass options follow the selected class where available.</small></label><label>Base unit of measure *<select required value={form.base_uom_id} onChange={e=>setField('base_uom_id',e.target.value)}><option value="">Select UOM</option>{uoms.map(u=><option key={u.id} value={u.id}>{u.uom_code} — {u.uom_name}</option>)}</select></label><label>HSN / SAC code<input maxLength="20" value={form.hsn_code||''} onChange={e=>setField('hsn_code',e.target.value)} placeholder="Tax classification"/></label></div><div className="form-section-title">Costing & engineering</div><div className="form-grid"><label>Standard rate (₹)<input type="number" min="0" step="0.0001" value={form.standard_rate} onChange={e=>setField('standard_rate',e.target.value)} required/></label><label>GST rate (%)<input type="number" min="0" max="100" step="0.01" value={form.gst_rate} onChange={e=>setField('gst_rate',e.target.value)} placeholder="e.g. 18"/></label><label>Drawing number<input value={form.drawing_number||''} onChange={e=>setField('drawing_number',e.target.value)} placeholder="Drawing reference"/></label><label>Revision<input value={form.revision||''} onChange={e=>setField('revision',e.target.value)} placeholder="e.g. A / 01"/></label></div><div className="form-section-title">Tracking controls</div><div className="check-grid"><label className="check-row"><input type="checkbox" checked={Boolean(form.is_batch_tracked)} onChange={e=>setField('is_batch_tracked',e.target.checked)}/><span><b>Batch tracking</b><small>Track lots and batches</small></span></label><label className="check-row"><input type="checkbox" checked={Boolean(form.is_serial_tracked)} onChange={e=>setField('is_serial_tracked',e.target.checked)}/><span><b>Serial tracking</b><small>Track unique units</small></span></label><label className="check-row"><input type="checkbox" checked={Boolean(form.is_active)} onChange={e=>setField('is_active',e.target.checked)}/><span><b>Active item</b><small>Available for transactions</small></span></label></div>{error&&<div className="alert error">{error}</div>}<div className="drawer-actions"><button type="button" className="secondary" onClick={()=>setDrawerOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':<><Check size={16}/> {editing?'Save changes':'Create material'}</>}</button></div></form></aside></div>}
  </div>;
}
