import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Check, CirclePlus, MapPin, Pencil, RefreshCw, Search, ToggleLeft, ToggleRight, Warehouse, X } from 'lucide-react';

const LOCATION_TYPES = ['ZONE', 'RACK', 'SHELF', 'BIN', 'FLOOR', 'OTHER'];
const WAREHOUSE_TYPES = ['GENERAL', 'RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'QC_HOLD', 'SUBCONTRACTOR', 'SCRAP', 'TRANSIT', 'OTHER'];

export default function WarehouseLocationPage({ supabase, company, setMessage, setError }) {
  const [tab, setTab] = useState('warehouses');
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    if (!supabase || !company?.id) { setWarehouses([]); setLocations([]); return; }
    setLoading(true);
    try {
      const [wr, lr] = await Promise.all([
        supabase.from('warehouse_master').select('id,company_id,warehouse_code,warehouse_name,warehouse_type,address,is_active').eq('company_id', company.id).order('warehouse_code'),
        supabase.from('location_master').select('id,company_id,warehouse_id,location_code,location_name,location_type,parent_location_id,is_active').eq('company_id', company.id).order('location_code')
      ]);
      if (wr.error) throw wr.error;
      if (lr.error) throw lr.error;
      setWarehouses(wr.data || []);
      setLocations(lr.data || []);
    } catch (e) { setError(e?.message || 'Could not load warehouse and location masters.'); }
    finally { setLoading(false); }
  }, [supabase, company?.id, setError]);

  useEffect(() => { load(); }, [load]);
  const warehouseMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);
  const visible = (tab === 'warehouses' ? warehouses : locations).filter(r => {
    const parent = tab === 'locations' ? warehouseMap.get(r.warehouse_id) : null;
    const match = [r.warehouse_code, r.warehouse_name, r.warehouse_type, r.address, r.location_code, r.location_name, r.location_type, parent?.warehouse_code, parent?.warehouse_name].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase());
    return match && (status === 'all' || (status === 'active' ? r.is_active : !r.is_active));
  });
  const reset = () => setForm(tab === 'warehouses'
    ? { warehouse_code: '', warehouse_name: '', warehouse_type: 'GENERAL', address: '', is_active: true }
    : { warehouse_id: warehouses.find(w => w.is_active)?.id || '', location_code: '', location_name: '', location_type: 'BIN', parent_location_id: '', is_active: true });
  const create = () => { setEditing(null); reset(); setError(''); setOpen(true); };
  const edit = r => {
    setEditing(r);
    setForm(tab === 'warehouses'
      ? { warehouse_code: r.warehouse_code, warehouse_name: r.warehouse_name, warehouse_type: r.warehouse_type, address: r.address || '', is_active: r.is_active }
      : { warehouse_id: r.warehouse_id, location_code: r.location_code, location_name: r.location_name || '', location_type: r.location_type, parent_location_id: r.parent_location_id || '', is_active: r.is_active });
    setError(''); setOpen(true);
  };
  const save = async e => {
    e.preventDefault();
    const codeKey = tab === 'warehouses' ? 'warehouse_code' : 'location_code';
    const nameKey = tab === 'warehouses' ? 'warehouse_name' : 'location_name';
    const code = String(form[codeKey] || '').trim().toUpperCase().replace(/\s+/g, '-');
    const name = String(form[nameKey] || '').trim();
    if (!code || (tab === 'warehouses' && !name)) { setError(tab === 'warehouses' ? 'Warehouse code and name are required.' : 'Location code is required.'); return; }
    if (tab === 'locations' && !form.warehouse_id) { setError('Select a warehouse for this location.'); return; }
    if (tab === 'locations' && editing?.id === form.parent_location_id) { setError('A location cannot be its own parent.'); return; }
    if (tab === 'locations' && form.parent_location_id) {
      const parent = locations.find(l => l.id === form.parent_location_id);
      if (!parent || parent.warehouse_id !== form.warehouse_id) {
        setError('Parent location must belong to the selected warehouse.'); return;
      }
      // Walk the proposed parent's ancestry; selecting a descendant would create a cycle.
      let ancestorId = parent.id;
      const visited = new Set();
      while (ancestorId && !visited.has(ancestorId)) {
        if (ancestorId === editing?.id) {
          setError('A location cannot be placed under one of its own descendants.'); return;
        }
        visited.add(ancestorId);
        ancestorId = locations.find(l => l.id === ancestorId)?.parent_location_id || null;
      }
    }
    const payload = { ...form, [codeKey]: code, [nameKey]: name || null };
    if (tab === 'warehouses') payload.company_id = company.id;
    else {
      payload.company_id = company.id;
      if (!payload.parent_location_id) payload.parent_location_id = null;
    }
    delete payload.id;
    setSaving(true); setError('');
    try {
      let result;
      if (editing) result = await supabase.from(tab === 'warehouses' ? 'warehouse_master' : 'location_master').update(payload).eq('id', editing.id).eq('company_id', company.id).select('id').maybeSingle();
      else {
        const user = await supabase.auth.getUser();
        payload.created_by = user.data?.user?.id || null;
        result = await supabase.from(tab === 'warehouses' ? 'warehouse_master' : 'location_master').insert(payload).select('id').maybeSingle();
      }
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No record was saved. Check that your user has Stores/Admin access for this company.');
      setOpen(false); setMessage((editing ? 'Updated ' : 'Created ') + (tab === 'warehouses' ? 'warehouse' : 'location') + ' successfully.');
      await load();
    } catch (e) { setError(e?.message || 'Could not save master record.'); }
    finally { setSaving(false); }
  };
  const toggle = async row => {
    const code = tab === 'warehouses' ? row.warehouse_code : row.location_code;
    const next = !row.is_active;
    if (!window.confirm((next ? 'Activate ' : 'Deactivate ') + code + '? Records are retained; this does not delete stock history.')) return;
    setError('');
    try {
      const result = await supabase.from(tab === 'warehouses' ? 'warehouse_master' : 'location_master').update({ is_active: next }).eq('id', row.id).eq('company_id', company.id).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No record changed. Check your role permissions.');
      setMessage(code + (next ? ' activated.' : ' deactivated.'));
      await load();
    } catch (e) { setError(e?.message || 'Could not change status.'); }
  };

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> MASTER DATA / STORES</div><h1>Warehouse & Locations</h1><p className="muted">Configure company warehouses and storage bins before stock transactions are enabled.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/> Refresh</button><button className="primary" onClick={create}><CirclePlus size={16}/> New {tab === 'warehouses' ? 'warehouse' : 'location'}</button></div></div>
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Warehouses</span><span className="stat-icon"><Warehouse size={17}/></span></div><div className="stat-value">{warehouses.length}</div><div className="stat-foot">Across selected company</div></div><div className="stat-card"><div className="stat-top"><span>Active warehouses</span><span className="stat-icon"><Check size={17}/></span></div><div className="stat-value">{warehouses.filter(w=>w.is_active).length}</div><div className="stat-foot">Available for selection</div></div><div className="stat-card"><div className="stat-top"><span>Storage locations</span><span className="stat-icon"><MapPin size={17}/></span></div><div className="stat-value">{locations.length}</div><div className="stat-foot">Bins, racks, shelves and zones</div></div><div className="stat-card"><div className="stat-top"><span>Active locations</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{locations.filter(l=>l.is_active).length}</div><div className="stat-foot">Available for stock assignment</div></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Stores structure</h2><p className="muted">{company?.display_name || 'Selected company'} · company-scoped access</p></div><span className="type-pill">{visible.length} records</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search code, name, warehouse or type…" aria-label="Search warehouse and location records"/></div><div className="filter-wrap"><select value={tab} onChange={e=>{setTab(e.target.value);setSearch('');setOpen(false)}} aria-label="Master type"><option value="warehouses">Warehouses</option><option value="locations">Storage locations</option></select></div><div className="filter-wrap"><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select></div><span className="result-count">{visible.length} shown</span></div>
      <div className="table-scroll"><table><thead>{tab === 'warehouses' ? <tr><th>WAREHOUSE CODE</th><th>NAME</th><th>TYPE</th><th>ADDRESS</th><th>STATUS</th><th>ACTIONS</th></tr> : <tr><th>LOCATION CODE</th><th>NAME</th><th>WAREHOUSE</th><th>TYPE</th><th>PARENT LOCATION</th><th>STATUS</th><th>ACTIONS</th></tr>}</thead><tbody>{loading ? <tr><td colSpan={tab==='warehouses'?6:7}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading stores structure…</b></div></td></tr> : visible.length ? visible.map(r => { const w = tab==='locations' ? warehouseMap.get(r.warehouse_id) : null; const parent = tab==='locations' ? locations.find(x=>x.id===r.parent_location_id) : null; return <tr key={r.id}><td><b>{tab==='warehouses'?r.warehouse_code:r.location_code}</b></td><td>{tab==='warehouses'?r.warehouse_name:(r.location_name||'—')}</td>{tab==='warehouses' ? <><td><span className="type-pill">{r.warehouse_type}</span></td><td>{r.address||'—'}</td></> : <><td><b>{w?.warehouse_code||'—'}</b><div className="muted">{w?.warehouse_name||''}</div></td><td><span className="type-pill">{r.location_type}</span></td><td>{parent ? parent.location_code : '—'}</td></>}<td><span className={'status-pill '+(r.is_active?'active':'inactive')}><span/>{r.is_active?'Active':'Inactive'}</span></td><td><div style={{display:'flex',gap:5}}><button className="row-action" title="Edit" aria-label={'Edit '+(tab==='warehouses'?r.warehouse_code:r.location_code)} onClick={()=>edit(r)}><Pencil size={15}/></button><button className="row-action" title={r.is_active?'Deactivate':'Activate'} aria-label={(r.is_active?'Deactivate ':'Activate ')+(tab==='warehouses'?r.warehouse_code:r.location_code)} onClick={()=>toggle(r)}>{r.is_active?<ToggleRight size={17}/>:<ToggleLeft size={17}/>}</button></div></td></tr>; }) : <tr><td colSpan={tab==='warehouses'?6:7}><div className="empty-state"><div className="empty-icon">{tab==='warehouses'?<Warehouse size={23}/>:<MapPin size={23}/>}</div><b>No {tab==='warehouses'?'warehouses':'locations'} found</b><span>Create a record or adjust the search/status filter.</span><button className="primary" onClick={create}>Create first {tab==='warehouses'?'warehouse':'location'}</button></div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{visible.length}</b> of <b>{tab==='warehouses'?warehouses.length:locations.length}</b> records</span><span><span className="live-dot"/> Company-level data</span></div>
    </section><footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Warehouse & Locations</span><span>Stores configuration</span></footer>
    {open && <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{editing?'EDIT MASTER RECORD':'NEW MASTER RECORD'}</span><h2>{editing?'Edit ':'Create '}{tab==='warehouses'?'warehouse':'storage location'}</h2><p className="muted">Changes apply only to the selected company.</p></div><button className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close form"><X size={19}/></button></div>
      <form className="item-form" onSubmit={save}><div className="form-section-title">Basic information</div><div className="form-grid">
      {tab==='warehouses' ? <><label>Warehouse code *<input required maxLength={30} value={form.warehouse_code||''} onChange={e=>setField('warehouse_code',e.target.value.toUpperCase())} placeholder="e.g. RM-STORE"/></label><label>Warehouse name *<input required maxLength={100} value={form.warehouse_name||''} onChange={e=>setField('warehouse_name',e.target.value)} placeholder="Raw material store"/></label><label>Warehouse type *<select required value={form.warehouse_type||'GENERAL'} onChange={e=>setField('warehouse_type',e.target.value)}>{WAREHOUSE_TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label className="full-field">Address<input value={form.address||''} onChange={e=>setField('address',e.target.value)} placeholder="Optional warehouse address"/></label></> : <><label className="full-field">Warehouse *<select required value={form.warehouse_id||''} onChange={e=>setField('warehouse_id',e.target.value)}><option value="">Select warehouse</option>{warehouses.filter(w=>w.is_active||w.id===editing?.warehouse_id).map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.warehouse_name}</option>)}</select></label><label>Location code *<input required maxLength={40} value={form.location_code||''} onChange={e=>setField('location_code',e.target.value.toUpperCase())} placeholder="e.g. R01-B02"/></label><label>Location name<input maxLength={100} value={form.location_name||''} onChange={e=>setField('location_name',e.target.value)} placeholder="Rack 1 / Bin 2"/></label><label>Location type *<select required value={form.location_type||'BIN'} onChange={e=>setField('location_type',e.target.value)}>{LOCATION_TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label>Parent location<select value={form.parent_location_id||''} onChange={e=>setField('parent_location_id',e.target.value)}><option value="">No parent</option>{locations.filter(l=>l.warehouse_id===form.warehouse_id&&l.id!==editing?.id&&l.is_active).map(l=><option key={l.id} value={l.id}>{l.location_code} — {l.location_name||l.location_type}</option>)}</select></label></>}
      <label className="check-row full-field"><input type="checkbox" checked={Boolean(form.is_active)} onChange={e=>setField('is_active',e.target.checked)}/><span><b>Active</b><small>Inactive records are retained and hidden from default lists.</small></span></label></div><div className="alert success"><Check size={15}/><span>Company-level row security applies. Existing stock history is not deleted when a master is deactivated.</span></div><div className="drawer-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':<><Check size={16}/>{editing?' Save changes':' Create record'}</>}</button></div></form></aside></div>}
  </div>;
}
