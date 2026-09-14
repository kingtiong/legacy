import series from './price-history.json';

// The "would you have held?" story, built from real month-end prices
// (lib/price-history.json, fetched and cross-checked 2026-09-13).
// Figures below are deliberately rounded: they tell a story, they are not quotes.
export const STORIES = {
  eth: {
    key: 'eth',
    symbol: 'ETH',
    coins: 10,
    entry: { month: '2016-09', label: 'September 2016', short: 'September 2016', price: 12 },
    maturity: 'A ten-year rung of ETH locked in September 2016 would be maturing this month.',
    series: series.eth,
    moments: [
      { month: '2018-01', label: 'January 2018', price: 1100, say: 'Your $120 has become about $11,000 in sixteen months.', ask: 'Take the win?' },
      { month: '2018-12', label: 'December 2018', price: 140, say: 'Almost all of it is gone again. Every headline says crypto is finished.', ask: 'Get out before it hits zero?' },
      { month: '2021-11', label: 'November 2021', price: 4500, say: 'Everyone you know is talking about crypto, and your coins could buy a car outright.', ask: 'Buy the car?' },
      { month: '2022-06', label: 'June 2022', price: 1100, say: 'Three-quarters of that has vanished in seven months.', ask: 'Cut your losses?' },
      { month: '2025-08', label: 'August 2025', price: 4500, say: 'After three hard years, it is back near the top.', ask: 'Finally sell at the high?' },
    ],
  },
  bnb: {
    key: 'bnb',
    symbol: 'BNB',
    coins: 100,
    entry: { month: '2017-07', label: 'July 2017, at launch', short: 'July 2017', price: 0.1152 },
    maturity: 'Locked at launch in July 2017, a BNB rung would still have until July 2027.',
    series: series.bnb,
    moments: [
      { month: '2018-01', label: 'January 2018', price: 14, say: 'Six months in, you have more than a hundred times what you paid.', ask: 'Take the win?' },
      { month: '2018-11', label: 'November 2018', price: 5, say: 'Nearly two-thirds of it has gone this year.', ask: 'Sell before it is worth nothing?' },
      { month: '2021-04', label: 'April 2021', price: 600, say: 'This is life-changing money now.', ask: 'Cash out?' },
      { month: '2022-06', label: 'June 2022', price: 230, say: 'Most of it has gone again in just over a year.', ask: 'Cut your losses?' },
      { month: '2025-10', label: 'October 2025', price: 1100, say: 'A new all-time high.', ask: 'Sell the top?' },
    ],
  },
};

export const SOURCES =
  'Month-end prices from Kraken (ETH) and CoinMarketCap (BNB), rounded. Today’s prices from CoinGecko, refreshed hourly.';
