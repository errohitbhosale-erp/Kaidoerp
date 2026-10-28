import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, RefreshCw, Search, X, Save, Eye, AlertTriangle, Send, CheckCircle, PackageCheck } from 'lucide-react';

const TYPES = [
  ['GRN', 'Goods Receipt'],
  ['PRODUCTION_ISSUE', 'Material Issue'],
  ['TRANSFER', 'Stock Transfer (coming soon — source/destination model required)'],
  ['ADJUSTMENT_IN', 'Stock Adjustment In'],
  ['ADJUSTMENT_OUT', 'Stock Adjustment Out'],
  ['OPENING', 'Opening Stock'],
];
const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const blankLine = () => ({ item_id: '', warehouse_id: '', location_id: '', qty: '1', unit_cost: '0', lot_number: '', serial_number: '', line_remarks: '' });
const localDateTime = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };

export default function StockTransactionsPage({ supabase, company, setMessage, setError }) {
  const [headers, setHeaders] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lines, setLines] = useState([blankLine()]);
  const [form, setForm] = useState({ txn_type: 'GRN', txn_date: localDateTime(), reference_no: '', source_document_type: '', source_document_no: '', remarks: '' });
  const [localError, setLocalError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !company?.id) { setHeaders([]); setItems([]); setWarehouses([]); setLocations([]); return; }
    setLoading(true); setLocalError('');
    try {
      const [hr, ir, wr, lr] = await Promise.all([
        supabase.from('stock_txn_header').select('id,company_id,document_no,txn_type,txn_date,status,source_document_type,source_document_no,reference_no,remarks,created_by,created_at,updated_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('item_master').select('id,item_code,item_name,base_uom_id,is_batch_tracked,is_serial_tracked,standard_rate,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id', company.id).eq('is_active', true).order('item_code').limit(2000),
        supabase.from('warehouse_master').select('id,warehouse_code,warehouse_name,is_active').eq('company_id', company.id).eq('is_active', true).order('warehouse_code'),
        supabase.from('location_master').select('id,warehouse_id,location_code,location_name,is_active').eq('company_id', company.id).eq('is_active', true).order('location_code')
      ]);
      for (const r of [hr,ir,wr,lr]) if (r.error) throw r.error;
      setHeaders(hr.data || []); setItems(ir.data || []); setWarehouses(wr.data || []); setLocations(lr.data || []);
    } catch (e) { setLocalError(e?.message || 'Could not load stock transactions. Check schema and company access policies.'); }
    finally { setLoading(false); }
  }, [supabase, company?.id]);

  useEffect(() => { load(); }, [load]);
  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const warehouseMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);
  const visible = headers.filter(h => (status === 'ALL' || h.status === status) && [h.document_no,h.txn_type,h.status,h.reference_no,h.source_document_no].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));
  const setField = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const patchLine = (idx, key, value) => setLines(old => old.map((line,i) => i === idx ? { ...line, [key]: value, ...(key === 'warehouse_id' ? { location_id: '' } : {}) } : line));
  const startNew = () => {
    setEditing(null);
    setForm({ txn_type: 'GRN', txn_date: localDateTime(), reference_no: '', source_document_type: '', source_document_no: '', remarks: '' });
    setLines([blankLine()]); setLocalError(''); setError(''); setOpen(true);
  };
  const startEdit = async header => {
    setLocalError(''); setError('');
    try {
      const { data, error: e } = await supabase.from('stock_txn_line').select('id,line_no,item_id,warehouse_id,location_id,qty,unit_cost,lot_number,serial_number,line_remarks').eq('company_id', company.id).eq('txn_id', header.id).order('line_no');
      if (e) throw e;
      setEditing(header);
      setForm({ txn_type: header.txn_type, txn_date: header.txn_date ? new Date(header.txn_date).toISOString().slice(0,16) : localDateTime(), reference_no: header.reference_no || '', source_document_type: header.source_document_type || '', source_document_no: header.source_document_no || '', remarks: header.remarks || '' });
      setLines((data || []).map(l => ({ id: l.id, item_id: l.item_id, warehouse_id: l.warehouse_id, location_id: l.location_id || '', qty: String(l.qty), unit_cost: String(l.unit_cost ?? 0), lot_number: l.lot_number || '', serial_number: l.serial_number || '', line_remarks: l.line_remarks || '' })).concat([]).length ? (data || []).map(l => ({ id: l.id, item_id: l.item_id, warehouse_id: l.warehouse_id, location_id: l.location_id || '', qty: String(l.qty), unit_cost: String(l.unit_cost ?? 0), lot_number: l.lot_number || '', serial_number: l.serial_number || '', line_remarks: l.line_remarks || '' })) : [blankLine()]);
      setOpen(true);
    } catch (e) { setLocalError(e?.message || 'Could not open draft.'); }
  };

  const saveDraft = async event => {
    event.preventDefault(); setLocalError(''); setError(''); setMessage('');
    if (!company?.id) return setLocalError('Select an active company first.');
    if (form.txn_type === 'TRANSFER') return setLocalError('Stock transfer is not enabled yet. Use a supported receipt, issue, opening or adjustment transaction until source and destination locations are implemented together.');
    if (!lines.length || lines.some(l => !l.item_id || !l.warehouse_id || !Number.isFinite(Number(l.qty)) || Number(l.qty) <= 0 || !Number.isFinite(Number(l.unit_cost)) || Number(l.unit_cost) < 0)) return setLocalError('Every line needs an item, warehouse, positive quantity, and non-negative unit cost.');
    for (const line of lines) {
      const item = itemMap.get(line.item_id);
      if (!item) return setLocalError('Select a valid active material on every line.');
      if (!line.location_id) return setLocalError('Select a location/bin for every line before saving.');
      if (item.is_batch_tracked && !line.lot_number.trim()) return setLocalError('Batch-controlled materials require a lot/batch number.');
      if (item.is_serial_tracked && !line.serial_number.trim()) return setLocalError('Serial-controlled materials require a serial number.');
      if (line.location_id) {
        const location = locations.find(l => l.id === line.location_id);
        if (!location || location.warehouse_id !== line.warehouse_id) return setLocalError('Each selected bin must belong to its selected warehouse.');
      }
    }
    setSaving(true);
    try {
      let txnId = editing?.id;
      if (editing) {
        if (editing.status !== 'DRAFT' || editing.created_by !== (await supabase.auth.getUser()).data.user?.id) throw new Error('Only your own draft transactions can be edited.');
        const { error: he } = await supabase.from('stock_txn_header').update({
          txn_type: form.txn_type, txn_date: new Date(form.txn_date).toISOString(),
          reference_no: form.reference_no.trim() || null, source_document_type: form.source_document_type.trim() || null,
          source_document_no: form.source_document_no.trim() || null, remarks: form.remarks.trim() || null
        }).eq('id', txnId).eq('company_id', company.id).eq('status', 'DRAFT');
        if (he) throw he;
        const { error: de } = await supabase.from('stock_txn_line').delete().eq('company_id', company.id).eq('txn_id', txnId);
        if (de) throw de;
      } else {
        const userResult = await supabase.auth.getUser();
        if (userResult.error || !userResult.data.user) throw new Error('Your session expired. Sign in again.');
        const documentNo = 'STK-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14) + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
        const idempotencyKey = crypto.randomUUID();
        const { data, error: he } = await supabase.from('stock_txn_header').insert({
          company_id: company.id, document_no: documentNo, txn_type: form.txn_type,
          txn_date: new Date(form.txn_date).toISOString(), status: 'DRAFT',
          source_document_type: form.source_document_type.trim() || null, source_document_no: form.source_document_no.trim() || null,
          reference_no: form.reference_no.trim() || null, remarks: form.remarks.trim() || null,
          idempotency_key: idempotencyKey, created_by: userResult.data.user.id
        }).select('id').single();
        if (he) throw he;
        txnId = data.id;
      }
      const userResult = await supabase.auth.getUser();
      const payload = lines.map((l,i) => ({ company_id: company.id, txn_id: txnId, line_no: i+1, item_id: l.item_id, warehouse_id: l.warehouse_id, location_id: l.location_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost), lot_number: l.lot_number.trim() || null, serial_number: l.serial_number.trim() || null, line_remarks: l.line_remarks.trim() || null, created_by: userResult.data.user.id }));
      const { error: le } = await supabase.from('stock_txn_line').insert(payload);
      if (le) throw le;
      setMessage(editing ? 'Draft transaction updated. Stock balances were not changed.' : 'Draft transaction saved. Stock balances were not changed.');
      setOpen(false); await load();
    } catch (e) { setLocalError(e?.message || 'Could not save draft transaction.'); }
    finally { setSaving(false); }
  };

  const runWorkflow = async (header, rpcName, successText) => {
    setLocalError(''); setError(''); setMessage('');
    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc(rpcName, { p_txn_id: header.id });
      if (rpcError) throw rpcError;
      setMessage(successText);
      await load();
    } catch (e) {
      setLocalError(e?.message || 'Workflow action failed.');
    } finally { setSaving(false); }
  };

  const itemOptions = item => itemMap.get(item.item_id);
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Stock Transactions</h1><p className="muted">Create drafts, submit for approval, approve, and post. Only successful posting updates stock balances.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={startNew}><Plus size={17}/> New transaction</button></div></div>
    {localError && <div className="alert error"><AlertTriangle size={17}/><span>{localError}</span><button className="icon-btn" onClick={()=>setLocalError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Total documents</span><span className="stat-icon"><ClipboardList size={17}/></span></div><div className="stat-value">{headers.length}</div><div className="stat-foot">Selected company</div></div><div className="stat-card"><div className="stat-top"><span>Drafts</span><span className="stat-icon"><Save size={17}/></span></div><div className="stat-value">{headers.filter(h=>h.status==='DRAFT').length}</div><div className="stat-foot">Editable by creator</div></div><div className="stat-card"><div className="stat-top"><span>Posted documents</span><span className="stat-icon"><ClipboardList size={17}/></span></div><div className="stat-value">{headers.filter(h=>h.status==='POSTED').length}</div><div className="stat-foot">Read-only in this phase</div></div><div className="stat-card"><div className="stat-top"><span>Available materials</span><span className="stat-icon"><Search size={17}/></span></div><div className="stat-value">{items.length}</div><div className="stat-foot">Active item master records</div></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Transaction register</h2><p className="muted">Search by document, transaction type, reference or source document.</p></div></div><div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder="Search stock transactions…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="filter-wrap"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All statuses</option>{['DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','CANCELLED','FAILED'].map(s=><option key={s}>{s}</option>)}</select></div><span className="result-count">{visible.length} documents</span></div><div className="table-scroll"><table><thead><tr><th>DOCUMENT NO.</th><th>TYPE</th><th>DATE</th><th>REFERENCE</th><th>STATUS</th><th>CREATED</th><th> </th></tr></thead><tbody>{loading?<tr><td colSpan="7"><div className="empty-state"><RefreshCw className="spin" size={22}/><b>Loading transactions…</b></div></td></tr>:visible.length?visible.map(h=><tr key={h.id}><td><b>{h.document_no}</b><small>{h.source_document_no||'No source document'}</small></td><td>{TYPES.find(t=>t[0]===h.txn_type)?.[1]||h.txn_type}</td><td>{new Date(h.txn_date).toLocaleDateString('en-IN')}</td><td>{h.reference_no||'—'}</td><td><span className={'status-pill '+(h.status==='POSTED'?'active':h.status==='DRAFT'?'inactive':'') }><span/>{h.status}</span></td><td>{new Date(h.created_at).toLocaleDateString('en-IN')}</td><td><div className="heading-actions">{h.status==='DRAFT'&&<><button className="row-action" title="Open draft" onClick={()=>startEdit(h)}><Eye size={16}/></button><button className="row-action" title="Submit for approval" disabled={saving} onClick={()=>runWorkflow(h,'submit_stock_transaction','Transaction submitted for approval.') }><Send size={16}/></button></>}{h.status==='PENDING_APPROVAL'&&<button className="row-action" title="Approve transaction" disabled={saving} onClick={()=>runWorkflow(h,'approve_stock_transaction','Transaction approved.') }><CheckCircle size={16}/></button>}{h.status==='APPROVED'&&<button className="row-action" title="Post stock transaction" disabled={saving} onClick={()=>runWorkflow(h,'post_stock_transaction','Stock transaction posted and balances updated.') }><PackageCheck size={16}/></button>}{!['DRAFT','PENDING_APPROVAL','APPROVED'].includes(h.status)&&<span className="muted small">Read only</span>}</div></td></tr>):<tr><td colSpan="7"><div className="empty-state"><div className="empty-icon"><ClipboardList size={24}/></div><b>No stock transactions yet</b><span>Create a draft document to begin tracking a receipt, issue, opening balance or adjustment.</span><button className="primary" onClick={startNew}><Plus size={16}/> New transaction</button></div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{visible.length}</b> of <b>{headers.length}</b> documents</span><span>Controlled workflow · posted documents are immutable</span></div></section>
    {open && <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)setOpen(false)}}><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{editing?'EDIT DRAFT TRANSACTION':'NEW STOCK TRANSACTION'}</span><h2>{editing?editing.document_no:'Create transaction draft'}</h2><p className="muted">Drafts do not change stock. Submission, approval and posting are separate controlled steps.</p></div><button className="icon-btn" onClick={()=>setOpen(false)} disabled={saving} aria-label="Close form"><X size={19}/></button></div><form className="item-form" onSubmit={saveDraft}><div className="form-section-title">Document information</div><div className="form-grid"><label>Transaction type *<select required value={form.txn_type} onChange={e=>setField('txn_type',e.target.value)} disabled={Boolean(editing)}>{TYPES.map(([v,l])=><option key={v} value={v} disabled={v==='TRANSFER'}>{l}</option>)}</select></label><label>Transaction date/time *<input type="datetime-local" required value={form.txn_date} onChange={e=>setField('txn_date',e.target.value)}/></label><label>Reference number<input maxLength="100" value={form.reference_no} onChange={e=>setField('reference_no',e.target.value)} placeholder="Optional external reference"/></label><label>Source document type<input maxLength="60" value={form.source_document_type} onChange={e=>setField('source_document_type',e.target.value)} placeholder="e.g. PO, WO, returnable challan"/></label><label>Source document number<input maxLength="100" value={form.source_document_no} onChange={e=>setField('source_document_no',e.target.value)} /></label><label className="full-field">Remarks<textarea rows="2" value={form.remarks} onChange={e=>setField('remarks',e.target.value)} /></label></div><div className="form-section-title">Material lines <span className="muted">({lines.length})</span></div>{lines.map((line,idx)=>{const item=itemOptions(line);const lineLocations=locations.filter(l=>l.warehouse_id===line.warehouse_id);return <div className="data-panel" style={{padding:'14px',marginBottom:'12px'}} key={line.id||idx}><div className="panel-title"><div><h2>Line {idx+1}</h2><p className="muted">{item?item.item_code+' · '+item.item_name:'Choose a material'}</p></div><button type="button" className="icon-btn" onClick={()=>setLines(old=>old.length===1?[blankLine()]:old.filter((_,i)=>i!==idx))} aria-label={'Remove line '+(idx+1)}><X size={17}/></button></div><div className="form-grid"><label className="full-field">Material *<select required value={line.item_id} onChange={e=>{const selected=itemMap.get(e.target.value);patchLine(idx,'item_id',e.target.value);if(selected)patchLine(idx,'unit_cost',String(selected.standard_rate??0));}}><option value="">Select active material</option>{items.map(i=><option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}</select></label><label>Warehouse *<select required value={line.warehouse_id} onChange={e=>patchLine(idx,'warehouse_id',e.target.value)}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.warehouse_name}</option>)}</select></label><label>Location / bin<select value={line.location_id} onChange={e=>patchLine(idx,'location_id',e.target.value)} disabled={!line.warehouse_id}><option value="">Select a location</option>{lineLocations.map(l=><option key={l.id} value={l.id}>{l.location_code}{l.location_name?' — '+l.location_name:''}</option>)}</select></label><label>Quantity *<input required type="number" min="0.000001" step="any" value={line.qty} onChange={e=>patchLine(idx,'qty',e.target.value)}/><small>Base UOM: {item?.uom_master?.uom_code||'select material'}</small></label><label>Unit cost (₹) *<input required type="number" min="0" step="any" value={line.unit_cost} onChange={e=>patchLine(idx,'unit_cost',e.target.value)}/></label>{item?.is_batch_tracked&&<label>Batch / lot number *<input required value={line.lot_number} onChange={e=>patchLine(idx,'lot_number',e.target.value)}/></label>}{item?.is_serial_tracked&&<label>Serial number *<input required value={line.serial_number} onChange={e=>patchLine(idx,'serial_number',e.target.value)}/></label>}<label className="full-field">Line remarks<input value={line.line_remarks} onChange={e=>patchLine(idx,'line_remarks',e.target.value)} /></label><div className="full-field muted small">Indicative line value: ₹{fmt(Number(line.qty||0)*Number(line.unit_cost||0))}</div></div></div>})}<button type="button" className="secondary" onClick={()=>setLines(old=>[...old,blankLine()])}><Plus size={16}/> Add material line</button>{localError&&<div className="alert error" style={{marginTop:12}}><AlertTriangle size={16}/>{localError}</div>}<div className="drawer-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving?<RefreshCw size={16} className="spin"/>:<Save size={16}/>} {saving?'Saving…':'Save draft'}</button></div></form></aside></div>}
  </div>;
}
