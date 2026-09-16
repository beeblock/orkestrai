import { MAC_TEXT_EVENTS } from './mac-text-events.js';
import { macNativeSessionScript } from './mac-native-session.js';
import { MAC_AX_WINDOW_READ } from './mac-window-read.js';

// A bounded AX read uses local IPC, not one Apple Event per label. No screenshot,
// clipboard, browser profile, or third-party helper is involved.
const MAC_ACCESSIBILITY_HANDLER = String.raw`
ObjC.import('AppKit'); ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightPostEventAccess',['bool',[]]);
ObjC.bindFunction('CGEventKeyboardSetUnicodeString',['void',['void *','unsigned long','void *']]);
${MAC_TEXT_EVENTS}
${MAC_AX_WINDOW_READ}
function attr(element, name) {
  const out = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), out) === 0 ? out[0] : null;
}
function elementAttr(element, name) {
  const value = attr(element, name);
  // AX attributes return an opaque CFTypeRef, not an AXUIElementRef argument.
  return value ? ObjC.castRefToObject(value) : null;
}
function unwrap(value) { return value ? ObjC.deepUnwrap(ObjC.castRefToObject(value)) : null; }
function text(element, name, max, strict) { const v = unwrap(attr(element,name)); const s=typeof v==='string'||typeof v==='number'?String(v):'';if(strict&&s.length>max)throw new Error('element_changed');return s.slice(0,max); }
function children(element,attribute) {
  const value = attr(element,attribute||'AXChildren');
  if (!value) return [];
  const array = ObjC.castRefToObject(value);
  const result = [];
  for (let i=0;i<Math.min(Number(array.count),500);i++) result.push(array.objectAtIndex(i));
  return result;
}
function handleAccessibility(request) {
  let fileStage='';
  let actionRequest=false,inputAttempted=false;
  try {
    actionRequest=Boolean(request.action)&&!request.file;
    const match = request.targetId.match(/^([1-9]\d*):cg:([1-9]\d*)$/);
    if (!match || !$.AXIsProcessTrusted()) throw new Error('accessibility_unavailable');
    const pid = Number(match[1]), cgId = Number(match[2]);
    const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    if (!app || app.isNil() || app.bundleIdentifier.js !== request.appId) throw new Error('target_changed');
    const native = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0,0)))
      .find(w=>Number(w.kCGWindowOwnerPID)===pid && Number(w.kCGWindowNumber)===cgId);
    if (!native) throw new Error('target_changed');
    function matchesWindowBounds(w){
      const b=native.kCGWindowBounds,a=scopedAXBounds(w);
      return b&&a&&Math.abs(a.x-b.X)<=1&&Math.abs(a.y-b.Y)<=1&&Math.abs(a.width-b.Width)<=1&&Math.abs(a.height-b.Height)<=1;
    }
    const root = $.AXUIElementCreateApplication(pid);
    $.AXUIElementSetMessagingTimeout(root,0.25);
    const rawWindows=attr(root,'AXWindows');
    if (!rawWindows) throw new Error('accessibility_unavailable');
    const windows=ObjC.castRefToObject(rawWindows),matches=[];
    for(let i=0;i<Math.min(Number(windows.count),100);i++){
      const w=windows.objectAtIndex(i);
      if(matchesWindowBounds(w)&&(typeof native.kCGWindowName!=='string'||text(w,'AXTitle',1000)===native.kCGWindowName.slice(0,1000)))matches.push(w);
    }
    if(matches.length!==1)throw new Error('ambiguous_window');
    const window=matches[0];
    const title=text(window,'AXTitle',1000);
    function editorValue(element,role,strict){
      const value=text(element,'AXValue',20000,strict);
      // WhatsApp exposes an invisible marker after its auto-continued list prefix.
      // Strip only that formatting marker, never arbitrary invisible user content.
      return request.appId==='net.whatsapp.WhatsApp'&&role==='AXTextArea'
        ? value.replace(/^(\d{1,4}\. |[-*] )\u2060/gm,'$1') : value;
    }
    function verifyTarget(){
      const currentApp=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
      if(!currentApp||currentApp.isNil()||currentApp.bundleIdentifier.js!==request.appId)throw new Error('target_changed');
      const current=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0,0)))
        .find(w=>Number(w.kCGWindowOwnerPID)===pid&&Number(w.kCGWindowNumber)===cgId);
      if(!current||text(window,'AXRole',120)!=='AXWindow')throw new Error('target_changed');
    }
    function verifyFocus(){
      // Core Graphics returns on-screen windows front-to-back. Avoid synchronous
      // System Events round trips for every 20-character chunk, retaining PID/id/bounds checks.
      const front=$.NSWorkspace.sharedWorkspace.frontmostApplication;
      if(!front||Number(front.processIdentifier)!==pid)throw new Error('focus_changed');
      const list=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1,0)));
      const first=list.find(w=>Number(w.kCGWindowOwnerPID)===pid&&Number(w.kCGWindowLayer||0)===0);
      const current=list.find(w=>Number(w.kCGWindowOwnerPID)===pid&&Number(w.kCGWindowNumber)===cgId);
      // App-owned popovers can be the first CG window without changing the
      // focused AX document. AX proxies cannot reliably be compared with CFEqual.
      if(!first||!current)throw new Error('focus_changed');
      if(Number(first.kCGWindowNumber)!==cgId){
        const focused=elementAttr(root,'AXFocusedWindow'),overlay=first.kCGWindowBounds,base=current.kCGWindowBounds;
        let focusedOwner=focused,sameDocument=false;
        for(let depth=0;focusedOwner&&depth<6;depth++){
          if(text(focusedOwner,'AXRole',120)==='AXWindow'){
            sameDocument=text(focusedOwner,'AXTitle',1000)===title;break;
          }
          if(text(focusedOwner,'AXRole',120)!=='AXSheet')break;
          focusedOwner=elementAttr(focusedOwner,'AXParent');
        }
        const attachedSheet=sameDocument&&children(window).some(e=>text(e,'AXRole',120)==='AXSheet');
        const ownedPopover=sameDocument
          &&!first.kCGWindowName&&overlay&&base&&overlay.Width>0&&overlay.Height>0
          &&overlay.Width<base.Width&&overlay.Height<base.Height
          &&overlay.X>=base.X&&overlay.Y>=base.Y&&overlay.X+overlay.Width<=base.X+base.Width&&overlay.Y+overlay.Height<=base.Y+base.Height;
        if(!ownedPopover&&!attachedSheet)throw new Error('focus_changed');
      }
      const a=native.kCGWindowBounds,b=current.kCGWindowBounds;
      if(!a||!b||['X','Y','Width','Height'].some(k=>Math.abs(a[k]-b[k])>1))throw new Error('focus_changed');
    }
    const directed=request.background===true&&Boolean(request.action)&&!request.file;
    function verifyInteraction(){
      if(!directed){verifyFocus();return;}
      verifyTarget();
      const focused=elementAttr(root,'AXFocusedWindow');
      if(!focused||text(focused,'AXRole',120)!=='AXWindow'||text(focused,'AXTitle',1000)!==title||!matchesWindowBounds(focused)
        ||children(window).some(e=>text(e,'AXRole',120)==='AXSheet'))throw new Error('focus_changed');
    }
    // Reading and directed AX actions never activate/raise the application.
    verifyTarget();
    if(request.file)verifyFocus();
    if(request.action)verifyInteraction();
    function entry(element,id,strict){
      const role=text(element,'AXRole',120),subrole=text(element,'AXSubrole',120);
      const protectedValue=/Secure|Password/i.test(role+' '+subrole);
      const actions=[];
      if(!protectedValue){
        const names=Ref();if($.AXUIElementCopyActionNames(element,names)===0 && (unwrap(names[0])||[]).includes('AXPress'))actions.push('press');
        const settable=Ref();if($.AXUIElementIsAttributeSettable(element,$('AXValue'),settable)===0&&settable[0]&&/TextField|TextArea|ComboBox/.test(role))actions.push('fill');
      }
      return {id,role,name:protectedValue?'':text(element,'AXTitle',2000,strict)||text(element,'AXDescription',2000,strict),value:protectedValue?'':editorValue(element,role,strict),protected:protectedValue,enabled:unwrap(attr(element,'AXEnabled'))!==false,focused:unwrap(attr(element,'AXFocused'))===true,actions};
    }
    function resolve(selector){
      let element=window;
      for(const index of selector.id.split('.').slice(1)){element=children(element)[Number(index)];if(!element)throw new Error('element_changed');}
      const current=entry(element,selector.id,true);
      if(current.protected||!current.enabled||current.role!==selector.role||current.name!==selector.name||('value'in selector&&current.value!==selector.value))throw new Error('element_changed');
      return {element,current};
    }
    function resolveGuard(selector){
      try{return resolve(selector);}catch(error){
        if(error.message!=='element_changed'||selector.role!=='AXStaticText')throw error;
        // Growing chat editors virtualize the message list. Relocate only an
        // exact read-only text guard among its original siblings, never input targets.
        const parts=selector.id.split('.');parts.pop();let parent=window;
        for(const index of parts.slice(1)){parent=children(parent)[Number(index)];if(!parent)throw error;}
        const matches=[];const siblings=children(parent);
        for(let i=0;i<siblings.length;i++){
          const id=parts.join('.')+'.'+i,e=entry(siblings[i],id,true);
          if(e.role===selector.role&&e.name===selector.name&&(!('value'in selector)||e.value===selector.value)&&!e.protected&&e.enabled&&!e.actions.includes('fill'))matches.push({element:siblings[i],current:e});
        }
        if(matches.length!==1)throw error;
        selector.id=matches[0].current.id;return matches[0];
      }
    }
    if(request.file){
      if(typeof request.file.path!=='string'||!request.file.path.startsWith('/')||/[\r\n\u0000]/.test(request.file.path))throw new Error('file_dialog_invalid');
      const file=request.file;
      function foreground(){
        const front=$.NSWorkspace.sharedWorkspace.frontmostApplication;
        if(!front||Number(front.processIdentifier)!==pid)throw new Error('focus_changed');
      }
      function descendants(element,selection){
        const queue=[element],result=[],until=Date.now()+1500;
        while(queue.length){
          if(result.length>=500||Date.now()>until)throw new Error('file_dialog_ambiguous');
          const next=queue.shift();result.push(next);
          let nested=children(next);
          if(selection&&text(next,'AXRole',120)==='AXList')nested=children(next,'AXSelectedChildren');
          else if(selection&&!nested.length&&text(next,'AXRole',120)==='AXScrollArea')nested=children(next,'AXContents');
          queue.push.apply(queue,nested);
        }
        return result;
      }
      function waitFor(read){
        const until=Date.now()+2500;
        while(Date.now()<until){foreground();const result=read();if(result)return result;delay(0.04);}
        throw new Error('file_dialog_unavailable');
      }
      function sheet(parent){
        const found=children(parent).filter(e=>text(e,'AXRole',120)==='AXSheet');
        if(found.length>1)throw new Error('file_dialog_ambiguous');
        return found[0]||null;
      }
      function press(element){
        foreground();
        if(unwrap(attr(element,'AXEnabled'))===false||$.AXUIElementPerformAction(element,$('AXPress'))!==0)throw new Error('action_failed');
      }
      // Never type a path into a chat or an arbitrary frontmost window. Only a
      // sheet attached to this exact window may receive a file selection.
      if(sheet(window))throw new Error('file_dialog_already_open');
      for(const guard of request.guards)resolve(guard);
      const opener=resolve(file.open);
      if(!opener.current.actions.includes('press'))throw new Error('action_unavailable');
      verifyFocus();press(opener.element);
      if(file.menu){
        const findMenu=()=>{
          // Some native apps expose attachment menus as button popovers.
          // The exact owner-approved role/name must be unique in this window.
          const matches=descendants(window).filter(e=>text(e,'AXRole',120)===file.menu.role&&(text(e,'AXTitle',2000)||text(e,'AXDescription',2000))===file.menu.name);
          if(matches.length>1)throw new Error('file_dialog_ambiguous');
          return matches[0];
        };
        waitFor(findMenu);
        // AX exposes animated popover buttons before they accept activation.
        delay(0.18);
        const item=waitFor(findMenu);
        // Modal popovers can hide the conversation's AX subtree. Selecting a
        // file is not publication; revalidate the exact window now and the
        // conversation after the picker closes, before returning any preview.
        verifyFocus();
        press(item);
      }
      fileStage='open';
      const panel=waitFor(()=>sheet(window));
      if(sheet(panel))throw new Error('file_dialog_ambiguous');
      delay(0.15);
      if(!$.CGPreflightPostEventAccess())throw new Error('accessibility_unavailable');
      // Go to Folder is a system panel key equivalent, not editor text. AppKit
      // can ignore PID-posted command shortcuts while still accepting Unicode.
      verifyFocus();
      Application('System Events').keystroke('g',{using:['command down','shift down']});
      fileStage='location';
      const go=waitFor(()=>sheet(panel));
      const fields=descendants(go).filter(e=>text(e,'AXRole',120)==='AXTextField');
      if(fields.length!==1)throw new Error('file_dialog_ambiguous');
      const field=fields[0],goButton=elementAttr(go,'AXDefaultButton');
      const location=file.mode==='save'?file.path.slice(0,file.path.lastIndexOf('/')):file.path;
      function dialogKey(code,flags){
        verifyFocus();if(!sheet(window))throw new Error('file_dialog_invalid');
        for(const down of [true,false]){
          const event=$.CGEventCreateKeyboardEvent(null,code,down);
          $.CGEventSetFlags(event,flags||0);$.CGEventPost($.kCGHIDEventTap,event);
        }
      }
      if(unwrap(attr(field,'AXFocused'))!==true)$.AXUIElementSetAttributeValue(field,$('AXFocused'),$(true));
      if(unwrap(attr(field,'AXFocused'))!==true)throw new Error('file_dialog_invalid');
      dialogKey(0,$.kCGEventFlagMaskCommand);
      let typed='';
      fileStage='path';
      for(const chunk of unicodeChunks(location)){
        verifyFocus();if(!sheet(panel)||unwrap(attr(field,'AXFocused'))!==true)throw new Error('file_dialog_invalid');
        // macOS may host this sheet in its Open/Save XPC service. Posting to
        // the document PID misses that editor; target the guarded focused sheet.
        for(const event of unicodeEvents(chunk))$.CGEventPost($.kCGHIDEventTap,event);
        typed+=chunk;
        waitFor(()=>text(field,'AXValue',4096,true)===typed);
      }
      if(text(field,'AXValue',4096,true)!==location)throw new Error('file_dialog_invalid');
      // Current macOS Go to Folder sheets use Return instead of a Go button.
      if(goButton)press(goButton);else dialogKey(36,0);
      fileStage='navigation';
      waitFor(()=>!sheet(panel));
      // Confirm the selected URL, not merely a matching basename in another folder.
      if(file.mode==='save'){
        const names=descendants(panel).filter(e=>text(e,'AXRole',120)==='AXTextField');
        const filename=file.path.slice(file.path.lastIndexOf('/')+1);
        if(names.length!==1||!filename||$.AXUIElementSetAttributeValue(names[0],$('AXValue'),$(filename))!==0||text(names[0],'AXValue',4096,true)!==filename)throw new Error('file_dialog_invalid');
      }else {
        fileStage='selection';
        let expectedPath=file.path;
        try{expectedPath=$.NSURL.fileURLWithPath($(file.path)).URLByResolvingSymlinksInPath.path.js;}catch{}
        waitFor(()=>descendants(panel,true).some(e=>{
        try{
          if(unwrap(attr(e,'AXSelected'))!==true)return false;
          const raw=attr(e,'AXURL'),value=unwrap(raw);
          // NSURL file-reference URLs use /.file/id=...; resolve them through
          // Foundation, including /var -> /private/var, before full-path checks.
          const path=typeof value==='string'?decodeURIComponent(value.replace(/^file:\/\//,'')):raw&&ObjC.castRefToObject(raw).filePathURL.URLByResolvingSymlinksInPath.path.js;
          return typeof path==='string'&&path===expectedPath;
        }catch{return false;}
      }));}
      // Open may not be exposed as the default button until a valid selection.
      const confirm=elementAttr(panel,'AXDefaultButton');
      foreground();if(confirm)press(confirm);else dialogKey(36,0);
      fileStage='confirmation';
      waitFor(()=>!sheet(window));
      verifyFocus();
      // Open transitions to an attachment preview, which can replace the chat.
      // The media service validates that preview's recipient/file/Send before
      // publication. Save returns to the original incoming message instead.
      if(file.mode==='save')for(const guard of request.guards)resolveGuard(guard);
    }
    if(request.action){
      for(const guard of request.guards)resolve(guard);
      const target=resolve(request.element);
      if(!target.current.actions.includes(request.action))throw new Error('action_unavailable');
      verifyInteraction();
      let code;
      if(request.action==='fill'){
        if(!('value'in request.element)||typeof request.text!=='string')throw new Error('draft_guard_required');
        if(/[\r\t\u0000-\u0008\u000b-\u001f\u007f]/.test(request.text)||request.text.includes('\n')&&target.current.role!=='AXTextArea')throw new Error('action_unavailable');
        if(!$.CGPreflightPostEventAccess())throw new Error('accessibility_unavailable');
        // AXValue alone can display text without updating the app's composer/Send state.
        // Deliver text to the verified editor in this PID, never the global keyboard target.
        function editorOwnsInput(){
          if(!directed)return unwrap(attr(target.element,'AXFocused'))===true;
          const focused=elementAttr(root,'AXFocusedUIElement');
          return Boolean(focused&&$.CFEqual(focused,target.element));
        }
        if(!editorOwnsInput()){
          inputAttempted=true;
          $.AXUIElementSetAttributeValue(target.element,$('AXFocused'),$(true));
          const until=Date.now()+250;
          while(!editorOwnsInput()&&Date.now()<until){verifyInteraction();delay(0.01);}
          if(!editorOwnsInput()&&target.current.actions.includes('press')){
            verifyInteraction();for(const guard of request.guards)resolveGuard(guard);
            resolve(request.element);
            if($.AXUIElementPerformAction(target.element,$('AXPress'))!==0)throw new Error('action_failed');
          }
          const settled=Date.now()+250;
          while(!editorOwnsInput()&&Date.now()<settled){verifyInteraction();delay(0.01);}
        }
        function verifyEditor(expected){
          verifyInteraction();
          for(const guard of request.guards){if(guard.id!==request.element.id)resolveGuard(guard);}
          const e=entry(target.element,request.element.id,true);
          if(!editorOwnsInput()||e.protected||!e.enabled||e.role!==request.element.role||e.name!==request.element.name)throw new Error('focus_changed');
          if(e.value!==expected)throw new Error('element_changed');
        }
        function key(code,flags){
          inputAttempted=true;
          for(const down of [true,false]){
            const event=$.CGEventCreateKeyboardEvent(null,code,down);
            if(!event)throw new Error('action_failed');
            $.CGEventSetFlags(event,flags);$.CGEventPostToPid(pid,event);
          }
        }
        let expected=request.element.value;
        verifyEditor(expected);
        if(expected){key(0,$.kCGEventFlagMaskCommand);delay(0.03);verifyEditor(expected);}
        if(!request.text&&expected){key(51,0);expected='';}
        let inserted='';
        // Never post a newline as an unmodified Unicode key: chat apps may send it.
        while(inserted.length<request.text.length){
          const remaining=request.text.slice(inserted.length);
          const chunk=remaining[0]==='\n'?'\n':unicodeChunks(remaining.split('\n')[0])[0];
          verifyEditor(expected);
          if(chunk==='\n')key(36,$.kCGEventFlagMaskShift);
          else {inputAttempted=true;for(const event of unicodeEvents(chunk))$.CGEventPostToPid(pid,event);}
          inserted+=chunk;
          const until=Date.now()+500;
          while(Date.now()<until){
            const actual=editorValue(target.element,request.element.role,true);
            if(actual===inserted)break;
            const extra=actual.startsWith(inserted)?actual.slice(inserted.length):'';
            const previous=inserted.slice(0,-1).split('\n').pop().match(/^(\d{1,4})\. |^([-*]) /);
            const continuation=previous?(previous[1]?String(Number(previous[1])+1)+'. ':previous[2]+' '):'';
            if(chunk==='\n'&&request.appId==='net.whatsapp.WhatsApp'&&continuation&&extra===continuation&&request.text.startsWith(actual)){
              inserted=actual;break;
            }
            delay(0.01);
          }
          if(directed&&expected!==inserted&&editorValue(target.element,request.element.role,true)===expected
            &&Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)!==pid)throw new Error('background_input_unavailable');
          expected=inserted;verifyEditor(expected);
        }
        delay(0.03);verifyEditor(request.text);
        code=0;
      } else {inputAttempted=true;code=$.AXUIElementPerformAction(target.element,$('AXPress'));}
      if(code!==0)throw new Error('action_failed');
      // Observe immediately; absence of a changed UI is not a delivery claim.
    }
    const elements=[],queue=[{element:window,id:'0',depth:0}],deadline=Date.now()+1500;
    let truncated=false,characters=0;
    while(queue.length){
      if(elements.length>=500||Date.now()>deadline||characters>75000){truncated=true;break;}
      const next=queue.shift(),e=entry(next.element,next.id);elements.push(e);characters+=e.name.length+e.value.length;
      if(!e.protected&&next.depth<24){const list=children(next.element);for(let i=0;i<list.length;i++){if(queue.length+elements.length>=500){truncated=true;break;}queue.push({element:list[i],id:next.id+'.'+i,depth:next.depth+1});}}
      else if(next.depth>=24)truncated=true;
    }
    verifyTarget();
    if(request.file)verifyFocus();
    if(request.action)verifyInteraction();
    return JSON.stringify({available:true,truncated,elements});
  } catch(error) {
    const known=['accessibility_unavailable','target_changed','ambiguous_window','focus_changed','element_changed','background_input_unavailable','action_unavailable','draft_guard_required','action_failed','file_dialog_invalid','file_dialog_ambiguous','file_dialog_unavailable','file_dialog_already_open'];
    const failure=known.includes(error.message)?error.message:'accessibility_failed';
    return JSON.stringify({error:['file_dialog_unavailable','file_dialog_ambiguous'].includes(failure)&&fileStage?failure+'_'+fileStage:failure,...(actionRequest?{inputAttempted}:{})});
  }
}`;

export const MAC_ACCESSIBILITY_SCRIPT = MAC_ACCESSIBILITY_HANDLER + String.raw`
function run(){
  const data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  return handleAccessibility(JSON.parse($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js));
}`;
export const MAC_ACCESSIBILITY_SESSION_SCRIPT = macNativeSessionScript('handleAccessibility', MAC_ACCESSIBILITY_HANDLER);
