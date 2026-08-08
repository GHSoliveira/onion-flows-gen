export const normalizeIxcOsAlertText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const isClosedOrder = (order) => (
  /(FINALIZ|ENCERR|FECHAD|CANCEL)/.test(normalizeIxcOsAlertText(order?.status))
);

const uniqueSubjects = (orders) => Array.from(new Set(
  orders
    .map((order) => String(order?.subject || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
));

export const summarizeIxcOsAlerts = (details) => {
  const orders = Array.isArray(details?.osList) ? details.osList : [];
  const openOrders = orders.filter((order) => order?.osId && !isClosedOrder(order));
  const scheduledOrders = openOrders.filter((order) => (
    /\bAGENDAD[AO]S?\b/.test(normalizeIxcOsAlertText(order?.status))
  ));
  const openPreOrders = openOrders.filter((order) => (
    /^PRE(?:\s|[-–—.]|$)/.test(normalizeIxcOsAlertText(order?.subject))
  ));

  return {
    scheduled: {
      count: scheduledOrders.length,
      subjects: uniqueSubjects(scheduledOrders),
    },
    openPre: {
      count: openPreOrders.length,
      subjects: uniqueSubjects(openPreOrders),
    },
  };
};
