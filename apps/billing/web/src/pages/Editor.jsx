// Rich-text editor for blog posts (TipTap / ProseMirror). Accessible toolbar (arrow keys move between buttons), paste cleaning, library images, tables, code, YouTube.
import React,{useEffect,useRef,useState} from 'react';import {useEditor,EditorContent} from '@tiptap/react';import StarterKit from '@tiptap/starter-kit';import Image from '@tiptap/extension-image';
import {TableKit} from '@tiptap/extension-table';import Youtube from '@tiptap/extension-youtube';import {Placeholder} from '@tiptap/extensions';import {toast} from 'sonner';
import {Bold,Italic,Strikethrough,Heading2,Heading3,Heading4,List,ListOrdered,Quote,Link2,Image as Img,Table2,Code,SquareCode,SquarePlay as Yt,Undo2,Redo2,Eraser,Sparkles,Minus,Rows3,Columns3,Trash2} from 'lucide-react';
import {cleanPaste} from '../paste.js';import {api} from '../lib.js';import {Button,Input,Field,Sheet,cn} from '../ui.jsx';
export function LibraryPicker({open,onClose,onPick,needAlt=true}){const[l,setL]=useState(null);const[sel,setSel]=useState(null);const[alt,setAlt]=useState('');
 useEffect(()=>{if(open){setSel(null);setAlt('');api('/files?client=null').then(x=>setL(x.filter(f=>f.image))).catch(e=>toast.error(e.message))}},[open]);
 return <Sheet wide open={open} onOpenChange={o=>!o&&onClose()} title="Pick an image from Files" desc="Only images in your Files library are shown. Add new images on the Files page."
  footer={<><Button v="secondary" onClick={onClose}>Cancel</Button><Button disabled={!sel||(needAlt&&!alt.trim())} onClick={()=>onPick({...sel,alt:alt.trim()})}>Use image</Button></>}>
  {sel&&<Field label="Describe the image for screen readers (alt text) *" hint="What a blind reader needs to know, e.g. “Red 1:24 scale Ferrari model on a shelf”."><Input autoFocus value={alt} onChange={e=>setAlt(e.target.value)} maxLength={300}/></Field>}
  {!l?<p className="text-muted">Loading…</p>:!l.length?<p className="text-muted">No images in your Files library yet.</p>:
  <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Images">{l.map(f=><li key={f.id}><button type="button" onClick={()=>{setSel(f);setAlt(a=>a||f.notes||'')}} aria-pressed={sel?.id===f.id}
   className={cn('w-full rounded-lg overflow-hidden border-2 transition cursor-pointer hover:-translate-y-0.5',sel?.id===f.id?'border-grid ring-2 ring-grid/30':'border-transparent')}><img src={f.url} alt="" className="w-full h-28 object-cover bg-slate-100"/><span className="block text-xs truncate p-1.5 text-left">{f.name}</span></button></li>)}</ul>}
 </Sheet>}
function Tb({on,label,icon:I,onClick,disabled}){return <button type="button" aria-label={label} title={label} aria-pressed={on===undefined?undefined:!!on} disabled={disabled} onClick={onClick} onMouseDown={e=>e.preventDefault()}
 className={cn('h-8 w-8 grid place-items-center rounded-md transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-default',on?'bg-grid/15 text-grid':'hover:bg-slate-100')}><I size={16}/></button>}
const Sep=()=><span role="separator" aria-orientation="vertical" className="w-px h-5 bg-line mx-1"/>;
export default function Editor({value,onChange,aiTidy,label='Post body'}){const[pick,setPick]=useState(false);const[busy,setBusy]=useState(false);const tb=useRef();
 const ed=useEditor({immediatelyRender:true,shouldRerenderOnTransaction:true,
  extensions:[StarterKit.configure({heading:{levels:[2,3,4]},link:{openOnClick:false,autolink:true,defaultProtocol:'https',HTMLAttributes:{rel:'noopener noreferrer',target:null}}}),
   Image.configure({inline:false}),TableKit.configure({table:{resizable:false}}),Youtube.configure({nocookie:true,controls:true,modestBranding:true,width:640,height:360}),Placeholder.configure({placeholder:'Start writing, or paste from Word or Google Docs…'})],
  content:value||'',editorProps:{attributes:{class:'pg-prose px-4 py-3','role':'textbox','aria-multiline':'true','aria-label':label},transformPastedHTML:cleanPaste},
  onUpdate:({editor})=>onChange(editor.isEmpty?'':editor.getHTML())});
 useEffect(()=>{if(ed&&value!==undefined&&value!==(ed.isEmpty?'':ed.getHTML()))ed.commands.setContent(value||'',{emitUpdate:false})},[value,ed]);
 if(!ed)return null;const c=()=>ed.chain().focus();
 const link=()=>{const prev=ed.getAttributes('link').href||'';const u=window.prompt('Link address (leave empty to remove the link)',prev);if(u===null)return;if(!u.trim())return c().extendMarkRange('link').unsetLink().run();
  const href=/^(https?:|mailto:|tel:|\/|#)/i.test(u.trim())?u.trim():'https://'+u.trim();c().extendMarkRange('link').setLink({href}).run()};
 const yt=()=>{const u=window.prompt('YouTube video link');if(!u)return;if(!/youtu(\.be|be\.com)/.test(u))return toast.error('That is not a YouTube link');c().setYoutubeVideo({src:u.trim()}).run()};
 const tidy=()=>{setBusy(true);api('/blog/tidy',{method:'POST',body:{html:ed.getHTML()}}).then(r=>{ed.commands.setContent(r.html);onChange(r.html);toast.success('Tidied. Use Undo if you prefer the old version.')}).catch(e=>toast.error(e.message)).finally(()=>setBusy(false))};
 const strip=()=>{const h=cleanPaste(ed.getHTML());ed.commands.setContent(h);onChange(h);toast.success('Formatting cleaned')};
 const inT=ed.isActive('table');
 // roving arrow keys inside the toolbar
 const keys=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const b=[...tb.current.querySelectorAll('button:not(:disabled)')];const i=b.indexOf(document.activeElement);if(i<0)return;e.preventDefault();
  const n=e.key==='Home'?0:e.key==='End'?b.length-1:(i+(e.key==='ArrowRight'?1:-1)+b.length)%b.length;b[n].focus()};
 return <div className="rounded-xl border border-line bg-white focus-within:border-grid focus-within:ring-2 focus-within:ring-grid/20 transition">
  <div ref={tb} role="toolbar" aria-label="Formatting" onKeyDown={keys} className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-line bg-white/95 backdrop-blur rounded-t-xl">
   <Tb label="Heading 2" icon={Heading2} on={ed.isActive('heading',{level:2})} onClick={()=>c().toggleHeading({level:2}).run()}/><Tb label="Heading 3" icon={Heading3} on={ed.isActive('heading',{level:3})} onClick={()=>c().toggleHeading({level:3}).run()}/><Tb label="Heading 4" icon={Heading4} on={ed.isActive('heading',{level:4})} onClick={()=>c().toggleHeading({level:4}).run()}/><Sep/>
   <Tb label="Bold (Ctrl+B)" icon={Bold} on={ed.isActive('bold')} onClick={()=>c().toggleBold().run()}/><Tb label="Italic (Ctrl+I)" icon={Italic} on={ed.isActive('italic')} onClick={()=>c().toggleItalic().run()}/><Tb label="Strikethrough" icon={Strikethrough} on={ed.isActive('strike')} onClick={()=>c().toggleStrike().run()}/><Tb label="Link" icon={Link2} on={ed.isActive('link')} onClick={link}/><Sep/>
   <Tb label="Bullet list" icon={List} on={ed.isActive('bulletList')} onClick={()=>c().toggleBulletList().run()}/><Tb label="Numbered list" icon={ListOrdered} on={ed.isActive('orderedList')} onClick={()=>c().toggleOrderedList().run()}/><Tb label="Quote" icon={Quote} on={ed.isActive('blockquote')} onClick={()=>c().toggleBlockquote().run()}/><Tb label="Inline code" icon={Code} on={ed.isActive('code')} onClick={()=>c().toggleCode().run()}/><Tb label="Code block" icon={SquareCode} on={ed.isActive('codeBlock')} onClick={()=>c().toggleCodeBlock().run()}/><Tb label="Divider line" icon={Minus} onClick={()=>c().setHorizontalRule().run()}/><Sep/>
   <Tb label="Image from Files" icon={Img} onClick={()=>setPick(true)}/><Tb label="YouTube video" icon={Yt} onClick={yt}/><Tb label={inT?'Delete table':'Insert table'} icon={inT?Trash2:Table2} onClick={()=>inT?c().deleteTable().run():c().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}/>
   {inT&&<><Tb label="Add row below" icon={Rows3} onClick={()=>c().addRowAfter().run()}/><Tb label="Add column right" icon={Columns3} onClick={()=>c().addColumnAfter().run()}/></>}<Sep/>
   <Tb label="Undo" icon={Undo2} disabled={!ed.can().undo()} onClick={()=>c().undo().run()}/><Tb label="Redo" icon={Redo2} disabled={!ed.can().redo()} onClick={()=>c().redo().run()}/><Tb label="Clean Word / Google Docs formatting" icon={Eraser} onClick={strip}/>
   <span className="ml-auto"><button type="button" onClick={tidy} disabled={!aiTidy||busy} title={aiTidy?'Tidy structure with AI (keeps your words)':'Tidy with AI is not switched on yet'} aria-label={aiTidy?'Tidy with AI':'Tidy with AI (not switched on yet)'}
    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-medium text-grid hover:bg-grid/10 disabled:text-muted disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"><Sparkles size={15} className={busy?'animate-pulse':''}/>{busy?'Tidying…':'Tidy with AI'}</button></span>
  </div>
  <EditorContent editor={ed}/>
  <div className="px-4 py-1.5 border-t border-line text-xs text-muted flex justify-between" aria-live="polite"><span>Pasting from Word or Google Docs is cleaned automatically.</span><span className="num">{ed.storage.characterCount?.words?.()??ed.getText().split(/\s+/).filter(Boolean).length} words</span></div>
  <LibraryPicker open={pick} onClose={()=>setPick(false)} onPick={f=>{setPick(false);c().setImage({src:'/api/files/'+f.id,alt:f.alt}).run()}}/>
 </div>}
