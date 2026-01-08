export interface ImageData {
  data: string; // Base64 string without prefix
  mimeType: string;
  url: string; // Full data URL for display
}

export enum EditorStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export interface EditResponse {
  success: boolean;
  data?: ImageData;
  error?: string;
}