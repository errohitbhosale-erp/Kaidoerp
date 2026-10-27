import { useCallback, useEffect, useState } from 'react';
import { Check, CirclePlus, Pencil, RefreshCw, Search, ToggleLeft, ToggleRight, X } from 'lucide-react';
const MASTER_CONFIG = {
  'Class Master': { table: 'class_master', code: 'class_code', name: 'class_name', title: 'Material Classes', codeLabel: 'Class code', codeMax: 5 },
  'Subclass Master': { table: 'subclass_master', code: 'subclass_code', name: 'subclass_name', title: 'Material Subclasses', codeLabel: 'Subclass code', codeMax: 5 },
  'Item Type Master': { table: 'item_type_master', code: 'type_code', name: 'type_name', title: 'Item Types', codeLabel: 'Type code', codeMax: 2 }
};
export default function MasterDataPage({ supabase, company, view, setMessage, setError }) {
  const cfg = MASTER_CONFIG[view];
  const [records, setRecords] = useState([]); const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('active');
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState(null);
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [classId, setClassId] = useState(''); const [active, setActive] = useState(true);
  const load = useCallback(async () => {
    if (!supabase || !company || !cfg) return; setLoading(true); setError('');
    try {
      const cr = await supabase.from('class_master').select('id,class_code,class_name,is_active').eq('company_id', company.id).order('class_code'); if (cr.error) throw cr.error; setClasses(cr.data || []);
      let q = supabase.from(cfg.table).select('*').eq('company_id', company.id).order(cfg.code);
      if (view === 'Subclass Master') q = supabase.from(cfg.table).select('*,class_master(id,class_code,class_name)').eq('company_id', company.id).order('subclass_code');
      const r = await q; if (r.error) throw r.error; setRecords(r.data || []);
    } catch (e) { setError(e?.message || 'Could not load master data. Check company access and database policies.'); } finally { setLoading(false); }
  }, [supabase, company?.id, cfg, view, setError]);
  useEffect(() => { load(); }, [load]);
  const visible = records.filter(r => [r[cfg.code],r[cfg.name],r.class_master?.class_code,r.class_master?.class_name].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()) && (status === 'all' || (status === 'active' ? r.is_active : !r.is_active)));
  const reset = () => { setEditing(null); setCode(''); setName(''); setClassId(classes.find(c=>c.is_active)?.id || ''); setActive(true); };
  const create = () => { reset(); setError(''); setFormOpen(true); };
  const edit = r => { setEditing(r); setCode(r[cfg.code] || ''); setName(r[cfg.name] || ''); setClassId(r.class_id || ''); setActive(Boolean(r.is_active)); setError(''); setFormOpen(true); };
  const save = async e => {
    e.preventDefault(); const c = code.trim().toUpperCase(); const n = name.trim();
    if (!c || !n) { setError('Code and description are required.'); return; }
    if (c.length > cfg.codeMax || (view === 'Item Type Master' && c.length !== 2)) { setError(view === 'Item Type Master' ? 'Item type code must be exactly 2 characters.' : 'Code must be 1 to 5 characters.'); return; }
    if (view === 'Subclass Master' && !classId) { setError('Select the parent class.'); return; }
    if (records.some(r=>r.id!==editing?.id && String(r[cfg.code]).toUpperCase()===c && (view!=='Subclass Master' || r.class_id===classId))) { setError('That code already exists in this company' + (view==='Subclass Master'?' for this class.':'.')); return; }
    const payload = { company_id: company.id, [cfg.code]: c, [cfg.name]: n, is_active: active, updated_at: new Date().toISOString() }; if (view==='Subclass Master') payload.class_id = classId;
    setSaving(true); setError('');
    try {
      let q; if (editing) q = supabase.from(cfg.table).update(payload).eq('id',editing.id).eq('company_id',company.id).select('id').maybeSingle();
      else { const user = await supabase.auth.getUser(); payload.created_by = user.data?.user?.id || null; q = supabase.from(cfg.table).insert(payload).select('id').maybeSingle(); }
      const r = await q; if (r.error) throw r.error; if (!r.data) throw new Error('No record was saved. Check role permissions and row-level security policies.');
      setFormOpen(false); setMessage((editing?'Updated ':'Created ')+view.replace(' Master','').toLowerCase()+' successfully.'); await load();
    } catch (e) { setError(e?.message || 'Could not save master record.'); } finally { setSaving(false); }
  };
  const toggle = async row => {
    const next = !row.is_active; if (!window.confirm((next?'Activate ':'Deactivate ')+row[cfg.code]+'? '+(next?'':'The record will be retained, not deleted.'))) return;
    setError(''); setMessage(''); try { const r = await supabase.from(cfg.table).update({is_active:next,updated_at:new Date().toISOString()}).eq('id',row.id).eq('company_id',company.id).select('id').maybeSingle(); if(r.error) throw r.error; if(!r.data) throw new Error('No record changed. Check your role permissions.'); setMessage(row[cfg.code]+(next?' activated.':' deactivated.')); await load(); } catch(e) { setError(e?.message || 'Could not update status.'); }
  };
  if (!cfg) return null;
  return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> MASTER DATA / CONFIGURATION</div><h1>{cfg.title}</h1><p className="muted">Dedicated CRUD, validation, status control and company-level access.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={create}><CirclePlus size={16}/> New {view.replace(' Master','').toLowerCase()}</button></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>{cfg.title}</h2><p className="muted">Company: {company?.display_name || 'Selected company'} · data isolated by row-level security.</p></div><span className="type-pill">{visible.length} records</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'Search '+view.toLowerCase()+'…'} aria-label="Search master records"/></div><div className="filter-wrap"><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select></div><span className="result-count">{visible.length} shown</span></div>
      <div className="table-scroll"><table><thead><tr><th>CODE</th><th>DESCRIPTION</th>{view==='Subclass Master'&&<th>PARENT CLASS</th>}<th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{loading?<tr><td colSpan={view==='Subclass Master'?5:4}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading master data…</b></div></td></tr>:visible.length?visible.map(r=><tr key={r.id}><td><b>{r[cfg.code]}</b></td><td>{r[cfg.name]}</td>{view==='Subclass Master'&&<td>{r.class_master?.class_code||'—'} · {r.class_master?.class_name||'Unknown class'}</td>}<td><span className={'status-pill '+(r.is_active?'active':'inactive')}><span/>{r.is_active?'Active':'Inactive'}</span></td><td><div style={{display:'flex',gap:5}}><button className="row-action" title="Edit" aria-label={'Edit '+r[cfg.code]} onClick={()=>edit(r)}><Pencil size={15}/></button><button className="row-action" title={r.is_active?'Deactivate':'Activate'} aria-label={(r.is_active?'Deactivate ':'Activate ')+r[cfg.code]} onClick={()=>toggle(r)}>{r.is_active?<ToggleRight size={17}/>:<ToggleLeft size={17}/>}</button></div></td></tr>):<tr><td colSpan={view==='Subclass Master'?5:4}><div className="empty-state"><div className="empty-icon"><CirclePlus size={23}/></div><b>No matching records</b><span>Create a record or change the search/status filter.</span><button className="primary" onClick={create}>Create first record</button></div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{visible.length}</b> of <b>{records.length}</b> records</span><span><span className="live-dot"/> Company-level data</span></div></section>
    <footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> {cfg.title}</span><span>Dedicated master data management</span></footer>
    {formOpen&&<div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setFormOpen(false)}}><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{editing?'EDIT MASTER RECORD':'NEW MASTER RECORD'}</span><h2>{editing?'Edit ':'Create '}{view.replace(' Master','').toLowerCase()}</h2><p className="muted">Changes apply only to the selected company.</p></div><button className="icon-btn" onClick={()=>setFormOpen(false)} aria-label="Close form"><X size={19}/></button></div><form className="item-form" onSubmit={save}><div className="form-grid"><label>{cfg.codeLabel} *<input required maxLength={cfg.codeMax} minLength={view==='Item Type Master'?2:1} value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/\s/g,''))} placeholder={view==='Item Type Master'?'e.g. RM':'Enter code'}/><small>{view==='Item Type Master'?'Exactly 2 characters.':'Maximum 5 characters.'}</small></label><label>Description *<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Enter clear description"/></label>{view==='Subclass Master'&&<label className="full-field">Parent class *<select required value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class</option>{classes.filter(c=>c.is_active||c.id===editing?.class_id).map(c=><option key={c.id} value={c.id}>{c.class_code} — {c.class_name}</option>)}</select><small>Only active classes are offered for new subclasses.</small></label>}<label className="check-row full-field"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/><span><b>Active</b><small>Inactive records are retained and hidden from default active lists.</small></span></label></div><div className="alert success"><Check size={15}/><span>Database validation and company-level row security remain enabled.</span></div><div className="drawer-actions"><button type="button" className="secondary" onClick={()=>setFormOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':<><Check size={16}/>{editing?' Save changes':' Create record'}</>}</button></div></form></aside></div>}
  </div>;
}