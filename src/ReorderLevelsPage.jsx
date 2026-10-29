import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Plus, RefreshCw, Save, Search, X } from 'lucide-react';

const qty = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const blank = { item_id: '', warehouse_id: '', minimum_qty: '0', reorder_qty: '0', maximum_qty: '', lead_time_days: '0', notes: '' };

export default function ReorderLevelsPage({ supabase, company, setMessage, setError }) {
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [rules, setRules] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setLocalError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !company?.id) { setItems([]); setWarehouses([]); setBalances([]); setRules([]); return; }
    setLoading(true); setLocalError('');
    try {
      const [ir, wr, br, rr] = await Promise.all([
        supabase.from('item_master').select('id,item_code,item_name,base_uom_id,is_active,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id', company.id).eq('is_active', true).order('item_code').limit(3000),
        supabase.from('warehouse_master').select('id,warehouse_code,warehouse_name,is_active').eq('company_id', company.id).eq('is_active', true).order('warehouse_code'),
        supabase.from('stock_balances').select('item_id,warehouse_id,qty_on_hand_base,qty_reserved_base,qty_available_base').eq('company_id', company.id).limit(5000),
        supabase.from('stock_reorder_settings').select('company_id,item_id,warehouse_id,minimum_qty,reorder_qty,maximum_qty,lead_time_days,is_active,notes,updated_at').eq('company_id', company.id).order('updated_at', { ascending: false }).limit(3000)
      ]);
      for (const r of [ir,wr,br,rr]) if (r.error) throw r.error;
      setItems(ir.data || []); setWarehouses(wr.data || []); setBalances(br.data || []); setRules(rr.data || []);
    } catch (e) { setLocalError(e?.message || 'Could not load reorder levels. Check Stores access and migration status.'); }
    finally { setLoading(false); }
  }, [supabase, company?.id]);

  useEffect(() => { load(); }, [load]);
  const itemMap = useMemo(() => new Map(items.map(x => [x.id,x])), [items]);
  const warehouseMap = useMemo(() => new Map(warehouses.map(x => [x.id,x])), [warehouses]);
  const availableFor = (itemId, warehouseId) => balances.filter(b => b.item_id === itemId && b.warehouse_id === warehouseId).reduce((sum,b) => sum + Number(b.qty_available_base ?? (Number(b.qty_on_hand_base || 0) - Number(b.qty_reserved_base || 0))), 0);
  const visible = rules.filter(r => [itemMap.get(r.item_id)?.item_code,itemMap.get(r.item_id)?.item_name,warehouseMap.get(r.warehouse_id)?.warehouse_code,warehouseMap.get(r.warehouse_id)?.warehouse_name,r.notes].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));
  const alerts = rules.filter(r => r.is_active && availableFor(r.item_id,r.warehouse_id) <= Number(r.minimum_qty));
  const beginNew = () => { setEditing(null); setForm(blank); setLocalError(''); setOpen(true); };
  const beginEdit = rule => { setEditing(rule); setForm({ item_id:rule.item_id,warehouse_id:rule.warehouse_id,minimum_qty:String(rule.minimum_qty),reorder_qty:String(rule.reorder_qty),maximum_qty:rule.maximum_qty == null ? '' : String(rule.maximum_qty),lead_time_days:String(rule.lead_time_days),notes:rule.notes || '' }); setLocalError(''); setOpen(true); };
  const save = async e => {
    e.preventDefault(); setSaving(true); setLocalError('');
    try {
      if (!form.item_id || !form.warehouse_id) throw new Error('Select both an item and warehouse.');
      const minimum = Number(form.minimum_qty), reorder = Number(form.reorder_qty), lead = Number(form.lead_time_days);
      const maximum = form.maximum_qty === '' ? null : Number(form.maximum_qty);
      if (![minimum,reorder,lead].every(Number.isFinite) || minimum < 0 || reorder < 0 || lead < 0 || (maximum !== null && (!Number.isFinite(maximum) || maximum < minimum))) throw new Error('Enter valid non-negative quantities; maximum must be at least the minimum.');
      const user = await supabase.auth.getUser();
      const payload = { company_id:company.id,item_id:form.item_id,warehouse_id:form.warehouse_id,minimum_qty:minimum,reorder_qty:reorder,maximum_qty:maximum,lead_time_days:lead,notes:form.notes.trim() || null,is_active:true,updated_at:new Date().toISOString(),updated_by:user.data?.user?.id || null };
      const { error: saveError } = await supabase.from('stock_reorder_settings').upsert(payload,{ onConflict:'company_id,item_id,warehouse_id' });
      if (saveError) throw saveError;
      setOpen(false); setMessage(editing ? 'Reorder level updated.' : 'Reorder level saved.'); await load();
    } catch(e) { setLocalError(e?.message || 'Could not save reorder level.'); }
    finally { setSaving(false); }
  };
  const toggle = async rule => {
    const { error: updateError } = await supabase.from('stock_reorder_settings').update({ is_active:!rule.is_active, updated_at:new Date().toISOString() }).eq('company_id',company.id).eq('item_id',rule.item_id).eq('warehouse_id',rule.warehouse_id);
    if (updateError) { setLocalError(updateError.message); return; }
    setMessage(rule.is_active ? 'Reorder level disabled; stock history retained.' : 'Reorder level enabled.'); await load();
  };

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Reorder Levels & Alerts</h1><p className="muted">Configure minimum and replenishment quantities per item and warehouse. Alerts are advisory and never create purchases automatically.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={beginNew}><Plus size={16}/> Configure level</button></div></div>
    {error && <div className="alert error"><AlertTriangle size={17}/><span>{error}</span><button className="icon-btn" onClick={()=>setLocalError('')} aria-label="Dismiss">×</button></div>}
    {localError && <div className="alert error"><AlertTriangle size={17}/><span>{localError}</span><button className="icon-btn" onClick={()=>setLocalError('')} aria-label="Dismiss">×</button></div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Configured rules</span><span className="stat-icon"><BellRing size={17}/></span></div><div className="stat-value">{rules.filter(r=>r.is_active).length}</div><div className="stat-foot">Active item / warehouse thresholds</div></div><div className="stat-card"><div className="stat-top"><span>Reorder alerts</span><span className="stat-icon"><AlertTriangle size={17}/></span></div><div className="stat-value">{alerts.length}</div><div className="stat-foot">Available stock at or below minimum</div></div><div className="stat-card"><div className="stat-top"><span>Warehouses</span><span className="stat-icon"><BellRing size={17}/></span></div><div className="stat-value">{warehouses.length}</div><div className="stat-foot">Active warehouses in selected company</div></div><div className="stat-card"><div className="stat-top"><span>Items</span><span className="stat-icon"><BellRing size={17}/></span></div><div className="stat-value">{items.length}</div><div className="stat-foot">Active materials available for setup</div></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Replenishment rules</h2><p className="muted">{company?.display_name || 'Selected company'} · thresholds are stored per company, item and warehouse</p></div><span className="type-pill">{alerts.length} alerts</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search item or warehouse…" aria-label="Search reorder rules"/></div><span className="result-count">{visible.length} shown</span></div>
      <div className="table-scroll"><table><thead><tr><th>ITEM</th><th>WAREHOUSE</th><th>AVAILABLE</th><th>MINIMUM</th><th>REORDER QTY</th><th>MAXIMUM</th><th>LEAD TIME</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={9}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading reorder settings…</b></div></td></tr> : visible.length ? visible.map(rule=>{ const item=itemMap.get(rule.item_id), warehouse=warehouseMap.get(rule.warehouse_id), available=availableFor(rule.item_id,rule.warehouse_id), low=rule.is_active && available<=Number(rule.minimum_qty); return <tr key={rule.item_id+rule.warehouse_id}><td><b>{item?.item_code || 'Inactive item'}</b><div className="muted">{item?.item_name || rule.item_id}</div></td><td><b>{warehouse?.warehouse_code || 'Inactive warehouse'}</b><div className="muted">{warehouse?.warehouse_name || ''}</div></td><td><b>{qty(available)}</b> <small>{item?.uom_master?.uom_code || ''}</small></td><td>{qty(rule.minimum_qty)}</td><td>{qty(rule.reorder_qty)}</td><td>{rule.maximum_qty == null ? '—' : qty(rule.maximum_qty)}</td><td>{rule.lead_time_days} days</td><td><span className={'status-pill '+(!rule.is_active?'inactive':low?'inactive':'active')}><span/>{!rule.is_active?'DISABLED':low?'REORDER':'OK'}</span></td><td><div className="row-actions"><button className="secondary small" onClick={()=>beginEdit(rule)}>Edit</button><button className="secondary small" onClick={()=>toggle(rule)}>{rule.is_active?'Disable':'Enable'}</button></div></td></tr>}) : <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon"><BellRing size={23}/></div><b>No reorder rules configured</b><span>Configure minimum stock for important materials. This does not change on-hand stock or create purchase orders.</span></div></td></tr>}
      </tbody></table></div><div className="table-footer"><span>Available quantity is aggregated across bins within each warehouse.</span><span><span className="live-dot"/> Company-scoped controls</span></div>
    </section>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reorder-modal-title"><div className="modal-heading"><div><h2 id="reorder-modal-title">{editing?'Edit reorder level':'Configure reorder level'}</h2><p className="muted">Choose one item / warehouse pair.</p></div><button className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close"><X size={18}/></button></div>
      <form className="form-grid" onSubmit={save}><label>Item<select required value={form.item_id} onChange={e=>setForm(v=>({...v,item_id:e.target.value}))} disabled={!!editing}><option value="">Select item</option>{items.map(i=><option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}</select></label><label>Warehouse<select required value={form.warehouse_id} onChange={e=>setForm(v=>({...v,warehouse_id:e.target.value}))} disabled={!!editing}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.warehouse_name}</option>)}</select></label><label>Minimum quantity<input required type="number" min="0" step="0.0001" value={form.minimum_qty} onChange={e=>setForm(v=>({...v,minimum_qty:e.target.value}))}/></label><label>Reorder quantity<input required type="number" min="0" step="0.0001" value={form.reorder_qty} onChange={e=>setForm(v=>({...v,reorder_qty:e.target.value}))}/></label><label>Maximum quantity<input type="number" min="0" step="0.0001" value={form.maximum_qty} onChange={e=>setForm(v=>({...v,maximum_qty:e.target.value}))}/></label><label>Lead time (days)<input required type="number" min="0" step="1" value={form.lead_time_days} onChange={e=>setForm(v=>({...v,lead_time_days:e.target.value}))}/></label><label className="full-width">Notes<input value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} placeholder="Supplier / planning notes (optional)"/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={saving}><Save size={16}/>{saving?'Saving…':'Save reorder level'}</button></div></form>
    </section></div>}
    <footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Reorder Levels</span><span>Planning controls only · no autonomous purchasing</span></footer>
  </div>;
}
