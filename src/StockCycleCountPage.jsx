import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Plus, RefreshCw, Save, Search, Send, X } from 'lucide-react';

const qty = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const today = () => new Date().toISOString().slice(0, 10);

export default function StockCycleCountPage({ supabase, company, setMessage, setError }) {
  const [warehouses,setWarehouses] = useState([]);
  const [sessions,setSessions] = useState([]);
  const [selected,setSelected] = useState(null);
  const [lines,setLines] = useState([]);
  const [query,setQuery] = useState('');
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [localError,setLocalError] = useState('');
  const [form,setForm] = useState({count_no:'',count_date:today(),warehouse_id:'',remarks:''});

  const load = useCallback(async () => {
    if(!supabase || !company?.id){setWarehouses([]);setSessions([]);return;}
    setLoading(true);setLocalError('');
    try{
      const [w,s] = await Promise.all([
        supabase.from('warehouse_master').select('id,warehouse_code,warehouse_name').eq('company_id',company.id).eq('is_active',true).order('warehouse_code'),
        supabase.from('stock_cycle_counts').select('id,count_no,count_date,warehouse_id,status,remarks,created_at').eq('company_id',company.id).order('count_date',{ascending:false}).limit(500)
      ]);
      if(w.error)throw w.error;if(s.error)throw s.error;
      setWarehouses(w.data||[]);setSessions(s.data||[]);
    }catch(e){setLocalError(e?.message||'Could not load cycle counts. Confirm the cycle-count migration has been applied.');}
    finally{setLoading(false);}
  },[supabase,company?.id]);
  useEffect(()=>{load();},[load]);
  const warehouseMap=useMemo(()=>new Map(warehouses.map(w=>[w.id,w])),[warehouses]);
  const visible=sessions.filter(s=>[s.count_no,warehouseMap.get(s.warehouse_id)?.warehouse_code,s.status,s.remarks].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));

  const newCount=()=>{
    setSelected(null);setLines([]);
    setForm({count_no:'CC-'+today().replaceAll('-','')+'-'+Math.random().toString(36).slice(2,6).toUpperCase(),count_date:today(),warehouse_id:warehouses[0]?.id||'',remarks:''});
    setLocalError('');
  };
  const openCount=async session=>{
    setSelected(session);setForm({count_no:session.count_no,count_date:session.count_date,warehouse_id:session.warehouse_id,remarks:session.remarks||''});setLocalError('');setLoading(true);
    try{
      const {data,error:e}=await supabase.from('stock_cycle_count_lines').select('id,item_id,location_id,expected_qty,counted_qty,variance_qty,notes,item_master:item_master(item_code,item_name,base_uom_id,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)),location_master:location_master(location_code,location_name)').eq('cycle_count_id',session.id).order('created_at');
      if(e)throw e;setLines((data||[]).map(l=>({...l,counted_qty:l.counted_qty==null?'':String(l.counted_qty)})));
    }catch(e){setLocalError(e?.message||'Could not load count lines.');}
    finally{setLoading(false);}
  };
  const startCount=async e=>{
    e.preventDefault();setSaving(true);setLocalError('');
    try{
      if(!form.warehouse_id)throw new Error('Select a warehouse.');
      const {data:userData}=await supabase.auth.getUser();
      const {data,error:e1}=await supabase.from('stock_cycle_counts').insert({company_id:company.id,count_no:form.count_no.trim(),count_date:form.count_date,warehouse_id:form.warehouse_id,remarks:form.remarks.trim()||null,created_by:userData?.user?.id}).select('id,count_no,count_date,warehouse_id,status,remarks,created_at').single();
      if(e1)throw e1;
      const {data:balances,error:e2}=await supabase.from('stock_balances').select('item_id,location_id,qty_on_hand_base').eq('company_id',company.id).eq('warehouse_id',form.warehouse_id).order('item_id').limit(10000);
      if(e2)throw e2;
      const itemIds=[...new Set((balances||[]).map(b=>b.item_id))];
      const {data:items,error:e3}=itemIds.length?await supabase.from('item_master').select('id,item_code,item_name,base_uom_id,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id',company.id).in('id',itemIds):{data:[],error:null};
      if(e3)throw e3;
      const itemMap=new Map((items||[]).map(i=>[i.id,i]));
      const countLines=(balances||[]).map(b=>({...b,item:itemMap.get(b.item_id)})).filter(b=>b.item).map(b=>({company_id:company.id,cycle_count_id:data.id,item_id:b.item_id,location_id:b.location_id,expected_qty:Number(b.qty_on_hand_base||0),counted_qty:null}));
      if(countLines.length){const {error:e4}=await supabase.from('stock_cycle_count_lines').insert(countLines);if(e4)throw e4;}
      setSelected(data);await load();await openCount(data);setMessage?.('Cycle count created with a snapshot of current system quantities.');
    }catch(e){setLocalError(e?.message||'Could not create cycle count.');}
    finally{setSaving(false);}
  };
  const saveLines=async()=>{
    if(!selected||selected.status!=='DRAFT')return;
    setSaving(true);setLocalError('');
    try{
      for(const line of lines){
        const counted=line.counted_qty===''?null:Number(line.counted_qty);
        if(counted!==null&&(!Number.isFinite(counted)||counted<0))throw new Error('Counted quantities must be non-negative numbers.');
      }
      const updates=lines.filter(l=>l.id);
      for(const line of updates){
        const {error:e}=await supabase.from('stock_cycle_count_lines').update({counted_qty:line.counted_qty===''?null:Number(line.counted_qty),notes:line.notes||null}).eq('id',line.id).eq('company_id',company.id);
        if(e)throw e;
      }
      setMessage?.('Physical counts saved. Inventory balances have not been changed.');
      await openCount(selected);
    }catch(e){setLocalError(e?.message||'Could not save physical counts.');}
    finally{setSaving(false);}
  };
  const submit=async()=>{
    if(!selected||selected.status!=='DRAFT')return;
    if(lines.some(l=>l.counted_qty==='')){setLocalError('Enter a physical count for every line before submitting.');return;}
    setSaving(true);setLocalError('');
    try{
      const {data:userData}=await supabase.auth.getUser();
      const {error:e}=await supabase.from('stock_cycle_counts').update({status:'SUBMITTED',submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',selected.id).eq('company_id',company.id).eq('status','DRAFT');
      if(e)throw e;
      setMessage?.('Cycle count submitted for review. No stock adjustment was posted.');
      await load();const fresh={...selected,status:'SUBMITTED',submitted_at:new Date().toISOString(),created_by:userData?.user?.id};setSelected(fresh);
    }catch(e){setLocalError(e?.message||'Could not submit cycle count.');}
    finally{setSaving(false);}
  };
  const varianceCount=lines.filter(l=>l.counted_qty!==''&&Math.abs(Number(l.counted_qty)-Number(l.expected_qty))>0.000001).length;
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Physical Stock Count</h1><p className="muted">Capture a warehouse snapshot, record physical quantities and submit variances for review. This screen never changes stock balances.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button><button className="primary" onClick={newCount}><Plus size={16}/> New count</button></div></div>
    {(localError)&&<div className="alert error"><AlertTriangle size={17}/><span>{localError}</span><button className="icon-btn" onClick={()=>setLocalError('')} aria-label="Dismiss"><X size={16}/></button></div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Count sessions</span><span className="stat-icon"><ClipboardCheck size={17}/></span></div><div className="stat-value">{sessions.length}</div><div className="stat-foot">Recorded warehouse count sessions</div></div><div className="stat-card"><div className="stat-top"><span>Drafts</span><span className="stat-icon"><Save size={17}/></span></div><div className="stat-value">{sessions.filter(s=>s.status==='DRAFT').length}</div><div className="stat-foot">Still open for physical entry</div></div><div className="stat-card"><div className="stat-top"><span>Submitted</span><span className="stat-icon"><Send size={17}/></span></div><div className="stat-value">{sessions.filter(s=>s.status==='SUBMITTED').length}</div><div className="stat-foot">Awaiting review</div></div><div className="stat-card"><div className="stat-top"><span>Lines with variance</span><span className="stat-icon"><AlertTriangle size={17}/></span></div><div className="stat-value">{varianceCount}</div><div className="stat-foot">In the selected count session</div></div></div>
    <div className="data-panel"><div className="panel-title"><div><h2>Count register</h2><p className="muted">Open a draft to enter or review counted quantities.</p></div></div><div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search count number, warehouse, status…"/></div><span className="result-count">{visible.length} sessions</span></div><div className="table-scroll"><table><thead><tr><th>COUNT NO.</th><th>DATE</th><th>WAREHOUSE</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{loading&&!sessions.length?<tr><td colSpan="6">Loading counts…</td></tr>:visible.length?visible.map(s=><tr key={s.id}><td><b>{s.count_no}</b></td><td>{s.count_date}</td><td>{warehouseMap.get(s.warehouse_id)?.warehouse_code||'—'} · {warehouseMap.get(s.warehouse_id)?.warehouse_name||''}</td><td><span className={'status-pill '+(s.status==='DRAFT'?'inactive':'active')}><span/>{s.status}</span></td><td>{s.created_at?new Date(s.created_at).toLocaleDateString('en-IN'):'—'}</td><td><button className="secondary small" onClick={()=>openCount(s)}>Open</button></td></tr>):<tr><td colSpan="6"><div className="empty-state"><div className="empty-icon"><ClipboardCheck size={24}/></div><b>No cycle counts yet</b><span>Create a warehouse count session when you're ready to perform a physical stock count.</span></div></td></tr>}</tbody></table></div></div>
    {!selected&&form.count_no&&<div className="modal-backdrop" role="presentation"><section className="modal-card" role="dialog" aria-modal="true"><div className="modal-heading"><div><h2>Start physical stock count</h2><p className="muted">System quantities are captured as a snapshot when the count starts.</p></div><button className="icon-btn" onClick={()=>setForm(v=>({...v,count_no:''}))} aria-label="Close"><X size={18}/></button></div><form className="form-grid" onSubmit={startCount}><label>Count number<input required value={form.count_no} onChange={e=>setForm(v=>({...v,count_no:e.target.value.toUpperCase()}))}/></label><label>Count date<input required type="date" value={form.count_date} onChange={e=>setForm(v=>({...v,count_date:e.target.value}))}/></label><label className="full-width">Warehouse<select required value={form.warehouse_id} onChange={e=>setForm(v=>({...v,warehouse_id:e.target.value}))}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.warehouse_name}</option>)}</select></label><label className="full-width">Remarks<input value={form.remarks} onChange={e=>setForm(v=>({...v,remarks:e.target.value}))} placeholder="Optional reason / count instructions"/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setForm(v=>({...v,count_no:''}))}>Cancel</button><button className="primary" disabled={saving}><Save size={16}/>{saving?'Creating…':'Create count session'}</button></div></form></section></div>}
    {selected&&<section className="data-panel"><div className="panel-title"><div><h2>{selected.count_no}</h2><p className="muted">{warehouseMap.get(selected.warehouse_id)?.warehouse_name||'Warehouse'} · {selected.count_date} · {selected.status}</p></div><div className="heading-actions"><button className="secondary" onClick={()=>{setSelected(null);setLines([]);}}><X size={16}/> Close</button>{selected.status==='DRAFT'&&<><button className="secondary" onClick={saveLines} disabled={saving}><Save size={16}/> Save counts</button><button className="primary" onClick={submit} disabled={saving}><Send size={16}/> Submit for review</button></>}</div></div><div className="toolbar"><span className="result-count">{lines.length} lines</span><span className="type-pill">{varianceCount} variances</span></div><div className="table-scroll"><table><thead><tr><th>ITEM CODE / NAME</th><th>BIN / LOCATION</th><th>SYSTEM QTY</th><th>PHYSICAL COUNT</th><th>VARIANCE</th><th>NOTES</th></tr></thead><tbody>{lines.map(l=>{const counted=l.counted_qty===''?null:Number(l.counted_qty);const variance=counted===null?null:counted-Number(l.expected_qty);return <tr key={l.id}><td><b>{l.item_master?.item_code||l.item_id}</b><div className="muted">{l.item_master?.item_name||''}</div></td><td>{l.location_master?.location_code||'Unassigned bin'}</td><td>{qty(l.expected_qty)} <small>{l.item_master?.uom_master?.uom_code||''}</small></td><td><input aria-label={'Physical count '+(l.item_master?.item_code||'item')} type="number" min="0" step="0.000001" value={l.counted_qty} disabled={selected.status!=='DRAFT'} onChange={e=>setLines(old=>old.map(x=>x.id===l.id?{...x,counted_qty:e.target.value}:x))} placeholder="Enter count"/></td><td className={variance!==null&&Math.abs(variance)>0.000001?'rate-cell':''}>{variance===null?'—':qty(variance)}</td><td><input value={l.notes||''} disabled={selected.status!=='DRAFT'} onChange={e=>setLines(old=>old.map(x=>x.id===l.id?{...x,notes:e.target.value}:x))} placeholder="Optional"/></td></tr>})}</tbody></table></div><div className="table-footer"><span>Variance = physical count − system snapshot. No inventory adjustment is automatic.</span><span><Check size={14}/> Audit-first workflow</span></div></section>}
    <footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Physical Stock Count</span><span>Submit for review before any adjustment document is created</span></footer>
  </div>;
}
