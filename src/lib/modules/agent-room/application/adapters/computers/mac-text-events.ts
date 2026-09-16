export const MAC_TEXT_EVENTS = String.raw`
function unicodeChunks(value) {
  const chunks = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 20,value.length);
    if (end < value.length && value.charCodeAt(end-1) >= 0xd800 && value.charCodeAt(end-1) <= 0xdbff) end--;
    chunks.push(value.slice(start,end)); start = end;
  }
  return chunks;
}
function unicodeEvents(chunk) {
  const data = $(chunk).dataUsingEncoding($.NSUTF16LittleEndianStringEncoding);
  return [true,false].map(down => {
    const event = $.CGEventCreateKeyboardEvent(null,0,down);
    if (!event) throw new Error('action_failed');
    $.CGEventSetFlags(event,0);
    $.CGEventKeyboardSetUnicodeString(event,chunk.length,data.bytes);
    return event;
  });
}
`;
