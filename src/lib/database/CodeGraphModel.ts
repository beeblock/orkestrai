import { Model } from '@beeblock/svelar/orm';
import { codeGraphConnectionName } from './code-graph-storage.js';

export class CodeGraphModel extends Model {}

// Resolve after bootstrap/test configuration, rather than pinning a connection at module import time.
Object.defineProperty(CodeGraphModel, 'connection', { get: codeGraphConnectionName });
