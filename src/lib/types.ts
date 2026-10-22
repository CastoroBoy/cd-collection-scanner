export type Marketplace = 'IT' | 'DE' | 'FR' | 'ES' | 'GB';
export type Confidence = 'confermato' | 'incerto';

export interface SoldSale {
  id: string;
  amount: number;
  currency: string;
  eurAmount?: number;
  rateToEur?: number;
  rateDate?: string;
  soldAt: string;
  marketplace: Marketplace;
  listingTitle: string;
  condition: string;
  url: string;
  shippingAmount?: number;
  provider: 'trawl' | 'manuale';
  /** Non registrare prezzi annunciati quando l'offerta finale non è nota. */
  priceNote: string;
  checkedAt: string;
}

export interface CdItem {
  id: string;
  artist: string;
  album: string;
  firstReleaseDate: string;
  editionDate: string;
  editionCountry: string;
  editionNote: string;
  mbid: string;
  releaseId: string;
  ocrText: string;
  ocrConfidence: number | null;
  confidence: Confidence;
  sales: SoldSale[];
  lastPriceCheck: string;
  lastMusicCheck: string;
  createdAt: string;
  updatedAt: string;
}

export interface OCRDraft {
  id: string;
  photoId: string;
  text: string;
  confidence: number;
  artist: string;
  album: string;
  bounds: { x: number; y: number; width: number; height: number };
  candidates: MBCandidate[];
  editions: MBEdition[];
  selectedMbid: string;
  selectedReleaseId: string;
  loading: boolean;
  error: string;
}

export interface MBCandidate {
  id: string;
  artist: string;
  title: string;
  firstReleaseDate: string;
  score: number;
  disambiguation?: string;
}
export interface MBEdition { id: string; title: string; date: string; country: string; format: string; disambiguation: string; }
export interface PhotoFile { id: string; name: string; file: File; objectUrl: string; rotation: 0 | 90 | 180 | 270; }
export interface PriceProgress { processed: number; total: number; found: number; missing: number; errors: number; }
export interface PriceSearchResult { sales: SoldSale[]; checkedAt: string; coverage: Marketplace[]; }
