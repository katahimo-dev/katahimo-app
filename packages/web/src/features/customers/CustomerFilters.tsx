/** 探す欄と地区の絞り込み(GAS版 #searchInput / #cityFilter)。 */
export function CustomerFilters({
  search,
  onSearchChange,
  city,
  onCityChange,
  cities,
  loaded,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  cities: string[];
  /** 一覧が届いたか。GAS版は届く前は「すべての地域」、届いたあとは「全ての地域」と出ていた */
  loaded: boolean;
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex gap-3">
        <div className="relative flex-grow">
          <input
            type="text"
            id="searchInput"
            aria-label="お客様の名前で探す"
            placeholder="お客様の名前で探す"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 bg-gray-50 text-base shadow-sm transition-all"
          />
          <svg
            className="w-5 h-5 absolute left-3 top-3.5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      <div className="relative">
        <select
          id="cityFilter"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          aria-label="地域"
          className="w-full appearance-none pl-4 pr-10 py-3 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 bg-gray-50 text-base shadow-sm transition-all"
        >
          <option value="">{loaded ? '全ての地域' : 'すべての地域'}</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
          <svg
            className="fill-current h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
