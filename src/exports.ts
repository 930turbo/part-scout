import ExcelJS from 'exceljs';
import type { Store } from './store.js';
export async function monitorWorkbook(store: Store, id: number, from: number, to: number) {
  const monitor = store.monitor(id);
  if (!monitor) throw new Error('Monitor not found');
  const records = store.monitorExport(id, from, to);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Part Scout';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Found parts', { views: [{ state: 'frozen', ySplit: 5 }] });
  sheet.mergeCells('A1:P1');
  sheet.getCell('A1').value = monitor.name;
  sheet.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF93E4C1' } };
  sheet.getRow(1).height = 34;
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172423' } };
  sheet.mergeCells('A2:P2');
  sheet.getCell('A2').value =
    `Found from ${new Date(from).toISOString()} to ${new Date(to).toISOString()} (end exclusive)`;
  sheet.mergeCells('A3:P3');
  sheet.getCell('A3').value =
    `${records.length} listings · Exported ${new Date().toISOString()} · Times in UTC`;
  const columns = [
    'Found at',
    'Last seen',
    'Source',
    'Year',
    'Model',
    'Part',
    'Price',
    'Currency',
    'Mileage',
    'Grade',
    'Recycler / seller',
    'Location',
    'Stock ID',
    'Listing',
    'Photos',
    'Notes',
  ];
  sheet.getRow(5).values = columns;
  sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF315B48' } };
  for (const r of records) {
    const row = sheet.addRow([
      new Date(r.foundAt),
      new Date(r.observedAt),
      r.source,
      r.year,
      r.model,
      r.part,
      r.price,
      r.currency,
      r.miles,
      r.grade,
      r.dealer,
      [r.city, r.state].filter(Boolean).join(', '),
      r.stock,
      r.url || '',
      [...new Set([r.image, ...r.images].filter(Boolean))].join('\n'),
      r.note,
    ]);
    row.getCell(1).numFmt = row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm';
    row.getCell(7).numFmt = '#,##0.00';
    if (r.url) row.getCell(14).value = { text: 'Open listing', hyperlink: r.url };
    if (row.number % 2 === 0)
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6F4' } };
    row.alignment = { vertical: 'top', wrapText: true };
  }
  [22, 22, 15, 10, 25, 24, 14, 10, 14, 10, 30, 25, 20, 20, 45, 40].forEach(
    (width, i) => (sheet.getColumn(i + 1).width = width),
  );
  sheet.autoFilter = { from: 'A5', to: `P${Math.max(5, sheet.rowCount)}` };
  const history = workbook.addWorksheet('Price history');
  history.columns = [
    { header: 'Listing ID', key: 'id', width: 68 },
    { header: 'Time (UTC)', key: 'at', width: 24 },
    { header: 'Price', key: 'price', width: 15 },
  ];
  for (const r of records)
    for (const p of store.detail(r.id)!.history.filter((p) => p.at >= from && p.at < to)) {
      const row = history.addRow({ id: r.id, at: new Date(p.at), price: p.price });
      row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm';
      row.getCell(3).numFmt = '#,##0.00';
    }
  history.getRow(1).font = { bold: true };
  history.views = [{ state: 'frozen', ySplit: 1 }];
  const details = workbook.addWorksheet('Listing details');
  details.columns = [
    { header: 'Listing ID', key: 'id', width: 68 },
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 85 },
  ];
  details.getRow(1).font = { bold: true };
  details.views = [{ state: 'frozen', ySplit: 1 }];
  for (const record of records) {
    const fields = {
      Description: record.description,
      Condition: record.condition,
      Distance: record.distance,
      Shipping: record.shipping,
      Phone: record.phone,
      Email: record.email,
      Address: record.address,
      'Buying options': record.buyingOptions,
      'Listing ends': record.endsAt,
      Active: record.active,
      Images: record.images,
      Attributes: record.attributes,
      'Original source record': record.raw,
    };
    for (const [name, value] of Object.entries(fields)) {
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
      for (let offset = 0; offset < Math.max(1, text.length); offset += 32000) {
        const row = details.addRow({
          id: record.id,
          field: offset ? `${name} (continued ${Math.floor(offset / 32000) + 1})` : name,
          value: text.slice(offset, offset + 32000),
        });
        row.alignment = { vertical: 'top', wrapText: true };
      }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
