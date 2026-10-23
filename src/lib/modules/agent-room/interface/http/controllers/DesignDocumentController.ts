import { Controller } from '@beeblock/svelar/routing';
import { ApplyDesignOperationsDto, ExportDesignPdfDto, ImportDesignAssetDto, UploadDesignThumbnailDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import {
  DesignRevisionConflictError,
  designDocumentService,
} from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { ApplyDesignOperationsRequest, ImportDesignAssetRequest, UploadDesignThumbnailRequest } from '$lib/modules/agent-room/interface/http/requests/DesignRequests.js';
import { ExportDesignPdfRequest } from '$lib/modules/agent-room/interface/http/requests/DesignRequests.js';
import { designExportService } from '$lib/modules/agent-room/application/services/DesignExportService.js';
import { DesignLeaseConflictError } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
import { auditDesignDocument } from '$lib/modules/agent-room/domain/design-quality.js';
import { createDesignTemplate, designTemplateIds } from '$lib/modules/agent-room/domain/design-templates.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { z } from 'zod/v3';

const designMaintenanceActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('restore-backup') }),
  z.object({ action: z.literal('compact-history') }),
  z.object({ action: z.literal('apply-template'), templateId: z.enum(designTemplateIds as [typeof designTemplateIds[number], ...typeof designTemplateIds[number][]]), baseRevision: z.number().int().min(0) }),
]);

export class DesignDocumentController extends Controller {
  async show(event: any) {
    try {
      return this.json({ data: await designDocumentService.get(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Design document not found.' }, 404);
    }
  }

  async apply(event: any) {
    try {
      const input = await ApplyDesignOperationsRequest.validate(event);
      return this.json({ data: await designDocumentService.apply(ApplyDesignOperationsDto.from(event.params.id, event.params.nodeId, input)) });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) {
        return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      }
      if (error instanceof DesignLeaseConflictError) {
        return this.json({ error: 'design_lease_conflict', data: error.lease }, 423);
      }
      return this.json({ error: error instanceof Error ? error.message : 'Failed to update design document.' }, 400);
    }
  }

  async quality(event: any) {
    try {
      const document = await designDocumentService.get(event.params.id, event.params.nodeId);
      const maintenance = await designDocumentService.maintenance(event.params.id, event.params.nodeId);
      return this.json({ data: { report: auditDesignDocument(document), maintenance } });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Failed to audit design document.' }, 404);
    }
  }

  async maintain(event: any) {
    try {
      const input = designMaintenanceActionSchema.parse(await event.request.json());
      if (input.action === 'restore-backup') {
        return this.json({ data: { document: await designDocumentService.restoreBackup(event.params.id, event.params.nodeId) } });
      }
      if (input.action === 'compact-history') {
        return this.json({ data: { maintenance: await designDocumentService.compactHistory(event.params.id, event.params.nodeId) } });
      }
      const current = await designDocumentService.get(event.params.id, event.params.nodeId);
      if (current.revision !== input.baseRevision) throw new DesignRevisionConflictError(current);
      const operations = createDesignTemplate(input.templateId, current, uuidv7);
      const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
        event.params.id,
        event.params.nodeId,
        input.baseRevision,
        operations,
        { kind: 'user', id: null, name: null, taskId: null },
        `Apply ${input.templateId} design template`,
      ));
      return this.json({ data: { document } });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.json({ error: error instanceof Error ? error.message : 'Failed to maintain design document.' }, 422);
    }
  }

  async importAsset(event: any) {
    try {
      const input = await ImportDesignAssetRequest.validate(event);
      const dto = ImportDesignAssetDto.from(event.params.id, event.params.nodeId, input);
      return this.json({
        data: await designDocumentService.importAsset(
          dto.workspaceId,
          dto.nodeId,
          dto.baseRevision,
          dto.file,
          { width: dto.width, height: dto.height },
        ),
      }, 201);
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) {
        return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      }
      const message = error instanceof Error ? error.message : 'Failed to import design asset.';
      return this.json({ error: message }, message.includes('20 MB') ? 413 : 422);
    }
  }

  async exportPdf(event: any) {
    try {
      const input = await ExportDesignPdfRequest.validate(event);
      const dto = ExportDesignPdfDto.from(input);
      const pdf = await designExportService.pdf(dto);
      return new Response(Uint8Array.from(pdf).buffer, {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${dto.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Failed to export design PDF.' }, 422);
    }
  }

  async thumbnail(event: any) {
    try {
      const thumbnail = await designDocumentService.getThumbnail(event.params.id, event.params.nodeId);
      if (!thumbnail) return new Response(null, { status: 404 });
      const requestedRevision = Number(event.url.searchParams.get('revision'));
      if (Number.isInteger(requestedRevision) && requestedRevision !== thumbnail.revision) {
        return new Response(null, { status: 404 });
      }
      return new Response(Uint8Array.from(thumbnail.data).buffer, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'private, max-age=31536000, immutable',
          'x-design-revision': String(thumbnail.revision),
        },
      });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Design thumbnail not found.' }, 404);
    }
  }

  async uploadThumbnail(event: any) {
    try {
      const input = await UploadDesignThumbnailRequest.validate(event);
      const dto = UploadDesignThumbnailDto.from(event.params.id, event.params.nodeId, input);
      await designDocumentService.uploadThumbnail(dto.workspaceId, dto.nodeId, dto.revision, dto.file);
      return this.json({ data: { revision: dto.revision } });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) {
        return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      }
      return this.json({ error: error instanceof Error ? error.message : 'Failed to update design thumbnail.' }, 422);
    }
  }
}
