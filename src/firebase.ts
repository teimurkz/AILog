/**
 * Standalone Local Stub (Firebase Completely Decoupled)
 * All data and GPS tracking are processed locally by the Node.js backend.
 */

export const db: any = {};
export const auth: any = {
  currentUser: {
    uid: 'admin_local',
    email: 'ti07kz@gmail.com',
    displayName: 'Главный Администратор'
  }
};
export const storage: any = null;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  console.warn(`[Local Fallback] Operation: ${operationType}, Path: ${path}`, error);
}
