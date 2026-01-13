
export interface MovieMetadata {
  title: string;
  slug: string;
  description: string;
  duration: string;
  posterUrl?: string;
}

export interface Movie extends MovieMetadata {
  streamUrl: string;
  folderPath: string;
}
