// "$25,100": amounts over $1,000 rounded to the nearest $100, smaller ones to the dollar.
export function aboutUsd(v) {
  const n = v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v);
  return `$${n.toLocaleString('en-US')}`;
}

// "200×", "6,200×": two significant figures, rounded down so it never overstates.
export function multiple(now, then) {
  const x = now / then;
  if (!(x > 0)) return '';
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(x)) - 1));
  return `${(Math.floor(x / mag) * mag).toLocaleString('en-US')}×`;
}

export function pctChange(now, then) {
  return Math.round(((now - then) / then) * 100);
}
