export interface RouteDestination {
  key: string;
  name: string;
  lat: number;
  lng: number;
  aliases: readonly string[];
}

// City centres, not delivery addresses. Added coordinates: GeoNames cities15000
// (2026-09-16), https://download.geonames.org/export/dump/, CC BY 4.0.
// Keep the order form and GPS resolver on the same list so no selectable city
// silently receives another city's route. Existing six centres are preserved.
export const ROUTE_DESTINATIONS: readonly RouteDestination[] = [
  { key: 'astana', name: 'Астана', lat: 51.1694, lng: 71.4491, aliases: ['Astana', 'Нур-Султан', 'Nur-Sultan'] },
  { key: 'shymkent', name: 'Шымкент', lat: 42.3417, lng: 69.5901, aliases: ['Shymkent', 'Чимкент'] },
  { key: 'karaganda', name: 'Караганда', lat: 49.8019, lng: 73.1021, aliases: ['Karaganda', 'Karagandy', 'Қарағанды'] },
  { key: 'aktobe', name: 'Актобе', lat: 50.27969, lng: 57.20718, aliases: ['Aktobe', 'Ақтөбе', 'Актюбинск'] },
  { key: 'taraz', name: 'Тараз', lat: 42.9, lng: 71.3667, aliases: ['Taraz'] },
  { key: 'pavlodar', name: 'Павлодар', lat: 52.27601, lng: 76.96881, aliases: ['Pavlodar'] },
  { key: 'ust-kamenogorsk', name: 'Усть-Каменогорск', lat: 49.97143, lng: 82.60586, aliases: ['Ust-Kamenogorsk', 'Oskemen', 'Өскемен'] },
  { key: 'semey', name: 'Семей', lat: 50.42064, lng: 80.25025, aliases: ['Semey', 'Семипалатинск'] },
  { key: 'atyrau', name: 'Атырау', lat: 47.1048, lng: 51.88427, aliases: ['Atyrau'] },
  { key: 'kostanay', name: 'Костанай', lat: 53.21435, lng: 63.62463, aliases: ['Kostanay', 'Kostanai', 'Қостанай'] },
  { key: 'kyzylorda', name: 'Кызылорда', lat: 44.85278, lng: 65.50917, aliases: ['Kyzylorda', 'Қызылорда'] },
  { key: 'aktau', name: 'Актау', lat: 43.66105, lng: 51.17392, aliases: ['Aktau', 'Ақтау'] },
  { key: 'bishkek', name: 'Бишкек', lat: 42.87, lng: 74.59, aliases: ['Bishkek'] },
  { key: 'tashkent', name: 'Ташкент', lat: 41.26465, lng: 69.21627, aliases: ['Tashkent', 'Toshkent'] },
];

const additionalDestinations: readonly RouteDestination[] = [
  { key: 'almaty', name: 'Алматы', lat: 43.2389, lng: 76.8897, aliases: ['Almaty', 'Алма-Ата'] },
  { key: 'balkhash', name: 'Балхаш', lat: 46.8481, lng: 74.9804, aliases: ['Balkhash', 'Балқаш'] },
];

export const POPULAR_CITIES: string[] = ROUTE_DESTINATIONS.map(city => city.name);
export const HIGHWAY_NODES = Object.fromEntries(
  [...ROUTE_DESTINATIONS, ...additionalDestinations].map(city => [city.key, city]),
);

const normalizeCity = (value: string) => value.normalize('NFKC').trim().toLowerCase()
  .replace(/[‐‑–—]/g, '-')
  .replace(/^(?:город\s+|г\.\s*|г\s+)/u, '')
  .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

const citiesByName = new Map([...ROUTE_DESTINATIONS, ...additionalDestinations].flatMap(city =>
  [city.key, city.name, ...city.aliases].map(name => [normalizeCity(name), city] as const),
));

export function resolveRouteDestination(name: string | undefined): RouteDestination | undefined {
  // Exact aliases only: an unknown address or a partial name is not another city.
  return citiesByName.get(normalizeCity(name || ''));
}
