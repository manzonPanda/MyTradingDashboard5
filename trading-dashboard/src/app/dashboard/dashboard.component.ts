import { Component, importProvidersFrom } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { CommonModule } from "@angular/common";
import { CalendarModule } from 'angular-calendar';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  viewDate: Date = new Date();
  events = [];
  tableData: any[] = [];
  rawData: any[] = [];

  onDayClicked(date: Date) {
    alert('Clicked: ' + date.toDateString());
  }

onPaste(event: ClipboardEvent): void {
    const clipboardItems = event.clipboardData?.items;
    if (clipboardItems) {
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type === 'text/plain' || item.type === 'text/tab-separated-values') {
          const text = event.clipboardData?.getData('text/plain');
          if (text) {
            this.parseTableData(text);
          }
        }
      }
    }
  }

  parseTableData(data: string): void {
    // Example: Handle pasted tab-separated or comma-separated values (CSV)
    const rows = data.split('\n').map(row => row.split('\t')); // For tab-separated values
    // Alternatively, for CSV: const rows = data.split('\n').map(row => row.split(','));

    this.tableData = rows;
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];  // Get the selected file
    if (file) {
      this.readExcelFile(file);  // Parse the Excel file
    }
  }

    // This method reads the Excel file and converts it into a usable format
    readExcelFile(file: File): void {
      const reader = new FileReader();
  
      reader.onload = (e: any) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
  
        // Assume that the first sheet contains the data
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
  
        // Convert the sheet to a 2D array (array of rows and columns)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
        // Store the raw data for later reference
        this.rawData = jsonData;
  
        // Find the start and end rows based on the text in the first column
        const startRowIndex = this.findRowIndex('Positions')+1;
        const endRowIndex = this.findRowIndex('Orders')-1;
  
        // Slice the data between "Positions" and "Orders"
        if (startRowIndex !== -1 && endRowIndex !== -1 && endRowIndex > startRowIndex) {
          this.tableData = this.rawData.slice(startRowIndex, endRowIndex + 1); // Include "Orders" row
        } else {
          console.error('Start or end row not found');
        }
  
        // Optional: Show the result in the console for debugging
        console.log('Filtered data:', this.tableData);
      };
  
      // Read the file as an array buffer
      reader.readAsArrayBuffer(file);
    }

    // This method finds the row index of the first occurrence of the given text in the first column
  findRowIndex(searchText: string): number {
    for (let i = 0; i < this.rawData.length; i++) {
      if (this.rawData[i][0] && this.rawData[i][0].toString().toLowerCase() === searchText.toLowerCase()) {
        return i; // Return the index of the row where the text is found
      }
    }
    return -1; // Return -1 if the text is not found
  }

  // Optional: Implement file upload to a server or Firebase
  onUpload(): void {
    // For example, upload the parsed data to Firebase or your server
    console.log('Uploading data...', this.tableData);
  }

}
