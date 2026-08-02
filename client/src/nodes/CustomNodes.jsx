import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import '@reactflow/node-resizer/dist/style.css';
import { motion } from 'framer-motion';
import {
    Play, Square, MessageSquare, TextCursorInput,
    Database, Split, Anchor, ArrowRight, Code,
    Globe, Hourglass, Hand, Users, Clock, FileText,
    X, Flag, GitBranch, Star, Command, Image, Package, Key, Menu as MenuIcon, Smartphone, Settings, Circle
} from 'lucide-react';


const NODE_WIDTH = 220;
const NODE_HEIGHT = 50;
const NODE_EXPANDED_HEIGHT = 96;
const NODE_DETAIL_ROW_HEIGHT = 16;
const NODE_DETAIL_VERTICAL_SPACE = 28;


const Tooltip = ({ text }) => (
    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg">
        {text || "Sem descrição"}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
    </div>
);

const compactText = (value, fallback = '') => String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();

const clipText = (value, max = 42) => {
    const text = compactText(value);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

const fullPreviewText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }
    return String(value).replace(/\r\n/g, '\n').trim();
};

const countItems = (value) => Array.isArray(value) ? value.length : 0;

const booleanLabel = (value, truthy = 'sim', falsy = 'nao') => value ? truthy : falsy;
const cleanBadge = (value, max = 14) => clipText(value, max).toUpperCase();

const getToneClass = (tone = 'slate') => {
    if (tone === 'blue') return 'border-blue-200/80 bg-blue-50/95 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-200';
    if (tone === 'green') return 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200';
    if (tone === 'amber') return 'border-amber-200/90 bg-amber-50/95 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200';
    if (tone === 'red') return 'border-red-200/90 bg-red-50/95 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200';
    if (tone === 'violet') return 'border-violet-200/80 bg-violet-50/95 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200';
    if (tone === 'cyan') return 'border-cyan-200/80 bg-cyan-50/95 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200';
    return 'border-slate-200/90 bg-white/95 text-slate-600 dark:border-slate-600/50 dark:bg-slate-900/90 dark:text-slate-200';
};

const buildNodeBadges = (data = {}, nodeType = '', label = '', outputs = []) => {
    const nodeKind = compactText(nodeType || label).toLowerCase();
    const badges = [];
    const addBadge = (text, tone = 'slate') => {
        const labelText = cleanBadge(text);
        if (labelText) badges.push({ text: labelText, tone });
    };

    if (nodeKind === 'messagenode' || nodeKind === 'textnode') addBadge('msg', 'blue');
    else if (nodeKind === 'inputnode') {
        addBadge('input', 'amber');
        addBadge(data.variableName, 'slate');
    } else if (nodeKind === 'holdernode') addBadge('hold', 'amber');
    else if (nodeKind === 'setvaluenode') {
        addBadge('set', 'green');
        addBadge(data.variableName, 'slate');
    } else if (nodeKind === 'secretnode') addBadge('secret', 'slate');
    else if (nodeKind === 'scriptnode') addBadge('js', 'slate');
    else if (nodeKind === 'delaynode') addBadge(data.delay || data.duration ? `${data.delay || data.duration}${data.unit || 's'}` : 'delay', 'amber');
    else if (nodeKind === 'queuenode') addBadge(data.queueName || data.queue || 'fila', 'amber');
    else if (nodeKind === 'medianode') addBadge(data.mediaType || 'media', 'cyan');
    else if (nodeKind === 'catalognode') addBadge(`${countItems(data.itemIds || data.items)} itens`, 'violet');
    else if (nodeKind === 'httprequestnode') {
        addBadge(data.method || 'GET', 'cyan');
        if ((outputs || []).some((item) => item.id === 'error')) addBadge('erro', 'red');
    } else if (nodeKind === 'conditionnode') addBadge(`${countItems(data.conditions)} if`, 'violet');
    else if (nodeKind === 'whatsapptemplatenode') {
        addBadge('wtn', 'green');
        if (data.waitForReply) addBadge('reply', 'amber');
    } else if (nodeKind === 'menunode') {
        addBadge(`${countItems(data.options)} op`, 'slate');
        addBadge(data.createBranches ? 'ramos' : 'unico', data.createBranches ? 'violet' : 'green');
    } else if (nodeKind === 'sequentialnode') addBadge(`${countItems(data.steps || data.items || data.actions)} etapas`, 'red');
    else if (nodeKind === 'startnode') addBadge('start', 'green');
    else if (nodeKind === 'endnode' || nodeKind === 'finalnode') addBadge('end', 'red');

    return badges.slice(0, 3);
};

const buildHoverDetails = (data = {}, nodeType = '', label = '') => {
    const nodeKind = compactText(nodeType || label).toLowerCase();
    const lines = [];
    const addLine = (title, value) => {
        const fullValue = fullPreviewText(value);
        const text = clipText(value, 52);
        if (text) lines.push({ title, value: text, fullValue });
    };

    if (nodeKind === 'messagenode' || nodeKind === 'textnode' || nodeKind.includes('mensagem') || nodeKind.includes('texto')) {
        addLine('Texto', data.text || data.message);
    } else if (nodeKind === 'inputnode' || nodeKind.includes('entrada')) {
        addLine('Pergunta', data.text || data.prompt);
        addLine('Var', data.variableName);
    } else if (nodeKind === 'holdernode' || nodeKind.includes('holder')) {
        addLine('Mensagem', data.text);
        addLine('Salvar', booleanLabel(data.saveMessages !== false));
        addLine('Fallback', data.fallbackText);
    } else if (nodeKind === 'setvaluenode' || nodeKind.includes('definir')) {
        addLine('Var', data.variableName);
        addLine('Valor', data.value);
    } else if (nodeKind === 'secretnode' || nodeKind.includes('secret')) {
        addLine('Var', data.variableName || data.name);
        addLine('Valor', data.variableName || data.name ? '***' : '');
    } else if (nodeKind === 'scriptnode' || nodeKind.includes('script')) {
        addLine('Script', data.script || data.code);
    } else if (nodeKind === 'delaynode' || nodeKind.includes('delay')) {
        addLine('Tempo', `${data.delay || data.duration || 1} ${data.unit || 's'}`);
    } else if (nodeKind === 'anchornode' || nodeKind.includes('ancora')) {
        addLine('Ancora', data.anchorName || data.name || data.label);
    } else if (nodeKind === 'gotonode' || nodeKind.includes('ir para')) {
        addLine('Destino', data.targetNodeId || data.targetId || data.gotoNodeId);
    } else if (nodeKind === 'queuenode' || nodeKind.includes('fila')) {
        addLine('Fila', data.queueName || data.queue);
        addLine('Continua fluxo', booleanLabel(data.continueFlowAfterQueue));
    } else if (nodeKind === 'ratingnode' || nodeKind.includes('nota')) {
        addLine('Texto', data.text);
        addLine('Var', data.variableName);
    } else if (nodeKind === 'commandnode' || nodeKind.includes('comando')) {
        addLine('Comando', data.command || data.commandText || data.text);
    } else if (nodeKind === 'medianode' || nodeKind.includes('midia')) {
        addLine('Tipo', data.mediaType || data.type);
        addLine('Legenda', data.caption || data.text);
    } else if (nodeKind === 'catalognode' || nodeKind.includes('catalogo')) {
        const total = countItems(data.itemIds || data.items);
        addLine('Itens', total ? `${total} selecionado(s)` : '');
        addLine('Botoes', booleanLabel(data.showButtons ?? data.withButtons ?? data.waitForReply));
    } else if (nodeKind === 'httprequestnode' || nodeKind.includes('api http')) {
        addLine('Metodo', data.method || 'GET');
        addLine('URL', data.url);
        addLine('Erro', data.errorVar || data.errorVariable || data.errorMessageVar);
    } else if (nodeKind === 'conditionnode' || nodeKind.includes('condicional')) {
        const total = countItems(data.conditions);
        addLine('Casos', total ? `${total} condicao(oes)` : '');
        addLine('Else', booleanLabel(data.hasElse !== false));
    } else if (nodeKind === 'schedulenode' || nodeKind.includes('horario')) {
        addLine('Agenda', data.scheduleName || data.scheduleId);
    } else if (nodeKind === 'templatenode' || nodeKind.includes('template')) {
        addLine('Template', data.templateName || data.templateId);
    } else if (nodeKind === 'whatsapptemplatenode' || nodeKind === 'wtn') {
        addLine('Tipo', data.contentKind || 'template');
        addLine('Modelo', data.subLabel || data.whatsappTemplateId || data.interactiveTemplateId);
        addLine('Aguardar', booleanLabel(data.waitForReply));
    } else if (nodeKind === 'menunode' || nodeKind.includes('menu')) {
        const total = countItems(data.options);
        addLine('Opcoes', total ? `${total} opcao(oes)` : '');
        addLine('Var', data.variableName);
        addLine('Ramos', booleanLabel(data.createBranches));
    } else if (nodeKind === 'sequentialnode' || nodeKind.includes('sequencial')) {
        const steps = countItems(data.steps || data.items || data.actions);
        addLine('Etapas', steps ? `${steps} configurada(s)` : '');
    } else if (nodeKind === 'endnode' || nodeKind === 'finalnode' || nodeKind.includes('fim') || nodeKind.includes('finalizar')) {
        addLine('Mensagem', data.text || data.message);
    }

    if (!lines.length) {
        addLine('Config', data.subLabel || data.customName || 'Sem detalhes');
    }

    return lines.slice(0, 3);
};


const CompactNode = ({ id, type, data, icon: Icon, color, label, outputs = [], onDelete, disableConfig = false, selected = false, hideLabels = false }) => {

    const handles = outputs.length > 0 ? outputs : [{ id: 'default', label: '' }];
    const nodeWidth = hideLabels ? NODE_HEIGHT : NODE_WIDTH;
    const hoverDetails = hideLabels ? [] : buildHoverDetails(data, type, label);
    const nodeBadges = hideLabels ? [] : buildNodeBadges(data, type, label, handles);
    const canExpand = hoverDetails.length > 0;
    const expandedHeight = Math.max(
        NODE_EXPANDED_HEIGHT,
        NODE_HEIGHT + 44 + (hoverDetails.length * 22)
    );

    return (
        <div
            className={`compact-node flow-node-card group relative overflow-visible rounded-xl border cursor-pointer bg-white/96 shadow-[0_10px_28px_rgba(15,23,42,0.07)] transition-[height,box-shadow,border-color,background-color,filter] duration-200 ease-out hover:z-20 dark:bg-slate-800/95 ${
                canExpand ? 'node-can-expand h-[50px]' : 'h-[50px]'
            } ${
                selected
                    ? 'is-selected border-sky-400 dark:border-sky-300 ring-2 ring-sky-300/70 dark:ring-sky-400/35 shadow-[0_0_0_1px_rgba(14,165,233,0.22),0_18px_40px_rgba(14,165,233,0.22)]'
                    : 'border-slate-200/90 dark:border-slate-700/80 hover:border-sky-300/70 dark:hover:border-sky-400/40 hover:shadow-[0_16px_36px_rgba(15,23,42,0.14)]'
            }`}
            style={{
                width: nodeWidth,
                borderLeft: `4px solid ${color}`,
                '--node-expanded-height': `${expandedHeight}px`,
                '--node-accent': color
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                if (!disableConfig && data.onConfig) data.onConfig(id);
            }}
        >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent opacity-80 dark:via-white/20" />
            <div className="pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-[var(--node-accent)] opacity-70 blur-[0.2px]" />

            {selected && !hideLabels && (
                <motion.div
                    className="pointer-events-none absolute -left-2 -top-2 z-20 h-3 w-3 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.8)] dark:border-slate-950"
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                />
            )}

            {nodeBadges.length > 0 && (
                <motion.div
                    className="pointer-events-none absolute -top-2 right-2 z-20 flex max-w-[170px] items-center gap-1 overflow-hidden"
                    initial={{ y: 2, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                    {nodeBadges.map((badge, index) => (
                        <span
                            key={`${badge.text}_${index}`}
                            className={`rounded-full border px-1.5 py-[1px] text-[8px] font-black leading-none tracking-[0.08em] shadow-sm backdrop-blur ${getToneClass(badge.tone)}`}
                        >
                            {badge.text}
                        </span>
                    ))}
                </motion.div>
            )}

            <div className={`flex h-[50px] items-center ${hideLabels ? 'justify-center px-0' : 'justify-between px-3'}`}>
                <div className={`flex items-center ${hideLabels ? 'justify-center w-full' : 'gap-3 overflow-hidden'}`}>
                    <div className="node-icon-shell p-1.5 rounded-lg bg-slate-50 text-slate-600 shadow-inner ring-1 ring-slate-200/70 transition-transform duration-200 group-hover:scale-105 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700/80">
                        <Icon size={18} color={color} />
                    </div>
                    {!hideLabels && (
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                {data.customName || label}
                            </span>
                            <span className="text-[9px] text-slate-400 truncate uppercase tracking-[0.16em]">
                                {data.subLabel || label}
                            </span>
                        </div>
                    )}
                </div>

                {!hideLabels && onDelete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                        className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {canExpand && (
                <motion.div
                    className="node-hover-preview pointer-events-none border-t border-slate-100/80 px-3 pb-3 pt-2 opacity-0 transition-all duration-200 ease-out group-hover:pointer-events-auto group-hover:opacity-100 dark:border-slate-700/70"
                    initial={false}
                    whileHover={{ opacity: 1 }}
                    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Preview</span>
                        <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent dark:from-slate-700" />
                    </div>
                    <div className="space-y-1.5">
                        {hoverDetails.map((detail, index) => (
                            <div key={`${detail.title}_${index}`} className="node-detail-preview relative flex min-h-[18px] items-center gap-2 text-[10px] leading-tight">
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">{detail.title}</span>
                                <span className="node-detail-value min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">
                                    {detail.value}
                                </span>
                                {detail.fullValue && detail.fullValue !== detail.value && (
                                    <div className="node-detail-tooltip pointer-events-none absolute left-0 top-[calc(100%+8px)] z-[1200] hidden w-80 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-snug text-slate-700 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                                        {detail.fullValue}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}

            {}
            <Handle
                type="target"
                position={Position.Left}
                style={{ top: NODE_HEIGHT / 2, transform: 'translateY(-50%)' }}
                className="!w-2 !h-6 !rounded-sm !bg-slate-300 dark:!bg-slate-600 !border-none"
            />

            {}
            {handles.map((output, index) => {
                const topPos = handles.length === 1 ? NODE_HEIGHT / 2 : ((index + 1) * NODE_HEIGHT) / (handles.length + 1);
                return (
                    <React.Fragment key={output.id}>
                        <Handle
                            type="source"
                            position={Position.Right}
                            id={output.id}
                            style={{ top: topPos, transform: 'translateY(-50%)' }}
                            className="!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800 !-right-[6px]"
                        />
                        {output.label && output.id !== 'default' && (
                            <span
                                className="absolute right-[10px] text-[9px] font-bold text-slate-400 bg-white dark:bg-slate-800 px-1 border border-slate-100 dark:border-slate-700 rounded shadow-sm whitespace-nowrap"
                                style={{ top: topPos, transform: 'translateY(-50%)' }}
                            >
                                {output.label}
                            </span>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export const CaseNode = ({ id, data, selected }) => (
    <div
        className={`case-node-card group relative flex items-center gap-2 overflow-visible bg-white/95 dark:bg-slate-800/95 border transition-all cursor-pointer rounded-full px-4 shadow-[0_10px_26px_rgba(15,23,42,0.08)] hover:z-20 hover:border-sky-300/70 hover:shadow-[0_16px_36px_rgba(15,23,42,0.14)] ${
            selected
                ? 'border-sky-400 dark:border-sky-300 ring-2 ring-sky-300/70 dark:ring-sky-400/35 shadow-[0_0_0_1px_rgba(14,165,233,0.18),0_18px_40px_rgba(14,165,233,0.20)]'
                : data?.tone === 'error'
                    ? 'border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/20'
                    : 'border-slate-200 dark:border-slate-700'
        }`}
        style={{
            width: 160,
            height: NODE_HEIGHT,
            boxSizing: 'border-box',
            lineHeight: 1
        }}
    >
        {selected && (
            <motion.div
                className="pointer-events-none absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_16px_rgba(56,189,248,0.75)] dark:border-slate-950"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            />
        )}
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
        <Handle
            type="target"
            position={Position.Left}
            style={{ top: NODE_HEIGHT / 2, transform: 'translateY(-50%)' }}
            className="!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800 !-left-[6px]"
        />
        <GitBranch size={14} className={`${data?.tone === 'error' ? 'text-red-500' : 'text-slate-400'} flex-shrink-0`} />
        <span className={`text-xs font-bold truncate max-w-[120px] ${data?.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'dark:text-white text-slate-700'}`}>
            {data.label}
        </span>
        {data?.label && String(data.label).length > 18 && (
            <div className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-[1200] hidden w-64 -translate-x-1/2 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white/98 p-2 text-[11px] leading-snug text-slate-700 shadow-2xl ring-1 ring-black/5 backdrop-blur group-hover:block dark:border-slate-700 dark:bg-slate-900/98 dark:text-slate-100">
                {data.label}
            </div>
        )}
        <Handle
            type="source"
            position={Position.Right}
            style={{ top: NODE_HEIGHT / 2, transform: 'translateY(-50%)' }}
            className="!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800 !-right-[6px]"
        />
    </div>
);




export const StartNode = (props) => (
    <CompactNode
        {...props}
        icon={Play}
        color="#10b981"
        label="Início"
        onDelete={null}
        disableConfig={true}
        hideLabels={true}
    />
);
export const EndNode = (props) => <CompactNode {...props} icon={Square} color="#ef4444" label="Fim" outputs={[]} />;
export const FinalNode = (props) => <CompactNode {...props} icon={Flag} color="#000" label="Finalizar" outputs={[]} />;

export const MessageNode = (props) => <CompactNode {...props} icon={MessageSquare} color="#3b82f6" label="Mensagem" />;
export const InputNode = (props) => <CompactNode {...props} icon={TextCursorInput} color="#f59e0b" label="Entrada" />;
export const HolderNode = (props) => <CompactNode {...props} icon={Hand} color="#b45309" label="Holder" />;
export const SetValueNode = (props) => <CompactNode {...props} icon={Database} color="#059669" label="Definir Var" />;
export const SecretNode = (props) => <CompactNode {...props} icon={Key} color="#c0c0c0" label="Secret" />;
export const ScriptNode = (props) => <CompactNode {...props} icon={Code} color="#475569" label="Script JS" />;
export const DelayNode = (props) => <CompactNode {...props} icon={Hourglass} color="#d97706" label="Delay" />;
export const AnchorNode = (props) => <CompactNode {...props} icon={Anchor} color="#db2777" label="Âncora" />;
export const GotoNode = (props) => <CompactNode {...props} icon={ArrowRight} color="#db2777" label="Ir Para" outputs={[]} />;
export const QueueNode = (props) => <CompactNode {...props} icon={Users} color="#ea580c" label="Fila" />;
export const RatingNode = (props) => (
    <CompactNode {...props} icon={Star} color="#fbbf24" label="Nota" />
);
export const CommandNode = (props) => (
    <CompactNode {...props} icon={Command} color="#0f766e" label="Comando" />
);
export const MediaNode = (props) => (
    <CompactNode {...props} icon={Image} color="#0ea5e9" label="Mídia" />
);
export const CatalogNode = (props) => (
    <CompactNode {...props} icon={Package} color="#8b5cf6" label="Catálogo" />
);

export const HttpRequestNode = (props) => (
    <CompactNode
        {...props}
        icon={Globe}
        color="#0891b2"
        label="API HTTP"
        outputs={[
            { id: 'success', label: 'OK' },
            { id: 'error', label: 'Erro' }
        ]}
    />
);

export const ConditionNode = (props) => {



    return (
        <CompactNode
            {...props}
            icon={Split}
            color="#7c3aed"
            label="Condicional"
        />
    );
};

export const ScheduleNode = (props) => (
    <CompactNode
        {...props}
        icon={Clock}
        color="#16a34a"
        label="Horário"
        outputs={[{ id: 'source', label: '' }]}
    />
);

export const TemplateNode = (props) => {


    return (
        <CompactNode
            {...props}
            icon={FileText}
            color="#be185d"
            label="Template HSM"
            outputs={[{ id: 'source', label: '' }]}
        />
    );
};
export const WhatsAppTemplateNode = (props) => (
    <CompactNode
        {...props}
        icon={Smartphone}
        color="#22c55e"
        label="WTN"
        outputs={[{ id: 'default', label: '' }]}
    />
);
export const MenuNode = (props) => (
    <CompactNode {...props} icon={MenuIcon} color="#94a3b8" label="Menu" />
);
export const SequentialNode = (props) => (
    <CompactNode {...props} icon={Settings} color="#dc2626" label="Sequencial" />
);

export const CommercialNode = ({ id, data, selected }) => {
    const clampSize = (value, fallback = 120) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return Math.max(24, Math.min(500, Number(fallback) || 120));
        return Math.max(24, Math.min(500, numeric));
    };
    const normalizeShape = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (['circle', 'square', 'rounded', 'rounded-rectangle'].includes(normalized)) return normalized;
        return 'circle';
    };
    const normalizeColor = (value) => String(value || '').trim() || '#f97316';
    const normalizeEasing = (value) => {
        const normalized = String(value || '').trim();
        return ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(normalized) ? normalized : 'ease-in-out';
    };
    const normalizeMode = (value) => {
        const normalized = String(value || '').trim();
        return ['forwards', 'backwards', 'both', 'none'].includes(normalized) ? normalized : 'forwards';
    };

    const showLabel = String(data?.text || data?.customName || '').trim();
    const playKey = String(data?.animationPlayKey || '');
    const onCommercialAnimationEnd = data?.onCommercialAnimationEnd;
    const onCommercialResize = data?.onCommercialResize;
    const timeoutRef = useRef(null);
    const lastPlayedKeyRef = useRef('');

    const runtimeState = {
        x: Number.isFinite(Number(data?.currentX)) ? Number(data.currentX) : 0,
        y: Number.isFinite(Number(data?.currentY)) ? Number(data.currentY) : 0,
        width: clampSize(data?.currentWidth ?? data?.endWidth ?? data?.endSize ?? data?.size, 120),
        height: clampSize(data?.currentHeight ?? data?.endHeight ?? data?.endSize ?? data?.size, 120),
        shape: normalizeShape(data?.currentShape ?? data?.shape),
        borderColor: normalizeColor(data?.currentBorderColor ?? data?.borderColor)
    };

    const normalizedKeyframes = (() => {
        const sourceFrames = Array.isArray(data?.motionKeyframes) ? data.motionKeyframes : [];
        const fallbackDuration = Math.max(100, Math.min(15000, Number(data?.durationMs || 900)));
        const frameFallback = {
            x: runtimeState.x,
            y: runtimeState.y,
            width: runtimeState.width,
            height: runtimeState.height,
            shape: runtimeState.shape,
            borderColor: runtimeState.borderColor
        };
        const normalizeFrame = (frame, index, isLast) => ({
            id: String(frame?.id || `kf_${index + 1}`),
            x: Number.isFinite(Number(frame?.x)) ? Number(frame.x) : frameFallback.x,
            y: Number.isFinite(Number(frame?.y)) ? Number(frame.y) : frameFallback.y,
            width: clampSize(frame?.width ?? frame?.size, frameFallback.width),
            height: clampSize(frame?.height ?? frame?.size, frameFallback.height),
            shape: normalizeShape(frame?.shape ?? frameFallback.shape),
            borderColor: normalizeColor(frame?.borderColor ?? frameFallback.borderColor),
            segmentDurationMs: isLast ? undefined : Math.max(100, Math.min(15000, Number(frame?.segmentDurationMs || fallbackDuration))),
            segmentEasing: isLast ? undefined : normalizeEasing(frame?.segmentEasing),
            segmentMode: isLast ? undefined : normalizeMode(frame?.segmentMode)
        });

        if (sourceFrames.length === 0) {
            return [{
                id: 'kf_1',
                x: runtimeState.x,
                y: runtimeState.y,
                width: runtimeState.width,
                height: runtimeState.height,
                shape: runtimeState.shape,
                borderColor: runtimeState.borderColor,
                segmentDurationMs: fallbackDuration,
                segmentEasing: normalizeEasing(data?.easing),
                segmentMode: normalizeMode(data?.mode)
            }];
        }

        return sourceFrames.map((frame, index) => normalizeFrame(frame, index, index === sourceFrames.length - 1));
    })();

    const [motion, setMotion] = useState({
        dx: 0,
        dy: 0,
        sx: 1,
        sy: 1,
        borderColor: runtimeState.borderColor,
        shape: runtimeState.shape,
        transition: 'none'
    });

    useEffect(() => {
        if (playKey) return;
        lastPlayedKeyRef.current = '';
        setMotion({
            dx: 0,
            dy: 0,
            sx: 1,
            sy: 1,
            borderColor: runtimeState.borderColor,
            shape: runtimeState.shape,
            transition: 'none'
        });
    }, [playKey, runtimeState.borderColor, runtimeState.shape]);

    useEffect(() => {
        if (!playKey) return;
        if (lastPlayedKeyRef.current === playKey) return;
        lastPlayedKeyRef.current = playKey;

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        let cancelled = false;
        const base = {
            x: runtimeState.x,
            y: runtimeState.y,
            width: runtimeState.width,
            height: runtimeState.height
        };

        const toTransformState = (frame, transition = 'none') => {
            const width = clampSize(frame?.width, base.width);
            const height = clampSize(frame?.height, base.height);
            return {
                dx: Number(frame?.x || 0) - base.x,
                dy: Number(frame?.y || 0) - base.y,
                sx: base.width ? width / base.width : 1,
                sy: base.height ? height / base.height : 1,
                borderColor: normalizeColor(frame?.borderColor ?? runtimeState.borderColor),
                shape: normalizeShape(frame?.shape ?? runtimeState.shape),
                transition
            };
        };

        const run = async () => {
            setMotion(toTransformState(normalizedKeyframes[0], 'none'));
            await new Promise((resolve) => requestAnimationFrame(resolve));

            if (normalizedKeyframes.length <= 1) {
                if (!cancelled && typeof onCommercialAnimationEnd === 'function') {
                    onCommercialAnimationEnd(id, playKey, normalizedKeyframes[0]);
                }
                return;
            }

            for (let index = 0; index < normalizedKeyframes.length - 1; index += 1) {
                if (cancelled) return;
                const currentFrame = normalizedKeyframes[index];
                const nextFrame = normalizedKeyframes[index + 1];
                const durationMs = Math.max(100, Math.min(15000, Number(currentFrame?.segmentDurationMs || 900)));
                const easing = normalizeEasing(currentFrame?.segmentEasing);
                const transition = `transform ${durationMs}ms ${easing}, border-color ${Math.max(120, Math.round(durationMs * 0.6))}ms ease-out`;
                setMotion(toTransformState(nextFrame, transition));
                await new Promise((resolve) => {
                    timeoutRef.current = setTimeout(resolve, durationMs);
                });
            }

            if (!cancelled && typeof onCommercialAnimationEnd === 'function') {
                const finalFrame = normalizedKeyframes[normalizedKeyframes.length - 1];
                onCommercialAnimationEnd(id, playKey, finalFrame);
            }
        };

        run();

        return () => {
            cancelled = true;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [id, onCommercialAnimationEnd, playKey]);

    const getShapeClass = (shape) => {
        if (shape === 'circle') return 'rounded-full';
        if (shape === 'square') return 'rounded-none';
        return 'rounded-2xl';
    };

    const activeShape = normalizeShape(motion.shape || runtimeState.shape);
    const activeBorderColor = normalizeColor(motion.borderColor || runtimeState.borderColor);
    const radiusClass = getShapeClass(activeShape);
    const hideGhostsGlobal = data?.hideCommercialGhostsGlobal === true;
    const showGhosts = !hideGhostsGlobal && !playKey && normalizedKeyframes.length > 0;
    const ghostFrames = showGhosts
        ? normalizedKeyframes.filter((frame) => {
            const samePosition = Math.round(Number(frame?.x || 0)) === Math.round(Number(runtimeState.x || 0))
                && Math.round(Number(frame?.y || 0)) === Math.round(Number(runtimeState.y || 0));
            const sameSize = Math.round(clampSize(frame?.width, runtimeState.width)) === Math.round(runtimeState.width)
                && Math.round(clampSize(frame?.height, runtimeState.height)) === Math.round(runtimeState.height);
            const sameShape = normalizeShape(frame?.shape) === normalizeShape(runtimeState.shape);
            const sameColor = normalizeColor(frame?.borderColor).toLowerCase() === normalizeColor(runtimeState.borderColor).toLowerCase();
            return !(samePosition && sameSize && sameShape && sameColor);
        })
        : [];

    return (
        <div
            className={`group relative ${radiusClass} border-2 bg-white/80 dark:bg-slate-900/70 shadow-sm transition-[border-color,box-shadow] ${
                selected
                    ? 'ring-2 ring-blue-300/70 dark:ring-blue-900/70 shadow-lg'
                    : 'hover:shadow-md'
            }`}
            style={{
                width: runtimeState.width,
                height: runtimeState.height,
                borderColor: activeBorderColor,
                transform: `translate(${motion.dx}px, ${motion.dy}px) scale(${motion.sx}, ${motion.sy})`,
                transition: motion.transition
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                if (data?.onConfig) data.onConfig(id);
            }}
        >
            {ghostFrames.map((frame, index) => {
                const ghostWidth = clampSize(frame?.width, runtimeState.width);
                const ghostHeight = clampSize(frame?.height, runtimeState.height);
                const ghostX = Number(frame?.x || 0);
                const ghostY = Number(frame?.y || 0);
                const ghostShape = normalizeShape(frame?.shape);
                const ghostColor = normalizeColor(frame?.borderColor ?? runtimeState.borderColor);
                const ghostRadiusClass = getShapeClass(ghostShape);
                const sx = runtimeState.width ? ghostWidth / runtimeState.width : 1;
                const sy = runtimeState.height ? ghostHeight / runtimeState.height : 1;
                const dx = ghostX - runtimeState.x;
                const dy = ghostY - runtimeState.y;
                const ghostLabel = String(data?.text || data?.customName || '').trim();

                return (
                    <div
                        key={`ghost_${frame?.id || index}`}
                        className={`pointer-events-none absolute inset-0 border-2 bg-white/35 dark:bg-slate-900/28 ${ghostRadiusClass}`}
                        style={{
                            borderColor: ghostColor,
                            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
                            opacity: 0.36,
                            zIndex: 0
                        }}
                    >
                        <div className="absolute inset-0 flex items-center justify-center">
                            {ghostLabel ? (
                                <span
                                    className="px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-100 text-center break-words max-w-[85%]"
                                    title={ghostLabel}
                                >
                                    {ghostLabel}
                                </span>
                            ) : (
                                <Circle size={14} style={{ color: ghostColor }} className="opacity-60" />
                            )}
                        </div>
                    </div>
                );
            })}

            <NodeResizer
                isVisible={selected}
                minWidth={24}
                minHeight={24}
                maxWidth={500}
                maxHeight={500}
                handleClassName="!w-2.5 !h-2.5 !rounded-sm !bg-sky-500 !border-none"
                lineClassName="!border-sky-400/80"
                onResizeEnd={(_event, params) => {
                    if (typeof onCommercialResize === 'function') {
                        onCommercialResize(id, {
                            x: Number.isFinite(Number(params?.x)) ? Math.round(Number(params.x)) : undefined,
                            y: Number.isFinite(Number(params?.y)) ? Math.round(Number(params.y)) : undefined,
                            width: Math.round(clampSize(params?.width, runtimeState.width)),
                            height: Math.round(clampSize(params?.height, runtimeState.height))
                        });
                    }
                }}
            />

            <Handle
                type="target"
                position={Position.Left}
                className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-none"
            />

            <div className="absolute inset-0 flex items-center justify-center">
                {showLabel ? (
                    <span
                        className="px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-100 text-center break-words max-w-[85%]"
                        title={showLabel}
                    >
                        {showLabel}
                    </span>
                ) : (
                    <Circle size={14} style={{ color: activeBorderColor }} className="opacity-60" />
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                id="default"
                className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-none"
            />
        </div>
    );
};
