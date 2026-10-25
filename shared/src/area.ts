// Socio-Economic Indexes for Areas (SEIFA) 2021, Australian Bureau of Statistics: the Index of Relative
// Socio-economic Disadvantage (IRSD) for each postcode customers live in (Postal Area, Table 2 of
// "Postal Area, Indexes, SEIFA 2021", released 27 Apr 2023; CC BY 4.0, (c) Commonwealth of Australia).
// A lower score means more disadvantage. Deciles: 1 = the most disadvantaged 10% of postcodes, nationally
// and within WA. None of these postcodes is flagged by the ABS as poorly represented.

/** postcode -> [IRSD score, decile in Australia, decile in WA] */
export const IRSD: Record<string, [score: number, decileAustralia: number, decileWA: number]> = {
  "6000": [1040, 8, 7],
  "6004": [1043, 8, 7],
  "6008": [1082, 10, 10],
  "6009": [1101, 10, 10],
  "6010": [1088, 10, 10],
  "6011": [1114, 10, 10],
  "6018": [1072, 9, 9],
  "6021": [1034, 7, 7],
  "6023": [1090, 10, 10],
  "6025": [1073, 9, 9],
  "6027": [1054, 8, 8],
  "6030": [1006, 6, 5],
  "6050": [1075, 9, 9],
  "6054": [991, 5, 4],
  "6056": [970, 4, 3],
  "6061": [906, 1, 1],
  "6062": [1001, 5, 5],
  "6064": [907, 1, 1],
  "6065": [1041, 8, 7],
  "6069": [1014, 6, 6],
  "6100": [1049, 8, 8],
  "6107": [990, 5, 4],
  "6108": [977, 4, 3],
  "6109": [909, 2, 1],
  "6110": [963, 3, 3],
  "6111": [971, 4, 3],
  "6112": [996, 5, 5],
  "6151": [1079, 10, 10],
  "6152": [1057, 9, 8],
  "6155": [1058, 9, 9],
  "6160": [1030, 7, 7],
  "6163": [1010, 6, 6],
  "6164": [1049, 8, 8],
  "6167": [946, 3, 2],
  "6168": [924, 2, 2],
  "6171": [1025, 7, 6],
  "6210": [952, 3, 2],
  "6225": [913, 2, 1],
  "6230": [966, 3, 3],
  "6258": [949, 3, 2],
  "6280": [1001, 5, 5],
  "6312": [960, 3, 3],
  "6330": [987, 5, 4],
  "6401": [932, 2, 2],
  "6430": [1029, 7, 7],
  "6450": [993, 5, 4],
  "6530": [957, 3, 3],
  "6701": [926, 2, 2],
  "6707": [1038, 8, 7],
  "6714": [1068, 9, 9],
  "6718": [737, 1, 1],
  "6721": [1079, 10, 10],
  "6722": [988, 5, 4],
  "6725": [950, 3, 2],
  "6728": [753, 1, 1],
  "6743": [908, 2, 1],
  "6765": [676, 1, 1],
  "6770": [558, 1, 1],
};

/** The most disadvantaged 20% of WA postcodes (WA decile 1 or 2) raise the area signal. */
export const AREA_DECILE_LIMIT = 2;
export const AREA_SIGNAL_ID = "area_disadvantage";
export const AREA_SIGNAL_NAME = "Lives in a disadvantaged area";

/** The area signal for a postcode, or null. It describes the area, never the person. */
export function areaSignal(postcode: string | null | undefined): { id: string; name: string; evidence: string } | null {
  const r = postcode ? IRSD[postcode] : undefined;
  if (!r || r[2] > AREA_DECILE_LIMIT) return null;
  return { id: AREA_SIGNAL_ID, name: AREA_SIGNAL_NAME, evidence: `Postcode ${postcode} is in WA decile ${r[2]} of 10 for socio-economic disadvantage (ABS SEIFA 2021, IRSD score ${r[0]}; Australia decile ${r[1]})` };
}
