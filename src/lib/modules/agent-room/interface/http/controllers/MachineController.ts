import { Controller } from '@beeblock/svelar/routing';
import { machineService } from '../../../application/services/MachineService.js';

export class MachineController extends Controller {
  async index() {
    return this.json({ data: await machineService.list() });
  }
}
