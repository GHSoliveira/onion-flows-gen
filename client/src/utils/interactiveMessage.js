const INTERACTIVE_MARKER = /^\s*\[\[INTERACTIVE\]\]\s*/i;

const cleanText = (value) => String(value ?? '').trim();

const normalizeSelectionValue = (value) => cleanText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('pt-BR');

const normalizeRows = (rows) => (Array.isArray(rows) ? rows : [])
  .map((row, index) => ({
    id: cleanText(row?.id) || `option_${index + 1}`,
    title: cleanText(row?.title),
    description: cleanText(row?.description)
  }))
  .filter((row) => row.title || row.id);

export const parseInteractiveMessage = (value) => {
  const source = String(value ?? '');
  if (!INTERACTIVE_MARKER.test(source)) return null;

  const jsonSource = source.replace(INTERACTIVE_MARKER, '').trim();
  if (!jsonSource) return null;

  try {
    const payload = JSON.parse(jsonSource);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

    const kind = cleanText(payload.kind).toUpperCase();
    if (kind !== 'LIST' && kind !== 'BUTTONS') return null;

    const sections = kind === 'LIST'
      ? (Array.isArray(payload?.list?.sections) ? payload.list.sections : [])
      .map((section, index) => ({
        id: cleanText(section?.id) || `section_${index + 1}`,
        title: cleanText(section?.title),
        rows: normalizeRows(section?.rows)
      }))
      .filter((section) => section.rows.length > 0)
      : [];
    const buttons = kind === 'BUTTONS' ? normalizeRows(payload.buttons) : [];

    return {
      kind,
      body: cleanText(payload.body),
      modal: cleanText(payload?.list?.modal) || 'Opções',
      sections,
      buttons
    };
  } catch {
    return null;
  }
};

const responseCandidates = (message) => [
  message?.text,
  message?.buttonText,
  message?.buttonId,
  message?.payload,
  message?.responsePayload,
  message?.meta?.buttonText,
  message?.meta?.buttonId,
  message?.meta?.payload,
  message?.meta?.responsePayload
]
  .map(normalizeSelectionValue)
  .filter(Boolean);

const isCustomerMessage = (message) => ['user', 'customer', 'client']
  .includes(cleanText(message?.sender).toLowerCase());

export const findInteractiveSelection = (interactive, messages, messageIndex) => {
  if (!interactive || !Array.isArray(messages) || !Number.isInteger(messageIndex)) return null;

  let customerResponse = null;
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (parseInteractiveMessage(candidate?.text)) break;
    if (isCustomerMessage(candidate)) {
      customerResponse = candidate;
      break;
    }
  }
  if (!customerResponse) return null;

  const candidates = new Set(responseCandidates(customerResponse));
  if (candidates.size === 0) return null;

  const optionGroups = interactive.kind === 'BUTTONS'
    ? [{ id: 'buttons', rows: interactive.buttons || [] }]
    : interactive.sections;

  for (const section of optionGroups) {
    const selectedRow = section.rows.find((row) => (
      candidates.has(normalizeSelectionValue(row.id))
      || candidates.has(normalizeSelectionValue(row.title))
    ));
    if (selectedRow) {
      return {
        ...selectedRow,
        sectionId: section.id,
        responseMessageId: customerResponse.id || customerResponse.messageId || null
      };
    }
  }

  return null;
};
