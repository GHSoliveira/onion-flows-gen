import { useEffect, useMemo, useState } from 'react';
import { Box, PackagePlus, Pencil, Trash2, Search, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiRequest } from '../services/api';
import { useDialog } from '../context/DialogContext';
import { TableSkeleton } from '../components/LoadingSkeleton';
import { listMediaAssets, uploadMediaAsset } from '../services/media';

const emptyForm = {
  id: null,
  name: '',
  description: '',
  sku: '',
  category: '',
  mediaUrl: '',
  price: '',
  active: true
};

const Catalog = () => {
  const { confirm } = useDialog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const q = query.trim();
      const endpoint = q
        ? `/catalog/items?active=all&limit=500&q=${encodeURIComponent(q)}`
        : '/catalog/items?active=all&limit=500';
      const res = await apiRequest(endpoint);
      if (res && res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data?.items) ? data.items : []);
      } else {
        toast.error('Erro ao carregar catálogo');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar catálogo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    listMediaAssets().then(setMediaAssets).catch(() => setMediaAssets([]));
  }, []);

  const resetForm = () => setForm(emptyForm);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error('Nome do item é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        sku: form.sku.trim(),
        category: form.category.trim(),
        mediaUrl: form.mediaUrl.trim(),
        price: form.price === '' ? null : Number(form.price),
        active: Boolean(form.active)
      };

      const endpoint = form.id ? `/catalog/items/${form.id}` : '/catalog/items';
      const method = form.id ? 'PUT' : 'POST';
      const res = await apiRequest(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      if (!res || !res.ok) {
        const error = res ? await res.json().catch(() => ({})) : {};
        throw new Error(error?.error || 'Falha ao salvar item');
      }

      toast.success(form.id ? 'Item atualizado' : 'Item criado');
      resetForm();
      await fetchItems();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Erro ao salvar item');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setForm({
      id: item.id,
      name: item.name || '',
      description: item.description || '',
      sku: item.sku || '',
      category: item.category || '',
      mediaUrl: item.mediaUrl || '',
      price: item.price === null || item.price === undefined ? '' : String(item.price),
      active: item.active !== false
    });
  };

  const handleDelete = async (itemId) => {
    const ok = await confirm({
      title: 'Remover item',
      message: 'Tem certeza que deseja remover este item do catálogo?',
      confirmText: 'Remover',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await apiRequest(`/catalog/items/${itemId}`, { method: 'DELETE' });
      if (!res || !res.ok) {
        throw new Error('Falha ao remover item');
      }
      toast.success('Item removido');
      if (form.id === itemId) resetForm();
      await fetchItems();
    } catch (error) {
      toast.error(error.message || 'Erro ao remover item');
    }
  };

  const handleMediaUpload = async (file) => {
    if (!file) return;
    setUploadingMedia(true);
    try {
      const uploaded = await uploadMediaAsset(file);
      setMediaAssets((prev) => [uploaded, ...prev.filter((item) => item.id !== uploaded.id)]);
      setForm((prev) => ({ ...prev, mediaUrl: uploaded.url }));
      toast.success('Arquivo enviado');
    } catch (error) {
      toast.error(error.message || 'Erro no upload');
    } finally {
      setUploadingMedia(false);
    }
  };

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.name,
        item.description,
        item.sku,
        item.category
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <Box size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Catálogo</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Produtos e serviços para uso em fluxo e orçamento.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 space-y-3 h-fit">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <PackagePlus size={16} />
              {form.id ? 'Editar item' : 'Novo item'}
            </h2>
            {form.id && (
              <button type="button" onClick={resetForm} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
                Limpar
              </button>
            )}
          </div>

          <input className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Nome" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <textarea className="w-full rounded-lg border px-3 py-2 text-sm min-h-[78px] dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Descrição" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />

          <div className="grid grid-cols-2 gap-2">
            <input className="rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="SKU" value={form.sku} onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))} />
            <input className="rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Categoria" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} />
          </div>

          <input className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="URL mídia (opcional)" value={form.mediaUrl} onChange={(e) => setForm((prev) => ({ ...prev, mediaUrl: e.target.value }))} />
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white"
            value={form.mediaUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, mediaUrl: e.target.value }))}
          >
            <option value="">Selecionar da biblioteca de mídia...</option>
            {mediaAssets.map((asset) => (
              <option key={asset.id} value={asset.url}>{asset.originalName || asset.fileName}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 cursor-pointer">
            <Upload size={14} />
            {uploadingMedia ? 'Enviando...' : 'Upload de mídia'}
            <input
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              disabled={uploadingMedia}
              onChange={(e) => handleMediaUpload(e.target.files?.[0] || null)}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.01" className="rounded-lg border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Preço" value={form.price} onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))} />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))} />
              Ativo
            </label>
          </div>

          <button disabled={saving} className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-2 text-sm font-medium">
            {saving ? 'Salvando...' : form.id ? 'Atualizar item' : 'Criar item'}
          </button>
        </form>

        <div className="xl:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  fetchItems();
                }
              }}
              className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200"
              placeholder="Buscar por nome, categoria, SKU..."
            />
            <button onClick={fetchItems} className="text-xs rounded border px-2 py-1 text-slate-600 dark:text-slate-200">Buscar</button>
          </div>

          {loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : visibleItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum item encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Item</th>
                    <th className="px-4 py-3 text-left font-medium">Categoria</th>
                    <th className="px-4 py-3 text-left font-medium">SKU</th>
                    <th className="px-4 py-3 text-left font-medium">Preço</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {visibleItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{item.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">{item.description || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.category || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.sku || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {item.price === null || item.price === undefined ? '-' : `R$ ${Number(item.price).toFixed(2).replace('.', ',')}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${item.active === false ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                          {item.active === false ? 'Inativo' : 'Ativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleEdit(item)} className="p-2 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Catalog;
