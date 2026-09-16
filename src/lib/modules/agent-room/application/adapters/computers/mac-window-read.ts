// Public AX/CoreGraphics reads for an already selected process. No Apple Events,
// window activation, private event ABI, or retained element handles.
export const MAC_AX_WINDOW_READ = String.raw`
ObjC.import('AppKit'); ObjC.import('ApplicationServices');
ObjC.bindFunction('AXValueGetValue',['bool',['void *','int','void *']]);
function scopedAXAttr(element,name){
  const out=Ref();
  return $.AXUIElementCopyAttributeValue(element,$(name),out)===0?out[0]:null;
}
function scopedAXBounds(element){
  const position=scopedAXAttr(element,'AXPosition'),size=scopedAXAttr(element,'AXSize');
  if(!position||!size)return null;
  const p=$.NSMutableData.dataWithLength(16),s=$.NSMutableData.dataWithLength(16);
  if(!$.AXValueGetValue(position,1,p.mutableBytes)||!$.AXValueGetValue(size,2,s.mutableBytes))return null;
  const point=$.NSValue.valueWithBytesObjCType(p.bytes,'{CGPoint=dd}').pointValue;
  const dimensions=$.NSValue.valueWithBytesObjCType(s.bytes,'{CGSize=dd}').sizeValue;
  const bounds={x:Number(point.x),y:Number(point.y),width:Number(dimensions.width),height:Number(dimensions.height)};
  return Object.values(bounds).every(Number.isFinite)&&bounds.width>0&&bounds.height>0?bounds:null;
}
`;

export const MAC_SCOPED_WINDOW_READ = MAC_AX_WINDOW_READ + String.raw`
function readScopedNativeWindows(pid,registered){
  const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if(!app||app.isNil()||app.bundleIdentifier.isNil())return [];
  const appId=String(app.bundleIdentifier.js),appName=String(app.localizedName.js||appId);
  const root=$.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(root,0.25);
  const raw=scopedAXAttr(root,'AXWindows');
  if(!raw)return [];
  const windows=ObjC.castRefToObject(raw),focusedRaw=scopedAXAttr(root,'AXFocusedWindow');
  const focused=focusedRaw?ObjC.castRefToObject(focusedRaw):null;
  const front=$.NSWorkspace.sharedWorkspace.frontmostApplication;
  const isFront=Boolean(front&&Number(front.processIdentifier)===pid);
  const result=[],deadline=Date.now()+1500;
  for(let i=0;i<Math.min(Number(windows.count),50)&&Date.now()<deadline;i++){
    const window=windows.objectAtIndex(i),bounds=scopedAXBounds(window);
    if(!bounds)continue;
    const matches=registered.filter(w=>Number(w.kCGWindowOwnerPID)===pid&&matchesBounds(w,[bounds.x,bounds.y],[bounds.width,bounds.height]));
    if(matches.length!==1)continue;
    const titleRef=scopedAXAttr(window,'AXTitle');
    const rawTitle=titleRef?ObjC.deepUnwrap(ObjC.castRefToObject(titleRef)):'';
    result.push({id:pid+':cg:'+matches[0].kCGWindowNumber,appId,appName,title:typeof rawTitle==='string'?rawTitle.slice(0,1000):'',bounds,focused:isFront&&Boolean(focused&&$.CFEqual(focused,window))});
  }
  // Two AX windows mapped to one CG window are ambiguous, not interchangeable.
  return result.filter(w=>result.filter(other=>other.id===w.id).length===1);
}`;
