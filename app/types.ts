export type Format = 'mp3' | 'mp4';
export type Video = { source?: 'youtube' | 'facebook'; url: string; id: string; title: string; author: string; duration: number; thumbnail: string; resolutions: number[] };
export type Job = Omit<Video, 'id'> & { id: string; format: Format; quality: string; destination: string; status: 'queued' | 'downloading' | 'converting' | 'completed' | 'error' | 'cancelled'; progress: number; speed?: number | null; eta?: number | null; error?: string; filePath?: string; createdAt: string };
export type AppState = { destination: string; jobs: Job[]; toolsReady: boolean; version: string; platform: string };
export type DesktopApi = {
  getState(): Promise<AppState>;
  pasteUrl(): Promise<string>;
  inspect(url: string): Promise<Video>;
  download(url: string, options: { format: Format; quality: string }): Promise<string>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<string>;
  chooseFolder(): Promise<string>;
  reveal(id: string): Promise<void>;
  openFolder(): Promise<void>;
  openContact(target: 'email' | 'github'): Promise<void>;
  clearHistory(): Promise<void>;
  onState(callback: (state: AppState) => void): () => void;
};
declare global { interface Window { tomp3?: DesktopApi } }
