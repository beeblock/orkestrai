import { creativeProviderId } from '../../domain/providers.js';
import { FalVideoProvider } from './FalVideoProvider.js';
import { BytePlusVideoProvider } from './BytePlusVideoProvider.js';
import { HiggsfieldVideoProvider } from './HiggsfieldVideoProvider.js';
const providers = { fal: new FalVideoProvider(), byteplus: new BytePlusVideoProvider(), higgsfield: new HiggsfieldVideoProvider() };
export function creativeVideoProvider(id: unknown) { return providers[creativeProviderId(id)]; }
