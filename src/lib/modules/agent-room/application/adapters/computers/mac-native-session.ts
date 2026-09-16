// One JSON frame at a time over private pipes. Parent EOF terminates the host;
// requests never contain code, paths to executables, or a method chosen by an agent.
export function macNativeSessionScript(handler: 'handleAccessibility' | 'readSnapshot' | 'foregroundRequest', source: string): string {
  return String.raw`${source}
ObjC.bindFunction('read',['long',['int','void *','unsigned long']]);
function run(){
  const input=$.NSMutableData.dataWithLength(65536),frame=$.NSMutableData.data;
  const output=$.NSFileHandle.fileHandleWithStandardOutput;
  const newline=$('\n').dataUsingEncoding($.NSUTF8StringEncoding);
  while(true){
    const count=Number($.read(0,input.mutableBytes,65536));
    if(count<=0)return;
    frame.appendBytesLength(input.bytes,count);
    if(Number(frame.length)>2097152)return;
    const end=frame.subdataWithRange($.NSMakeRange(Number(frame.length)-1,1));
    if(!end.isEqualToData(newline))continue;
    const decoded=$.NSString.alloc.initWithDataEncoding(frame,$.NSUTF8StringEncoding);
    if(decoded.isNil())return;
    let envelope;
    try{envelope=JSON.parse(decoded.js);}catch{return;}
    if(!Number.isSafeInteger(envelope.id)||envelope.id<1||!Object.prototype.hasOwnProperty.call(envelope,'request'))return;
    frame.setLength(0);
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.001));
    const result=JSON.parse(${handler}(envelope.request));
    output.writeData($(JSON.stringify({id:envelope.id,result})+'\n').dataUsingEncoding($.NSUTF8StringEncoding));
  }
}`;
}
