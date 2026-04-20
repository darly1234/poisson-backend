const XLSX = require('xlsx');
const path = require('path');

const workbook = XLSX.readFile('c:/poisson-erp/PowerP2_-_Editora_Poisson-1.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log('Columns found:', Object.keys(data[0] || {}));
console.log('Sample row:', data[0]);
