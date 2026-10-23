import { z } from 'zod/v3';

export const updateUserRoleSchema = z.object({
  userId: z.coerce.number().int().positive(),
  role: z.enum(['user', 'admin']),
});

export const deleteUserSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(50),
  guard: z.string().trim().optional().or(z.literal('')),
  description: z.string().trim().max(255).optional().or(z.literal('')),
});

export const deleteRoleSchema = z.object({
  name: z.string().trim().min(1),
  guard: z.string().trim().optional().or(z.literal('')),
});

export const createPermissionSchema = z.object({
  name: z.string().trim().min(2, 'Permission name must be at least 2 characters').max(50),
  guard: z.string().trim().optional().or(z.literal('')),
  description: z.string().trim().max(255).optional().or(z.literal('')),
});

export const deletePermissionSchema = z.object({
  name: z.string().trim().min(1),
  guard: z.string().trim().optional().or(z.literal('')),
});

export const rolePermissionSchema = z.object({
  roleId: z.coerce.number().int().positive(),
  permissionId: z.coerce.number().int().positive(),
});

export const userRoleSchema = z.object({
  userId: z.coerce.number().int().positive(),
  roleId: z.coerce.number().int().positive(),
});

export const userPermissionSchema = z.object({
  userId: z.coerce.number().int().positive(),
  permissionId: z.coerce.number().int().positive(),
});

export const exportDataSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
});

// ── Inferred Types ───────────────────────────────────────

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;
export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
export type DeletePermissionInput = z.infer<typeof deletePermissionSchema>;
export type RolePermissionInput = z.infer<typeof rolePermissionSchema>;
export type UserRoleInput = z.infer<typeof userRoleSchema>;
export type UserPermissionInput = z.infer<typeof userPermissionSchema>;
export type ExportDataInput = z.infer<typeof exportDataSchema>;

// ── Response Schemas ─────────────────────────────────────

export const roleResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  guard: z.string(),
  description: z.string().nullable(),
});

export const permissionResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  guard: z.string(),
  description: z.string().nullable(),
});

export type RoleResponse = z.infer<typeof roleResponseSchema>;
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;
