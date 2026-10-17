/** Public VAST responses. Credentials and upstream URLs never enter these types. */
export interface VastStatus {
  provider: "vast";
  enabled: boolean;
  configured: boolean;
}

export interface VastSearchResult {
  id: string;
  title: string;
  description: string;
  similarity: number;
  /** Match position in the original upload, when the backend provides it. */
  startSeconds?: number;
  endSeconds?: number;
  playbackUrl: string;
}

export interface VastSearchResponse {
  provider: "vast";
  results: VastSearchResult[];
  searchedAt: string;
}
