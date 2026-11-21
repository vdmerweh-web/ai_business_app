import {createContext,useContext} from 'react';
export const Data=createContext({});export const useData=()=>useContext(Data);
export const go=(page,id)=>{location.hash='/'+page+(id?'/'+id:'')};
export const Me=createContext(null);export const useMe=()=>useContext(Me);
const LV={none:0,read:1,edit:2,delete:3};
export const can=(me,t,l='read')=>LV[me?.perms?.[t]||'none']>=LV[l];
export const useCan=()=>{const me=useMe();return (t,l)=>can(me,t,l)};
