import { z } from 'zod';

export const CHARACTER_DRAG_TYPE = 'application/x-orkestrai-character';
export const characterDragSchema = z.object({ id: z.string().uuid(), sourceWorkspaceId: z.string().uuid() }).strict();
