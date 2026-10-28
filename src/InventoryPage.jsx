import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Boxes, RefreshCw, Search, Warehouse, Calculator } from 'lucide-react';

const number = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

export default function InventoryPage({ supabase, company, setMessage, setError }) {
  const [balances, setBalances] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [valuations, setValuations] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('balances');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !company?.id) { setBalances([]); setLedger([]); setValuations([]); return; }
    setLoading(true); setLoadError('');
    try {
      const [balanceRes, ledgerRes, valuationRes, itemRes, warehouseRes] = await Promise.all([
        supabase.from('stock_balances').select('company_id,item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base,last_movement_at').eq('company_id', company.id).order('last_movement_at', { ascending: false, nullsFirst: false }).limit(1000),
        supabase.from('stock_ledger').select('id,company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_at').eq('company_id', company.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('stock_valuation').select('company_id,item_id,valuation_method,valuation_status,qty_on_hand_base,inventory_value,average_cost,last_valuation_at,updated_at').eq('company_id', company.id).order('updated_at', { ascending: false }).limit(1000),
        supabase.from('item_master').select('id,item_code,item_name,base_uom_id,uom_master:uom_master!item_master_base_uom_id_fkey(uom_code)').eq('company_id', company.id),
        supabase.from('warehouse_master').select('id,warehouse_code,warehouse_name,warehouse_type').eq('company_id', company.id).eq('is_active', true).order('warehouse_code')
      ]);
      if (balanceRes.error) throw balanceRes.error;
      if (ledgerRes.error) throw ledgerRes.error;
      if (valuationRes.error) throw valuationRes.error;
      if (itemRes.error) throw itemRes.error;
      if (warehouseRes.error) throw warehouseRes.error;
      setBalances(balanceRes.data || []); setLedger(ledgerRes.data || []);
      setValuations(valuationRes.data || []); setItems(itemRes.data || []); setWarehouses(warehouseRes.data || []);
    } catch (e) {
      setLoadError(e?.message || 'Could not load inventory. Verify company-scoped read policies and schema.');
    } finally { setLoading(false); }
  }, [supabase, company?.id]);

  useEffect(() => { load(); }, [load]);
  const itemMap = useMemo(() => new Map(items.map(x => [x.id, x])), [items]);
  const warehouseMap = useMemo(() => new Map(warehouses.map(x => [x.id, x])), [warehouses]);
  const matchesQuery = values => values.filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase());
  const visibleBalances = balances.filter(row => {
    const item = itemMap.get(row.item_id); const warehouse = warehouseMap.get(row.warehouse_id);
    return matchesQuery([item?.item_code, item?.item_name, warehouse?.warehouse_code, warehouse?.warehouse_name]);
  });
  const visibleLedger = ledger.filter(row => {
    const item = itemMap.get(row.item_id); const warehouse = warehouseMap.get(row.warehouse_id);
    return matchesQuery([item?.item_code, item?.item_name, warehouse?.warehouse_code, warehouse?.warehouse_name, row.txn_id, row.lot_number, row.line_remarks]);
  });
  const visibleValuations = valuations.filter(row => {
    const item = itemMap.get(row.item_id);
    return matchesQuery([item?.item_code, item?.item_name, row.valuation_status, row.valuation_method]);
  });
  const onHand = balances.reduce((sum, row) => sum + Number(row.qty_on_hand_base || 0), 0);
  const reserved = balances.reduce((sum, row) => sum + Number(row.qty_reserved_base || 0), 0);
  const available = balances.reduce((sum, row) => sum + Number(row.qty_available_base ?? (Number(row.qty_on_hand_base || 0) - Number(row.qty_reserved_base || 0))), 0);
  const valuedInventory = valuations.reduce((sum, row) => sum + Number(row.inventory_value || 0), 0);
  const uninitializedCount = valuations.filter(row => row.valuation_status === 'UNINITIALIZED').length;
  const shownCount = tab === 'balances' ? visibleBalances.length : tab === 'ledger' ? visibleLedger.length : visibleValuations.length;

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> OPERATIONS / STORES</div><h1>Inventory & Stock</h1><p className="muted">Company-scoped stock balances, movement history and weighted-average valuation status.</p></div>
      <div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/> Refresh</button></div></div>
    {loadError && <div className="alert error"><AlertTriangle size={17}/><span>{loadError}</span></div>}
    <div className="stats-grid">
      <div className="stat-card"><div className="stat-top"><span>Stock lines</span><span className="stat-icon"><Boxes size={17}/></span></div><div className="stat-value">{balances.length.toLocaleString('en-IN')}</div><div className="stat-foot">Item / warehouse / location combinations</div></div>
      <div className="stat-card"><div className="stat-top"><span>On hand</span><span className="stat-icon"><Activity size={17}/></span></div><div className="stat-value">{number(onHand)}</div><div className="stat-foot">Base-unit quantities across listed lines</div></div>
      <div className="stat-card"><div className="stat-top"><span>Available</span><span className="stat-icon"><Warehouse size={17}/></span></div><div className="stat-value">{number(available)}</div><div className="stat-foot">{number(reserved)} units reserved</div></div>
      <div className="stat-card"><div className="stat-top"><span>Valued inventory</span><span className="stat-icon"><Calculator size={17}/></span></div><div className="stat-value">{money(valuedInventory)}</div><div className="stat-foot">{uninitializedCount} valuation records uninitialized · INR display pending company currency setup</div></div>
    </div>
    <section className="data-panel"><div className="panel-title"><div><h2>Stock records</h2><p className="muted">{company?.display_name || 'Selected company'} · company-scoped inventory</p></div><span className="type-pill">{tab === 'balances' ? balances.length + ' stock lines' : tab === 'ledger' ? ledger.length + ' ledger entries' : valuations.length + ' valuation records'}</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search item, warehouse, document or status…" aria-label="Search stock records"/></div>
        <div className="filter-wrap"><select value={tab} onChange={e => setTab(e.target.value)} aria-label="Inventory view"><option value="balances">Stock balances</option><option value="ledger">Movement ledger</option><option value="valuation">Inventory valuation</option></select></div>
        <span className="result-count">{shownCount} shown</span></div>
      <div className="table-scroll"><table>{tab === 'balances' ? <>
        <thead><tr><th>ITEM CODE / NAME</th><th>WAREHOUSE</th><th>ON HAND</th><th>RESERVED</th><th>AVAILABLE</th><th>LAST MOVEMENT</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={6}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading stock balances…</b></div></td></tr> : visibleBalances.length ? visibleBalances.map(row => { const item=itemMap.get(row.item_id); const warehouse=warehouseMap.get(row.warehouse_id); return <tr key={row.company_id+row.item_id+row.warehouse_id+row.location_id}><td><div className="item-identity"><span className="item-symbol"><Boxes size={17}/></span><div><b>{item?.item_code || 'Unknown item'}</b><span>{item?.item_name || row.item_id}</span></div></div></td><td><b>{warehouse?.warehouse_code || '—'}</b><div className="muted">{warehouse?.warehouse_name || row.warehouse_id}</div></td><td>{number(row.qty_on_hand_base)} <small>{item?.uom_master?.uom_code || ''}</small></td><td>{number(row.qty_reserved_base)}</td><td><b>{number(row.qty_available_base ?? (Number(row.qty_on_hand_base || 0)-Number(row.qty_reserved_base || 0)))}</b></td><td>{row.last_movement_at ? new Date(row.last_movement_at).toLocaleString('en-IN') : '—'}</td></tr>; }) : <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon"><Boxes size={23}/></div><b>No stock balance records yet</b><span>Posted transactions create stock balances here. This screen does not create stock movements.</span></div></td></tr>}
        </tbody></> : tab === 'ledger' ? <>
        <thead><tr><th>POSTED AT</th><th>ITEM</th><th>WAREHOUSE</th><th>IN</th><th>OUT</th><th>UNIT COST</th><th>REFERENCE / NOTES</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={7}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading stock ledger…</b></div></td></tr> : visibleLedger.length ? visibleLedger.map(row => { const item=itemMap.get(row.item_id); const warehouse=warehouseMap.get(row.warehouse_id); return <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('en-IN')}</td><td><b>{item?.item_code || 'Unknown item'}</b><div className="muted">{item?.item_name || row.item_id}</div></td><td>{warehouse?.warehouse_code || row.warehouse_id}</td><td>{Number(row.qty_in_base)>0 ? <span className="status-pill active"><span/>{number(row.qty_in_base)}</span> : '—'}</td><td>{Number(row.qty_out_base)>0 ? <span className="status-pill inactive"><span/>{number(row.qty_out_base)}</span> : '—'}</td><td>{money(row.unit_cost)}</td><td><b>{String(row.txn_id).slice(0,8)} · #{row.txn_line_no}</b>{row.lot_number&&<div className="muted">Lot: {row.lot_number}</div>}{row.line_remarks&&<div className="muted">{row.line_remarks}</div>}</td></tr>; }) : <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Activity size={23}/></div><b>No ledger entries yet</b><span>Stock movement history will appear after controlled transactions are posted.</span></div></td></tr>}
        </tbody></> : <>
        <thead><tr><th>ITEM CODE / NAME</th><th>VALUATION METHOD</th><th>STATUS</th><th>VALUED QTY</th><th>AVERAGE COST</th><th>INVENTORY VALUE</th><th>LAST VALUATION</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={7}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading inventory valuation…</b></div></td></tr> : visibleValuations.length ? visibleValuations.map(row => { const item=itemMap.get(row.item_id); return <tr key={row.company_id+row.item_id}><td><div className="item-identity"><span className="item-symbol"><Calculator size={17}/></span><div><b>{item?.item_code || 'Unknown item'}</b><span>{item?.item_name || row.item_id}</span></div></div></td><td>{row.valuation_method.replaceAll('_',' ')}</td><td><span className={'status-pill '+(row.valuation_status==='RECONCILED'?'active':'inactive')}><span/>{row.valuation_status}</span></td><td>{number(row.qty_on_hand_base)} <small>{item?.uom_master?.uom_code || ''}</small></td><td>{money(row.average_cost)}</td><td><b>{money(row.inventory_value)}</b></td><td>{row.last_valuation_at ? new Date(row.last_valuation_at).toLocaleString('en-IN') : '—'}</td></tr>; }) : <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Calculator size={23}/></div><b>No valuation records yet</b><span>Valuation records are created as approved stock documents are posted. Opening stock needs an explicit opening value; standard rate is not substituted automatically.</span></div></td></tr>}
        </tbody></>}</table></div><div className="table-footer"><span>Showing <b>{shownCount}</b> records · maximum 1,000 balances / 500 ledger entries / 1,000 valuation records loaded</span><span><span className="live-dot"/> Read-only view</span></div>
    </section><footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> Inventory & Stock</span><span>Stock posting and valuation controlled by approved transactions</span></footer>
  </div>;
}
