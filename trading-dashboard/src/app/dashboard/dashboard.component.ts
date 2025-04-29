import { Component, importProvidersFrom } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { CommonModule } from "@angular/common";
import { CalendarModule, CalendarEvent  } from 'angular-calendar';
import * as XLSX from 'xlsx';
import { Firestore, collection, addDoc, setDoc, doc,getDocs,onSnapshot   } from '@angular/fire/firestore';


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
  events: CalendarEvent[] = [];
  locale: string = 'en';
  tableData: any[] = [];
  rawData: any[] = [];

  constructor(private firestore: Firestore) {}

  ngOnInit() {
    this.loadTradesRealtime(); // Start listening immediately
  }
  
  
  addTradesToCalendar(): void {
    this.tableData.forEach(row => {
      const tradeDateString = row[0]; // Column 0: the date string
      const symbol = row[2];           // Column 2: symbol
      const type = row[3];             // Column 3: buy/sell
  
      const tradeDate = this.parseTradeDate(tradeDateString);
  
      if (tradeDate) {
        this.events = [
          ...this.events,
          {
            start: tradeDate,
            title: `${type.toUpperCase()} ${symbol}`,
            color: {
              primary: type.toLowerCase() === 'buy' ? '#1e90ff' : '#ad2121', // blue for buy, red for sell
              secondary: '#FAE3E3'
            },
            allDay: true,
            meta: {
              position: row[1],
              symbol: row[2],
              type: row[3],
              volume: parseFloat(row[4]),
              openPrice: parseFloat(row[5]),
              stopLoss: parseFloat(row[6]),
              takeProfit: parseFloat(row[7]),
              closeTime: new Date(row[8].replace(' ', 'T')),
              closePrice: parseFloat(row[9]),
              commission: parseFloat(row[10]),
              swap: parseFloat(row[11]),
              profit: parseFloat(row[12]),
            }
          }
        ];
      
      }
    });
  }

  countWins(events: any[]): number {
    return events.filter(event => event.meta?.profit > 0).length;
  }
  
  countLosses(events: any[]): number {
    return events.filter(event => event.meta?.profit < 0).length;
  }
  
  totalProfit(events: any[]): number {
    console.log(events);
    return events
      .filter(event => event.meta?.profit > 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  
  totalLoss(events: any[]): number {
    return events
      .filter(event => event.meta?.profit < 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  parseTradeDate(dateStr: string): Date | null {
    // MT5 format is like "2025.03.25 09:10:25"
    const parts = dateStr.split(' ');
    if (parts.length !== 2) return null;
  
    const dateParts = parts[0].split('.');
    const timeParts = parts[1].split(':');
  
    if (dateParts.length !== 3 || timeParts.length !== 3) return null;
  
    return new Date(
      parseInt(dateParts[0]),  // Year
      parseInt(dateParts[1]) - 1, // Month (0-based)
      parseInt(dateParts[2]),  // Day
      parseInt(timeParts[0]),  // Hours
      parseInt(timeParts[1]),  // Minutes
      parseInt(timeParts[2])   // Seconds
    );
  }

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
    // const rows = data.split('\n').map(row => row.split('\t')); // For tab-separated values
    // Alternatively, for CSV: const rows = data.split('\n').map(row => row.split(','));
    const rows = data
    .split('\n')
    .map((row: string) => row.trim()) 
    .filter((row: string) => row.length > 0) // Remove empty lines
    .map((row: string) => {
      const cells = row.split('\t');
      
      // Define which columns should be numbers
      const numberColumns = [4, 5, 6, 7, 9, 10, 11, 12]; 
      // Indices for: Volume, Price, S/L, T/P, Close Price, Commission, Swap, Profit

      // Loop and convert specific columns
      numberColumns.forEach(index => {
        if (cells[index] !== undefined) {
          cells[index] = cells[index].replace(/\s+/g, ''); // Remove spaces & parse to number
        }
      });

      return cells;
    }); 

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
    const collectionRef = collection(this.firestore, 'trades');
    this.tableData.forEach(async (row) => {
      try {
        const documentId = row[0];
        const docRef = doc(collectionRef, documentId);
        await setDoc(docRef, {
          rowData: row
        });
      
        console.log('Row uploaded successfully');
      } catch (error) {
        console.error('Error uploading row: ', error);
      }
    });

  }

  loadTradesRealtime() {
    const collectionRef = collection(this.firestore, 'trades');
    onSnapshot(collectionRef, (querySnapshot) => {
      const loadedData: any[] = [];
  
      querySnapshot.forEach((doc) => {
        loadedData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('Real-time trades:', loadedData);
      this.tableData = loadedData;
    });
  }

  
}
