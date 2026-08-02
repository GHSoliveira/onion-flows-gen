import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../services/api';
import {
  Play,
  RefreshCcw,
  Send,
  Bot,
  User,
  Terminal,
  MessageSquare,
  Cpu,
  AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const ChatSimulator = () => {
  const [flows, setFlows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [activeFlow, setActiveFlow] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [sessionVars, setSessionVars] = useState({});
  const [userInput, setUserInput] = useState('');
  const [chatId, setChatId] = useState(null);
  const [currentCpf, setCurrentCpf] = useState(null);
  const [isClosed, setIsClosed] = useState(false);
  const [resumeTriggeredNode, setResumeTriggeredNode] = useState(null);
  const [chatMetadata, setChatMetadata] = useState(null);
  const chatEndRef = useRef(null);


  useEffect(() => {
    const loadData = async () => {
      try {
        const [f, t, s] = await Promise.all([
          apiRequest('/flows?limit=200&page=1'),
          apiRequest('/templates'),
          apiRequest('/schedules')
        ]);
        if (f && t && s) {
          const flowData = await f.json();
          const flowList = Array.isArray(flowData) ? flowData : (flowData?.items || []);
          setFlows(flowList);
          setTemplates(await t.json());
          setSchedules(await s.json());
        }
      } catch (e) { console.error(e); }
    };
    loadData();
  }, []);


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);





  const parseText = (text, vars) => {
    if (!text) return "";



    return text.replace(/\{([\w\.[\]]+)\}/g, (match, path) => {
      try {

        const keys = path.split(/[.[\]]/).filter(Boolean);
        let value = vars;


        for (const key of keys) {
          if (value === undefined || value === null) return match;
          value = value[key];
        }


        return value !== undefined ? String(value) : match;
      } catch (e) {
        return match;
      }
    });
  };
  const resolveVariables = (varMap, globalVars) => {
    const localContext = { ...globalVars };
    if (varMap && Array.isArray(varMap)) {
      varMap.forEach(mapping => {
        if (mapping.global && mapping.local) {

          localContext[mapping.local] = globalVars[mapping.global];
        }
      });
    }
    return localContext;
  };

  const DAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sábado'];

  const toMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
  };

  const isWithinRange = (nowMinutes, startMinutes, endMinutes) => {
    if (startMinutes === null || endMinutes === null) return false;
    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  };

  const isScheduleOpen = (schedule, reference = new Date()) => {
    if (!schedule || !schedule.rules) return false;
    const dayLabel = DAY_LABELS[reference.getDay()];
    const rule = schedule.rules[dayLabel];
    if (!rule || !rule.active) return false;
    const startMinutes = toMinutes(rule.start);
    const endMinutes = toMinutes(rule.end);
    const currentMinutes = reference.getHours() * 60 + reference.getMinutes();
    return isWithinRange(currentMinutes, startMinutes, endMinutes);
  };

  const addBotMessage = async (text, buttons = null, idChat) => {
    if (!idChat) return;
    setIsTyping(true);
    const res = await apiRequest(`/chats/${idChat}/messages`, {
      method: 'POST',
      body: JSON.stringify({ sender: 'bot', text, buttons })
    });
    const saved = await res.json();
    setMessages(prev => [...prev, saved]);
    setIsTyping(false);
  };

  const processNextNode = async (nodeId, flowData, currentVars, idChat) => {
    const node = flowData.nodes.find(n => n.id === nodeId);
    if (!node) return;



    const contextWithAlias = resolveVariables(node.data.varMap, currentVars);


    if (node.type === 'messageNode' || node.type === 'startNode') {
      if (node.data?.text && node.data.text !== "Início") {
        const text = parseText(node.data.text, contextWithAlias);
        await addBotMessage(text, null, idChat);
      }
      const edge = flowData.edges.find(e => e.source === nodeId);
      if (edge) {
        setTimeout(() => processNextNode(edge.target, flowData, currentVars, idChat), 1000);
      }
      return;
    }


    if (node.type === 'inputNode') {
      const questionText = parseText(node.data?.text || "Digite uma informação:", currentVars);
      await addBotMessage(questionText, null, idChat);
      setCurrentNodeId(node.id);
      return;
    }


    if (node.type === 'menuNode') {
      const menuText = parseText(node.data?.text || "Selecione uma opção:", currentVars);
      await addBotMessage(menuText, null, idChat);
      setCurrentNodeId(node.id);
      return;
    }

    if (node.type === 'templateNode') {
      const template = templates.find(t => t.id === node.data.templateId);
      if (template) {
        const text = parseText(template.text, currentVars);
        await addBotMessage(text, template.buttons, idChat);
        setCurrentNodeId(node.id);
      } else {
        console.error("Template não encontrado:", node.data.templateId);
      }
      return;
    }


    if (node.type === 'conditionNode') {
      let matchedHandleId = 'else';


      for (const cond of node.data.conditions || []) {

        const varValue = currentVars[cond.variable] !== undefined ? currentVars[cond.variable] : '';
        const condValue = cond.value;

        let isMatch = false;


        const v1 = String(varValue).trim().toLowerCase();
        const v2 = String(condValue).trim().toLowerCase();

        switch (cond.operator) {
          case '==': isMatch = v1 === v2; break;
          case '!=': isMatch = v1 !== v2; break;
          case '>': isMatch = Number(varValue) > Number(condValue); break;
          case '<': isMatch = Number(varValue) < Number(condValue); break;
          case 'contains': isMatch = v1.includes(v2); break;
          default: isMatch = v1 === v2;
        }

        if (isMatch) {
          matchedHandleId = String(cond.id);
          break;
        }
      }

      const edgesFromNode = flowData.edges.filter(e => e.source === nodeId);

      const edgeToCase = edgesFromNode.find(e => String(e.sourceHandle) === String(matchedHandleId));

      if (edgeToCase) {
        const caseNodeId = edgeToCase.target;

        const nextEdge = flowData.edges.find(e => e.source === caseNodeId);

        if (nextEdge) {
          processNextNode(nextEdge.target, flowData, currentVars, idChat);
        } else {
          console.warn("[CONDITION] O caminho condicional para", matchedHandleId, "não está conectado a nada.");

        }
      } else {
        console.error("[CONDITION] Nenhuma aresta encontrada para o handle:", matchedHandleId);
      }
      return;
    }


    if (node.type === 'scriptNode') {
      try {
        const execute = new Function('vars', `${node.data.script}; return vars;`);
        const updatedVars = execute({ ...currentVars });
        setSessionVars(updatedVars);
        await apiRequest(`/chats/${idChat}/vars`, { method: 'PUT', body: JSON.stringify(updatedVars) });

        const edge = flowData.edges.find(e => e.source === nodeId);
        if (edge) processNextNode(edge.target, flowData, updatedVars, idChat);
      } catch (e) {
        await addBotMessage(`⚠️ Erro no script: ${e.message}`, null, idChat);
      }
      return;
    }


    if (node.type === 'httpRequestNode') {
      const url = parseText(node.data.url, currentVars);
      try {

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const apiData = await res.json();
        let newVars = { ...currentVars };

        if (res.ok && node.data.mappings) {
          node.data.mappings.forEach(m => {
            let value = apiData;
            if (m.jsonPath && m.jsonPath !== '.') {
              m.jsonPath.split('.').forEach(key => { value = value ? value[key] : undefined; });
            }
            if (m.varName) newVars[m.varName] = value;
          });
          setSessionVars(newVars);
          await apiRequest(`/chats/${idChat}/vars`, { method: 'PUT', body: JSON.stringify(newVars) });
        }

        const status = res.ok ? 'success' : 'error';
        const edge = flowData.edges.find(e => e.source === nodeId && e.sourceHandle === status);
        if (edge) processNextNode(edge.target, flowData, newVars, idChat);
      } catch (e) {
        const errorEdge = flowData.edges.find(e => e.source === nodeId && e.sourceHandle === 'error');
        if (errorEdge) processNextNode(errorEdge.target, flowData, currentVars, idChat);
      }
      return;
    }


    if (node.type === 'scheduleNode') {
      const schedule = schedules.find(s => s.id === node.data.scheduleId);
      const isOpen = isScheduleOpen(schedule);
      const branch = isOpen ? 'inside' : 'outside';

      const childNode = flowData.nodes.find(n => n.id.startsWith(`child_${nodeId}_${branch}`));

      if (childNode) {
        const nextEdge = flowData.edges.find(e => e.source === childNode.id);
        if (nextEdge) {
          processNextNode(nextEdge.target, flowData, currentVars, idChat);
        } else {
          console.warn(`[SCHEDULE] Branch ${branch} não conectada após ${childNode.id}`);
        }
      } else {
        console.warn(`[SCHEDULE] Branch ${branch} não encontrada para o nó ${nodeId}`);
        const fallbackEdge = flowData.edges.find(e => e.source === nodeId);
        if (fallbackEdge) {
          const nextEdge = flowData.edges.find(e => e.source === fallbackEdge.target);
          if (nextEdge) {
            processNextNode(nextEdge.target, flowData, currentVars, idChat);
          }
        }
      }
      return;
    }


    if (node.type === 'setValueNode' || node.type === 'secretNode') {
      const newVars = { ...currentVars, [node.data.variableName]: node.data.value };
      setSessionVars(newVars);
      await apiRequest(`/chats/${idChat}/vars`, { method: 'PUT', body: JSON.stringify(newVars) });
      const edge = flowData.edges.find(e => e.source === nodeId);
      if (edge) processNextNode(edge.target, flowData, newVars, idChat);
      return;
    }


    if (node.type === 'delayNode') {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        const edge = flowData.edges.find(e => e.source === nodeId);
        if (edge) processNextNode(edge.target, flowData, currentVars, idChat);
      }, (parseInt(node.data.delay) || 1) * 1000);
      return;
    }


    if (node.type === 'gotoNode') {
      const targetAnchorName = node.data.targetAnchor;
      const anchorNode = flowData.nodes.find(n => n.type === 'anchorNode' && n.data.anchorName === targetAnchorName);
      if (anchorNode) {
        processNextNode(anchorNode.id, flowData, currentVars, idChat);
      } else {
        await addBotMessage(`⚠️ Erro: Âncora "${targetAnchorName}" não encontrada.`, null, idChat);
      }
      return;
    }

    if (node.type === 'anchorNode') {
      const edge = flowData.edges.find(e => e.source === nodeId);
      if (edge) processNextNode(edge.target, flowData, currentVars, idChat);
      return;
    }

    // caseNode é um nó intermediário criado para condições/templates
    // Ele apenas redireciona para o próximo nó
    if (node.type === 'caseNode') {
      const edge = flowData.edges.find(e => e.source === nodeId);
      if (edge) {
        processNextNode(edge.target, flowData, currentVars, idChat);
      }
      return;
    }

    if (node.type === 'queueNode') {
      const queue = node.data.queueName;
      const nextEdge = flowData.edges.find(e => e.source === nodeId);
      const resumeNodeId = nextEdge ? nextEdge.target : null;
      const waitMessage = node.data?.queueMessage || `Aguarde, em alguns instantes um especialista deve te atender.`;
      await addBotMessage(waitMessage, null, idChat);
      await apiRequest('/chats/transfer', {
        method: 'POST',
        body: JSON.stringify({
          chatId: idChat,
          queue,
          reason: 'Fluxo automático',
          continueFlow: node.data.continueFlowAfterQueue ?? true,
          resumeNodeId
        })
      });

      return;
    }


    if (node.type === 'endNode' || node.type === 'finalNode') {
      const finalMessage = node.data.text || "Atendimento finalizado. Obrigado!";
      await addBotMessage(finalMessage, null, idChat);
      await apiRequest(`/chats/${idChat}/close`, { method: 'PUT', body: JSON.stringify({ continueFlow: false }) });
      setIsClosed(true);
      return;
    }
  };

  const resumeFlow = async (nodeId, chatVars) => {
    if (!nodeId || !activeFlow || !chatId) return;

    try {
      setResumeTriggeredNode(nodeId);
      setIsClosed(false);
      const varsToUse = chatVars || sessionVars;
      await processNextNode(nodeId, activeFlow, varsToUse, chatId);
      await apiRequest(`/chats/${chatId}/resume`, { method: 'POST' });
    } catch (error) {
      console.error("[RESUME] erro ao retomar fluxo:", error);
    }
  };



  const startSimulation = async () => {
    if (!selectedFlowId) return toast.error("Selecione um fluxo");

    const fRes = await apiRequest(`/flows/${selectedFlowId}`);
    const flow = await fRes.json();
    const publishedFlow = flow.published;

    if (!publishedFlow || !publishedFlow.nodes || publishedFlow.nodes.length === 0) {
      return toast.error("Este fluxo não foi PUBLICADO.");
    }

    const simCpf = `sim_${Date.now()}`;
    setCurrentCpf(simCpf);

    const cRes = await apiRequest('/chats/init', { method: 'POST', body: JSON.stringify({ customerCpf: simCpf }) });
    const chat = await cRes.json();

    setChatId(chat.id);
    setMessages([]);
    setSessionVars({});
    setActiveFlow(publishedFlow);
    setCurrentNodeId(null);
    setIsClosed(false);
    setChatMetadata(chat);

    const startNode = publishedFlow.nodes.find(n => n.type === 'startNode');
    if (startNode) processNextNode(startNode.id, publishedFlow, {}, chat.id);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (isClosed || !userInput.trim() || !chatId) return;

    const text = userInput;
    setUserInput('');


    await apiRequest(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ sender: 'user', text })
    });
    setMessages(prev => [...prev, { sender: 'user', text, timestamp: new Date() }]);


    if (currentNodeId) {
      const node = activeFlow.nodes.find(n => n.id === currentNodeId);

      if (node?.type === 'menuNode') {
        const options = Array.isArray(node.data?.options) ? node.data.options : [];
        const normalized = text.trim().toLowerCase();
        let selected = null;

        if (/^\d+$/.test(normalized)) {
          const index = Number(normalized) - 1;
          selected = options[index] || null;
        }
        if (!selected) {
          selected = options.find(opt => String(opt.id || '').toLowerCase() === normalized) || null;
        }
        if (!selected) {
          selected = options.find(opt => String(opt.label || '').toLowerCase() === normalized) || null;
        }

        if (!selected) {
          const elseEdge = activeFlow.edges.find(e => e.source === currentNodeId && e.sourceHandle === 'else');
          if (elseEdge) {
            const elseNode = activeFlow.nodes.find(n => n.id === elseEdge.target);
            if (elseNode) {
              const nextEdge = activeFlow.edges.find(e => e.source === elseNode.id);
              if (nextEdge) {
                setCurrentNodeId(null);
                processNextNode(nextEdge.target, activeFlow, sessionVars, chatId);
                return;
              }
            }
          }
          const errorMsg = node.data?.invalidSelectionMessage || 'Selecione uma opção válida.';
          await addBotMessage(errorMsg, null, chatId);
          return;
        }

        let newVars = { ...sessionVars };
        if (node.data?.setVarEnabled && node.data?.variableName) {
          newVars[node.data.variableName] = selected.value ?? selected.label ?? selected.id;
          setSessionVars(newVars);
          await apiRequest(`/chats/${chatId}/vars`, {
            method: 'PUT',
            body: JSON.stringify(newVars)
          });
        }

        let edgeToCase = activeFlow.edges.find(e =>
          e.source === currentNodeId && String(e.sourceHandle) === String(selected.id)
        );
        if (!edgeToCase) {
          edgeToCase = activeFlow.edges.find(e => e.source === currentNodeId);
        }
        if (edgeToCase) {
          const caseNodeId = edgeToCase.target;
          const edgeFromCase = activeFlow.edges.find(e => e.source === caseNodeId);
          if (edgeFromCase) {
            setCurrentNodeId(null);
            processNextNode(edgeFromCase.target, activeFlow, newVars, chatId);
          }
        }
        return;
      }

      if (node?.type === 'inputNode') {
        const varName = node.data.variableName;

        if (varName) {

          const newVars = { ...sessionVars, [varName]: text };
          setSessionVars(newVars);

          await apiRequest(`/chats/${chatId}/vars`, {
            method: 'PUT',
            body: JSON.stringify(newVars)
          });


          const edge = activeFlow.edges.find(e => e.source === currentNodeId);

          if (edge) {
            setCurrentNodeId(null);

            processNextNode(edge.target, activeFlow, newVars, chatId);
          } else {
            console.warn("Usuário respondeu, mas não há conexão saindo do nó de Input.");
          }
        } else {
          toast.error("Erro: Este nó de input não tem uma variável destino configurada.");
        }
      }
    }
  };

  const handleButtonClick = async (btnId, label) => {
    if (isClosed || !chatId || !currentNodeId) return;




    let edgeToCase = activeFlow.edges.find(e =>
      e.source === currentNodeId && e.sourceHandle === btnId
    );


    if (!edgeToCase) {
      console.warn("Conexão exata não encontrada. Tentando busca por ordem...");
      edgeToCase = activeFlow.edges.find(e => e.source === currentNodeId);
    }

    if (edgeToCase) {
      const caseNodeId = edgeToCase.target;


      const edgeFromCase = activeFlow.edges.find(e => e.source === caseNodeId);

      if (edgeFromCase) {

        setMessages(prev => [...prev, { sender: 'user', text: label, timestamp: new Date() }]);
        await apiRequest(`/chats/${chatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ sender: 'user', text: label })
        });

        setCurrentNodeId(null);
        processNextNode(edgeFromCase.target, activeFlow, sessionVars, chatId);
      } else {
        toast.error("Este caminho não foi concluído no editor.");
      }
    } else {
      console.error("ERRO CRÍTICO: Nenhuma aresta saindo de", currentNodeId);
      toast.error("Erro de conexão no fluxo. Re-salve o fluxo no editor.");
    }
  };



  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;
    let isPolling = false;

    const pollData = async () => {
      if (isPolling || !isMounted || isClosed || !chatId || !currentCpf) {
        return;
      }

      isPolling = true;

      try {
        // Usar /chats/:id para buscar mensagens do chat
        const res = await apiRequest(`/chats/${chatId}`);

        if (res && res.ok && isMounted) {
          const chatData = await res.json();

          if (chatData.status === 'closed') {
            setIsClosed(true);
            setMessages(chatData.messages || []);
            isPolling = false;
            return;
          }

          if (chatData.messages) {
            setMessages(chatData.messages);
          }

          if (chatData.vars) {
            setSessionVars(chatData.vars);
          }

          if (chatData.resumePending && chatData.resumeNodeId && activeFlow && chatData.resumeNodeId !== resumeTriggeredNode) {
            setMessages(chatData.messages || []);
            await resumeFlow(chatData.resumeNodeId, chatData.vars);
          }
          setChatMetadata(chatData);
        }
      } catch (e) {
        console.error("[POLL] Erro:", e.message);
      }

      isPolling = false;

      if (isMounted && !isClosed) {
        timeoutId = setTimeout(pollData, 2000);
      }
    };

    // Iniciar polling após 1 segundo
    timeoutId = setTimeout(pollData, 1000);

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [chatId, isClosed, currentCpf]);

  return (
    <main className="content min-h-screen flex flex-col p-3 sm:p-4 lg:p-6 overflow-hidden bg-gray-50 dark:bg-gray-900">

      { }
      <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm mb-4 lg:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
            <Cpu size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Simulador de Chatbot</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Ambiente de teste controlado.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="p-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-gray-700 dark:text-gray-200 w-full sm:w-auto"
            value={selectedFlowId}
            onChange={e => setSelectedFlowId(e.target.value)}
          >
            <option value="">Selecione um fluxo...</option>
            {flows.map(f => <option key={f.id} value={f.id}>{f.name} {f.published ? '✅' : '📝'}</option>)}
          </select>

          <button
            onClick={startSimulation}
            disabled={!selectedFlowId}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm w-full sm:w-auto justify-center"
          >
            <Play size={16} /> Iniciar Sessão
          </button>

          {chatId && (
            <button
              onClick={() => { setMessages([]); setChatId(null); setIsClosed(false); }}
              className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-200 dark:border-gray-600"
              title="Resetar"
            >
              <RefreshCcw size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row gap-4 lg:gap-6 min-h-0">
 
        <div className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 p-4 lg:p-6 overflow-y-auto space-y-4 bg-gray-50/50 dark:bg-gray-900/50 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
            {messages.length === 0 && !chatId && (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Bot size={64} className="mb-4 opacity-20" />
                <p className="text-sm">Selecione um fluxo acima e clique em iniciar.</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : m.sender === 'system'
                    ? 'bg-transparent text-gray-500 text-xs text-center w-full shadow-none italic'
                    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-bl-sm'
                  }`}>
                  {m.sender !== 'system' && (
                    <div className={`text-[10px] font-bold mb-1 uppercase tracking-wide flex items-center gap-1 ${m.sender === 'user' ? 'text-blue-100' : 'text-gray-400'
                      }`}>
                      {m.sender === 'bot' ? <Bot size={12} /> : <User size={12} />}
                      {m.sender}
                    </div>
                  )}

                  {m.text}

                  {m.buttons && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.buttons.map(b => (
                        <button
                          key={b.id}
                          onClick={() => handleButtonClick(b.id, b.label)}
                          disabled={isClosed}
                          className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-xs font-medium rounded-full border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSend} className="p-3 sm:p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <input
              className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800 text-gray-900 dark:text-white"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              placeholder={isClosed ? "Atendimento encerrado." : "Digite sua mensagem..."}
              disabled={!chatId || isClosed}
            />
            <button
              type="submit"
              disabled={!chatId || isClosed}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Send size={20} />
            </button>
          </form>
        </div>
 
        <div className="w-full lg:w-80 bg-[#0f172a] rounded-xl border border-gray-800 flex flex-col overflow-hidden shadow-lg">
          <div className="p-4 border-b border-gray-800 bg-[#1e293b] flex items-center gap-2 text-gray-200">
            <Terminal size={16} className="text-green-400" />
            <span className="text-xs font-mono font-bold tracking-wider">MEMORY_DUMP</span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-gray-400 space-y-4 scrollbar-thin scrollbar-thumb-gray-700">
            <div>
              <div className="text-gray-500 mb-1">
                <div className="text-blue-400 break-all">{chatId || 'null'}</div>
                {currentCpf && (
                  <div className="text-green-400 mt-1">CPF: {currentCpf}</div>
                )}
              </div>
              {chatMetadata && (
                <div className="text-[11px] text-gray-400 space-y-1">
                  <div>Em espera de: <span className="text-white">{chatMetadata.queue || '---'}</span></div>
                  <div>Agente responsável: <span className="text-blue-300">{chatMetadata.agentName || 'Aguardando agente'}</span></div>
                  <div>Status: <span className="text-green-300">{chatMetadata.status || 'Aguardando'}</span></div>
                </div>
              )}
            </div>

          <div>
            <div className="text-gray-500 mb-2">
              {Object.keys(sessionVars).length === 0 ? (
                <span className="text-gray-600 italic">empty</span>
              ) : (
                Object.entries(sessionVars).map(([key, val]) => (
                  <div key={key} className="flex gap-2 mb-1">
                    <span className="text-purple-400">{key}:</span>
                    <span className="text-yellow-300">"{String(val)}"</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {activeFlow && (
            <div>
              <div className="text-gray-500 mb-1">
                <div className="text-orange-400">{activeFlow.name}</div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
     </main>
  );
};
export default ChatSimulator;
