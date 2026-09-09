import { createHash } from 'node:crypto';
import { safeMetadata } from './redactor.mjs';
export function fingerprint(metadata){const m=safeMetadata(metadata);return createHash('sha256').update(['v1-metadata',m.component,m.phase,m.category,m.code,metadata.projectId??'global'].join('|')).digest('hex');}
