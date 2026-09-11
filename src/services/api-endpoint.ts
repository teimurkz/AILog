import { resolveFirebaseApiUrl } from '../../shared/firebase-endpoints';

export const apiUrl = (path: string) => resolveFirebaseApiUrl(path, import.meta.env.VITE_CRM_API_BASE_URL || undefined);
