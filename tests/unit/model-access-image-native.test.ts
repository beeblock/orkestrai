import { describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { delegatedCodexImage } from '$lib/modules/agent-room/application/adapters/delegated-images.js';

describe.skipIf(process.env.ORKESTRAI_MODEL_ACCESS_IMAGE_LIVE !== '1')('native Codex image subscription contract', () => {
  it('edits one guest reference into one PNG using the selected subscription', async () => {
    const configDir=process.env.ORKESTRAI_MODEL_ACCESS_TEST_CODEX_PROFILE;
    if(!configDir)throw new Error('Select the native Codex image test profile directory explicitly.');
    const directory = await mkdtemp(join(tmpdir(),'orkestrai-model-access-image-'));
    const reference = new PNG({width:256,height:256});
    for(let y=0;y<256;y++) for(let x=0;x<256;x++) { const at=(y*256+x)*4, circle=(x-128)**2+(y-128)**2<64**2; reference.data.set(circle ? [36,96,210,255] : [255,255,255,255],at); }
    const bytes = PNG.sync.write(reference), id = randomUUID();
    const input = { id,prompt:'Keep the single blue circle from the reference, move it slightly to the left on the same plain white background. One simple flat icon, no text, no added objects.',transparentBackground:false,references:[{mime:'image/png' as const,data:bytes.toString('base64')}] };
    await writeFile(join(directory,'reference.png'),bytes,{flag:'wx',mode:0o600});
    await writeFile(join(directory,'manifest.json'),JSON.stringify({ id,authorization:'Owner explicitly requested verification of the Codex image workflow for delegated access.',endpoint:'https://chatgpt.com/backend-api/codex/images/edits',prompt:input.prompt,parameters:{model:'gpt-image-2',n:1,background:'opaque',quality:'auto'},reference:{path:'reference.png',sha256:createHash('sha256').update(bytes).digest('hex')},estimate:{billing:'existing Codex subscription quota; no API-key billing'},reservation:{generations:1},profileId:null },null,2),{flag:'wx',mode:0o600});
    const image = await delegatedCodexImage(input,{CODEX_HOME:configDir},AbortSignal.timeout(300000));
    const decoded = PNG.sync.read(image); expect(decoded.width).toBeGreaterThan(128); expect(decoded.height).toBeGreaterThan(128);
    await writeFile(join(directory,'output.png'),image,{flag:'wx',mode:0o600});
    await writeFile(join(directory,'result.json'),JSON.stringify({width:decoded.width,height:decoded.height,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex')},null,2),{flag:'wx',mode:0o600});
    console.info('Image smoke artifact',directory,decoded.width,decoded.height,image.length);
  },330000);
});
