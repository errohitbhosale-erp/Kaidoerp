import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, Scale } from 'lucide-react';

const qty = value => Number(value || 0).toLocaleString('en-IN',{maximumFractionDigits:6});
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(value||0));

export default function StockReconciliationPage({ supabase, company }) {
  const [items,setItems]=useState([]), [balances,setBalances]=useState([]), [valuations,setValuations]=useState([]);
  const [query,setQuery]=useState(''), [loading,setLoading]=useState(false), [error,setError]=useState('');
  const load=useCallback(async()=>{
    if(!supabase||!company?.id){setItems([]);setBalances([]);setValuations([]);return;}
    setLoading(true);setError('');
    try{
      const [ir,br,vr]=await Promise.all([
        supabase.from('item_master').select('id,item_code,item_name,base_uom_id,is_active,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id',company.id).order('item_code').limit(5000),
        supabase.from('stock_balances').select('item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base').eq('company_id',company.id).limit(10000),
        supabase.from('stock_valuation').select('item_id,qty_on_hand_base,inventory_value,average_cost,valuation_status,updated_at').eq('company_id',company.id).limit(5000)
      ]);
      for(const r of [ir,br,vr]) if(r.error) throw r.error;
      setItems(ir.data||[]);setBalances(br.data||[]);setValuations(vr.data||[]);
    }catch(e){setError(e?.message||'Could not load reconciliation data.');}
    finally{setLoading(false);}
  },[supabase,company?.id]);
  useEffect(()=>{load();},[load]);
  const rows=useMemo(()=>items.map(item=>{
    const stock=balances.filter(b=>b.item_id===item.id);
    const onHand=stock.reduce((s,b)=>s+Number(b.qty_on_hand_base||0),0);
    const available=stock.reduce((s,b)=>s+Number(b.qty_available_base??(Number(b.qty_on_hand_base||0)-Number(b.qty_reserved_base||0))),0);
    const valuation=valuations.find(v=>v.item_id===item.id);
    const valuedQty=valuation?Number(valuation.qty_on_hand_base||0):null;
    const difference=valuedQty===null?null:onHand-valuedQty;
    const reconciled=difference!==null&&Math.abs(difference)<0.000001;
    return {item,onHand,available,valuation,valuedQty,difference,reconciled,locations:stock.length};
  }).filter(r=>[r.item.item_code,r.item.item_name,r.valuation?.valuation_status].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())),[items,balances,valuations,query]);
  const mismatches=rows.filter(r=>r.valuation&& !r.reconciled);
  const unvalued=rows.filter(r=>!r.valuation);
  const totalValue=valuations.reduce((s,v)=>s+Number(v.inventory_value||0),0);
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Stock Reconciliation</h1><p className="muted">Read-only comparison of stock balances by item against weighted-average valuation quantities. This report never adjusts inventory.</p></div><div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading?'spin':''}/> Refresh</button></div></div>
    {error&&<div className="alert error"><AlertTriangle size={17}/><span>{error}</span></div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>Items checked</span><span className="stat-icon"><Scale size={17}/></span></div><div className="stat-value">{rows.length}</div><div className="stat-foot">Active and inactive item records</div></div><div className="stat-card"><div className="stat-top"><span>Quantity mismatches</span><span className="stat-icon"><AlertTriangle size={17}/></span></div><div className="stat-value">{mismatches.length}</div><div className="stat-foot">Balance quantity differs from valued quantity</div></div><div className="stat-card"><div className="stat-top"><span>Unvalued items</span><span className="stat-icon"><Scale size={17}/></span></div><div className="stat-value">{unvalued.length}</div><div className="stat-foot">No valuation record; not treated as zero-cost stock</div></div><div className="stat-card"><div className="stat-top"><span>Recorded value</span><span className="stat-icon"><CheckCircle2 size={17}/></span></div><div className="stat-value">{money(totalValue)}</div><div className="stat-foot">Sum of existing valuation records · INR display</div></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Item reconciliation</h2><p className="muted">{company?.display_name||'Selected company'} · quantity totals are aggregated across warehouses and locations</p></div><span className="type-pill">{mismatches.length} mismatches</span></div>
    <div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search item code, description or valuation status…" aria-label="Search reconciliation"/></div><span className="result-count">{rows.length} items</span></div>
    <div className="table-scroll"><table><thead><tr><th>ITEM</th><th>STOCK ON HAND</th><th>AVAILABLE</th><th>VALUED QTY</th><th>DIFFERENCE</th><th>VALUATION STATUS</th><th>INVENTORY VALUE</th><th>CHECK</th></tr></thead><tbody>
    {loading?<tr><td colSpan={8}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Checking stock and valuation…</b></div></td></tr>:rows.length?rows.map(r=><tr key={r.item.id}><td><b>{r.item.item_code}</b><div className="muted">{r.item.item_name}</div></td><td>{qty(r.onHand)} <small>{r.item.uom_master?.uom_code||''}</small></td><td>{qty(r.available)}</td><td>{r.valuedQty===null?'—':qty(r.valuedQty)}</td><td>{r.difference===null?'—':qty(r.difference)}</td><td>{r.valuation?.valuation_status||'UNINITIALIZED'}</td><td>{r.valuation?money(r.valuation.inventory_value):'—'}</td><td><span className={'status-pill '+(r.valuation?(r.reconciled?'active':'inactive'):'inactive')}><span/>{!r.valuation?'NOT VALUED':r.reconciled?'MATCH':'MISMATCH'}</span></td></tr>):<tr><td colSpan={8}><div className="empty-state"><b>No items found</b><span>Try a different search.</span></div></td></tr>}
    </tbody></table></div><div className="table-footer"><span>Differences are flagged only; no automatic correction is performed.</span><span><span className="live-dot"/> Read-only reconciliation</span></div></section>
    <footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Stock Reconciliation</span><span>Investigate discrepancies before valuation or operational adjustments</span></footer>
  </div>;
}
