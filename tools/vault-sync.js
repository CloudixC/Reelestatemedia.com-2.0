/* Reel Estate Media: Vault sync.
   Runs inside the Command Centre (thecontenthub.ca) in the studio's own browser. It does two things:
   1. sends a full backup of the Command Centre data kept in this browser to the studio's Supabase project;
   2. works out which approved, final reels are not on reelestatemedia.com yet, and stores that list with the backup.
   It holds no secrets: the backup key and the Drive key are read from this browser's own storage.
   Rule: a file named "(web preview)" is a review copy and is never listed.
   Rule: a piece whose files are held until paid in the Command Centre is never listed either, approved or not (see unpaid below). */
(function(){
  var SUPA='https://bsfcjyddfcasatijyrdr.supabase.co', PUB='sb_publishable_FuuE3suWxjFo7UEcyie41g_mH40W82Y', SITE='https://reelestatemedia.com/';
  function driveId(u){var m=String(u||'').match(/\/(?:folders|file\/d)\/([-\w]{20,})/)||String(u||'').match(/[?&]id=([-\w]{20,})/);return m?m[1]:'';}
  function isFolder(u){return /\/drive\/(?:u\/\d+\/)?folders\//.test(String(u||''));}
  function inferMedia(t){t=(t||'').toLowerCase();var v=/reel|video|film|tour|b-roll|drone|cut|walkthrough|recap/.test(t),p=/photo|headshot|staging|sheet|floor plan/.test(t);if(v&&p)return 'both';if(p)return 'photo';return 'video';}
  function isPin(c){return c.tier==='partner'||c.tier==='internal'||/pinnacle/i.test(c.company||'');}
  /* Held until paid: the same rule as the Command Centre's lock (payLockWanted + lockOnFor in studio.html). The switch is on when Jag
     ticked it (payLock true), or by default for a client billed directly who is not on a monthly plan; it bites while the order is not
     marked Paid and owes something. Such a piece is off the review link and off the agent's hub, so it must stay off the site as well. */
  function unpaid(d,o,c){var want=d.payLock===true||(d.payLock!==false&&!isPin(c)&&!(c.tier==='unlimited'||c.tier==='package'));
    if(!want||o.payment==='paid')return false;return (o.items||[]).reduce(function(a,i){return a+(+i.price||0)*(+i.qty||0);},0)>0;}
  function clipBase(name){return String(name||'').replace(/\.[A-Za-z0-9]{2,4}$/,'').replace(/[\s_\-]*\(\d+\)$/,'').replace(/[\s_\-]+copy$/i,'')
    .replace(/[\s_\-]+(?:final|updated|revised|fixed|new)\d*$/i,'').replace(/([a-z0-9])V\d+(?:[\s_\-]?[A-Za-z])?$/,'$1')
    .replace(/[\s_\-]+v(?:er(?:sion)?)?[\s_\-]?\d+(?:[\s_\-]?[A-Za-z])?$/i,'').replace(/[\s_\-]+(?:final|updated|revised|fixed|new)\d*$/i,'').replace(/[\s_\-]+$/,'').toLowerCase();}
  function collapse(files){var newest={};files.forEach(function(f,ix){var b=clipBase(f.name),cur=newest[b],key=(f.t||'')+'|'+String(ix).padStart(4,'0');if(!cur||key>cur.key)newest[b]={key:key,id:f.id};});
    return files.filter(function(f){return newest[clipBase(f.name)].id===f.id;});}
  function finalSource(d,media,APPR){var vers=d.reviewVersions||[],src=(d.approved&&d.approved.src)||'';
    if(!src&&APPR[d.id]&&vers.length)src=vers[Math.min(APPR[d.id],vers.length)-1]||'';
    var first=String(src).split(',').map(function(p){return p.trim();}).filter(function(p){return /drive\.google|docs\.google/.test(p);})[0]||'';
    if(first&&/\/file\/d\//.test(first))return {file:driveId(first),folder:''};
    if(first&&isFolder(first))return {file:'',folder:driveId(first)};
    if(media==='video'&&/\/file\/d\//.test(d.link||''))return {file:driveId(d.link),folder:''};
    var folder=driveId(d.dlvFolderUrl||'')||(isFolder(d.link)?driveId(d.link):'');
    return {file:(!folder&&/\/file\/d\//.test(d.link||''))?driveId(d.link):'',folder:folder};}
  function sha(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(h){return Array.from(new Uint8Array(h)).map(function(x){return x.toString(16).padStart(2,'0');}).join('').slice(0,16);});}
  function rpc(fn,body){return fetch(SUPA+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:PUB,Authorization:'Bearer '+PUB,'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.text().then(function(t){if(!r.ok)throw new Error(fn+' '+r.status+' '+t.slice(0,120));return t;});});}

  async function collect(db,APPR,key,errors,heldOut){
    var out=[],seen={},heldIds={},cl={};(db.clients||[]).forEach(function(c){if(c)cl[c.id]=c;});var ord={};(db.orders||[]).forEach(function(o){ord[o.id]=o;});
    var api=function(u){return fetch(u).then(function(r){return r.json();});};
    for(const d of (db.deliverables||[])){
      var o=ord[d.orderId];if(!o)continue;var c=cl[o.clientId];if(!c||!c.name)continue;
      if(!(d.status==='Delivered'||d.approved||APPR[d.id]))continue;
      var media=d.mediaType||inferMedia((d.name||'')+' '+(d.group||''));if(media==='photo')continue;
      var hold=unpaid(d,o,c);
      var fs=finalSource(d,media,APPR),files=[];
      try{
        if(fs.file){var j=await api('https://www.googleapis.com/drive/v3/files/'+fs.file+'?fields=id,name,mimeType,createdTime&key='+encodeURIComponent(key));
          if(j.error){errors.push('file '+d.id+': '+(j.error.message||'').slice(0,60));continue;}
          if(/^video\//.test(j.mimeType||''))files=[{id:j.id,name:j.name,t:j.createdTime||''}];}
        else if(fs.folder){var q=await api('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent("'"+fs.folder+"' in parents and trashed=false")+'&key='+encodeURIComponent(key)+'&fields=files(id,name,mimeType,createdTime)&pageSize=200&orderBy=name');
          if(q.error){errors.push('folder '+d.id+': '+(q.error.message||'').slice(0,60));continue;}
          files=(q.files||[]).filter(function(f){return /^video\//.test(f.mimeType||'');}).map(function(f){return {id:f.id,name:f.name,t:f.createdTime||''};});}
      }catch(e){errors.push('drive '+d.id);continue;}
      var previews=files.filter(function(f){return /web\s*preview/i.test(f.name);}).length;
      files=collapse(files.filter(function(f){return !/web\s*preview/i.test(f.name);}));
      var co=isPin(c)?'P':/skyway/i.test(c.company||'')?'S':((c.company||'').trim()||'Independent');
      if(hold){files.forEach(function(f){if(heldIds[f.id])return;heldIds[f.id]=1;if(heldOut)heldOut.push({id:f.id,name:f.name,did:d.id,agent:c.name,title:(d.brief&&d.brief.topic)||d.name||'',project:o.project||d.group||''});});continue;}
      files.forEach(function(f){if(seen[f.id])return;seen[f.id]=1;
        out.push({id:f.id,name:f.name,did:d.id,agent:c.name,co:co,title:(d.brief&&d.brief.topic)||d.name||'',project:o.project||d.group||'',date:d.deliveredDate||d.shootDate||o.date||'',status:d.status||''});});
      if(!files.length&&previews)errors.push('preview only, not final: '+c.name+' / '+(d.name||''));
    }
    /* several pieces can share one delivery folder: a file that any held piece points at is held */
    return out.filter(function(f){return !heldIds[f.id];});}

  window.remVaultSync=async function(){
    var res={ok:false,backup:null,finals:0,fresh:0,held:0,unpaid:0,unpaidOnSite:[],errors:[]};
    var raw=localStorage.getItem('rem_pipeline_v1');if(!raw){res.errors.push('No Command Centre data in this browser.');return res;}
    var db=JSON.parse(raw),APPR={};try{APPR=JSON.parse(localStorage.getItem('vault_appr')||'{}')||{};}catch(e){}
    var bk=localStorage.getItem('rem_sbk_v1');if(!bk){res.errors.push('No backup key in this browser.');return res;}
    var publish=null,key=(db.settings||{}).driveApiKey||'';
    try{
      if(!key)throw new Error('No Drive key in settings');
      var man=await fetch(SITE+'media/vault/manifest.json?'+Date.now(),{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('manifest '+r.status);return r.json();});
      var heldFiles=[],finals=await collect(db,APPR,key,res.errors,heldFiles);res.finals=finals.length;res.unpaid=heldFiles.length;
      for(const hf of heldFiles){var hh=await sha(hf.id);hf.h=hh;hf.on=man.on[hh]||'';if(hf.on)res.unpaidOnSite.push(hf.on);}
      if(res.unpaidOnSite.length)res.errors.unshift('ON THE SITE but held until paid: '+res.unpaidOnSite.join(', '));
      if(heldFiles.length)res.errors.unshift('held until paid, not published: '+heldFiles.length+' file(s), '+heldFiles.slice(0,3).map(function(x){return x.agent;}).filter(function(x,i,a){return a.indexOf(x)===i;}).join(', '));
      var fresh=[];for(const f of finals){var h=await sha(f.id);if(man.on[h])continue;if(man.hold&&man.hold[h]){res.held++;continue;}f.h=h;fresh.push(f);}
      res.fresh=fresh.length;publish={at:new Date().toISOString(),finals:finals.length,fresh:fresh,unpaid:heldFiles,errors:res.errors.slice(0,40)};
    }catch(e){res.errors.push('publish list: '+String(e.message||e).slice(0,100));}
    var ls={};Object.keys(localStorage).forEach(function(k){if(k==='rem_sbk_v1'||k==='rem_pipeline_v1'||k==='beta:rem_pipeline_v1')return;if(/^(beta:)?(rem_|vault_)/.test(k))ls[k]=localStorage.getItem(k);});
    var beta=null;try{beta=JSON.parse(localStorage.getItem('beta:rem_pipeline_v1')||'null');}catch(e){}
    try{res.backup=+(await rpc('rem_cc_backup',{k:bk,device:'MacBook Chrome',data:{v:1,taken:new Date().toISOString(),origin:location.origin,pipeline:db,beta:beta,ls:ls,publish:publish}}));res.ok=!!publish;}
    catch(e){res.errors.push('backup: '+String(e.message||e).slice(0,100));}
    res.errors=res.errors.slice(0,6).map(function(x){return x.slice(0,70);});
    return res;};
  /* read-only: the files held until paid, and whether any of them is on the site already. Writes nothing. */
  window.remVaultHeld=async function(){
    var db=JSON.parse(localStorage.getItem('rem_pipeline_v1')||'{}'),APPR={};try{APPR=JSON.parse(localStorage.getItem('vault_appr')||'{}')||{};}catch(e){}
    var key=(db.settings||{}).driveApiKey||'',errs=[],heldFiles=[];if(!key)return {ok:false,error:'No Drive key in settings'};
    var man=await fetch(SITE+'media/vault/manifest.json?'+Date.now(),{cache:'no-store'}).then(function(r){return r.json();});
    var finals=await collect(db,APPR,key,errs,heldFiles),onSite=[];
    for(const hf of heldFiles){var hh=await sha(hf.id);if(man.on[hh])onSite.push({reel:man.on[hh],agent:hf.agent,title:hf.title});}
    return {ok:true,finals:finals.length,unpaid:heldFiles.length,unpaidList:heldFiles.map(function(x){return {agent:x.agent,title:x.title,project:x.project};}),unpaidOnSite:onSite};};
  /* after new reels are on the site: let the brokerage's library hand out the original file. rows: [{lib:'pinnacle',key:'v80',id:'<drive file id>'}] */
  window.remVaultLink=async function(rows){var bk=localStorage.getItem('rem_sbk_v1'),n=0,skip={};
    try{var db=JSON.parse(localStorage.getItem('rem_pipeline_v1')||'{}'),APPR={};try{APPR=JSON.parse(localStorage.getItem('vault_appr')||'{}')||{};}catch(e){}
      var hf=[];await collect(db,APPR,(db.settings||{}).driveApiKey||'',[],hf);hf.forEach(function(x){skip[x.id]=1;});}catch(e){}
    for(const r of rows){if(skip[r.id])continue;await rpc('rem_site_download',{k:bk,lib:r.lib,reel:r.key,file_id:r.id});n++;}return n;};
})();
