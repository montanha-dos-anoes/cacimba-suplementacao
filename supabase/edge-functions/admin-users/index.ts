import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,40)
const pinPassword=(pin:string)=>`Cc${pin}`
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
 try{
  const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,auth=req.headers.get('Authorization')||''
  const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}})
  const {data:a,error:ae}=await admin.auth.getUser(auth.replace('Bearer ','')); if(ae||!a.user) throw new Error('Não autenticado')
  const {data:caller}=await admin.from('suplementacao_profiles').select('*').eq('id',a.user.id).single(); if(!caller?.active||caller?.deleted_at) throw new Error('Usuário inativo')
  const b=await req.json()
  if(b.action==='change_password'){
   if(caller.role==='owner') throw new Error('Use a senha normal do Proprietário')
   const pin=String(b.password||''); if(pin.length<4) throw new Error('O novo PIN deve ter pelo menos 4 caracteres')
   const {error:e}=await admin.auth.admin.updateUserById(a.user.id,{password:pinPassword(pin)}); if(e) throw e
   const {error:pe}=await admin.from('suplementacao_profiles').update({must_change_password:false,updated_at:new Date().toISOString()}).eq('id',a.user.id); if(pe) throw pe
   return json({ok:true})
  }
  if(caller.role!=='owner') throw new Error('Somente o Proprietário pode administrar usuários')
  if(b.action==='create'){
   const role=b.role==='admin'?'admin':'field',login=norm(String(b.login_name||'')),pin=String(b.password||''); if(!login||pin.length<4) throw new Error('Informe usuário e PIN de pelo menos 4 caracteres')
   const email=`${login}@cacimba.local`; const {data:c,error:e}=await admin.auth.admin.createUser({email,password:pinPassword(pin),email_confirm:true,user_metadata:{full_name:String(b.full_name||login)}}); if(e) throw e
   const {error:pe}=await admin.from('suplementacao_profiles').update({full_name:String(b.full_name||login),email,login_name:login,role,active:true,protected_owner:false,must_change_password:true,deleted_at:null,updated_at:new Date().toISOString()}).eq('id',c.user.id); if(pe) throw pe
   return json({ok:true,id:c.user.id,login_name:login})
  }
  if(b.action==='reset_password'){
   const pin=String(b.password||''); if(pin.length<4) throw new Error('O novo PIN provisório deve ter pelo menos 4 caracteres')
   const {data:t}=await admin.from('suplementacao_profiles').select('*').eq('id',b.user_id).single(); if(!t||t.deleted_at) throw new Error('Usuário não encontrado'); if(t.protected_owner) throw new Error('A senha do Proprietário protegido não pode ser redefinida por esta tela')
   const {error:e}=await admin.auth.admin.updateUserById(t.id,{password:pinPassword(pin)}); if(e) throw e
   const {error:pe}=await admin.from('suplementacao_profiles').update({must_change_password:true,updated_at:new Date().toISOString()}).eq('id',t.id); if(pe) throw pe
   return json({ok:true})
  }
  if(b.action==='toggle'){
   const {data:t}=await admin.from('suplementacao_profiles').select('*').eq('id',b.user_id).single(); if(!t||t.deleted_at) throw new Error('Usuário não encontrado'); if(t.protected_owner) throw new Error('O Proprietário protegido não pode ser desativado')
   const active=!t.active; const {error:pe}=await admin.from('suplementacao_profiles').update({active}).eq('id',t.id); if(pe) throw pe; return json({ok:true,active})
  }
  if(b.action==='role'){
   const {data:t}=await admin.from('suplementacao_profiles').select('*').eq('id',b.user_id).single(); if(!t||t.deleted_at) throw new Error('Usuário não encontrado'); if(t.protected_owner) throw new Error('O Proprietário protegido não pode ser alterado')
   const role=b.role==='admin'?'admin':'field'; const {error:pe}=await admin.from('suplementacao_profiles').update({role}).eq('id',t.id); if(pe) throw pe; return json({ok:true})
  }
  if(b.action==='delete'){
   const {data:t}=await admin.from('suplementacao_profiles').select('*').eq('id',b.user_id).single(); if(!t||t.deleted_at) throw new Error('Usuário não encontrado'); if(t.protected_owner) throw new Error('O Proprietário protegido não pode ser excluído')
   const deletedEmail=`deleted-${t.id}@cacimba.invalid`
   const randomPassword=crypto.randomUUID()+crypto.randomUUID()
   const {error:ae2}=await admin.auth.admin.updateUserById(t.id,{email:deletedEmail,password:randomPassword,ban_duration:'876000h',user_metadata:{full_name:t.full_name,deleted:true}}); if(ae2) throw ae2
   const {error:pe}=await admin.from('suplementacao_profiles').update({active:false,email:null,login_name:null,must_change_password:false,deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',t.id); if(pe) throw pe
   return json({ok:true})
  }
  throw new Error('Ação inválida')
 }catch(e){return json({ok:false,error:String(e?.message||e)},400)}
})
