import { Region } from './types';

export const REGION_COLORS: Record<Region, string> = {
  [Region.Africa]: 'bg-[#001529] text-white',
  [Region.AsiaPacific]: 'bg-[#214a7c] text-white',
  [Region.Europe]: 'bg-[#e7d5b1] text-slate-800',
  [Region.MiddleEast]: 'bg-[#bdbdbd] text-slate-800',
  [Region.Americas]: 'bg-[#4a90e2] text-white',
  [Region.Unknown]: 'bg-slate-200 text-slate-500'
};

export const BLR_CATCHMENT = new Set([
  'HYD','MAA','IXG','VGA','VTZ','RJA','HBX','GOI','IXE','MYQ','TIR',
  'PNY','TRZ','IXM','TRV','COK','CJB','CCJ','CNN','VDY','GBI','TCR',
  'BLR','NAG','AGX','PNQ','RQY','KJB'
]);

export const INDIAN_AIRPORTS = new Set([
  'BLR','BOM','DEL','MAA','HYD','CCU','COK','AMD','LKO','TRV','PNQ','CNN','GWL','JAI',
  'IXE','AYJ','CCJ','GOX','GAU','BBI','VGA','VTZ','NMI','NAG','TRZ','IXZ','IXR','UDR',
  'IXC','IXB','HDO','JDH','STV','IDR','DED','IXD','IXA','RPR','HBX','BDQ','BHO','CJB',
  'IXM','IXG','NDC','VDY','KJB','TCR','JLR','BEK','ISK','SXV','DGH','IXJ','RDP','TIR',
  'SDW','JSA','KLH','HSR','RJA','AGR','IXU','AGX','RQY','SAG','JRG','KNU','PNY','VNS',
  'PAT','ATQ','GOI','IXX','SXR','GOP'
]);

export const AIRPORT_REGIONS: Record<string, Region> = {
  'ICN':Region.AsiaPacific,'NRT':Region.AsiaPacific,'HKG':Region.AsiaPacific,'SIN':Region.AsiaPacific,
  'BKK':Region.AsiaPacific,'PVG':Region.AsiaPacific,'PEK':Region.AsiaPacific,'KUL':Region.AsiaPacific,
  'MNL':Region.AsiaPacific,'CGK':Region.AsiaPacific,'SYD':Region.AsiaPacific,'MEL':Region.AsiaPacific,
  'BLR':Region.AsiaPacific,'BOM':Region.AsiaPacific,'DEL':Region.AsiaPacific,'MAA':Region.AsiaPacific,
  'HYD':Region.AsiaPacific,'CCU':Region.AsiaPacific,'COK':Region.AsiaPacific,'AMD':Region.AsiaPacific,
  'LKO':Region.AsiaPacific,'HKT':Region.AsiaPacific,'CNX':Region.AsiaPacific,'HND':Region.AsiaPacific,
  'KIX':Region.AsiaPacific,'NGO':Region.AsiaPacific,'FUK':Region.AsiaPacific,'TPE':Region.AsiaPacific,
  'SGN':Region.AsiaPacific,'HAN':Region.AsiaPacific,'DAC':Region.AsiaPacific,'KTM':Region.AsiaPacific,
  'CMB':Region.AsiaPacific,'MLE':Region.AsiaPacific,'CAN':Region.AsiaPacific,'AKL':Region.AsiaPacific,
  'BNE':Region.AsiaPacific,'PER':Region.AsiaPacific,'DMK':Region.AsiaPacific,'DPS':Region.AsiaPacific,
  'VNS':Region.AsiaPacific,'PAT':Region.AsiaPacific,'ATQ':Region.AsiaPacific,'GOI':Region.AsiaPacific,
  'TRV':Region.AsiaPacific,'PNQ':Region.AsiaPacific,'CNN':Region.AsiaPacific,'GWL':Region.AsiaPacific,
  'JAI':Region.AsiaPacific,'IXE':Region.AsiaPacific,'AYJ':Region.AsiaPacific,'CCJ':Region.AsiaPacific,
  'GOX':Region.AsiaPacific,'GAU':Region.AsiaPacific,'BBI':Region.AsiaPacific,'VGA':Region.AsiaPacific,
  'VTZ':Region.AsiaPacific,'NMI':Region.AsiaPacific,'NAG':Region.AsiaPacific,'TRZ':Region.AsiaPacific,
  'IXZ':Region.AsiaPacific,'IXR':Region.AsiaPacific,'UDR':Region.AsiaPacific,'IXC':Region.AsiaPacific,
  'IXB':Region.AsiaPacific,'HDO':Region.AsiaPacific,'JDH':Region.AsiaPacific,'STV':Region.AsiaPacific,
  'IDR':Region.AsiaPacific,'DED':Region.AsiaPacific,'IXD':Region.AsiaPacific,'IXA':Region.AsiaPacific,
  'RPR':Region.AsiaPacific,'HBX':Region.AsiaPacific,'BDQ':Region.AsiaPacific,'BHO':Region.AsiaPacific,
  'CJB':Region.AsiaPacific,'IXM':Region.AsiaPacific,'IXG':Region.AsiaPacific,'NDC':Region.AsiaPacific,
  'VDY':Region.AsiaPacific,'KJB':Region.AsiaPacific,'TCR':Region.AsiaPacific,'JLR':Region.AsiaPacific,
  'BEK':Region.AsiaPacific,'ISK':Region.AsiaPacific,'SXV':Region.AsiaPacific,'DGH':Region.AsiaPacific,
  'IXX':Region.AsiaPacific,'SXR':Region.AsiaPacific,'IXJ':Region.AsiaPacific,'RDP':Region.AsiaPacific,
  'TIR':Region.AsiaPacific,'SDW':Region.AsiaPacific,'JSA':Region.AsiaPacific,'KLH':Region.AsiaPacific,
  'HSR':Region.AsiaPacific,'GOP':Region.AsiaPacific,'RJA':Region.AsiaPacific,'AGR':Region.AsiaPacific,
  'IXU':Region.AsiaPacific,'AGX':Region.AsiaPacific,'RQY':Region.AsiaPacific,'SAG':Region.AsiaPacific,
  'JRG':Region.AsiaPacific,'KNU':Region.AsiaPacific,'PNY':Region.AsiaPacific,'KBV':Region.AsiaPacific,
  'LGK':Region.AsiaPacific,'USM':Region.AsiaPacific,'ISB':Region.AsiaPacific,'KHI':Region.AsiaPacific,
  'LHE':Region.AsiaPacific,
  'LHR':Region.Europe,'CDG':Region.Europe,'FRA':Region.Europe,'AMS':Region.Europe,
  'MAD':Region.Europe,'FCO':Region.Europe,'IST':Region.Europe,'MUC':Region.Europe,
  'LGW':Region.Europe,'STN':Region.Europe,'MAN':Region.Europe,'EDI':Region.Europe,
  'NCE':Region.Europe,'BCN':Region.Europe,'ZRH':Region.Europe,'GVA':Region.Europe,
  'VIE':Region.Europe,'CPH':Region.Europe,'ARN':Region.Europe,'OSL':Region.Europe,
  'HEL':Region.Europe,'DME':Region.Europe,'SVO':Region.Europe,'WAW':Region.Europe,
  'PRG':Region.Europe,'BUD':Region.Europe,'ATH':Region.Europe,'LIS':Region.Europe,
  'DUB':Region.Europe,'BRU':Region.Europe,'MXP':Region.Europe,'BHX':Region.Europe,
  'JED':Region.MiddleEast,'RUH':Region.MiddleEast,'DXB':Region.MiddleEast,'DOH':Region.MiddleEast,
  'AUH':Region.MiddleEast,'KWI':Region.MiddleEast,'AMM':Region.MiddleEast,'BAH':Region.MiddleEast,
  'MCT':Region.MiddleEast,'DMM':Region.MiddleEast,'MED':Region.MiddleEast,'BEY':Region.MiddleEast,
  'SHJ':Region.MiddleEast,'HAS':Region.MiddleEast,'ELQ':Region.MiddleEast,'SLL':Region.MiddleEast,
  'JFK':Region.Americas,'LAX':Region.Americas,'ORD':Region.Americas,'DFW':Region.Americas,
  'SFO':Region.Americas,'YYZ':Region.Americas,'IAD':Region.Americas,'ATL':Region.Americas,
  'MIA':Region.Americas,'IAH':Region.Americas,'DEN':Region.Americas,'SEA':Region.Americas,
  'BOS':Region.Americas,'EWR':Region.Americas,'PHX':Region.Americas,'LAS':Region.Americas,
  'MCO':Region.Americas,'YVR':Region.Americas,'YUL':Region.Americas,'GRU':Region.Americas,
  'EZE':Region.Americas,'SCL':Region.Americas,'BOG':Region.Americas,'MEX':Region.Americas,
  'CAI':Region.Africa,'JNB':Region.Africa,'NBO':Region.Africa,'LOS':Region.Africa,
  'ADD':Region.Africa,'ACC':Region.Africa,'CMN':Region.Africa,'ALG':Region.Africa,
  'TUN':Region.Africa,'DAR':Region.Africa,'EBB':Region.Africa,'KGL':Region.Africa,
  'MRU':Region.Africa,'LAD':Region.Africa,'CPT':Region.Africa,'HRG':Region.Africa,
};

export const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2,'0')}:00`);
