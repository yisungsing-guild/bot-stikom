const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Test parsing uploaded Excel file
const excelFiles = [
  'Penjelasan Prodi dan Karier Masa Depan (1).xlsx',
  'Penjelasan Prodi dan Karier Masa Depan.xlsx'
];

console.log('=== TESTING EXCEL PARSING ===\n');

for (const filename of excelFiles) {
  const filePath = path.join('uploads', filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    continue;
  }
  
  console.log(`\n--- ${filename} ---`);
  
  try {
    const workbook = XLSX.readFile(filePath, {
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellFormula: false
    });
    
    console.log(`Sheets: ${workbook.SheetNames.join(', ')}`);
    
    workbook.SheetNames.slice(0, 2).forEach(sheetName => {
      console.log(`\n[Sheet: ${sheetName}]`);
      const worksheet = workbook.Sheets[sheetName];
      
      // Show dimensions
      const range = worksheet['!ref'];
      console.log(`Range: ${range}`);
      
      // Try sheet_to_csv
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      console.log(`CSV length: ${csv.length}`);
      console.log(`CSV preview (first 300 chars): ${csv.substring(0, 300)}`);
      
      // Try sheet_to_html
      const html = XLSX.utils.sheet_to_html(worksheet);
      console.log(`HTML length: ${html.length}`);
      
      // Try sheet_to_json
      const json = XLSX.utils.sheet_to_json(worksheet);
      console.log(`JSON rows: ${json.length}`);
      if (json.length > 0) {
        console.log(`First row keys: ${Object.keys(json[0]).join(', ')}`);
      }
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}
