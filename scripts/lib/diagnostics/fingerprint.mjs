import { createHash } from 'node:crypto';
import { safeMetadata } from './redactor.mjs';
export function fingerprint(metadata){const m=safeMetadata(metadata);return createHash('sha256').update(['v2-safe-cause',m.component,m.operation,m.phase,m.category,m.errorName,m.code,m.signature,JSON.stringify(m.frames),metadata.projectId??'global'].join('|')).digest('hex');}
