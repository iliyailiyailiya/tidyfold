/**
 * A deliberately messy, synthetic dataset for trying the app.
 * Generated in the browser — no network.
 */
export function makeSampleCsv(): File {
  const cities = ['Chisinau', ' Chişinău', 'Chisinău ', 'Kishinev', 'Paris', 'paris', 'Berlin', 'Berlin ', 'São Paulo', 'Sao Paulo'];
  const products = ['Notebook', 'Pen', 'Backpack', 'Desk lamp', 'Stapler'];
  const people = ['Ana Popescu', 'Ion Rusu', 'Maria Ciobanu', 'Luca Bianchi', 'Emma Martin', 'Jonas Weber', 'Lia Souza', 'Mihai Lungu'];
  const lines = ['order_id,customer,city,product,quantity,unit_price,order_date,zip,paid'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  for (let i = 1; i <= 240; i++) {
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
    const month = String(1 + Math.floor(rnd() * 12)).padStart(2, '0');
    const qty = rnd() < 0.05 ? '' : String(1 + Math.floor(rnd() * 9));
    const price = (2 + rnd() * 80).toFixed(2);
    const name = rnd() < 0.08 ? `${pick(people)} ` : pick(people);
    const zip = rnd() < 0.1 ? '' : String(Math.floor(rnd() * 9000) + 1000).padStart(5, '0');
    const paid = rnd() < 0.85 ? 'true' : 'false';
    const city = rnd() < 0.04 ? '' : pick(cities);
    lines.push(`${1000 + i},${name},"${city}",${pick(products)},${qty},${price},2024-${month}-${day},${zip},${paid}`);
    if (rnd() < 0.06) lines.push(lines[lines.length - 1]!); // exact duplicate
  }
  return new File([lines.join('\n')], 'sample-orders.csv', { type: 'text/csv' });
}
