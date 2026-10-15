const ownKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const text = (s, max = 100) => typeof s === 'string' && s.length > 0 && s.length <= max;
const slot = o => ownKeys(o, ['slotId','version']) && text(o.slotId) && Number.isSafeInteger(o.version) && o.version >= 0;
const target = o => ownKeys(o, ['playerId','slotId','version']) && text(o.playerId) && text(o.slotId) && Number.isSafeInteger(o.version) && o.version >= 0;
export function validEnvelope(e) {
  if (!ownKeys(e, ['commandId','roundId','command']) || !text(e.commandId, 100) || !(e.roundId === null || text(e.roundId))) return false;
  const c = e.command;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const exact = keys => ownKeys(c, keys);
  if (c.type === 'READY') return exact(['type','ready']) && typeof c.ready === 'boolean';
  if (c.type === 'START') return exact(['type']);
  if (c.type === 'BURN') return exact(['type','burnId','own']) && text(c.burnId) && slot(c.own);
  if (!text(c.actionId)) return false;
  if (['DRAW_DECK','DRAW_FIRE','DISCARD_DRAWN','SKIP_POWER','CABO'].includes(c.type)) return exact(['type','actionId']);
  if (['TAKE_FIRE','REPLACE_DRAWN','POWER_7','POWER_10_SWAP'].includes(c.type)) return exact(['type','actionId','own']) && slot(c.own);
  if (['POWER_8','POWER_10_PEEK'].includes(c.type)) return exact(['type','actionId','target']) && target(c.target);
  if (c.type === 'POWER_9') return exact(['type','actionId','own','target']) && slot(c.own) && target(c.target);
  return false;
}
export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const result = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 24);
  return result.length > 0 ? result : null;
}
