import {withContext,currentContext} from './context.mjs';
import {faultMaterial} from './fault-material.mjs';
/** Preserve synchronous APIs; defer one failure write until the outer transaction unwinds. */
export function withOperation(operation,component,fn){
 const parent=currentContext();
 return withContext(()=>{
  const context=currentContext();context.projectId=parent.projectId??null;context.faultOptions=parent.faultOptions;
  const failed=error=>{parent.childFailure=context.childFailure??{metadata:faultMaterial(error,{...context.faultOptions,operation,component}),context:{...context}};throw error;};
  try{const value=fn();return value&&typeof value.then==='function'?value.catch(failed):value;}catch(error){return failed(error);}
 });
}
export function traceService(service,definitions){for(const [method,operation,component] of definitions){const original=service[method];if(typeof original!=='function')throw Error('Unknown span method');service[method]=function(...args){return withOperation(operation,component,()=>original.apply(this,args));};}return service;}
