import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Plus, Trash2, Code, Split, FileText, Send, Clock, Users, Hourglass, Hand, Anchor, Database, Globe, Flag, Command, Image, Upload, Key, Smartphone, Settings, MessageSquare, FormInput, List, ChevronUp, ChevronDown, ChevronRight, ListOrdered, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { uploadMediaAsset } from '../services/media';
import { apiRequest } from '../services/api';

const ConfigWrapper = ({ title, onClose, onSave, children, sizeClass = 'max-w-lg' }) => {
    const reduceMotion = useReducedMotion();
    const surfaceTransition = {
        duration: 0.24,
        times: [0, 0.42, 1],
        ease: [0.22, 1, 0.36, 1]
    };

    return (
        <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
        >
            <motion.div
                className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full ${sizeClass} flex flex-col max-h-[90vh] overflow-hidden`}
                initial={reduceMotion ? false : { opacity: 0, scaleX: 0.16, scaleY: 0.08, borderRadius: 22 }}
                animate={reduceMotion ? { opacity: 1 } : {
                    opacity: [0, 1, 1],
                    scaleX: [0.16, 1, 1],
                    scaleY: [0.08, 0.18, 1],
                    borderRadius: [22, 18, 12]
                }}
                transition={reduceMotion ? { duration: 0 } : surfaceTransition}
                style={{ transformOrigin: 'center' }}
            >
                <motion.div
                    className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl"
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.14, delay: reduceMotion ? 0 : 0.12, ease: 'easeOut' }}
                >
                    <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">{title}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"><X size={20} /></button>
                </motion.div>
                <motion.div
                    className="p-6 overflow-y-auto flex-1 custom-scrollbar"
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16, delay: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
                >
                    {children}
                </motion.div>
                <motion.div
                    className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl flex justify-end gap-3"
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.14, delay: reduceMotion ? 0 : 0.17, ease: 'easeOut' }}
                >
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancelar</button>
                    <button onClick={onSave} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-2 transition-colors">
                        <Save size={16} /> Salvar Alterações
                    </button>
                </motion.div>
            </motion.div>
        </motion.div>
    );
};

const AnchorConfig = ({ data, onChange }) => (
    <div className="space-y-4">
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Nome desta Âncora</label>
            <input
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                placeholder="Ex: menu_principal"
                value={data.anchorName || ''}
                onChange={e => onChange({ anchorName: e.target.value })}
            />
            <p className="text-[10px] text-gray-400 mt-1">
                Dê um nome único. Use este mesmo nome no nó "Ir Para" (GoTo) para criar um salto no fluxo.
            </p>
        </div>
    </div>
);



const ScriptConfig = ({ data, onChange }) => {
    const [status, setStatus] = useState({ type: 'idle', message: 'Sem validação.' });
    const [validating, setValidating] = useState(false);

    useEffect(() => {
        setStatus({ type: 'idle', message: 'Sem validação.' });
    }, [data.script]);

    // Chama o validador do backend (mesmas regras aplicadas no save). Evita
    // que o front diga "Sintaxe OK" e o salvamento depois retorne 400 por
    // construções proibidas (constructor, eval, Function, etc).
    const validateScript = async () => {
        setValidating(true);
        try {
            const res = await apiRequest('/flows/validate-script', {
                method: 'POST',
                body: JSON.stringify({ script: data.script || '' })
            });
            if (!res) return;
            const payload = await res.json().catch(() => ({}));
            if (res.ok && payload.ok) {
                setStatus({ type: 'ok', message: 'Script válido. Pode publicar.' });
            } else {
                setStatus({
                    type: 'error',
                    message: payload.reason || payload.error || 'Script inválido'
                });
            }
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Falha ao validar.' });
        } finally {
            setValidating(false);
        }
    };

    const statusStyles = status.type === 'ok'
        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200'
        : status.type === 'error'
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200'
            : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400';

    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Código JavaScript (Sandbox)</label>
                <p className="text-[10px] text-gray-400 mb-2">Use o objeto 'vars' para ler/escrever. Ex: vars.nome = vars.nome.toUpperCase();</p>
                <textarea
                    className="w-full p-3 border rounded-lg h-64 font-mono text-xs dark:bg-gray-900 dark:text-green-400 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={data.script || ''}
                    onChange={e => onChange({ script: e.target.value })}
                    placeholder="// Escreva seu código aqui..."
                />
            </div>

            <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">A validação verifica sintaxe e construções proibidas (eval, constructor, etc).</span>
                <button
                    type="button"
                    onClick={validateScript}
                    disabled={validating}
                    className="px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                    {validating ? 'Validando…' : 'Validar'}
                </button>
            </div>

            <div className={`border rounded-lg p-3 text-[11px] font-mono ${statusStyles}`}>
                {status.message}
            </div>
        </div>
    );
};

const ConditionConfig = ({ data, onChange, vars }) => (
    <div className="space-y-4">
        <div className="flex justify-between items-center">
            <label className="text-xs font-bold text-gray-500 uppercase">Regras de Condicao (IF)</label>
            <button
                onClick={() => onChange({ conditions: [...(data.conditions || []), { id: Date.now(), variable: '', operator: '==', value: '' }] })}
                className="text-xs text-blue-600 font-bold flex items-center gap-1"
            >
                <Plus size={14} /> Add Regra
            </button>
        </div>
        <div className="space-y-3">
            {(data.conditions || []).map((cond, i) => (
                <div key={cond.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 space-y-2">
                    <div className="flex gap-2">
                        <select
                            className="flex-1 p-2 border rounded text-xs dark:bg-gray-800"
                            value={cond.variable}
                            onChange={e => {
                                const newC = [...data.conditions]; newC[i].variable = e.target.value; onChange({ conditions: newC });
                            }}
                        >
                            <option value="">Variavel...</option>
                            {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                        </select>
                        <select
                            className="w-20 p-2 border rounded text-xs dark:bg-gray-800"
                            value={cond.operator}
                            onChange={e => {
                                const newC = [...data.conditions]; newC[i].operator = e.target.value; onChange({ conditions: newC });
                            }}
                        >
                            <option value="==">==</option>
                            <option value="!=">!=</option>
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value="contains">contem</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className="flex-1 p-2 border rounded text-xs dark:bg-gray-800"
                            placeholder="Valor"
                            value={cond.value}
                            onChange={e => {
                                const newC = [...data.conditions]; newC[i].value = e.target.value; onChange({ conditions: newC });
                            }}
                        />
                        <button onClick={() => onChange({ conditions: data.conditions.filter(c => c.id !== cond.id) })} className="text-red-500"><Trash2 size={16} /></button>
                    </div>
                </div>
            ))}
            <div className="text-[10px] text-gray-400 italic">Cada regra acima gera uma saida lateral no no.</div>
        </div>
        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
            <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={data.hasElse ?? true}
                        onChange={e => onChange({ hasElse: e.target.checked })}
                    />
                    <div className="w-10 h-5 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide group-hover:text-blue-500 transition-colors">
                    Gerar saida Else
                </span>
            </label>
            <p className="text-[10px] text-gray-400 mt-1 pl-13">
                Se desmarcado, o fluxo para caso nenhuma condicao seja atendida.
            </p>
        </div>
    </div>
);

const TemplateConfig = ({ data, onChange, templates }) => (
    <div className="space-y-4">
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Selecionar Template (HSM)</label>
            <select
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700"
                value={data.templateId || ''}
                onChange={e => onChange({ templateId: e.target.value })}
            >
                <option value="">Selecione um modelo...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
        </div>
        {data.templateId && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-600 dark:text-blue-400 italic">Os botões configurados neste template aparecerão automaticamente como saídas no fluxo.</p>
            </div>
        )}
    </div>
);

const COMMERCIAL_BORDER_COLORS = [
    '#f97316',
    '#ef4444',
    '#10b981',
    '#0ea5e9',
    '#6366f1',
    '#a855f7',
    '#eab308',
    '#14b8a6'
];

const CommercialNodeConfig = ({ data, onChange, node }) => {
    const currentPositionX = Number.isFinite(Number(node?.position?.x)) ? Math.round(Number(node.position.x)) : 0;
    const currentPositionY = Number.isFinite(Number(node?.position?.y)) ? Math.round(Number(node.position.y)) : 0;
    const currentNodeWidth = Math.max(24, Math.min(500, Number(node?.width || data?.currentWidth || data?.endWidth || data?.endSize || data?.size || 120)));
    const currentNodeHeight = Math.max(24, Math.min(500, Number(node?.height || data?.currentHeight || data?.endHeight || data?.endSize || data?.size || 120)));
    const easingOptions = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
    const modeOptions = ['forwards', 'backwards', 'both', 'none'];
    const shapeOptions = ['circle', 'square', 'rounded', 'rounded-rectangle'];
    const routeOptions = [
        { value: 'bezier', label: 'Livre (Bezier)' },
        { value: 'straight', label: 'Reta' },
        { value: 'smoothstep', label: 'Ortogonal (Smoothstep)' }
    ];
    const clampSize = (value, fallback = 120) => Math.max(24, Math.min(500, Number(value) || Number(fallback) || 120));
    const clampConnectionNumber = (value, min, max, fallback) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(min, Math.min(max, numeric));
    };
    const normalizeShape = (value) => {
        const shape = String(value || '').trim().toLowerCase();
        return shapeOptions.includes(shape) ? shape : 'circle';
    };
    const normalizeColor = (value) => String(value || '').trim() || '#f97316';
    const normalizeRoute = (value) => {
        const route = String(value || '').trim().toLowerCase();
        return ['bezier', 'smoothstep', 'straight'].includes(route) ? route : 'bezier';
    };

    const ensureFrames = () => {
        const existing = Array.isArray(data?.motionKeyframes) ? data.motionKeyframes : [];
        if (existing.length >= 1) {
            return existing.map((frame, index) => ({
                id: String(frame?.id || `kf_${index + 1}`),
                x: Number.isFinite(Number(frame?.x)) ? Number(frame.x) : currentPositionX,
                y: Number.isFinite(Number(frame?.y)) ? Number(frame.y) : currentPositionY,
                width: clampSize(frame?.width ?? frame?.size, currentNodeWidth),
                height: clampSize(frame?.height ?? frame?.size, currentNodeHeight),
                shape: normalizeShape(frame?.shape ?? data?.currentShape ?? data?.shape),
                borderColor: normalizeColor(frame?.borderColor ?? data?.currentBorderColor ?? data?.borderColor),
                segmentDurationMs: index === existing.length - 1 ? undefined : Math.max(100, Math.min(15000, Number(frame?.segmentDurationMs || data?.durationMs || 900))),
                segmentEasing: index === existing.length - 1 ? undefined : String(frame?.segmentEasing || data?.easing || 'ease-in-out'),
                segmentMode: index === existing.length - 1 ? undefined : String(frame?.segmentMode || data?.mode || 'forwards')
            }));
        }

        return [{
            id: 'kf_1',
            x: Number.isFinite(Number(data?.startX)) ? Number(data.startX) : currentPositionX,
            y: Number.isFinite(Number(data?.startY)) ? Number(data.startY) : currentPositionY,
            width: clampSize(data?.startWidth ?? data?.startSize, currentNodeWidth),
            height: clampSize(data?.startHeight ?? data?.startSize, currentNodeHeight),
            shape: normalizeShape(data?.startShape ?? data?.currentShape ?? data?.shape),
            borderColor: normalizeColor(data?.startBorderColor ?? data?.currentBorderColor ?? data?.borderColor),
            segmentDurationMs: Math.max(100, Math.min(15000, Number(data?.durationMs || 900))),
            segmentEasing: String(data?.easing || 'ease-in-out'),
            segmentMode: String(data?.mode || 'forwards')
        }];
    };

    const summarize = (frames) => {
        const safe = Array.isArray(frames) && frames.length >= 1 ? frames : ensureFrames();
        const first = safe[0];
        const last = safe[safe.length - 1];
        const totalDuration = safe
            .slice(0, -1)
            .reduce((acc, frame) => acc + Math.max(100, Number(frame?.segmentDurationMs || 900)), 0);
        return {
            startX: Number(first?.x || 0),
            startY: Number(first?.y || 0),
            startWidth: clampSize(first?.width, 36),
            startHeight: clampSize(first?.height, 36),
            endX: Number(last?.x || 0),
            endY: Number(last?.y || 0),
            endWidth: clampSize(last?.width, currentNodeWidth),
            endHeight: clampSize(last?.height, currentNodeHeight),
            durationMs: Math.max(100, totalDuration || 900),
            easing: String(first?.segmentEasing || data?.easing || 'ease-in-out'),
            mode: String(first?.segmentMode || data?.mode || 'forwards'),
            startShape: normalizeShape(first?.shape),
            startBorderColor: normalizeColor(first?.borderColor),
            endShape: normalizeShape(last?.shape),
            endBorderColor: normalizeColor(last?.borderColor),
            motionKeyframes: safe
        };
    };

    const emitFrames = (frames, extra = {}) => {
        const summary = summarize(frames);
        onChange({
            ...summary,
            startSize: summary.startWidth,
            endSize: summary.endWidth,
            startShape: summary.startShape,
            startBorderColor: summary.startBorderColor,
            endShape: summary.endShape,
            endBorderColor: summary.endBorderColor,
            currentX: Number(data?.currentX ?? currentPositionX),
            currentY: Number(data?.currentY ?? currentPositionY),
            currentWidth: clampSize(data?.currentWidth, currentNodeWidth),
            currentHeight: clampSize(data?.currentHeight, currentNodeHeight),
            currentShape: normalizeShape(data?.currentShape ?? data?.shape),
            currentBorderColor: normalizeColor(data?.currentBorderColor ?? data?.borderColor),
            shape: normalizeShape(data?.shape ?? summary.endShape),
            borderColor: normalizeColor(data?.borderColor ?? summary.endBorderColor),
            ...extra
        });
    };

    const keyframes = ensureFrames();
    const connectionStyle = (() => {
        const source = data?.connectionStyle || {};
        return {
            route: normalizeRoute(source.route),
            strokeColor: normalizeColor(source.strokeColor ?? data?.currentBorderColor ?? data?.borderColor),
            strokeWidth: clampConnectionNumber(source.strokeWidth, 1, 8, 2),
            opacity: clampConnectionNumber(source.opacity, 0.2, 1, 1),
            dashed: Boolean(source.dashed),
            dashLength: clampConnectionNumber(source.dashLength, 1, 48, 8),
            dashGap: clampConnectionNumber(source.dashGap, 1, 48, 6),
            animated: Boolean(source.animated),
            animationDurationMs: clampConnectionNumber(source.animationDurationMs, 300, 15000, 1400),
            sourceOffsetX: clampConnectionNumber(source.sourceOffsetX, -400, 400, 0),
            sourceOffsetY: clampConnectionNumber(source.sourceOffsetY, -400, 400, 0),
            targetOffsetX: clampConnectionNumber(source.targetOffsetX, -400, 400, 0),
            targetOffsetY: clampConnectionNumber(source.targetOffsetY, -400, 400, 0),
            curvature: clampConnectionNumber(source.curvature, 0, 1, 0.25),
            routeOffset: clampConnectionNumber(source.routeOffset, 0, 400, 80),
            cornerRadius: clampConnectionNumber(source.cornerRadius, 0, 80, 12)
        };
    })();

    const updateConnectionStyle = (patch) => {
        onChange({
            connectionStyle: {
                ...connectionStyle,
                ...patch
            }
        });
    };

    const updateFrame = (index, patch) => {
        const next = [...keyframes];
        next[index] = { ...next[index], ...patch };
        emitFrames(next);
    };

    const removeFrame = (index) => {
        if (index <= 0 || keyframes.length <= 1) return;
        const next = [...keyframes];
        next.splice(index, 1);
        emitFrames(next);
    };

    const addFrameFromCurrent = () => {
        const currentShape = normalizeShape(data?.currentShape ?? data?.shape);
        const currentBorderColor = normalizeColor(data?.currentBorderColor ?? data?.borderColor);
        const next = [...keyframes];
        const previous = next[next.length - 1] || next[0];
        const inserted = {
            id: `kf_${Date.now()}`,
            x: currentPositionX,
            y: currentPositionY,
            width: clampSize(previous?.width, currentNodeWidth),
            height: clampSize(previous?.height, currentNodeHeight),
            shape: currentShape,
            borderColor: currentBorderColor,
            segmentDurationMs: Math.max(100, Number(previous?.segmentDurationMs || 900)),
            segmentEasing: String(previous?.segmentEasing || data?.easing || 'ease-in-out'),
            segmentMode: String(previous?.segmentMode || data?.mode || 'forwards')
        };
        if (next.length > 0) {
            next[next.length - 1] = {
                ...next[next.length - 1],
                segmentDurationMs: Math.max(100, Number(next[next.length - 1]?.segmentDurationMs || 900)),
                segmentEasing: String(next[next.length - 1]?.segmentEasing || data?.easing || 'ease-in-out'),
                segmentMode: String(next[next.length - 1]?.segmentMode || data?.mode || 'forwards')
            };
        }
        next.push(inserted);
        emitFrames(next);
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Texto interno (opcional)</label>
                <input
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    placeholder="Deixe vazio para manter sem texto"
                    value={data.text || ''}
                    onChange={e => onChange({ text: e.target.value })}
                />
            </div>

            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Quadros-chave controlam forma, cor, posicao, tamanho e interpolacao. Campos globais de inicio/fim nao sao usados.
            </p>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-900/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Linha do tempo dos quadros</label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => updateFrame(0, {
                                x: currentPositionX,
                                y: currentPositionY,
                                width: currentNodeWidth,
                                height: currentNodeHeight,
                                shape: normalizeShape(data?.currentShape ?? data?.shape),
                                borderColor: normalizeColor(data?.currentBorderColor ?? data?.borderColor)
                            })}
                            className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
                        >
                            quadro_1 = estado atual
                        </button>
                        <button
                            type="button"
                            onClick={addFrameFromCurrent}
                            className="text-[11px] px-2 py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                            + Adicionar quadro (estado atual)
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    {keyframes.map((frame, index) => (
                        <React.Fragment key={frame.id}>
                            <span className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold">
                                quadro_{index + 1}
                            </span>
                            {index < keyframes.length - 1 && (
                                <span className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30">
                                    [{Math.max(100, Number(frame.segmentDurationMs || 900))}ms | {String(frame.segmentEasing || 'ease-in-out')} | {String(frame.segmentMode || 'forwards')}]
                                </span>
                            )}
                        </React.Fragment>
                    ))}
                </div>

                <div className="space-y-3">
                    {keyframes.map((frame, index) => (
                        <div key={`editor_${frame.id}`} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">quadro_{index + 1}</div>
                                {index > 0 && keyframes.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeFrame(index)}
                                        className="text-[11px] px-2 py-1 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-300"
                                    >
                                        Remover
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500">X</label>
                                    <input
                                        type="number"
                                        className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                        value={Number(frame.x)}
                                        onChange={e => updateFrame(index, { x: Number(e.target.value) || 0 })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500">Y</label>
                                    <input
                                        type="number"
                                        className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                        value={Number(frame.y)}
                                        onChange={e => updateFrame(index, { y: Number(e.target.value) || 0 })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500">Largura</label>
                                    <input
                                        type="number"
                                        min="24"
                                        max="500"
                                        className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                        value={Number(frame.width)}
                                        onChange={e => updateFrame(index, { width: clampSize(e.target.value, 120) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500">Altura</label>
                                    <input
                                        type="number"
                                        min="24"
                                        max="500"
                                        className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                        value={Number(frame.height)}
                                        onChange={e => updateFrame(index, { height: clampSize(e.target.value, 120) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500">Forma</label>
                                    <select
                                        className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                        value={normalizeShape(frame.shape)}
                                        onChange={e => updateFrame(index, { shape: normalizeShape(e.target.value) })}
                                    >
                                        <option value="circle">Circular</option>
                                        <option value="square">Quadrado</option>
                                        <option value="rounded">Arredondado</option>
                                        <option value="rounded-rectangle">Retangulo arredondado</option>
                                    </select>
                                </div>
                                <div className="col-span-2 md:col-span-3">
                                    <label className="text-[10px] font-semibold text-slate-500">Cor da borda</label>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {COMMERCIAL_BORDER_COLORS.map((color) => {
                                            const selected = normalizeColor(frame.borderColor).toLowerCase() === color.toLowerCase();
                                            return (
                                                <button
                                                    key={`${frame.id}_${color}`}
                                                    type="button"
                                                    onClick={() => updateFrame(index, { borderColor: color })}
                                                    className={`w-5 h-5 rounded-full border transition-all ${selected ? 'scale-110 ring-2 ring-blue-300/70 dark:ring-blue-900/70' : 'opacity-80 hover:opacity-100'}`}
                                                    style={{ backgroundColor: color, borderColor: selected ? '#0f172a' : '#ffffff' }}
                                                    title={color}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {index < keyframes.length - 1 && (
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="text-[10px] font-semibold text-slate-500">Duracao ate o proximo</label>
                                        <input
                                            type="number"
                                            min="100"
                                            max="15000"
                                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                            value={Math.max(100, Number(frame.segmentDurationMs || 900))}
                                            onChange={e => updateFrame(index, { segmentDurationMs: Math.max(100, Math.min(15000, Number(e.target.value) || 900)) })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-semibold text-slate-500">Suavizacao</label>
                                        <select
                                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                            value={String(frame.segmentEasing || 'ease-in-out')}
                                            onChange={e => updateFrame(index, { segmentEasing: e.target.value })}
                                        >
                                            {easingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-semibold text-slate-500">Modo</label>
                                        <select
                                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                            value={String(frame.segmentMode || 'forwards')}
                                            onChange={e => updateFrame(index, { segmentMode: e.target.value })}
                                        >
                                            {modeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-900/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Controles da conexao (saida)</label>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Afeta apenas as conexoes que saem deste no comercial.
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Modo de rota</label>
                        <select
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={connectionStyle.route}
                            onChange={(e) => updateConnectionStyle({ route: normalizeRoute(e.target.value) })}
                        >
                            {routeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Espessura</label>
                        <input
                            type="number"
                            min="1"
                            max="8"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.strokeWidth)}
                            onChange={(e) => updateConnectionStyle({ strokeWidth: clampConnectionNumber(e.target.value, 1, 8, 2) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Opacidade</label>
                        <input
                            type="number"
                            min="0.2"
                            max="1"
                            step="0.05"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.opacity)}
                            onChange={(e) => updateConnectionStyle({ opacity: clampConnectionNumber(e.target.value, 0.2, 1, 1) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Cor</label>
                        <input
                            type="text"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={connectionStyle.strokeColor}
                            onChange={(e) => updateConnectionStyle({ strokeColor: normalizeColor(e.target.value) })}
                            placeholder="#f97316"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-1">
                    {COMMERCIAL_BORDER_COLORS.map((color) => {
                        const selected = normalizeColor(connectionStyle.strokeColor).toLowerCase() === color.toLowerCase();
                        return (
                            <button
                                key={`edge_color_${color}`}
                                type="button"
                                onClick={() => updateConnectionStyle({ strokeColor: color })}
                                className={`w-5 h-5 rounded-full border transition-all ${selected ? 'scale-110 ring-2 ring-blue-300/70 dark:ring-blue-900/70' : 'opacity-80 hover:opacity-100'}`}
                                style={{ backgroundColor: color, borderColor: selected ? '#0f172a' : '#ffffff' }}
                                title={color}
                            />
                        );
                    })}
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input
                            type="checkbox"
                            checked={connectionStyle.dashed === true}
                            onChange={(e) => updateConnectionStyle({ dashed: e.target.checked })}
                        />
                        Tracejada
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input
                            type="checkbox"
                            checked={connectionStyle.animated === true}
                            onChange={(e) => updateConnectionStyle({ animated: e.target.checked })}
                        />
                        Animar traco
                    </label>
                </div>

                {(connectionStyle.dashed || connectionStyle.animated) && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500">Tamanho do tracejado</label>
                            <input
                                type="number"
                                min="1"
                                max="48"
                                className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                value={Number(connectionStyle.dashLength)}
                                onChange={(e) => updateConnectionStyle({ dashLength: clampConnectionNumber(e.target.value, 1, 48, 8) })}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500">Espaco do tracejado</label>
                            <input
                                type="number"
                                min="1"
                                max="48"
                                className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                value={Number(connectionStyle.dashGap)}
                                onChange={(e) => updateConnectionStyle({ dashGap: clampConnectionNumber(e.target.value, 1, 48, 6) })}
                            />
                        </div>
                    </div>
                )}

                {connectionStyle.animated && (
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Duracao da animacao (ms)</label>
                        <input
                            type="number"
                            min="300"
                            max="15000"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.animationDurationMs)}
                            onChange={(e) => updateConnectionStyle({ animationDurationMs: clampConnectionNumber(e.target.value, 300, 15000, 1400) })}
                        />
                    </div>
                )}

                {connectionStyle.route === 'bezier' && (
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Curvatura</label>
                        <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.curvature)}
                            onChange={(e) => updateConnectionStyle({ curvature: clampConnectionNumber(e.target.value, 0, 1, 0.25) })}
                        />
                    </div>
                )}

                {connectionStyle.route === 'smoothstep' && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500">Deslocamento da rota</label>
                            <input
                                type="number"
                                min="0"
                                max="400"
                                className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                value={Number(connectionStyle.routeOffset)}
                                onChange={(e) => updateConnectionStyle({ routeOffset: clampConnectionNumber(e.target.value, 0, 400, 80) })}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500">Raio do canto</label>
                            <input
                                type="number"
                                min="0"
                                max="80"
                                className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                                value={Number(connectionStyle.cornerRadius)}
                                onChange={(e) => updateConnectionStyle({ cornerRadius: clampConnectionNumber(e.target.value, 0, 80, 12) })}
                            />
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Deslocamento origem X</label>
                        <input
                            type="number"
                            min="-400"
                            max="400"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.sourceOffsetX)}
                            onChange={(e) => updateConnectionStyle({ sourceOffsetX: clampConnectionNumber(e.target.value, -400, 400, 0) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Deslocamento origem Y</label>
                        <input
                            type="number"
                            min="-400"
                            max="400"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.sourceOffsetY)}
                            onChange={(e) => updateConnectionStyle({ sourceOffsetY: clampConnectionNumber(e.target.value, -400, 400, 0) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Deslocamento destino X</label>
                        <input
                            type="number"
                            min="-400"
                            max="400"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.targetOffsetX)}
                            onChange={(e) => updateConnectionStyle({ targetOffsetX: clampConnectionNumber(e.target.value, -400, 400, 0) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500">Deslocamento destino Y</label>
                        <input
                            type="number"
                            min="-400"
                            max="400"
                            className="w-full mt-1 p-2 border rounded text-xs dark:bg-gray-700 dark:text-white"
                            value={Number(connectionStyle.targetOffsetY)}
                            onChange={(e) => updateConnectionStyle({ targetOffsetY: clampConnectionNumber(e.target.value, -400, 400, 0) })}
                        />
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={data.spawnOnComplete === true}
                    onChange={e => onChange({ spawnOnComplete: e.target.checked })}
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">Gerar novos nos comerciais ao fim da animacao</span>
            </div>

            {data.spawnOnComplete && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10">
                    <div>
                        <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase">Quantidade</label>
                        <input
                            type="number"
                            min="1"
                            max="8"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={Number(data.spawnCount || 1)}
                            onChange={e => onChange({ spawnCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase">Profundidade</label>
                        <input
                            type="number"
                            min="1"
                            max="4"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={Number(data.spawnDepth || 1)}
                            onChange={e => onChange({ spawnDepth: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase">Deslocamento X</label>
                        <input
                            type="number"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={Number(data.spawnSpacingX || 180)}
                            onChange={e => onChange({ spawnSpacingX: Number(e.target.value) || 180 })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase">Deslocamento Y</label>
                        <input
                            type="number"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={Number(data.spawnSpacingY || 0)}
                            onChange={e => onChange({ spawnSpacingY: Number(e.target.value) || 0 })}
                        />
                    </div>
                </div>
            )}

            <p className="text-[10px] text-gray-400">
                No apenas visual. Use Espaco para tocar, Ctrl+1 para resetar no quadro_1, Ctrl+2 para adicionar quadro do estado atual e Ctrl+3 para aplicar o estado atual ao ultimo quadro.
            </p>
        </div>
    );
};

const HttpRequestConfig = ({ data, onChange, vars }) => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE'];
    const responseTypes = ['json', 'text'];

    const addMapping = () => {
        const newMappings = [...(data.mappings || []), { jsonPath: '', varName: '' }];
        onChange({ mappings: newMappings });
    };

    const updateMapping = (index, field, value) => {
        const newMappings = [...data.mappings];
        newMappings[index][field] = value;
        onChange({ mappings: newMappings });
    };

    const removeMapping = (index) => {
        onChange({ mappings: data.mappings.filter((_, i) => i !== index) });
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
                <div className="col-span-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Método</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.method || 'GET'}
                        onChange={e => onChange({ method: e.target.value })}
                    >
                        {methods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div className="col-span-3">
                    <label className="text-xs font-bold text-gray-500 uppercase">Endpoint (URL)</label>
                    <input
                        type="text"
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        placeholder="https://api.exemplo.com/v1/cliente/{cpf}"
                        value={data.url || ''}
                        onChange={e => onChange({ url: e.target.value })}
                    />
                </div>
            </div>

            <p className="text-[10px] text-gray-400">
                Dica: Use <code>{'{variavel}'}</code> na URL para enviar dados dinâmicos.
            </p>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Tipo de resposta</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.responseType || 'json'}
                        onChange={e => onChange({ responseType: e.target.value })}
                    >
                        {responseTypes.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Timeout (ms)</label>
                    <input
                        type="number"
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.timeoutMs || 10000}
                        onChange={e => onChange({ timeoutMs: Number(e.target.value) || 10000 })}
                    />
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Headers (JSON)</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white font-mono h-24"
                    placeholder='{"Content-Type":"application/json"}'
                    value={data.headersJson || ''}
                    onChange={e => onChange({ headersJson: e.target.value })}
                />
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Body (opcional)</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white font-mono h-24"
                    placeholder='{"cpf":"{cpf}","nome":"{nome_cliente}"}'
                    value={data.body || ''}
                    onChange={e => onChange({ body: e.target.value })}
                />
                <p className="text-[10px] text-gray-400 mt-1">
                    Dica: variáveis também funcionam no corpo.
                </p>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-gray-500 uppercase">Mapear Resposta JSON</label>
                    <button
                        onClick={addMapping}
                        className="text-xs text-blue-600 font-bold flex items-center gap-1"
                    >
                        <Plus size={14} /> Add Campo
                    </button>
                </div>

                <div className="space-y-2">
                    {(data.mappings || []).map((m, i) => (
                        <div key={i} className="flex gap-2 items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg">
                            <input
                                className="flex-1 p-1.5 border rounded text-xs dark:bg-gray-800 dark:text-white"
                                placeholder="Caminho (ex: data.nome)"
                                value={m.jsonPath}
                                onChange={e => updateMapping(i, 'jsonPath', e.target.value)}
                            />
                            <span className="text-gray-400">-&gt;</span>
                            <select
                                className="flex-1 p-1.5 border rounded text-xs dark:bg-gray-800 dark:text-white"
                                value={m.varName}
                                onChange={e => updateMapping(i, 'varName', e.target.value)}
                            >
                                <option value="">Salvar em...</option>
                                {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                            </select>
                            <button onClick={() => removeMapping(i)} className="text-red-500 hover:bg-red-50 p-1 rounded">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    {(!data.mappings || data.mappings.length === 0) && (
                        <p className="text-center text-[11px] text-gray-400 py-2 italic">Nenhum mapeamento definido.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const GotoConfig = ({ data, onChange, anchors = [] }) => {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    const selected = data.targetAnchor || '';
    const filtered = anchors.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()));
    const selectedExists = !selected || anchors.includes(selected);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const choose = (name) => {
        onChange({ targetAnchor: name });
        setSearch('');
        setOpen(false);
    };

    return (
        <div className="space-y-4">
            <div ref={boxRef} className="relative">
                <label className="text-xs font-bold text-gray-500 uppercase">Âncora de destino</label>

                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="w-full mt-1 flex items-center justify-between gap-2 p-2 border rounded-lg text-sm text-left dark:bg-gray-700 dark:text-white"
                >
                    <span className={selected ? '' : 'text-gray-400'}>
                        {selected || 'Selecione uma âncora...'}
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-lg overflow-hidden">
                        <div className="p-2 border-b dark:border-gray-700">
                            <input
                                autoFocus
                                className="w-full p-2 border rounded-md text-sm dark:bg-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Buscar âncora..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="max-h-56 overflow-y-auto custom-scrollbar">
                            {anchors.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-gray-400">Nenhuma âncora criada no fluxo. Adicione um nó "Âncora" primeiro.</div>
                            ) : filtered.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-gray-400">Nenhuma âncora encontrada para "{search}".</div>
                            ) : (
                                filtered.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => choose(name)}
                                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 ${name === selected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold' : 'dark:text-gray-200'}`}
                                    >
                                        <span className="inline-flex items-center gap-2 truncate"><Anchor size={13} className="shrink-0 text-gray-400" />{name}</span>
                                        {name === selected && <Check size={14} className="shrink-0" />}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {!selectedExists && (
                    <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                        ⚠ A âncora "{selected}" não existe mais no fluxo. O salto não vai funcionar — selecione uma âncora válida.
                    </p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">O fluxo saltará para o nó "Âncora" selecionado.</p>
            </div>
        </div>
    );
};

const FinalNodeConfig = ({ data, onChange }) => (
    <div className="space-y-4">
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Mensagem de Encerramento</label>
            <textarea
                className="w-full mt-1 p-3 border rounded-lg h-32 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:border-gray-600"
                value={data.text || ''}
                onChange={e => onChange({ text: e.target.value })}
                placeholder="Atendimento finalizado. Obrigado!"
            />
            <p className="text-[10px] text-gray-400 mt-1">
                Mensagem exibida ao cliente quando o fluxo chegar neste nó.
            </p>
        </div>
    </div>
);



const MessageConfig = ({ data, onChange }) => (
    <div>
        <label className="text-xs font-bold text-gray-500 uppercase">Texto da Mensagem</label>
        <textarea
            className="w-full mt-1 p-3 border rounded-lg h-32 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:border-gray-600"
            value={data.text || ''}
            onChange={e => onChange({ text: e.target.value })}
            placeholder="Olá! Como posso ajudar?"
        />
    </div>
);

const createSequentialStep = (type = 'message') => {
    const id = `seq_step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (type === 'input') {
        return {
            id,
            type: 'input',
            text: 'Digite uma informacao:',
            variableName: ''
        };
    }
    if (type === 'menu') {
        return {
            id,
            type: 'menu',
            text: 'Selecione uma opcao:',
            options: [
                { id: '1', label: 'Opcao 1', value: '1' },
                { id: '2', label: 'Opcao 2', value: '2' }
            ],
            setVarEnabled: false,
            variableName: '',
            invalidSelectionMessage: 'Selecione uma opcao valida.'
        };
    }
    return {
        id,
        type: 'message',
        text: '...'
    };
};

const STEP_TYPE_META = {
    message: { bg: 'bg-blue-500', border: 'border-l-blue-400', Icon: MessageSquare, label: 'Mensagem' },
    input:   { bg: 'bg-violet-500', border: 'border-l-violet-400', Icon: FormInput, label: 'Input' },
    menu:    { bg: 'bg-amber-500', border: 'border-l-amber-400', Icon: List, label: 'Menu' },
};

const SequentialConfig = ({ data, onChange, vars }) => {
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const [collapsedStepIds, setCollapsedStepIds] = useState({});
    const stepKeys = steps.map((step, index) => step.id || `step_${index}`).join('|');

    useEffect(() => {
        setCollapsedStepIds(prev => {
            const allowed = new Set(steps.map((step, index) => step.id || `step_${index}`));
            const next = {};
            Object.keys(prev).forEach(key => {
                if (allowed.has(key)) next[key] = prev[key];
            });
            return next;
        });
    }, [stepKeys]);

    const patchSteps = (nextSteps) => onChange({ steps: nextSteps });
    const getStepKey = (step, index) => step.id || `step_${index}`;
    const isStepCollapsed = (step, index) => collapsedStepIds[getStepKey(step, index)] === true;
    const toggleStep = (step, index) => {
        const key = getStepKey(step, index);
        setCollapsedStepIds(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const setAllCollapsed = (collapsed) => {
        const next = {};
        steps.forEach((step, index) => {
            next[getStepKey(step, index)] = collapsed;
        });
        setCollapsedStepIds(next);
    };

    const addStep = (type) => {
        patchSteps([...steps, createSequentialStep(type)]);
    };

    const updateStep = (index, patch) => {
        const next = [...steps];
        next[index] = { ...(next[index] || {}), ...patch };
        patchSteps(next);
    };

    const updateStepType = (index, nextType) => {
        const current = steps[index] || {};
        const base = createSequentialStep(nextType);
        updateStep(index, {
            ...base,
            id: current.id || base.id,
            text: current.text || base.text
        });
    };

    const removeStep = (index) => {
        patchSteps(steps.filter((_, idx) => idx !== index));
    };

    const moveStep = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= steps.length) return;
        const next = [...steps];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        patchSteps(next);
    };

    const updateMenuOption = (stepIndex, optionIndex, patch) => {
        const step = steps[stepIndex] || {};
        const options = Array.isArray(step.options) ? [...step.options] : [];
        options[optionIndex] = { ...(options[optionIndex] || {}), ...patch };
        updateStep(stepIndex, { options });
    };

    const addMenuOption = (stepIndex) => {
        const step = steps[stepIndex] || {};
        const options = Array.isArray(step.options) ? [...step.options] : [];
        const nextId = String(options.length + 1);
        options.push({ id: nextId, label: `Opcao ${nextId}`, value: nextId });
        updateStep(stepIndex, { options });
    };

    const removeMenuOption = (stepIndex, optionIndex) => {
        const step = steps[stepIndex] || {};
        const options = Array.isArray(step.options) ? [...step.options] : [];
        options.splice(optionIndex, 1);
        updateStep(stepIndex, { options });
    };

    const counts = steps.reduce((acc, s) => {
        acc[s.type] = (acc[s.type] || 0) + 1;
        return acc;
    }, {});
    const allCollapsed = steps.length > 0 && steps.every((step, index) => isStepCollapsed(step, index));
    const getStepPreview = (step) => {
        const text = String(step.text || '').replace(/\s+/g, ' ').trim();
        if (text) return text.length > 86 ? `${text.slice(0, 86)}...` : text;
        if (step.type === 'input') return step.variableName ? `Salva resposta em ${step.variableName}` : 'Aguardando variavel de resposta.';
        if (step.type === 'menu') {
            const options = Array.isArray(step.options) ? step.options : [];
            return `${options.length} ${options.length === 1 ? 'opcao configurada' : 'opcoes configuradas'}`;
        }
        return 'Sem texto definido.';
    };

    return (
        <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/70">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-bold text-gray-800 dark:text-gray-100">{steps.length} {steps.length === 1 ? 'etapa' : 'etapas'}</span>
                            {counts.message > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                    <MessageSquare size={12} /> {counts.message} {counts.message === 1 ? 'mensagem' : 'mensagens'}
                                </span>
                            )}
                            {counts.input > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                                    <FormInput size={12} /> {counts.input} input{counts.input > 1 ? 's' : ''}
                                </span>
                            )}
                            {counts.menu > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                    <List size={12} /> {counts.menu} {counts.menu === 1 ? 'menu' : 'menus'}
                                </span>
                            )}
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            O bot executa as etapas em ordem. Mensagem segue automaticamente; Input e Menu aguardam resposta.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                        <button
                            type="button"
                            onClick={() => addStep('message')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                        >
                            <MessageSquare size={13} /> Mensagem
                        </button>
                        <button
                            type="button"
                            onClick={() => addStep('input')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40"
                        >
                            <FormInput size={13} /> Input
                        </button>
                        <button
                            type="button"
                            onClick={() => addStep('menu')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                        >
                            <List size={13} /> Menu
                        </button>
                    </div>
                </div>
            </div>

            {steps.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-200 p-8 text-gray-400 dark:border-gray-700">
                    <ListOrdered size={32} className="opacity-40" />
                    <p className="text-xs text-center">Nenhuma etapa adicionada ainda.<br/>Use os botões acima para começar.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Etapas do fluxo</span>
                        <button
                            type="button"
                            onClick={() => setAllCollapsed(!allCollapsed)}
                            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                        >
                            {allCollapsed ? 'Expandir todas' : 'Colapsar todas'}
                        </button>
                    </div>
                    {steps.map((step, index) => {
                        const meta = STEP_TYPE_META[step.type] || STEP_TYPE_META.message;
                        const StepIcon = meta.Icon;
                        const badgeLabel = step.stepLabel ? step.stepLabel : `Etapa ${index + 1}`;
                        const collapsed = isStepCollapsed(step, index);
                        const optionsCount = Array.isArray(step.options) ? step.options.length : 0;
                        return (
                            <div key={step.id || index} className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-gray-600`}>
                                <div className={`border-l-4 ${meta.border}`}>
                                    <div className="flex items-start gap-3 p-3">
                                        <button
                                            type="button"
                                            onClick={() => toggleStep(step, index)}
                                            className="mt-0.5 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                                            aria-label={collapsed ? 'Expandir etapa' : 'Colapsar etapa'}
                                        >
                                            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${meta.bg}`}>
                                            <StepIcon size={15} />
                                        </div>
                                        <button type="button" onClick={() => toggleStep(step, index)} className="min-w-0 flex-1 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{badgeLabel}</span>
                                                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                                    {meta.label}
                                                </span>
                                                {step.type === 'input' && step.variableName && (
                                                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                                                        {step.variableName}
                                                    </span>
                                                )}
                                                {step.type === 'menu' && (
                                                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                                        {optionsCount} opcoes
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{getStepPreview(step)}</p>
                                        </button>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => moveStep(index, -1)}
                                                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                                                disabled={index === 0}
                                                title="Mover para cima"
                                            >
                                                <ChevronUp size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveStep(index, 1)}
                                                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                                                disabled={index === steps.length - 1}
                                                title="Mover para baixo"
                                            >
                                                <ChevronDown size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeStep(index)}
                                                className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                                title="Remover etapa"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>

                                    {!collapsed && (
                                        <div className="space-y-4 border-t border-gray-100 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/25">
                                            <div className="grid gap-3 md:grid-cols-[180px,1fr]">
                                                <div>
                                                    <label className="text-[10px] font-bold uppercase text-gray-500">Tipo</label>
                                                    <select
                                                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                        value={step.type || 'message'}
                                                        onChange={e => updateStepType(index, e.target.value)}
                                                    >
                                                        <option value="message">Mensagem</option>
                                                        <option value="input">Input</option>
                                                        <option value="menu">Menu</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold uppercase text-gray-500">Nome opcional</label>
                                                    <input
                                                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                        placeholder={`Etapa ${index + 1}`}
                                                        value={step.stepLabel || ''}
                                                        onChange={e => updateStep(index, { stepLabel: e.target.value })}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold uppercase text-gray-500">Texto</label>
                                                    <span className="text-[10px] text-gray-400">{step.text?.length || 0} caracteres</span>
                                                </div>
                                                <textarea
                                                    className="mt-1 min-h-[88px] w-full rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                    value={step.text || ''}
                                                    onChange={e => updateStep(index, { text: e.target.value })}
                                                    placeholder="Mensagem ou pergunta"
                                                />
                                            </div>

                                            {step.type === 'input' && (
                                                <div>
                                                    <label className="text-[10px] font-bold uppercase text-gray-500">Salvar em variavel</label>
                                                    <select
                                                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-violet-950"
                                                        value={step.variableName || ''}
                                                        onChange={e => updateStep(index, { variableName: e.target.value })}
                                                    >
                                                        <option value="">Selecione...</option>
                                                        {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                                                    </select>
                                                </div>
                                            )}

                                            {step.type === 'menu' && (
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-[10px] font-bold uppercase text-gray-500">Opcoes</label>
                                                        <button type="button" onClick={() => addMenuOption(index)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40">
                                                            <Plus size={12} /> Add opcao
                                                        </button>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {(Array.isArray(step.options) ? step.options : []).map((option, optionIndex) => (
                                                            <div key={`${step.id || index}_${optionIndex}`} className="grid grid-cols-[64px,1fr,1fr,30px] gap-2 items-center">
                                                                <input
                                                                    className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                                    value={option.id || ''}
                                                                    onChange={e => updateMenuOption(index, optionIndex, { id: e.target.value })}
                                                                    placeholder="ID"
                                                                />
                                                                <input
                                                                    className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                                    value={option.label || ''}
                                                                    onChange={e => updateMenuOption(index, optionIndex, { label: e.target.value })}
                                                                    placeholder="Rotulo"
                                                                />
                                                                <input
                                                                    className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-950"
                                                                    value={option.value || ''}
                                                                    onChange={e => updateMenuOption(index, optionIndex, { value: e.target.value })}
                                                                    placeholder="Valor"
                                                                />
                                                                <button type="button" onClick={() => removeMenuOption(index, optionIndex)} className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40">
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                        <input
                                                            type="checkbox"
                                                            checked={step.setVarEnabled === true}
                                                            onChange={e => updateStep(index, { setVarEnabled: e.target.checked })}
                                                        />
                                                        Salvar selecao em variavel
                                                    </label>
                                                    {step.setVarEnabled && (
                                                        <select
                                                            className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-amber-950"
                                                            value={step.variableName || ''}
                                                            onChange={e => updateStep(index, { variableName: e.target.value })}
                                                        >
                                                            <option value="">Selecione...</option>
                                                            {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                                                        </select>
                                                    )}
                                                    <input
                                                        className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-amber-950"
                                                        value={step.invalidSelectionMessage || ''}
                                                        onChange={e => updateStep(index, { invalidSelectionMessage: e.target.value })}
                                                        placeholder="Mensagem para opcao invalida"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <InactivityConfig data={data} onChange={onChange} />
        </div>
    );
};

const CommandConfig = ({ data, onChange }) => (
    <div className="space-y-4">
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Comando do usuário</label>
            <input
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                placeholder="Ex: menu, suporte, /status"
                value={data.command || ''}
                onChange={e => onChange({ command: e.target.value })}
            />
            <p className="text-[10px] text-gray-400 mt-1">
                Quando o cliente enviar exatamente este texto, o fluxo saltará para este nó.
            </p>
        </div>
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Descrição opcional</label>
            <input
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                placeholder="Ex: Atalho para voltar ao menu principal"
                value={data.description || ''}
                onChange={e => onChange({ description: e.target.value })}
            />
        </div>
        <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800 rounded-lg">
            <p className="text-xs text-teal-700 dark:text-teal-300">
                Este nó não espera entrada sequencial. Ele é acionado globalmente quando o comando configurado for enviado.
            </p>
        </div>
    </div>
);

const InactivityConfig = ({ data, onChange }) => (
    <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase">Inatividade (timeout)</label>
        <div className="grid grid-cols-2 gap-2">
            <input
                type="number"
                min="0"
                className="p-2 border rounded text-xs dark:bg-gray-800 dark:text-white"
                placeholder="Minutos (0 = desativar)"
                value={data.timeoutMinutes || 0}
                onChange={e => onChange({ timeoutMinutes: Number(e.target.value) || 0 })}
            />
            <input
                type="text"
                className="p-2 border rounded text-xs dark:bg-gray-800 dark:text-white"
                placeholder="Mensagem ao expirar (opcional)"
                value={data.timeoutMessage || ''}
                onChange={e => onChange({ timeoutMessage: e.target.value })}
            />
        </div>
        <p className="text-[10px] text-gray-400">
            Se o cliente não responder em X minutos, o fluxo segue automaticamente.
        </p>
    </div>
);

const HolderConfig = ({ data, onChange, vars }) => {
    const variableOptions = (vars || []).map(v => <option key={v.id || v.name} value={v.name}>{v.name}</option>);
    const varInput = (label, field, placeholder) => (
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <select
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                value={data[field] || ''}
                onChange={e => onChange({ [field]: e.target.value })}
            >
                <option value="">{placeholder}</option>
                {variableOptions}
            </select>
        </div>
    );

    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Mensagem inicial opcional</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white h-24"
                    value={data.text || ''}
                    onChange={e => onChange({ text: e.target.value })}
                    placeholder="Ex: Recebido. Se quiser falar com um atendente, digite #humano."
                />
                <p className="text-[10px] text-gray-400 mt-1">
                    Essa mensagem e enviada uma vez quando o fluxo chega no Holder.
                </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                    type="checkbox"
                    checked={data.saveMessages !== false}
                    onChange={e => onChange({ saveMessages: e.target.checked })}
                />
                Salvar mensagens recebidas enquanto estiver segurando
            </label>

            {data.saveMessages !== false && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {varInput('Ultima mensagem', 'lastMessageVar', 'Nao salvar ultima')}
                    {varInput('Lista de mensagens', 'listVar', 'Nao salvar lista')}
                    {varInput('Texto concatenado', 'textVar', 'Nao salvar texto')}
                    {varInput('Quantidade', 'countVar', 'Nao salvar contagem')}
                </div>
            )}

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Fallback para texto comum</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white h-20"
                    value={data.fallbackText || ''}
                    onChange={e => onChange({ fallbackText: e.target.value })}
                    placeholder="Ex: Recebido. Se preferir, digite #humano."
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <input
                        type="checkbox"
                        checked={data.fallbackOnce !== false}
                        onChange={e => onChange({ fallbackOnce: e.target.checked })}
                    />
                    Responder fallback apenas uma vez
                </label>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Palavras-chave para sair</label>
                <input
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    value={data.exitKeywords || ''}
                    onChange={e => onChange({ exitKeywords: e.target.value })}
                    placeholder="Ex: pronto, finalizar, ok"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                    Se vazio, o Holder nao avanca por texto comum. Comandos globais continuam funcionando.
                </p>
            </div>

            <InactivityConfig data={data} onChange={onChange} />
        </div>
    );
};

const MediaConfig = ({ data, onChange, mediaAssets, onUploadAsset, uploadState }) => (
    <div className="space-y-4">
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Tipo de mídia</label>
            <select
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                value={data.mediaType || 'image'}
                onChange={e => onChange({ mediaType: e.target.value })}
            >
                <option value="image">Imagem</option>
                <option value="video">Vídeo</option>
                <option value="document">Documento</option>
                <option value="audio">Áudio</option>
            </select>
        </div>
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Biblioteca de mídia</label>
            <select
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                value={data.mediaUrl || ''}
                onChange={e => onChange({ mediaUrl: e.target.value })}
            >
                <option value="">Selecionar da biblioteca...</option>
                {(Array.isArray(mediaAssets) ? mediaAssets : []).map((asset) => (
                    <option key={asset.id} value={asset.url}>{asset.originalName || asset.fileName}</option>
                ))}
            </select>
        </div>
        <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 cursor-pointer">
                <Upload size={14} />
                {uploadState?.loading ? 'Enviando...' : 'Upload de arquivo'}
                <input
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    disabled={uploadState?.loading}
                    onChange={(e) => onUploadAsset?.(e.target.files?.[0] || null)}
                />
            </label>
            {uploadState?.error ? <span className="text-[10px] text-red-500">{uploadState.error}</span> : null}
        </div>
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">URL pública do arquivo</label>
            <input
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                placeholder="https://cdn.exemplo.com/arquivo.pdf"
                value={data.mediaUrl || ''}
                onChange={e => onChange({ mediaUrl: e.target.value })}
            />
        </div>
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Legenda (opcional)</label>
            <textarea
                className="w-full mt-1 p-2 border rounded-lg min-h-[88px] text-sm dark:bg-gray-700 dark:text-white"
                placeholder="Você pode usar variáveis: {nome_cliente}"
                value={data.caption || ''}
                onChange={e => onChange({ caption: e.target.value })}
            />
        </div>
        <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Nome do arquivo (opcional)</label>
            <input
                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                placeholder="ex: proposta_comercial.pdf"
                value={data.fileName || ''}
                onChange={e => onChange({ fileName: e.target.value })}
            />
            <p className="text-[10px] text-gray-400 mt-1">
                Usado principalmente para documentos no WhatsApp.
            </p>
        </div>
    </div>
);

const CatalogConfig = ({ data, onChange, catalogItems }) => {
    const sourceType = data.sourceType || 'catalog';
    const manualItems = Array.isArray(data.items) ? data.items : [];
    const selectedIds = Array.isArray(data.itemIds) ? data.itemIds : [];

    const toggleCatalogItem = (id) => {
        const stringId = String(id);
        const next = selectedIds.includes(stringId)
            ? selectedIds.filter((itemId) => itemId !== stringId)
            : [...selectedIds, stringId];
        onChange({ itemIds: next });
    };

    const updateManualItem = (index, field, value) => {
        const next = [...manualItems];
        next[index] = { ...next[index], [field]: value };
        onChange({ items: next });
    };

    const addManualItem = () => {
        onChange({
            items: [...manualItems, { id: `manual_${Date.now()}`, name: '', price: '', description: '', category: '', sku: '', mediaUrl: '' }]
        });
    };

    const removeManualItem = (index) => {
        onChange({ items: manualItems.filter((_, idx) => idx !== index) });
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Fonte dos itens</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={sourceType}
                        onChange={e => onChange({ sourceType: e.target.value })}
                    >
                        <option value="catalog">Catálogo</option>
                        <option value="manual">Manual</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Limite</label>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.limit || 5}
                        onChange={e => onChange({ limit: Number(e.target.value) || 5 })}
                    />
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Mensagem inicial</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg min-h-[80px] text-sm dark:bg-gray-700 dark:text-white"
                    value={data.title || data.message || ''}
                    onChange={e => onChange({ title: e.target.value, message: e.target.value })}
                    placeholder="Selecione um item:"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Categoria (opcional)</label>
                    <input
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.category || ''}
                        onChange={e => onChange({ category: e.target.value })}
                        placeholder="Ex: eletrônicos"
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Prefixo das variáveis</label>
                    <input
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.varPrefix || 'PRODUTO'}
                        onChange={e => onChange({ varPrefix: e.target.value })}
                        placeholder="PRODUTO"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Ex: PRODUTO_ID, PRODUTO_NOME, PRODUTO_PRECO.</p>
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Mensagem para seleção inválida</label>
                <input
                    className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    value={data.invalidSelectionMessage || ''}
                    onChange={e => onChange({ invalidSelectionMessage: e.target.value })}
                    placeholder="Selecione um item válido da lista."
                />
            </div>

            <div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={data.showButtons !== false}
                        onChange={e => onChange({ showButtons: e.target.checked })}
                    />
                    Mostrar botoes para selecao
                </label>
            </div>

            <div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={data.includeInactive === true}
                        onChange={e => onChange({ includeInactive: e.target.checked })}
                    />
                    Incluir itens inativos do catálogo
                </label>
            </div>

            {sourceType === 'catalog' ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-500 uppercase">Itens específicos (opcional)</label>
                        <span className="text-[10px] text-gray-400">{catalogItems.length} item(ns) disponíveis</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1 dark:border-gray-600">
                        {catalogItems.length === 0 ? (
                            <p className="text-xs text-gray-400 p-2">Nenhum item cadastrado no catálogo.</p>
                        ) : (
                            catalogItems.map((item) => (
                                <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(String(item.id))}
                                        onChange={() => toggleCatalogItem(item.id)}
                                    />
                                    <span className="truncate">{item.name}</span>
                                </label>
                            ))
                        )}
                    </div>
                    <p className="text-[10px] text-gray-400">
                        Se nada for marcado, o nó usa todos os itens conforme categoria/limite.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-500 uppercase">Itens manuais</label>
                        <button onClick={addManualItem} className="text-xs text-blue-600 font-bold flex items-center gap-1">
                            <Plus size={14} /> Add item
                        </button>
                    </div>
                    {manualItems.length === 0 ? (
                        <p className="text-xs text-gray-400 p-2 border rounded-lg">Nenhum item manual adicionado.</p>
                    ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {manualItems.map((item, index) => (
                                <div key={item.id || index} className="border rounded-lg p-2 space-y-2 dark:border-gray-600">
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            className="p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                            placeholder="Nome"
                                            value={item.name || ''}
                                            onChange={e => updateManualItem(index, 'name', e.target.value)}
                                        />
                                        <input
                                            className="p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                            placeholder="Preço"
                                            value={item.price || ''}
                                            onChange={e => updateManualItem(index, 'price', e.target.value)}
                                        />
                                    </div>
                                    <input
                                        className="w-full p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                        placeholder="Descrição"
                                        value={item.description || ''}
                                        onChange={e => updateManualItem(index, 'description', e.target.value)}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            className="p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                            placeholder="Categoria"
                                            value={item.category || ''}
                                            onChange={e => updateManualItem(index, 'category', e.target.value)}
                                        />
                                        <input
                                            className="p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                            placeholder="SKU"
                                            value={item.sku || ''}
                                            onChange={e => updateManualItem(index, 'sku', e.target.value)}
                                        />
                                    </div>
                                    <input
                                        className="w-full p-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
                                        placeholder="URL mídia (opcional)"
                                        value={item.mediaUrl || ''}
                                        onChange={e => updateManualItem(index, 'mediaUrl', e.target.value)}
                                    />
                                    <div className="flex justify-end">
                                        <button onClick={() => removeManualItem(index)} className="text-xs text-red-600 flex items-center gap-1">
                                            <Trash2 size={12} /> Remover
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const TEMPLATE_TOKEN_REGEX = /\{\{\s*[^{}]+\s*\}\}/g;
const countTemplateTokens = (value) => (String(value || '').match(TEMPLATE_TOKEN_REGEX) || []).length;

const describeWhatsAppTemplateInputs = (template) => {
    const components = Array.isArray(template?.components) ? template.components : [];
    const header = components.find((component) => String(component?.type || '').toUpperCase() === 'HEADER') || null;
    const body = components.find((component) => String(component?.type || '').toUpperCase() === 'BODY') || null;
    const buttons = Array.isArray(template?.buttons) ? template.buttons : [];
    const headerFormat = String(header?.format || '').toUpperCase();
    return {
        header: {
            format: headerFormat || null,
            text: String(header?.text || ''),
            placeholderCount: countTemplateTokens(header?.text || ''),
            requiresMedia: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)
        },
        body: {
            text: String(body?.text || ''),
            placeholderCount: countTemplateTokens(body?.text || '')
        },
        buttons: buttons.map((button) => ({
            index: String(button.index),
            text: String(button.text || ''),
            type: String(button.type || 'UNKNOWN').toUpperCase(),
            placeholderCount: countTemplateTokens(button.url || button.text || '')
        })).filter((button) => button.placeholderCount > 0)
    };
};

const normalizeTemplateMapping = (mapping) => ({
    mode: mapping?.mode === 'variable' ? 'variable' : 'fixed',
    value: String(mapping?.value || '')
});

const buildTemplateMappingArray = (count) => Array.from({ length: count }, () => ({ mode: 'fixed', value: '' }));

const buildWhatsAppTemplateDefaults = (template) => {
    const inputDef = describeWhatsAppTemplateInputs(template);
    return {
        headerMappings: buildTemplateMappingArray(inputDef.header.placeholderCount),
        bodyMappings: buildTemplateMappingArray(inputDef.body.placeholderCount),
        buttonMappings: inputDef.buttons.reduce((acc, button) => ({
            ...acc,
            [button.index]: buildTemplateMappingArray(button.placeholderCount)
        }), {}),
        headerMediaMapping: { mode: 'fixed', value: '' }
    };
};

const replacePreviewTokens = (text, mappings = []) => {
    let cursor = 0;
    return String(text || '').replace(TEMPLATE_TOKEN_REGEX, () => {
        const mapping = normalizeTemplateMapping(mappings[cursor]);
        cursor += 1;
        if (!mapping.value) return '{{...}}';
        return mapping.mode === 'variable' ? `{${mapping.value}}` : mapping.value;
    });
};

const normalizeInteractiveTemplate = (template) => ({
    id: template?.id || '',
    name: template?.name || '',
    kind: template?.kind === 'button' ? 'button' : template?.kind === 'product' ? 'product' : template?.kind === 'product_list' ? 'product_list' : 'list',
    headerText: template?.headerText || '',
    bodyText: template?.bodyText || '',
    footerText: template?.footerText || '',
    actionTitle: template?.actionTitle || 'Ver opcoes',
    sections: Array.isArray(template?.sections) ? template.sections : [],
    buttons: Array.isArray(template?.buttons) ? template.buttons : [],
    catalogId: template?.catalogId || '',
    productRetailerId: template?.productRetailerId || '',
    productSections: Array.isArray(template?.productSections) ? template.productSections : []
});

const getInteractiveKindLabel = (kind) => {
    if (kind === 'button') return 'Reply buttons';
    if (kind === 'product') return 'Single product';
    if (kind === 'product_list') return 'Multi product';
    return 'Interactive list';
};

const WhatsAppTemplateNodeConfig = ({
    data,
    onChange,
    vars,
    whatsappTemplates,
    whatsappInteractiveTemplates,
    whatsappSenderOptions,
    whatsappChannelReady
}) => {
    const approvedTemplates = (Array.isArray(whatsappTemplates) ? whatsappTemplates : []).filter((template) => {
        const status = String(template?.status || '').toUpperCase();
        return status === 'APPROVED' || status === 'ACTIVE';
    });
    const interactiveTemplates = Array.isArray(whatsappInteractiveTemplates) ? whatsappInteractiveTemplates : [];
    const contentKind = data.contentKind === 'interactive' ? 'interactive' : 'template';
    const selectedTemplate = contentKind === 'template'
        ? approvedTemplates.find((template) => String(template.id) === String(data.whatsappTemplateId || '')) || null
        : null;
    const selectedInteractive = contentKind === 'interactive'
        ? normalizeInteractiveTemplate(interactiveTemplates.find((template) => String(template.id) === String(data.interactiveTemplateId || '')) || null)
        : null;
    const inputDef = describeWhatsAppTemplateInputs(selectedTemplate);
    const senderOptions = Array.isArray(whatsappSenderOptions) ? whatsappSenderOptions : [];

    const ensureTemplateStructure = () => {
        if (!selectedTemplate || contentKind !== 'template') return;
        const defaults = buildWhatsAppTemplateDefaults(selectedTemplate);
        const nextHeader = Array.from({ length: defaults.headerMappings.length }, (_, index) => normalizeTemplateMapping((data.headerMappings || [])[index]));
        const nextBody = Array.from({ length: defaults.bodyMappings.length }, (_, index) => normalizeTemplateMapping((data.bodyMappings || [])[index]));
        const nextButtons = Object.fromEntries(Object.entries(defaults.buttonMappings).map(([buttonIndex, arr]) => [
            buttonIndex,
            Array.from({ length: arr.length }, (_, index) => normalizeTemplateMapping(data.buttonMappings?.[buttonIndex]?.[index]))
        ]));
        onChange({
            headerMappings: nextHeader,
            bodyMappings: nextBody,
            buttonMappings: nextButtons,
            headerMediaMapping: normalizeTemplateMapping(data.headerMediaMapping)
        });
    };

    useEffect(() => {
        ensureTemplateStructure();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.whatsappTemplateId, data.contentKind]);

    const handleTemplateChange = (templateId) => {
        const nextTemplate = approvedTemplates.find((template) => String(template.id) === String(templateId)) || null;
        const defaults = nextTemplate ? buildWhatsAppTemplateDefaults(nextTemplate) : {
            headerMappings: [],
            bodyMappings: [],
            buttonMappings: {},
            headerMediaMapping: { mode: 'fixed', value: '' }
        };
        onChange({
            whatsappTemplateId: templateId,
            subLabel: nextTemplate ? `Meta: ${nextTemplate.name}` : 'WTN',
            ...defaults
        });
    };

    const handleContentKindChange = (nextKind) => {
        onChange({
            contentKind: nextKind,
            subLabel: nextKind === 'interactive'
                ? (selectedInteractive?.name ? `Interactive: ${selectedInteractive.name}` : 'WTN Interactive')
                : (selectedTemplate?.name ? `Meta: ${selectedTemplate.name}` : 'WTN')
        });
    };

    const handleInteractiveChange = (interactiveTemplateId) => {
        const nextInteractive = normalizeInteractiveTemplate(
            interactiveTemplates.find((template) => String(template.id) === String(interactiveTemplateId)) || null
        );
        onChange({
            interactiveTemplateId,
            subLabel: nextInteractive?.name ? `Interactive: ${nextInteractive.name}` : 'WTN Interactive'
        });
    };

    const updateArrayMapping = (field, index, patch) => {
        const source = Array.isArray(data?.[field]) ? [...data[field]] : [];
        source[index] = { ...normalizeTemplateMapping(source[index]), ...patch };
        onChange({ [field]: source });
    };

    const updateButtonMapping = (buttonIndex, valueIndex, patch) => {
        const buttonMappings = { ...(data.buttonMappings || {}) };
        const source = Array.isArray(buttonMappings[buttonIndex]) ? [...buttonMappings[buttonIndex]] : [];
        source[valueIndex] = { ...normalizeTemplateMapping(source[valueIndex]), ...patch };
        buttonMappings[buttonIndex] = source;
        onChange({ buttonMappings });
    };

    const renderMappingField = (label, mapping, onUpdate) => {
        const normalized = normalizeTemplateMapping(mapping);
        return (
            <div className="grid grid-cols-1 md:grid-cols-[120px,1fr] gap-2 items-start">
                <label className="text-xs font-bold text-gray-500 uppercase pt-2">{label}</label>
                <div className="grid grid-cols-1 sm:grid-cols-[120px,1fr] gap-2">
                    <select
                        className="p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={normalized.mode}
                        onChange={e => onUpdate({ mode: e.target.value, value: '' })}
                    >
                        <option value="fixed">Fixo</option>
                        <option value="variable">Variavel</option>
                    </select>
                    {normalized.mode === 'variable' ? (
                        <select
                            className="p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={normalized.value}
                            onChange={e => onUpdate({ value: e.target.value })}
                        >
                            <option value="">Selecione a variavel...</option>
                            {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                        </select>
                    ) : (
                        <input
                            className="p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            value={normalized.value}
                            onChange={e => onUpdate({ value: e.target.value })}
                            placeholder="Valor fixo"
                        />
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-5">
            {!whatsappChannelReady && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                    Configure o canal WhatsApp com token, WABA e numero antes de usar o WTN.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Modo do WTN</label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => handleContentKindChange('template')}
                            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors border ${contentKind === 'template' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}
                        >
                            Templates
                        </button>
                        <button
                            type="button"
                            onClick={() => handleContentKindChange('interactive')}
                            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors border ${contentKind === 'interactive' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}
                        >
                            Interactive
                        </button>
                    </div>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Numero remetente</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.senderPhoneNumberId || ''}
                        onChange={e => onChange({ senderPhoneNumberId: e.target.value })}
                    >
                        <option value="">Padrao do canal</option>
                        {senderOptions.map((sender) => (
                            <option key={sender.id || sender.phoneNumberId} value={sender.phoneNumberId}>
                                {[sender.label, sender.displayNumber, sender.phoneNumberId].filter(Boolean).join(' - ')}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {contentKind === 'template' ? (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Template Meta aprovado</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.whatsappTemplateId || ''}
                        onChange={e => handleTemplateChange(e.target.value)}
                    >
                        <option value="">Selecione um template...</option>
                        {approvedTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                                {template.name} - {template.language}
                            </option>
                        ))}
                    </select>
                </div>
            ) : (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Interactive WhatsApp</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.interactiveTemplateId || ''}
                        onChange={e => handleInteractiveChange(e.target.value)}
                    >
                        <option value="">Selecione uma interactive...</option>
                        {interactiveTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                                {template.name} - {getInteractiveKindLabel(template.kind)}
                            </option>
                        ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">
                        Use o catalogo da tela de Templates para montar as interactive messages reutilizaveis.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={data.waitForReply !== false}
                        onChange={e => onChange({ waitForReply: e.target.checked })}
                    />
                    Esperar resposta do cliente antes de seguir
                </label>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Se o canal nao for WhatsApp</label>
                    <select
                        className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                        value={data.nonWhatsappAction || 'skip'}
                        onChange={e => onChange({ nonWhatsappAction: e.target.value })}
                    >
                        <option value="skip">Pular para o proximo no</option>
                        <option value="sendFallback">Enviar texto alternativo</option>
                    </select>
                </div>
            </div>

            {data.nonWhatsappAction === 'sendFallback' && (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Texto alternativo</label>
                    <textarea
                        className="w-full mt-1 p-2 border rounded-lg min-h-[80px] text-sm dark:bg-gray-700 dark:text-white"
                        value={data.fallbackText || ''}
                        onChange={e => onChange({ fallbackText: e.target.value })}
                        placeholder="Mensagem para canais que nao sao WhatsApp"
                    />
                </div>
            )}

            {contentKind === 'template' && selectedTemplate && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-800 dark:text-white">Parametros do template</div>
                    {inputDef.header.requiresMedia && renderMappingField('Header midia', data.headerMediaMapping, (patch) => onChange({ headerMediaMapping: { ...normalizeTemplateMapping(data.headerMediaMapping), ...patch } }))}
                    {Array.from({ length: inputDef.header.placeholderCount }).map((_, index) => renderMappingField(`Header ${index + 1}`, data.headerMappings?.[index], (patch) => updateArrayMapping('headerMappings', index, patch)))}
                    {Array.from({ length: inputDef.body.placeholderCount }).map((_, index) => renderMappingField(`Body ${index + 1}`, data.bodyMappings?.[index], (patch) => updateArrayMapping('bodyMappings', index, patch)))}
                    {inputDef.buttons.map((button) => (
                        <div key={`btn_map_${button.index}`} className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-2">
                            <div className="text-xs font-bold text-gray-500 uppercase">Botao {Number(button.index) + 1}: {button.text || button.type}</div>
                            {Array.from({ length: button.placeholderCount }).map((_, valueIndex) => (
                                <div key={`btn_map_${button.index}_${valueIndex}`}>
                                    {renderMappingField(
                                        `Parametro ${valueIndex + 1}`,
                                        data.buttonMappings?.[button.index]?.[valueIndex],
                                        (patch) => updateButtonMapping(button.index, valueIndex, patch)
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {((contentKind === 'template' && selectedTemplate) || (contentKind === 'interactive' && selectedInteractive)) && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-800 dark:text-white">Captura da resposta</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Salvar texto da resposta</label>
                            <select className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white" value={data.saveResponseTextVar || ''} onChange={e => onChange({ saveResponseTextVar: e.target.value })}>
                                <option value="">Nao salvar</option>
                                {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Salvar payload</label>
                            <select className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white" value={data.saveResponsePayloadVar || ''} onChange={e => onChange({ saveResponsePayloadVar: e.target.value })}>
                                <option value="">Nao salvar</option>
                                {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Salvar texto do botao</label>
                            <select className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white" value={data.saveButtonTextVar || ''} onChange={e => onChange({ saveButtonTextVar: e.target.value })}>
                                <option value="">Nao salvar</option>
                                {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <p className="text-[10px] text-gray-400">
                        Globais preenchidas pelo WTN: <code>ULTIMA_RESPOSTA_CLIENTE</code>, <code>WTN_BOTAO_TEXTO</code> e <code>WTN_BOTAO_PAYLOAD</code>.
                    </p>
                    {contentKind === 'interactive' && (selectedInteractive?.kind === 'product' || selectedInteractive?.kind === 'product_list') && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-300">
                            Dica: em <code>{selectedInteractive?.kind === 'product_list' ? 'Multi product' : 'Single product'}</code>, normalmente faz mais sentido desativar "Esperar resposta do cliente" se o objetivo for apenas vitrine.
                        </p>
                    )}
                </div>
            )}

            {contentKind === 'interactive' && selectedInteractive && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-800 dark:text-white">Como usar variaveis</div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Nas interactive messages, use variaveis direto no texto com o formato <code>{'{NOME_VARIAVEL}'}</code>.
                        Isso vale para header, body, footer, titulo do botao, secoes, linhas, ids estaveis, <code>catalogId</code>, <code>productRetailerId</code> e produtos do multi product.
                    </p>
                    <p className="text-[10px] text-gray-400">
                        Para ramificar depois da resposta, prefira comparar <code>WTN_BOTAO_PAYLOAD</code> com o ID do botao ou da linha.
                    </p>
                </div>
            )}

            {contentKind === 'template' && selectedTemplate && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50 dark:bg-gray-900/30">
                    <div className="text-sm font-semibold text-gray-800 dark:text-white">Preview</div>
                    {inputDef.header.text && (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">
                            {replacePreviewTokens(inputDef.header.text, data.headerMappings || [])}
                        </div>
                    )}
                    {inputDef.header.requiresMedia && (data.headerMediaMapping?.value || '') && (
                        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-3 text-xs text-gray-500 dark:text-gray-400 break-all">
                            Midia do header: {normalizeTemplateMapping(data.headerMediaMapping).mode === 'variable' ? `{${normalizeTemplateMapping(data.headerMediaMapping).value}}` : normalizeTemplateMapping(data.headerMediaMapping).value}
                        </div>
                    )}
                    <div className="rounded-2xl rounded-tl-sm bg-emerald-600 text-white px-4 py-3 text-sm whitespace-pre-wrap break-words shadow-sm">
                        {replacePreviewTokens(inputDef.body.text || 'Corpo do template', data.bodyMappings || [])}
                    </div>
                    {Array.isArray(selectedTemplate.buttons) && selectedTemplate.buttons.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {selectedTemplate.buttons.map((button) => (
                                <span key={`preview_btn_${button.index}`} className="px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                                    {button.text || button.type}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {contentKind === 'interactive' && selectedInteractive && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50 dark:bg-gray-900/30">
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-800 dark:text-white">Preview</div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${selectedInteractive.kind === 'list' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : selectedInteractive.kind === 'product' || selectedInteractive.kind === 'product_list' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300'}`}>
                            {getInteractiveKindLabel(selectedInteractive.kind)}
                        </span>
                    </div>

                    <div className="max-w-md rounded-3xl rounded-tl-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
                        {selectedInteractive.headerText && selectedInteractive.kind !== 'product' && (
                            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-100 whitespace-pre-wrap break-words">
                                {selectedInteractive.headerText}
                            </div>
                        )}
                        <div className="px-4 py-4 space-y-3">
                            <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                                {selectedInteractive.bodyText || 'Corpo da mensagem interativa'}
                            </p>
                            {selectedInteractive.footerText && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 whitespace-pre-wrap break-words">
                                    {selectedInteractive.footerText}
                                </p>
                            )}
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                            {selectedInteractive.kind === 'list' ? (
                                <>
                                    <div className="px-4 py-3 text-center text-sm font-semibold text-blue-600 dark:text-blue-400 border-b border-gray-200 dark:border-gray-700">
                                        {selectedInteractive.actionTitle || 'Ver opcoes'}
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {selectedInteractive.sections.map((section, sectionIndex) => (
                                            <div key={`wtn_int_section_${sectionIndex}`} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
                                                {section.title && (
                                                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                                                        {section.title}
                                                    </div>
                                                )}
                                                {(Array.isArray(section.rows) ? section.rows : []).map((row, rowIndex) => (
                                                    <div key={`wtn_int_row_${sectionIndex}_${row.id || rowIndex}`} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                                                        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                                            {row.title || 'Linha sem titulo'}
                                                        </div>
                                                        {row.description && (
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                                {row.description}
                                                            </div>
                                                        )}
                                                        <div className="text-[10px] text-gray-400 mt-2 font-mono break-all">
                                                            payload: {row.id || 'sem_id'}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : selectedInteractive.kind === 'product' ? (
                                <div className="p-4">
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 p-4 space-y-3">
                                        <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                            Single product
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 text-xs">
                                            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                                                <div className="font-semibold text-amber-700 dark:text-amber-300">catalogId</div>
                                                <div className="mt-1 font-mono break-all text-amber-900 dark:text-amber-100">{selectedInteractive.catalogId || 'nao definido'}</div>
                                            </div>
                                            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                                                <div className="font-semibold text-amber-700 dark:text-amber-300">productRetailerId</div>
                                                <div className="mt-1 font-mono break-all text-amber-900 dark:text-amber-100">{selectedInteractive.productRetailerId || 'nao definido'}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : selectedInteractive.kind === 'product_list' ? (
                                <div className="p-4 space-y-3">
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 p-4 space-y-3">
                                        <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                            Multi product
                                        </div>
                                        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                                            <div className="font-semibold text-amber-700 dark:text-amber-300">catalogId</div>
                                            <div className="mt-1 font-mono break-all text-amber-900 dark:text-amber-100">{selectedInteractive.catalogId || 'nao definido'}</div>
                                        </div>
                                        {(Array.isArray(selectedInteractive.productSections) ? selectedInteractive.productSections : []).map((section, sectionIndex) => (
                                            <div key={`wtn_int_product_section_${sectionIndex}`} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-3 space-y-2">
                                                <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                                    {section.title || `Secao ${sectionIndex + 1}`}
                                                </div>
                                                {(Array.isArray(section.productItems) ? section.productItems : []).map((item, itemIndex) => (
                                                    <div key={`wtn_int_product_item_${sectionIndex}_${itemIndex}`} className="rounded-md bg-white dark:bg-gray-900 px-3 py-2 text-xs">
                                                        <div className="font-mono break-all text-amber-900 dark:text-amber-100">
                                                            {item.productRetailerId || 'produto_sem_id'}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-3 flex flex-wrap gap-2">
                                    {selectedInteractive.buttons.map((button, index) => (
                                        <span key={`wtn_int_btn_${button.id || index}`} className="inline-flex flex-col items-start gap-1 px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-fuchsia-200 dark:border-fuchsia-800 text-fuchsia-700 dark:text-fuchsia-300 text-xs font-medium">
                                            <span>{button.title || 'Botao'}</span>
                                            <span className="text-[10px] font-mono text-fuchsia-500/80 dark:text-fuchsia-300/80">
                                                payload: {button.id || 'sem_id'}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const NodeConfigModal = ({
    node,
    isOpen,
    onClose,
    onSave,
    nodes = [],
    vars = [],
    templates = [],
    schedules = [],
    whatsappTemplates = [],
    whatsappInteractiveTemplates = [],
    whatsappSenderOptions = [],
    whatsappChannelReady = false,
    queues = [],
    catalogItems = [],
    mediaAssets = []
}) => {
    const [localData, setLocalData] = useState({});
    const [mediaLibrary, setMediaLibrary] = useState([]);
    const [uploadState, setUploadState] = useState({ loading: false, error: '' });

    useEffect(() => {
        if (node) setLocalData({ ...node.data });
    }, [node]);

    useEffect(() => {
        setMediaLibrary(Array.isArray(mediaAssets) ? mediaAssets : []);
    }, [mediaAssets]);

    const handleLocalChange = (newData) => setLocalData(prev => ({ ...prev, ...newData }));
    const getMenuOptions = () => (Array.isArray(localData.options) ? localData.options : []);

    // Lista de âncoras existentes no fluxo (para o seletor de busca do GoTo).
    const availableAnchors = (Array.isArray(nodes) ? nodes : [])
        .filter((n) => n?.type === 'anchorNode')
        .map((n) => String(n?.data?.anchorName || '').trim())
        .filter(Boolean)
        .filter((name, index, arr) => arr.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const addMenuOption = () => {
        setLocalData(prev => {
            const options = Array.isArray(prev.options) ? [...prev.options] : [];
            const nextId = String(options.length + 1);
            options.push({ id: nextId, label: `Opção ${nextId}`, value: nextId });
            return { ...prev, options };
        });
    };
    const updateMenuOption = (index, key, value) => {
        setLocalData(prev => {
            const options = Array.isArray(prev.options) ? [...prev.options] : [];
            options[index] = { ...(options[index] || {}), [key]: value };
            return { ...prev, options };
        });
    };
    const removeMenuOption = (index) => {
        setLocalData(prev => {
            const options = Array.isArray(prev.options) ? [...prev.options] : [];
            options.splice(index, 1);
            return { ...prev, options };
        });
    };
    const handleUploadAsset = async (file) => {
        if (!file) return;
        setUploadState({ loading: true, error: '' });
        try {
            const asset = await uploadMediaAsset(file);
            setMediaLibrary((prev) => [asset, ...prev.filter((item) => item.id !== asset.id)]);
            handleLocalChange({ mediaUrl: asset.url });
            setUploadState({ loading: false, error: '' });
        } catch (error) {
            setUploadState({ loading: false, error: error.message || 'Falha no upload' });
        }
    };

    const handleSave = () => {
        onSave(node.id, localData);
        onClose();
    };

    if (!isOpen || !node) return null;

    let Content = null;
    let Title = 'Configurar Nó';
    let Icon = FileText;
    let modalSizeClass = 'max-w-lg';

    switch (node.type) {
        case 'setValueNode':
            Title = 'Definir Valor de Variável';
            Icon = Database;
            Content = (
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Variável Alvo</label>
                        <select
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={localData.variableName || ''}
                            onChange={e => handleLocalChange({ variableName: e.target.value })}
                        >
                            <option value="">Selecione a variável...</option>
                            {vars.map(v => (
                                <option key={v.id} value={v.name}>{v.name}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1">Escolha qual variável terá o valor alterado.</p>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Valor a ser Atribuído</label>
                        <input
                            type="text"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Ex: true, 100, Ativo..."
                            value={localData.value || ''}
                            onChange={e => handleLocalChange({ value: e.target.value })}
                        />
                        <p className="text-[10px] text-gray-400 mt-1">Dica: Você pode usar outras variáveis aqui usando {'{var_nome}'}.</p>
                    </div>
                </div>
            );
            break;
        case 'secretNode':
            Title = 'Definir Secret';
            Icon = Key;
            Content = (
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Variável Alvo</label>
                        <select
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={localData.variableName || ''}
                            onChange={e => handleLocalChange({ variableName: e.target.value })}
                        >
                            <option value="">Selecione a variável...</option>
                            {vars.map(v => (
                                <option key={v.id} value={v.name}>{v.name}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1">Escolha a variável que receberá o segredo.</p>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Valor Secreto</label>
                        <input
                            type="password"
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Ex: token, chave, segredo..."
                            value={localData.value || ''}
                            onChange={e => handleLocalChange({ value: e.target.value })}
                        />
                        <p className="text-[10px] text-gray-400 mt-1">O valor pode ser usado como {'{SECRET}'} em outros nós.</p>
                    </div>
                </div>
            );
            break;
        case 'messageNode':
            Title = 'Configurar Mensagem';
            Content = <MessageConfig data={localData} onChange={handleLocalChange} />;
            break;
        case 'commandNode':
            Title = 'Configurar Comando';
            Icon = Command;
            Content = <CommandConfig data={localData} onChange={handleLocalChange} />;
            break;
        case 'mediaNode':
            Title = 'Configurar Mídia';
            Icon = Image;
            Content = <MediaConfig data={localData} onChange={handleLocalChange} mediaAssets={mediaLibrary} onUploadAsset={handleUploadAsset} uploadState={uploadState} />;
            break;
        case 'catalogNode':
            Title = 'Configurar Catálogo';
            Icon = FileText;
            Content = <CatalogConfig data={localData} onChange={handleLocalChange} catalogItems={catalogItems} />;
            break;
        case 'menuNode':
            Title = 'Configurar Menu';
            Icon = FileText;
            Content = (
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Mensagem do Menu</label>
                        <textarea
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white font-mono h-24"
                            placeholder="1 - Falar com atendente&#10;2 - Acompanhar OS"
                            value={localData.text || ''}
                            onChange={e => handleLocalChange({ text: e.target.value })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-500 uppercase">Opções</label>
                        <button
                            onClick={addMenuOption}
                            className="text-xs text-blue-600 font-bold flex items-center gap-1"
                        >
                            <Plus size={14} /> Add Opção
                        </button>
                    </div>

                    <div className="space-y-2">
                        {getMenuOptions().map((opt, index) => (
                            <div key={`${opt.id || index}`} className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-700/50 space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        className="w-20 p-2 border rounded text-xs dark:bg-gray-800 dark:text-white"
                                        placeholder="ID"
                                        value={opt.id || ''}
                                        onChange={e => updateMenuOption(index, 'id', e.target.value)}
                                    />
                                    <input
                                        className="flex-1 p-2 border rounded text-xs dark:bg-gray-800 dark:text-white"
                                        placeholder="Rótulo"
                                        value={opt.label || ''}
                                        onChange={e => updateMenuOption(index, 'label', e.target.value)}
                                    />
                                    <button
                                        onClick={() => removeMenuOption(index)}
                                        className="text-red-500 hover:text-red-600"
                                        title="Remover"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                {localData.setVarEnabled && (
                                    <input
                                        className="w-full p-2 border rounded text-xs dark:bg-gray-800 dark:text-white"
                                        placeholder="Valor a salvar nesta opção"
                                        value={opt.value || ''}
                                        onChange={e => updateMenuOption(index, 'value', e.target.value)}
                                    />
                                )}
                            </div>
                        ))}
                        {getMenuOptions().length === 0 && (
                            <div className="text-[11px] text-gray-400">Nenhuma opção cadastrada.</div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={localData.setVarEnabled === true}
                            onChange={e => handleLocalChange({ setVarEnabled: e.target.checked })}
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300">Salvar seleção em variável</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={localData.createBranches !== false}
                            onChange={e => handleLocalChange({ createBranches: e.target.checked })}
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300">Criar ramificações</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={localData.hasElse !== false}
                            onChange={e => handleLocalChange({ hasElse: e.target.checked })}
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300">Criar saída Else</span>
                    </div>

                    {localData.setVarEnabled && (
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Variável Alvo</label>
                            <select
                                className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={localData.variableName || ''}
                                onChange={e => handleLocalChange({ variableName: e.target.value })}
                            >
                                <option value="">Selecione a variável...</option>
                                {vars.map(v => (
                                    <option key={v.id} value={v.name}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Mensagem de erro</label>
                        <input
                            className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                            placeholder="Selecione uma opção válida."
                            value={localData.invalidSelectionMessage || ''}
                            onChange={e => handleLocalChange({ invalidSelectionMessage: e.target.value })}
                        />
                    </div>
                    <InactivityConfig data={localData} onChange={handleLocalChange} />
                </div>
            );
            break;
        case 'commercialNode':
            Title = 'Configurar No Comercial';
            Icon = Settings;
            Content = <CommercialNodeConfig data={localData} onChange={handleLocalChange} node={node} />;
            break;
        case 'sequentialNode':
            Title = 'Configurar Sequencial';
            Icon = Settings;
            modalSizeClass = 'max-w-3xl';
            Content = <SequentialConfig data={localData} onChange={handleLocalChange} vars={vars} />;
            break;
        case 'scriptNode':
            Title = 'Configurar Script JS';
            Icon = Code;
            Content = <ScriptConfig data={localData} onChange={handleLocalChange} />;
            break;
        case 'conditionNode':
            Title = 'Configurar Condicional';
            Icon = Split;
            Content = <ConditionConfig data={localData} onChange={handleLocalChange} vars={vars} />;
            break;
        case 'templateNode':
            Title = 'Configurar Template HSM';
            Icon = FileText;
            Content = <TemplateConfig data={localData} onChange={handleLocalChange} templates={templates} />;
            break;
        case 'whatsappTemplateNode':
            Title = 'Configurar WTN';
            Icon = Smartphone;
            modalSizeClass = 'max-w-5xl';
            Content = (
                <WhatsAppTemplateNodeConfig
                    data={localData}
                    onChange={handleLocalChange}
                    vars={vars}
                    whatsappTemplates={whatsappTemplates}
                    whatsappInteractiveTemplates={whatsappInteractiveTemplates}
                    whatsappSenderOptions={whatsappSenderOptions}
                    whatsappChannelReady={whatsappChannelReady}
                />
            );
            break;
        case 'gotoNode':
            Title = 'Salto de Fluxo (GoTo)';
            Icon = Send;
            Content = <GotoConfig data={localData} onChange={handleLocalChange} anchors={availableAnchors} />;
            break;
        case 'anchorNode':
            Title = 'Configurar Âncora';
            Icon = Anchor;
            Content = <AnchorConfig data={localData} onChange={handleLocalChange} />;
            break;

        case 'delayNode':
            Title = 'Configurar Delay';
            Content = (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Tempo de Espera (segundos)</label>
                    <input type="number" className="w-full mt-1 p-2 border rounded dark:bg-gray-700"
                        value={localData.delay || 1} onChange={e => handleLocalChange({ delay: e.target.value })} />
                </div>
            );
            break;
        case 'queueNode':
            Title = 'Transferir para Fila';
            Content = (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Escolha a Fila de Destino</label>
                <select
                    className="w-full mt-1 p-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    value={localData.queueName || ''}
                    onChange={e => handleLocalChange({ queueName: e.target.value })}
                >
                    <option value="">Selecione uma fila...</option>
                    {queues.map(q => (
                        <option key={q.id} value={q.name}>{q.name}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Mensagem de espera</label>
                <textarea
                    className="w-full mt-1 p-2 border rounded-lg dark:bg-gray-700 dark:text-white min-h-[90px]"
                    value={localData.queueMessage || ''}
                    onChange={e => handleLocalChange({ queueMessage: e.target.value })}
                    placeholder="Aguarde, em alguns instantes um especialista deve te atender."
                />
            </div>
            <label className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                <input
                    type="checkbox"
                    checked={localData.continueFlowAfterQueue ?? true}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    onChange={e => handleLocalChange({ continueFlowAfterQueue: e.target.checked })}
                />
                Continuar fluxo após o agente finalizar
            </label>
            <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-[11px] text-orange-700 dark:text-orange-300">
                Ao atingir este nó, o bot será pausado e o cliente entrará na fila selecionada aguardando um agente humano.
            </div>
        </div>
            );
            break;
        case 'scheduleNode':
            Title = 'Validar Horário';
            Content = (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Grupo de Horário</label>
                    <select className="w-full mt-1 p-2 border rounded dark:bg-gray-700" value={localData.scheduleId || ''} onChange={e => handleLocalChange({ scheduleId: e.target.value })}>
                        <option value="">Selecione...</option>
                        {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>
            );
            break;
        case 'inputNode':
            Title = 'Entrada de Dados';
            Content = (
                <div className="space-y-4">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Pergunta do Bot</label>
                    <textarea
                            className="w-full mt-1 p-2 border rounded dark:bg-gray-700 h-20"
                            value={localData.text || ''}
                            onChange={e => handleLocalChange({ text: e.target.value })}
                            placeholder="Ex: Qual o seu e-mail?"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Salvar resposta na variável:</label>
                        <select
                            className="w-full mt-1 p-2 border rounded dark:bg-gray-700"
                            value={localData.variableName || ''}
                            onChange={e => handleLocalChange({ variableName: e.target.value })}
                        >
                            <option value="">Selecione uma variável...</option>
                            {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1">
                            A resposta do cliente será guardada nesta variável para uso posterior.
                        </p>
                    </div>
                    <InactivityConfig data={localData} onChange={handleLocalChange} />
                </div>
            );
            break;
        case 'holderNode':
            Title = 'Configurar Holder';
            Icon = Hand;
            Content = <HolderConfig data={localData} onChange={handleLocalChange} vars={vars} />;
            break;
        case 'ratingNode':
            Title = 'Solicitar Nota (1-5)';
            Content = (
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Pergunta do Bot</label>
                        <textarea
                            className="w-full mt-1 p-2 border rounded dark:bg-gray-700 h-20"
                            value={localData.text || ''}
                            onChange={e => handleLocalChange({ text: e.target.value })}
                            placeholder="Avalie este atendimento de 1 a 5."
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                            O cliente deve digitar um número entre 1 e 5; respostas inválidas retornam erro.
                        </p>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Resposta inválida</label>
                        <input
                            type="text"
                            className="w-full mt-1 p-2 border rounded dark:bg-gray-700"
                            value={localData.errorText || ''}
                            onChange={e => handleLocalChange({ errorText: e.target.value })}
                            placeholder="Ex: Digite um número entre 1 e 5."
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                            Texto exibido quando o cliente responde com algo diferente de 1 a 5.
                        </p>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Salvar resposta na variável:</label>
                        <select
                            className="w-full mt-1 p-2 border rounded dark:bg-gray-700"
                            value={localData.variableName || ''}
                            onChange={e => handleLocalChange({ variableName: e.target.value })}
                        >
                            <option value="">Selecione uma variável...</option>
                            {vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                        </select>
                    </div>
                    <InactivityConfig data={localData} onChange={handleLocalChange} />
                </div>
            );
            break;
        case 'httpRequestNode':
            Title = 'Requisição HTTP (API)';
            Icon = Globe;
            Content = (
                <HttpRequestConfig
                    data={localData}
                    onChange={handleLocalChange}
                    vars={vars}
                />
            );
            break;
        case 'finalNode':
            Title = 'Mensagem de Encerramento';
            Icon = Flag;
            Content = <FinalNodeConfig data={localData} onChange={handleLocalChange} />;
            break;
        default:
            Content = <div className="p-4 bg-yellow-50 text-yellow-700 rounded-lg border border-yellow-200">Configuração não mapeada para o tipo: <b>{node.type}</b></div>;
    }

    return (
        <ConfigWrapper title={Title} onClose={onClose} onSave={handleSave} sizeClass={modalSizeClass}>
            <div className="mb-6 border-b border-gray-100 dark:border-gray-700 pb-4">
                <label className="text-xs font-bold text-gray-400 uppercase">Identificador Visual</label>
                <input
                    className="w-full mt-1 p-2 border rounded text-sm bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-white"
                    placeholder={node.type}
                    value={localData.customName || ''}
                    onChange={e => handleLocalChange({ customName: e.target.value })}
                />
            </div>
            {Content}
        </ConfigWrapper>
    );
};

export default NodeConfigModal;

