import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Plus, RefreshCw, RotateCcw, Search, X } from 'lucide-react';

const n = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const initial = { item_id: '', warehouse_id: '', location_id: '', qty: '', source_type: 'WORK_ORDER', source_reference: '' };

export default function StockReservationsPage({ supabase, company, setMessage, setError }) {
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [balances, setBalances] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [localError, setLocalError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !company?.id) return;
    setLoading(true); setLocalError('');
    try {
      const [ir, wr, lr, br, rr] = await Promise.all([
        supabase.from('item_master').select('id,item_code,item_name,base_uom_id,is_active,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id', company.id).eq('is_active', true).order('item_code').limit(3000),
        supabase.from('warehouse_master').select('id,warehouse_code,warehouse_name,is_active').eq('company_id', company.id).eq('is_active', true).order('warehouse_code'),
        supabase.from('location_master').select('id,warehouse_id,location_code,location_name,is_active').eq('company_id', company.id).eq('is_active', true).order('location_code'),
        supabase.from('stock_balances').select('item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base').eq('company_id', company.id).limit(10000),
        supabase.from('stock_reservations').select('id,reservation_no,item_id,warehouse_id,location_id,qty_reserved_base,source_type,source_reference,status,expires_at,created_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(1000)
      ]);
      for (const r of [ir, wr, lr, br, rr]) if (r.error) throw r.error;
      setItems(ir.data || []); setWarehouses(wr.data || []); setLocations(lr.data || []); setBalances(br.data || []); setReservations(rr.data || []);
    } catch (e) { setLocalError(e?.message || 'Could not load stock reservations. Check permissions and database migrations.'); }
    finally { setLoading(false); }
  }, [supabase, company?.id]);

  useEffect(() => { load(); }, [load]);
  const itemMap = useMemo(() => new Map(items.map(x => [x.id, x])), [items]);
  const warehouseMap = useMemo(() => new Map(warehouses.map(x => [x.id, x])), [warehouses]);
  const locationMap = useMemo(() => new Map(locations.map(x => [x.id, x])), [locations]);
  const available = (item, warehouse, location) => balances.filter(b => b.item_id === item && b.warehouse_id === warehouse && b.location_id === location).reduce((sum, b) => sum + Number(b.qty_available_base ?? (Number(b.qty_on_hand_base || 0) - Number(b.qty_reserved_base || 0))), 0);
  const chosenAvailable = available(form.item_id, form.warehouse_id, form.location_id);
  const filtered = reservations.filter(r => [r.reservation_no, r.source_type, r.source_reference, itemMap.get(r.item_id)?.item_code, itemMap.get(r.item_id)?.item_name, warehouseMap.get(r.warehouse_id)?.warehouse_code, locationMap.get(r.location_id)?.location_code, r.status].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));
  const begin = () => { setForm(initial); setLocalError(''); setOpen(true); };
  const save = async e => {
    e.preventDefault(); setSaving(true); setLocalError('');
    try {
      const qty = Number(form.qty);
      if (!form.item_id || !form.warehouse_id || !form.location_id) throw new Error('Choose an item, warehouse and location.');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Reservation quantity must be greater than zero.');
      if (qty > chosenAvailable) throw new Error(`Requested quantity ${n(qty)} exceeds available stock ${n(chosenAvailable)}.`);
      const stamp = new Date();
      const reservationNo = `RSV-${stamp.getFullYear()}${String(stamp.getMonth()+1).padStart(2,'0')}${String(stamp.getDate()).padStart(2,'0')}-${stamp.getTime().toString().slice(-6)}`;
      const { error } = await supabase.rpc('reserve_stock_item', {
        p_company_id: company.id, p_reservation_no: reservationNo, p_item_id: form.item_id,
        p_warehouse_id: form.warehouse_id, p_location_id: form.location_id, p_qty: qty,
        p_source_type: form.source_type, p_source_id: null, p_source_reference: form.source_reference.trim() || null, p_expires_at: null
      });
      if (error) throw error;
      setOpen(false); setMessage('Stock reserved successfully. Available stock has been reduced by the reserved quantity.'); await load();
    } catch (e) { setLocalError(e?.message || 'Could not reserve stock.'); }
    finally { setSaving(false); }
  };
  const release = async r => {
    if (!window.confirm(`Release reservation ${r.reservation_no}? This returns its quantity to available stock.`)) return;
    setLocalError('');
    const { error } = await supabase.rpc('release_stock_reservation', { p_reservation_id: r.id });
    if (error) { setLocalError(error.message); return; }
    setMessage(`Reservation ${r.reservation_no} released.`); await load();
  };

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Stock Reservations & Allocation</h1><p className="muted">Reserve available stock against work-order references. Reservations change availability, not on-hand stock or the stock ledger.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={begin}><Plus size={16}/> Reserve stock</button></div></div>
    {localError && <div className="alert error" role="alert"><AlertTriangle size={17}/><span>{localError}</span><button className="icon-btn" onClick={()=>setLocalError('')} aria-label="Dismiss"><X size={16}/></button></div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Active reservations</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{reservations.filter(r=>r.status==='ACTIVE').length}</div><div className="stat-foot">Current allocations</div></div><div className="stat-card"><div className="stat-top"><span>Reserved quantity</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{n(reservations.filter(r=>r.status==='ACTIVE').reduce((s,r)=>s+Number(r.qty_reserved_base||0),0))}</div><div className="stat-foot">Across active reservations; mixed UOMs may apply</div></div><div className="stat-card"><div className="stat-top"><span>Active warehouses</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{warehouses.length}</div><div className="stat-foot">Company-scoped</div></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Reservation register</h2><p className="muted">{company?.display_name || 'Selected company'} · source references are informational until a work-order master is connected</p></div><span className="type-pill">{filtered.length} records</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search reservation, item, warehouse or WO…" aria-label="Search reservations"/></div><span className="result-count">{filtered.length} shown</span></div>
      <div className="table-scroll"><table><thead><tr><th>RESERVATION</th><th>ITEM</th><th>WAREHOUSE / LOCATION</th><th>QTY</th><th>SOURCE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading reservations…</b></div></td></tr> : filtered.length ? filtered.map(r=>{const item=itemMap.get(r.item_id), w=warehouseMap.get(r.warehouse_id), l=locationMap.get(r.location_id); return <tr key={r.id}><td><b>{r.reservation_no}</b><div className="muted">{new Date(r.created_at).toLocaleString('en-IN')}</div></td><td><b>{item?.item_code || 'Inactive item'}</b><div className="muted">{item?.item_name || ''}</div></td><td><b>{w?.warehouse_code || '—'}</b><div className="muted">{l?.location_code || 'No location'} · {l?.location_name || w?.warehouse_name || ''}</div></td><td><b>{n(r.qty_reserved_base)}</b> <small>{item?.uom_master?.uom_code || ''}</small></td><td>{r.source_type}<div className="muted">{r.source_reference || 'No reference'}</div></td><td><span className={'status-pill '+(r.status==='ACTIVE'?'active':'inactive')}><span/>{r.status}</span></td><td>{r.status==='ACTIVE' ? <button className="secondary small" onClick={()=>release(r)}><RotateCcw size={14}/> Release</button> : '—'}</td></tr>}) : <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Boxes size={23}/></div><b>No reservations found</b><span>Reserve stock against a work order or other source to protect it from other issues.</span></div></td></tr>}
      </tbody></table></div><div className="table-footer"><span>Atomic reservations lock the stock balance before allocating.</span><span><span className="live-dot"/> Company-scoped</span></div>
    </section>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reservation-title"><div className="modal-heading"><div><h2 id="reservation-title">Reserve stock</h2><p className="muted">Only existing available stock can be reserved.</p></div><button className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close"><X size={18}/></button></div>
      <form className="form-grid" onSubmit={save}>
        <label>Item<select required value={form.item_id} onChange={e=>setForm(v=>({...v,item_id:e.target.value}))}><option value="">Select item</option>{items.map(i=><option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}</select></label>
        <label>Warehouse<select required value={form.warehouse_id} onChange={e=>setForm(v=>({...v,warehouse_id:e.target.value,location_id:''}))}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.warehouse_name}</option>)}</select></label>
        <label>Location<select required value={form.location_id} onChange={e=>setForm(v=>({...v,location_id:e.target.value}))} disabled={!form.warehouse_id}><option value="">Select location</option>{locations.filter(l=>l.warehouse_id===form.warehouse_id).map(l=><option key={l.id} value={l.id}>{l.location_code} — {l.location_name || l.location_code}</option>)}</select></label>
        <label>Quantity ({itemMap.get(form.item_id)?.uom_master?.uom_code || 'base UOM'})<input required type="number" min="0.0001" step="0.0001" value={form.qty} onChange={e=>setForm(v=>({...v,qty:e.target.value}))}/><small className="muted">Available at selected location: {n(chosenAvailable)}</small></label>
        <label>Allocation type<select value={form.source_type} onChange={e=>setForm(v=>({...v,source_type:e.target.value}))}><option value="WORK_ORDER">Work order</option><option value="PRODUCTION">Production</option><option value="MANUAL">Manual allocation</option><option value="OTHER">Other</option></select></label>
        <label>Work order / source reference<input value={form.source_reference} onChange={e=>setForm(v=>({...v,source_reference:e.target.value}))} placeholder="e.g. WO-2026-001"/></label>
        <div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={saving}><Plus size={16}/>{saving?'Reserving…':'Confirm reservation'}</button></div>
      </form>
    </section></div>}
    <footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Stock Reservations</span><span>Reservations protect availability; posting issues stock through the ledger</span></footer>
  </div>;
}
