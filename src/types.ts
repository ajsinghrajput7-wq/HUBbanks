export enum Region {
  Africa = 'Africa',
  AsiaPacific = 'Asia/Pacific',
  Europe = 'Europe',
  MiddleEast = 'Middle East',
  Americas = 'Americas',
  Unknown = 'Unknown'
}

export enum MarketSegment {
  All = 'All',
  Domestic = 'Domestic',
  International = 'International'
}

export interface FlightInfo {
  id?: string;
  code: string;
  flightNo?: string;
  freq: number;
  seats?: number;
  pax?: number;
  region: Region;
  airline?: string;
  market?: MarketSegment;
  isManual?: boolean;
  exactTime?: string;
  originalHubTime?: string;
}

export interface HubSlot {
  label: string;
  arrivals: FlightInfo[];
  departures: FlightInfo[];
}

export interface AirportDataset {
  id: string;
  code: string;
  fileName: string;
  data: any[];
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  timestamp: number;
  manualBlocks: Record<string, Record<number, { arrivals: FlightInfo[], departures: FlightInfo[] }>>;
  mct: number;
  maxConnectionWindow: number;
  selectedRegions: Region[];
  marketFilter: MarketSegment;
}
