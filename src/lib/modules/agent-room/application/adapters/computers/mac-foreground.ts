import { MAC_AX_WINDOW_READ } from './mac-window-read.js';
import { macNativeSessionScript } from './mac-native-session.js';
import { runNative } from './native-runner.js';
import { NativeInteractionError } from './native-interaction-error.js';
import type { ComputerForegroundLease } from './types.js';

// Receipts never leave this process or enter agent-visible state. Do not read the
// previous app's text, clipboard, screenshot or document title to restore focus.
export const MAC_FOREGROUND_HANDLER = String.raw`
${MAC_AX_WINDOW_READ}
ObjC.import('CoreGraphics');
function frontPid(){
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.002));
  const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;return a&&!a.isNil()?Number(a.processIdentifier):0;
}
function identity(pid){
  const a=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if(!a||a.isNil()||a.bundleIdentifier.isNil()||a.launchDate.isNil())throw new Error('target_changed');
  return {pid,appId:String(a.bundleIdentifier.js),launched:Number(a.launchDate.timeIntervalSince1970)};
}
function sameProcess(expected){try{const a=identity(expected.pid);return a.appId===expected.appId&&a.launched===expected.launched;}catch{return false;}}
function nativeList(){return ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0,0)));}
function matches(w,b){const n=w.kCGWindowBounds;return n&&b&&Math.abs(n.X-b.x)<=1&&Math.abs(n.Y-b.y)<=1&&Math.abs(n.Width-b.width)<=1&&Math.abs(n.Height-b.height)<=1;}
function root(pid){const a=$.AXUIElementCreateApplication(pid);$.AXUIElementSetMessagingTimeout(a,0.25);return a;}
function focusedWindow(pid){
  const value=scopedAXAttr(root(pid),'AXFocusedWindow');
  if(!value)return null;
  const bounds=scopedAXBounds(ObjC.castRefToObject(value));
  const found=nativeList().filter(w=>Number(w.kCGWindowOwnerPID)===pid&&matches(w,bounds));
  if(found.length!==1)throw new Error('ambiguous_window');
  return Number(found[0].kCGWindowNumber);
}
function exactWindow(pid,id){
  const native=nativeList().find(w=>Number(w.kCGWindowOwnerPID)===pid&&Number(w.kCGWindowNumber)===id);
  const raw=scopedAXAttr(root(pid),'AXWindows');
  if(!native||!raw)throw new Error('target_changed');
  const windows=ObjC.castRefToObject(raw),found=[];
  for(let i=0;i<Math.min(Number(windows.count),100);i++){
    const w=windows.objectAtIndex(i);if(matches(native,scopedAXBounds(w)))found.push(w);
  }
  if(found.length!==1)throw new Error('ambiguous_window');
  return found[0];
}
function activate(target){
  if(!sameProcess(target))throw new Error('target_changed');
  const window=target.windowId===null?null:exactWindow(target.pid,target.windowId);
  if(window&&$.AXUIElementPerformAction(window,$('AXRaise'))!==0)throw new Error('focus_failed');
  const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(target.pid);
  if(!app.activateWithOptions(2))throw new Error('focus_failed');
  const deadline=Date.now()+750;
  do{
    if(frontPid()===target.pid&&(target.windowId===null||focusedWindow(target.pid)===target.windowId))return;
    delay(0.02);
  }while(Date.now()<deadline);
  throw new Error('focus_failed');
}
function restore(receipt){
  if(!receipt.changed)return 'unchanged';
  if(!sameProcess(receipt.target)||frontPid()!==receipt.target.pid||focusedWindow(receipt.target.pid)!==receipt.target.windowId)return 'skipped';
  if(!sameProcess(receipt.previous))return 'skipped';
  activate(receipt.previous);return 'restored';
}
function foregroundRequest(request){
  if(request.command==='restore'){
    try{return JSON.stringify({state:restore(request.receipt)});}catch{return JSON.stringify({state:'failed'});}
  }
  let receipt=null;
  try{
    if(request.command!=='acquire'||!$.AXIsProcessTrusted())throw new Error('accessibility_unavailable');
    const match=request.targetId.match(/^([1-9]\d*):cg:([1-9]\d*)$/);
    if(!match)throw new Error('target_changed');
    const target={...identity(Number(match[1])),windowId:Number(match[2])};
    if(target.appId!==request.appId)throw new Error('target_changed');
    exactWindow(target.pid,target.windowId);
    // Never steal an in-progress keystroke/click or carry held modifiers into Send.
    const idle=Math.min(...[1,3,10,11,12].map(t=>Number($.CGEventSourceSecondsSinceLastEventType(0,t))));
    if(!Number.isFinite(idle)||idle<0.75||Number($.CGEventSourceFlagsState(0))&0x1e0000)throw new Error('user_input_active');
    const pid=frontPid(),previous={...identity(pid),windowId:focusedWindow(pid)};
    receipt={target,previous,changed:pid!==target.pid||previous.windowId!==target.windowId};
    if(receipt.changed)activate(target);
    return JSON.stringify({receipt});
  }catch(error){
    if(receipt)try{restore(receipt);}catch{}
    const known=['target_changed','ambiguous_window','focus_failed','accessibility_unavailable','user_input_active'];
    return JSON.stringify({error:known.includes(error.message)?error.message:'focus_failed'});
  }
}`;

const sessionScript = macNativeSessionScript('foregroundRequest', MAC_FOREGROUND_HANDLER);

async function request(input: unknown): Promise<Record<string, unknown>> {
  const result = await runNative('/usr/bin/osascript', ['-l', 'JavaScript'], {
    input: JSON.stringify(input), structuredOutput: true, timeoutMs: 5_000,
    persistent: { script: sessionScript, scope: 'mac-foreground' },
  });
  return JSON.parse(result.stdout);
}

export async function acquireMacForeground(targetId: string, appId: string): Promise<ComputerForegroundLease> {
  const result = await request({ command: 'acquire', targetId, appId });
  if (!result.receipt || result.error) throw new NativeInteractionError(`Temporary foreground access failed (${result.error ?? 'focus_failed'}). No conversation input was attempted.`, false);
  let restored = false;
  return { restore: async () => {
    if (restored) return 'unchanged';
    restored = true;
    try {
      const resultOfRestore = await request({ command: 'restore', receipt: result.receipt });
      return ['restored', 'unchanged', 'skipped'].includes(String(resultOfRestore.state)) ? resultOfRestore.state as 'restored' | 'unchanged' | 'skipped' : 'failed';
    } catch { return 'failed'; }
  } };
}
