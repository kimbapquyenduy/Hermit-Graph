import {randomBytes} from 'node:crypto';
// RFC 9562: 48-bit millisecond timestamp, version 7, RFC variant, random tail.
export function uuidV7(now=Date.now()){
 const bytes=randomBytes(16);bytes.writeUIntBE(now,0,6);bytes[6]=(bytes[6]&15)|112;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
