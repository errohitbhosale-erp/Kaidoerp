import { useCallback, useEffect, useState } from 'react';
import { Check, CirclePlus, Pencil, RefreshCw, Search, ToggleLeft, ToggleRight, X } from 'lucide-react';

const CATEGORIES = ['COUNT', 'LENGTH', 'WEIGHT', 'AREA', 'VOLUME', 'TIME', 'OTHER'];

export default function UOMMasterPage({ supabase, setMessage, setError }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('COUNT');
  const [decimalPlaces, setDecimalPlaces] = useState('3');
  const [active, setActive] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError('');
    try {
      const result = await supabase.from('uom_master')
        .select('id,uom_code,uom_name,uom_category,decimal_places,is_active,created_at')
        .order('uom_code');
      if (result.error) throw result.error;
      setRecords(result.data || []);
    } catch (e) {
      setError(e?.message || 'Could not load UOM Master. Check administrator permissions and RLS policies.');
    } finally { setLoading(false); }
  }, [supabase, setError]);

  useEffect(() => { load(); }, [load]);

  const visible = records.filter(r =>
    [r.uom_code, r.uom_name, r.uom_category].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()) &&
    (status === 'all' || (status === 'active' ? r.is_active : !r.is_active))
  );

  const reset = () => {
    setEditing(null); setCode(''); setName(''); setCategory('COUNT'); setDecimalPlaces('3'); setActive(true);
  };
  const create = () => { reset(); setError(''); setFormOpen(true); };
  const edit = row => {
    setEditing(row); setCode(row.uom_code || ''); setName(row.uom_name || '');
    setCategory(row.uom_category || 'OTHER'); setDecimalPlaces(String(row.decimal_places ?? 3));
    setActive(Boolean(row.is_active)); setError(''); setFormOpen(true);
  };

  const save = async event => {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase().replace(/\\s+/g, '_');
    const normalizedName = name.trim();
    const precision = Number(decimalPlaces);
    if (!normalizedCode || !normalizedName) { setError('UOM code and description are required.'); return; }
    if (!/^[A-Z0-9_-]{1,20}$/.test(normalizedCode)) {
      setError('Use 1–20 letters, numbers, hyphens or underscores for the UOM code.'); return;
    }
    if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
      setError('Decimal places must be a whole number from 0 to 6.'); return;
    }
    if (records.some(r => r.id !== editing?.id && r.uom_code.toUpperCase() === normalizedCode)) {
      setError('That UOM code already exists. Codes must be unique.'); return;
    }
    const payload = {
      uom_code: normalizedCode, uom_name: normalizedName, uom_category: category,
      decimal_places: precision, is_active: active
    };
    setSaving(true); setError(''); setMessage('');
    try {
      const result = editing
        ? await supabase.from('uom_master').update(payload).eq('id', editing.id).select('id').maybeSingle()
        : await supabase.from('uom_master').insert(payload).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No record was saved. UOM changes require an authorized administrator role.');
      setFormOpen(false);
      setMessage((editing ? 'Updated ' : 'Created ') + normalizedCode + ' successfully.');
      await load();
    } catch (e) {
      setError(e?.message || 'Could not save UOM. Only authorized administrators can manage global units.');
    } finally { setSaving(false); }
  };

  const toggle = async row => {
    const next = !row.is_active;
    if (!window.confirm((next ? 'Activate ' : 'Deactivate ') + row.uom_code + '? ' +
      (next ? '' : 'Existing materials may still reference this unit; it will be hidden from new active selections.'))) return;
    setError(''); setMessage('');
    try {
      const result = await supabase.from('uom_master').update({ is_active: next }).eq('id', row.id).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No record changed. Check administrator permissions.');
      setMessage(row.uom_code + (next ? ' activated.' : ' deactivated.'));
      await load();
    } catch (e) { setError(e?.message || 'Could not update UOM status.'); }
  };

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> GLOBAL MASTER DATA / CONFIGURATION</div>
      <h1>Unit of Measure Master</h1><p className="muted">Manage standardized units shared across materials, inventory and purchasing.</p></div>
      <div className="heading-actions"><button className="secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/> Refresh</button>
      <button className="primary" onClick={create}><CirclePlus size={16}/> New UOM</button></div></div>
    <section className="data-panel"><div className="panel-title"><div><h2>Units of measure</h2><p className="muted">Global catalog · database permissions control who can maintain units.</p></div><span className="type-pill">{visible.length} records</span></div>
      <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, description or category…" aria-label="Search UOM records"/></div>
        <div className="filter-wrap"><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter UOM status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select></div><span className="result-count">{visible.length} shown</span></div>
      <div className="table-scroll"><table><thead><tr><th>UOM CODE</th><th>DESCRIPTION</th><th>CATEGORY</th><th>DECIMAL PLACES</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6}><div className="empty-state"><RefreshCw size={22} className="spin"/><b>Loading units…</b></div></td></tr> :
        visible.length ? visible.map(row => <tr key={row.id}><td><b>{row.uom_code}</b></td><td>{row.uom_name}</td><td><span className="type-pill">{row.uom_category}</span></td><td>{row.decimal_places}</td>
          <td><span className={'status-pill ' + (row.is_active ? 'active' : 'inactive')}><span/>{row.is_active ? 'Active' : 'Inactive'}</span></td>
          <td><div style={{display:'flex',gap:5}}><button className="row-action" title="Edit" aria-label={'Edit '+row.uom_code} onClick={() => edit(row)}><Pencil size={15}/></button>
          <button className="row-action" title={row.is_active ? 'Deactivate' : 'Activate'} aria-label={(row.is_active ? 'Deactivate ' : 'Activate ') + row.uom_code} onClick={() => toggle(row)}>{row.is_active ? <ToggleRight size={17}/> : <ToggleLeft size={17}/>}</button></div></td></tr>) :
          <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon"><CirclePlus size={23}/></div><b>No matching units</b><span>Create a unit or change the search/status filter.</span><button className="primary" onClick={create}>Create first UOM</button></div></td></tr>}
      </tbody></table></div><div className="table-footer"><span>Showing <b>{visible.length}</b> of <b>{records.length}</b> units</span><span><span className="live-dot"/> Global master data</span></div>
    </section><footer className="page-footer"><span>SWIZA ERP <span className="footer-sep">/</span> UOM Master</span><span>Standardized units for manufacturing operations</span></footer>
    {formOpen && <div className="drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}><aside className="drawer">
      <div className="drawer-head"><div><span className="eyebrow">{editing ? 'EDIT UOM' : 'NEW UOM'}</span><h2>{editing ? 'Edit unit of measure' : 'Create unit of measure'}</h2><p className="muted">Global units can be used by all authorized companies.</p></div>
      <button className="icon-btn" onClick={() => setFormOpen(false)} aria-label="Close form"><X size={19}/></button></div>
      <form className="item-form" onSubmit={save}><div className="form-grid">
        <label>UOM code *<input required maxLength={20} value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\\s+/g, '_'))} placeholder="e.g. NOS, KG, MM"/><small>Unique code; letters, numbers, hyphens and underscores.</small></label>
        <label>Description *<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Number, Kilogram, Millimetre"/></label>
        <label>Category *<select required value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Decimal places *<select required value={decimalPlaces} onChange={e => setDecimalPlaces(e.target.value)}>{[0,1,2,3,4,5,6].map(value => <option key={value} value={value}>{value} {value === 0 ? '(whole units only)' : value === 3 ? '(default precision)' : ''}</option>)}</select><small>Precision used for quantity entry and display in future transactions.</small></label>
        <label className="check-row full-field"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/><span><b>Active</b><small>Inactive units are hidden from new material selections; existing records are retained.</small></span></label>
      </div><div className="alert success"><Check size={15}/><span>Database uniqueness and administrator-only write policies remain enforced.</span></div>
      <div className="drawer-actions"><button type="button" className="secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : <><Check size={16}/>{editing ? ' Save changes' : ' Create UOM'}</>}</button></div></form>
    </aside></div>}
  </div>;
}
