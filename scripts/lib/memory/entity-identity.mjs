/** Stable identity helpers for derived indexes. */
export function entityId(entity, fallbackName = '') {
  if (typeof entity === 'string') return entity;
  if (!entity || typeof entity !== 'object') return fallbackName;
  if (entity.id != null && String(entity.id)) return String(entity.id);
  if (entity.entityId != null && String(entity.entityId)) return String(entity.entityId);
  const scope = entity.projectId ?? entity.project_id ?? entity.scope ?? entity.project;
  if (scope != null && String(scope)) return `${String(scope)}::${String(entity.name || fallbackName)}`;
  return String(entity.name || fallbackName);
}

export function entityLabel(entity, fallbackId = '') {
  if (entity && typeof entity === 'object' && entity.name != null) return String(entity.name);
  return String(fallbackId);
}
