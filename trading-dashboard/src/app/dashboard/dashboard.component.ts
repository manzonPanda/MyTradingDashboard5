import { Component, importProvidersFrom, OnDestroy, OnInit   } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from "@angular/common";
import { CalendarModule, CalendarEvent,CalendarMonthViewDay   } from 'angular-calendar';
import * as XLSX from 'xlsx';
import { Firestore, collection, addDoc, setDoc, doc,getDocs,onSnapshot   } from '@angular/fire/firestore';
import { addMonths, subMonths } from 'date-fns';
declare var $: any;
import { DataTablesModule, } from 'angular-datatables';
import { Subject } from 'rxjs';
import * as DataTables from 'datatables.net';
import 'datatables.net'; // Ensure DataTables functionality is available
import { provideHttpClient } from '@angular/common/http';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core'; // for default JS Date support
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';

interface Relation {
  relationName: string;
  relationId: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule,
    DataTablesModule,
    MatProgressBarModule,
    MatButtonModule,
    MatIconModule,
    FormsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatNativeDateModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})


// @Injectable({ providedIn: 'root' })
export class DashboardComponent {
  viewDate: Date = new Date();
  events: CalendarEvent[] = [];
  locale: string = 'en';
  tableData: any[] = [];
  rawData: any[] = [];
  dtOptions: any = {}; // Use 'any' or type the object more specifically later
  dtTrigger: Subject<any> = new Subject<any>();
  //uploading progress bar
  uploadProgress: number = 0;
  isUploading: boolean = false;
  showProgressBar = false;
  hideProgressBar = false;
  startDate: Date | null = null;
  endDate: Date | null = null;
  isLoading = false;
  relations: Relation[] = [];

  constructor(private firestore: Firestore,private http: HttpClient) {

  }

  async ngOnInit() {
    this.dtOptions = {
      destroy: true, 
      paging: true,
      searching: true,
      ordering: true,
      pageLength: 25,
      processing: true, // Show a loading spinner while data is being processed
      responsive: true,
			keys: true
    };

    // this.loadTradesRealtime(); // Start listening immediately
    await this.loadTrades(); // Wait for trades to load
    this.addTradesToCalendar();
    // console.log(this.events)

    // this.dtTrigger.next(null);// Emit a value to trigger the DataTable rendering

  }

  ngAfterViewInit() {
    // $('#myTable').DataTable(); // Apply DataTables after view is ready
  }

  ngOnDestroy(): void {
    this.dtTrigger.unsubscribe();
     // Clean up the DataTable when the component is destroyed
     if ($.fn.dataTable.isDataTable('#myTable')) {
        $('#myTable').DataTable().destroy();
     }
  }
  
  addMonth(date: Date): Date {
    return addMonths(date, 1);
  }
  
  subMonth(date: Date): Date {
    return subMonths(date, 1);
  }

 addTradesToCalendar() {
  // console.log("tableData::"+this.tableData)
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

  getPnLColor(day: CalendarMonthViewDay): string {
    if (!day.events.length) return 'bg-white';
    const pnl = day.events.reduce((sum, e) => sum + (e.meta?.profit || 0), 0);
    if (pnl > 0) return 'bg-green-100';
    if (pnl < 0) return 'bg-red-100';
    return 'bg-gray-100';
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

async onPaste(event: ClipboardEvent): Promise<void> {
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
      //If you're refreshing data multiple times (e.g., after upload or load), don't unsubscribe and reuse the old Subject. Instead, recreate it:
      this.dtTrigger.unsubscribe();
      this.dtTrigger = new Subject();
      this.dtTrigger.next(null)
      console.log("printing to DT")
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
      
      // Add 5 hours to datetime strings at column 0 and 8
      [0, 8].forEach(index => {
        if (cells[index]) {
          const [datePart, timePart] = cells[index].split(' ');
          const [year, month, day] = datePart.split('.').map(Number);
          const [hour, minute, second] = timePart.split(':').map(Number);

          const dateObj = new Date(year, month - 1, day, hour, minute, second);
          dateObj.setHours(dateObj.getHours() + 5);

          const formattedDate = `${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
          cells[index] = formattedDate;
        }
      });

      // Define which columns should be numbers
      // Indices for: Volume, Price, S/L, T/P, Close Price, Commission, Swap, Profit
      const numberColumns = [4, 5, 6, 7, 9, 10, 11, 12]; 
      // Loop and convert specific columns
      numberColumns.forEach(index => {
        if (cells[index] !== undefined) {
          cells[index] = cells[index].replace(/\s+/g, ''); // Remove spaces & parse to number
        }
      });

      //add 13th column-Net Profit
      cells[13] = (parseFloat(cells[10]) + parseFloat(cells[12])).toFixed(2)

      return cells;
    }); 

    this.tableData = rows;
    console.log(this.tableData)
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
  console.log('Uploading data...', this.tableData);
  const collectionRef = collection(this.firestore, 'trades');

  this.showProgressBar = true;
  this.hideProgressBar = false;
  this.isUploading = true;
  this.uploadProgress = 0;

  const total = this.tableData.length;
  let uploaded = 0;

  this.tableData.forEach(async (row) => {
    try {
      const documentId = row[0];
      const docRef = doc(collectionRef, documentId);
      await setDoc(docRef, {
        rowData: row
      });
      uploaded++;
      this.uploadProgress = Math.round((uploaded / total) * 100);
    } catch (error) {
      console.error('Error uploading row: ', error);
    }

    if (uploaded === total) {
      setTimeout(() => {
        this.isUploading = false;
        this.hideProgressBar = true; // Triggers CSS fade-out
        this.showProgressBar = false;
        this.uploadProgress = 0;
      }, 2000); // Wait for CSS transition
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

  loadTrades(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tradesRef = collection(this.firestore, 'trades');
      getDocs(tradesRef).then((querySnapshot) => {
        this.tableData = querySnapshot.docs.map(doc => doc.data()['rowData']);
        console.log(this.tableData)
        resolve(); // Notify that loading is done
      }).catch((error) => {
        console.error('Error loading trades:', error);
        reject(error);
      });
    });
  }
  
  copyColumns(index1: number, index2: number): void {
    const combinedValues = this.tableData.map(row => {
      return `${row[index1]}\t${row[index2]}`; // tab-separated
    });
    const textToCopy = combinedValues.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      alert('Two columns copied to clipboard!');
    });
  }
  
  getAllPagesFromDB(){ 
    const formattedStartDate = this.startDate
      ? `${this.startDate.getFullYear()}-${String(this.startDate.getMonth() + 1).padStart(2, '0')}-${String(this.startDate.getDate()).padStart(2, '0')}`
      : '';
    const formattedEndDate = this.endDate
      ? `${this.endDate.getFullYear()}-${String(this.endDate.getMonth() + 1).padStart(2, '0')}-${String(this.endDate.getDate()).padStart(2, '0')}`
      : '';

    const body = {
      "filter": {
        "and": [
          {
            "property": "Date",
            "date": {
              "on_or_after": formattedStartDate
            }
          },
          {
            "property": "Date",
            "date": {
              "on_or_before": formattedEndDate
            }
          }
        ]
      }
    }
    this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
    .subscribe({
      next: async (res:any) => {
        console.log(res)
        for (const page of res.results) {
          console.log(page.id)
          // const body = {
          //   "properties": {
          //     "Activity log": {
          //       "relation": [
          //         {
          //           "id": "22688a31-7d99-8167-b921-fb1703c158a4"
          //         }
          //       ]
          //     }
          //   }
          // }
            // try {
            //   const res: any = await firstValueFrom(
            //     this.http.post("http://localhost:3000/api/getRelationName", body)
            //   );

            //   if (res.results.length > 0) {
            //     console.log("RelationName already exists for", date);
            //     this.relations.push({ relationName: date, relationId: res.results[0].id })
            //   } else {
            //     console.log('done checking:', date);
            //     await this.createRelationId(date); // make this async if needed
            //   }
            // } catch (error) {
            //   this.isLoading = false;
            //   console.error('Error checking relation for', date, error);
            // }
        }
      },
      error: (err) => {
        console.error('Error:', err)
      }
    });
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkAndCreateRelationId(){
    if(!this.endDate){
      return
    }
    this.isLoading = true;
    const dateRange: string[] = [];
    for (
      let d = new Date(this.startDate ?? '');
      d <= (this.endDate ?? '');
      d.setDate(d.getDate() + 1)
    ) {
      const dayOfWeek = d.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      dateRange.push(`${month}-${day}-${year}`);
    }
    
    for (const date of dateRange) {
       const body = {
          "filter": {
            "property": "Name",
            "title": {
              "equals": date
            }
          }
        }
        try {
          const res: any = await firstValueFrom(
            this.http.post("http://localhost:3000/api/getRelationName", body)
          );

          if (res.results.length > 0) {
            console.log("RelationName already exists for", date);
            this.relations.push({ relationName: date, relationId: res.results[0].id })
          } else {
            console.log('done checking:', date);
            await this.createRelationId(date); // make this async if needed
          }
          
          // await this.delay(300); // optional
        } catch (error) {
          this.isLoading = false;
          console.error('Error checking relation for', date, error);
        }
    }
    this.isLoading = false;
    console.log('All dates checked');
    // console.log(this.relations)
    this.getAllPagesFromDB() //Patching relationIds to ActivityLog
  }

  async createRelationId(dateName:string): Promise<any>{
    const body = {
      "parent": {
        "database_id": "5e00bcb25c3d4276b1de54de3576894a"
      },
      "properties": {
        "Name": {
          "title": [
            {
              "text": {
                "content": dateName
              }
            }
          ]
        }
      }
    }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/createRelationId", body)
    );
    if (res) {
      this.relations.push({ relationName: dateName, relationId: res.id })
      console.log("created successful:"+dateName);
    } 

  }

}


