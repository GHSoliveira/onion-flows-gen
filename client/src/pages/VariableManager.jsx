import { useState, useEffect } from 'react'
import { Plus, Edit, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getJSON, postJSON, deleteJSON } from '../services/api'
import { apiRequest } from '../services/api'
import { useDialog } from '../context/DialogContext'
import { SkeletonBox } from '../components/LoadingSkeleton'

const VariableManager = () => {
  const { confirm } = useDialog()
  const [variables, setVariables] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    name: '',
    type: 'text',
    defaultValue: '',
    description: '',
    isRoot: false,
    enabled: true
  })

  useEffect(() => { fetchVariables() }, [])

  const fetchVariables = async () => {
    try {
      const data = await getJSON('/variables')
      setVariables(data || [])
    } catch (error) {
      console.error('Erro:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const newVar = await postJSON('/variables', form)
      setVariables([...variables, newVar])
      setShowModal(false)
      setForm({ name: '', type: 'text', defaultValue: '', description: '', isRoot: false, enabled: true })
    } catch (error) {
      toast.error('Erro ao criar variável')
    }
  }

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Excluir variável',
      message: 'Tem certeza que deseja excluir esta variável?',
      confirmText: 'Excluir',
      type: 'danger',
    })
    if (!ok) return

    const previousVariables = variables
    setVariables(prev => prev.filter(v => v.id !== id))

    try {
      await deleteJSON(`/variables/${id}`)
      toast.success('Variável removida')
    } catch (error) {
      setVariables(previousVariables)
      toast.error('Erro ao excluir')
    }
  }

  const handleToggle = async (variable, updates) => {
    try {
      const { _id, id, ...safe } = variable
      const res = await apiRequest(`/variables/${variable.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...safe, ...updates })
      })
      if (!res || !res.ok) {
        const data = res ? await res.json() : null
        toast.error(data?.error || 'Erro ao atualizar variável')
        return
      }
      setVariables(prev => prev.map(v => v.id === variable.id ? { ...v, ...updates } : v))
    } catch (error) {
      toast.error('Erro ao atualizar variável')
    }
  }

  if (loading) {
    return (
      <div className='space-y-6 p-3 sm:p-4 lg:p-6'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
          <SkeletonBox className='h-6 w-40' />
          <SkeletonBox className='h-10 w-full sm:w-40' />
        </div>
        <div className='bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden p-4 space-y-3'>
          <SkeletonBox className='h-4 w-32' />
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`var_${index}`} className='grid grid-cols-4 gap-3'>
              <SkeletonBox className='h-4 col-span-2' />
              <SkeletonBox className='h-4' />
              <SkeletonBox className='h-4' />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-6 p-3 sm:p-4 lg:p-6'>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
        <h1 className='text-2xl font-bold text-gray-900 dark:text-white'>Variaveis</h1>
        <button onClick={() => setShowModal(true)} className='flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 w-full sm:w-auto'>
          <Plus className='w-5 h-5' /> Nova Variavel
        </button>
      </div>

      <div className='bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden'>
        <div className='overflow-x-auto'>
        <table className='w-full min-w-[640px]'>
          <thead className='bg-gray-50 dark:bg-gray-700'>
            <tr>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Nome</th>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Tipo</th>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Valor Padrao</th>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Root</th>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Ativo</th>
              <th className='px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase'>Acoes</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
            {variables.map(v => (
              <tr key={v.id} className='hover:bg-gray-50 dark:hover:bg-gray-700/50'>
                <td className='px-6 py-4 font-medium text-gray-900 dark:text-white'>{v.name}</td>
                <td className='px-6 py-4'><span className='px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs'>{v.type}</span></td>
                <td className='px-6 py-4 text-gray-600 dark:text-gray-300'>{v.defaultValue || '-'}</td>
                <td className='px-6 py-4'>
                  <label className='inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300'>
                    <input
                      type='checkbox'
                      checked={v.isRoot === true}
                      onChange={(e) => handleToggle(v, { isRoot: e.target.checked })}
                    />
                    Root
                  </label>
                </td>
                <td className='px-6 py-4'>
                  <label className='inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300'>
                    <input
                      type='checkbox'
                      checked={v.enabled !== false}
                      onChange={(e) => handleToggle(v, { enabled: e.target.checked })}
                    />
                    Ativo
                  </label>
                </td>
                <td className='px-6 py-4'>
                  <button onClick={() => handleDelete(v.id)} className='p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded'><Trash2 className='w-4 h-4' /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {showModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4' onClick={() => setShowModal(false)}>
          <div className='bg-white dark:bg-gray-800 rounded-xl p-5 sm:p-6 w-full max-w-md' onClick={e => e.stopPropagation()}>
            <h2 className='text-xl font-bold text-gray-900 dark:text-white mb-4'>Nova Variavel</h2>
            <form onSubmit={handleSubmit} className='space-y-4'>
              <div><label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>Nome</label><input type='text' required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className='w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600' /></div>
              <div><label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>Tipo</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className='w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600'><option value='text'>Texto</option><option value='number'>Numero</option><option value='boolean'>Boolean</option><option value='json'>JSON</option></select></div>
              <div><label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>Valor Padrao</label><input type='text' value={form.defaultValue} onChange={e => setForm({...form, defaultValue: e.target.value})} className='w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600' /></div>
              <div className='flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300'>
                <label className='inline-flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={form.isRoot}
                    onChange={e => setForm({ ...form, isRoot: e.target.checked })}
                  />
                  Variável Root
                </label>
                <label className='inline-flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={form.enabled}
                    onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  />
                  Ativa
                </label>
              </div>
              <div className='flex flex-col sm:flex-row gap-3 pt-4'><button type='button' onClick={() => setShowModal(false)} className='flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700'>Cancelar</button><button type='submit' className='flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600'>Criar</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default VariableManager

